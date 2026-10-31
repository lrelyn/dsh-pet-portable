// 睡眠 / 唤醒状态机验证
//
// 背景（2026-10-30 用户反馈「查看一下睡觉状态，唤醒又被挤掉了」，前后说了五次）：
// 睡着后被点/被投喂/被菜单点播时，别的代码路径会抢走正在播的醒来动画，
// 而 switchTo() 一开头就把旧 <video> 的 onended 置空 → 醒来动画的「播完」回调
// 永远不来 → PET_SLEEP_Waking / PET_SLEEP_On 双双卡 true → 宠物定格，
// 之后点它没反应、也不会再自己动。
//
// 这个文件把状态机真的跑一遍（不是读源码猜）：
//   从 sprite.js 里用正则摘出 PET_SLEEP_* / playOnce / moodCue 的方法体，
//   用可控假时钟 + 假 this 拼成一台真机器，然后按真实时序驱动它。
// 另有一节做源码结构断言（调用点白名单、守卫位置、handleEnded 分支顺序）——
// 那些顺序一颠倒就是上面那个 bug 复发，光跑逻辑抓不到。
const path = require('node:path');
const fs = require('node:fs');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'app', 'runtime', 'electron-helper');

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// ---------------------------------------------------------------- 源码抽取
const rawSprite = fs.readFileSync(path.join(HELPER, 'sprite.js'), 'utf8');
const rawEvents = fs.readFileSync(path.join(HELPER, 'events.js'), 'utf8');
// CRLF 归一化必须有：sprite.js 全篇 \r\n，\n 正则匹配不到（本 session 第三次栽在这）
const spriteSrc = rawSprite.replace(/\r\n/g, '\n');

function extract(name, params = '\\(\\)') {
  const re = new RegExp('\\n  ' + name + params + ' \\{[\\s\\S]*?\\n  \\}\\n');
  const m = spriteSrc.match(re);
  return m ? m[0].trim() : null;
}

const NAMES = [
  ['PET_SLEEP_Start', '\\(\\)'],
  ['PET_SLEEP_Loop', '\\(\\)'],
  ['PET_SLEEP_Wake', '\\(\\)'],
  ['PET_SLEEP_EndSleep', '\\(\\)'],
  ['PET_SLEEP_Skip', '\\(\\)'],
  ['PET_SLEEP_Tick', '\\(\\)'],
  ['PET_SLEEP_Touch', '\\(\\)'],
  ['PET_SLEEP_WasAsleep', '\\(\\)'],
  ['playOnce', '\\(name\\)'],
  ['moodCue', '\\(to\\)'],
];

console.log('=== 0. 从 sprite.js 摘出睡眠方法体 ===');
const bodies = {};
for (const [n, p] of NAMES) {
  bodies[n] = extract(n, p);
  ok(!!bodies[n], `找到 ${n} 的方法体`);
}
if (Object.values(bodies).some((b) => !b)) {
  console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(1);
}

// ---------------------------------------------------------------- 常量（从源码解析，不写死副本）
const numConst = (name) => {
  const m = spriteSrc.match(new RegExp('const ' + name + ' = ([0-9*\\s+]+);'));
  return m ? new Function('return ' + m[1] + ';')() : NaN;
};
const strConst = (name) => {
  const m = spriteSrc.match(new RegExp('const ' + name + ' = "([^"]+)";'));
  return m ? m[1] : null;
};

console.log('\n=== 1. 常量可解析 ===');
const WAKE_MAX_MS = numConst('PET_SLEEP_WAKE_MAX_MS');
const SLEEP_IN = strConst('PET_SLEEP_IN');
const SLEEP_LOOP = strConst('PET_SLEEP_LOOP');
const SLEEP_WAKE = strConst('PET_SLEEP_WAKE');
ok(Number.isFinite(WAKE_MAX_MS) && WAKE_MAX_MS > 0, 'PET_SLEEP_WAKE_MAX_MS 是正数', String(WAKE_MAX_MS));
ok(SLEEP_IN && SLEEP_LOOP && SLEEP_WAKE && SLEEP_IN !== SLEEP_LOOP && SLEEP_LOOP !== SLEEP_WAKE, `${SLEEP_IN} / ${SLEEP_LOOP} / ${SLEEP_WAKE} 三段名字互不相同`);

// ---------------------------------------------------------------- 拼装真机器
// 假时钟：performance.now() 完全可控，看门狗/入睡计时才能确定性地推进。
let clock = 1000;
const fakePerf = { now: () => clock };

const buildMachine = new Function(
  'console', 'setTimeout', 'clearTimeout', 'performance',
  'PET_SLEEP_WAKE_MAX_MS', 'PET_SLEEP_IN', 'PET_SLEEP_LOOP', 'PET_SLEEP_WAKE',
  'PET_SLEEP_Seconds', 'PET_SLEEP_IdleSeconds',
  'return ({\n' + NAMES.map(([n]) => bodies[n]).join(',\n') + '\n});',
);

function freshMachine(opt = {}) {
  clock = 1000;
  const timers = new Map();
  let timerId = 1;
  const setTimeoutStub = (fn, ms) => { const id = timerId++; timers.set(id, { fn, ms }); return id; };
  const clearTimeoutStub = (id) => { timers.delete(id); };

  const moodEvents = [];
  const mood = {
    enabled: true,
    cue: () => (opt.cue === undefined ? '心情引导动作' : opt.cue),
    event: (name) => { moodEvents.push(name); return null; },
  };

  const log = [];
  const m = buildMachine(
    { log: () => {}, warn: () => {}, info: () => {}, error: () => {} },
    setTimeoutStub, clearTimeoutStub, fakePerf,
    WAKE_MAX_MS, SLEEP_IN, SLEEP_LOOP, SLEEP_WAKE,
    opt.secs === undefined ? () => 600 : () => opt.secs,
    opt.need === undefined ? () => 300 : () => opt.need,
  );

  Object.assign(m, {
    // 睡眠状态字段（与构造函数里的初值一致）
    PET_SLEEP_On: false,
    PET_SLEEP_Waking: false,
    PET_SLEEP_WokeByClick: false,
    PET_SLEEP_At: 0,
    PET_SLEEP_Timer: null,
    PET_SLEEP_WakeBy: 0,
    anim: '待机呼吸',
    once: false,
    mood,
    log,
    moodEvents,
    timers,
    // 依赖桩
    hasAnim: (n) => (opt.missing || []).indexOf(n) < 0,
    switchTo(n, once) { log.push('switchTo:' + n + ':' + (once ? 'once' : 'loop')); this.anim = n; this.once = once; },
    playIdle() { log.push('playIdle'); },
    renderMood() { log.push('renderMood'); },
    moodSaveThrottled() { log.push('moodSave'); },
    clearGap() { log.push('clearGap'); },
    stopMove() { log.push('stopMove'); },
    stopThrow() { log.push('stopThrow'); },
  });
  return m;
}

// 入睡 → 循环 → 醒来 → 播完，这条主干任何一步断掉都是「唤醒被挤掉」
function sleepToLoop(m) {
  m.PET_SLEEP_Start();
  m.PET_SLEEP_Loop();   // 模拟睡觉第一段播完（handleEnded 里的接力）
}
function wakeUp(m) {
  m.PET_SLEEP_Touch();  // 被点/被摸：Touch = 重置计时 + Wake
}

// ---------------------------------------------------------------- 2. 主干时序
console.log('\n=== 2. 睡着 → 循环 → 醒来（主干）===');
{
  const m = freshMachine();
  m.PET_SLEEP_Start();
  ok(m.PET_SLEEP_On === true, '入睡后 On=true');
  ok(m.anim === SLEEP_IN && m.once === true, `先播第一段 ${SLEEP_IN}（once）`, m.anim);
  ok(m.log.includes('switchTo:' + SLEEP_IN + ':once'), '确实切到了第一段');
  ok(m.PET_SLEEP_Timer !== null, '排了 8 秒兜底定时器');
  ok(m.moodEvents.includes('sleep'), '入睡记了 sleep 心情事件');

  m.PET_SLEEP_Loop();
  ok(m.anim === SLEEP_LOOP && m.once === false, `第二段 ${SLEEP_LOOP} 用 loop 播`, `${m.anim}/${m.once}`);
  ok(m.PET_SLEEP_On === true, '循环期间仍是睡眠态');

  wakeUp(m);
  ok(m.PET_SLEEP_Waking === true, '醒来 → Waking=true');
  ok(m.PET_SLEEP_On === true, '醒来期间 On 故意保持 true（挡随机链）');
  ok(m.anim === SLEEP_WAKE && m.once === true, `播第三段 ${SLEEP_WAKE}`, m.anim);
  ok(m.PET_SLEEP_WakeBy > clock, '看门狗截止时间已设', String(m.PET_SLEEP_WakeBy));
  ok(m.moodEvents.filter((e) => e === 'wake').length === 1, '醒来 +3 只记一次');
}

// ---------------------------------------------------------------- 3. 连点不再掐掉醒来（本次修复的第一主因）
console.log('\n=== 3. 连点 / 反复触发唤醒 ===');
{
  const m = freshMachine();
  sleepToLoop(m);
  wakeUp(m);
  const before = m.log.slice();
  // 用户连点三下：每一次 pointerdown 都会走到 PET_SLEEP_Touch → Wake
  m.PET_SLEEP_Touch();
  m.PET_SLEEP_Touch();
  m.PET_SLEEP_Touch();
  ok(m.PET_SLEEP_Waking === true, '连点后仍在醒来（没被 Skip 掉）');
  ok(m.PET_SLEEP_On === true, '连点后仍挡着随机链');
  ok(m.anim === SLEEP_WAKE, '连点后动画仍是醒来段', m.anim);
  ok(m.log.filter((x) => x === 'playIdle').length === 0, '连点没有触发 playIdle（旧实现会当场 Skip）');
  ok(m.log.length === before.length, '连点没有再切任何动画', `${before.length} → ${m.log.length}`);
  ok(m.moodEvents.filter((e) => e === 'wake').length === 1, '连点没有重复记 wake');
}

// ---------------------------------------------------------------- 4. 醒来播完：真的能回随机链
console.log('\n=== 4. 醒来播完 → 脱离睡眠态 ===');
{
  const m = freshMachine();
  sleepToLoop(m);
  wakeUp(m);
  // 复现 handleEnded 里那段（顺序见第 8 节源码断言），确认清标志后 playOnce 立刻可用
  m.PET_SLEEP_Waking = false;
  m.PET_SLEEP_On = false;
  m.PET_SLEEP_At = fakePerf.now();
  m.PET_SLEEP_WakeBy = 0;
  m.playOnce('待机呼吸');
  ok(m.anim === '待机呼吸', '醒完后能正常播待机', m.anim);
  ok(m.log.includes('switchTo:待机呼吸:once'), 'playOnce 真的切了动画');
  ok(m.PET_SLEEP_WakeBy === 0, '看门狗已清零');
}

// ---------------------------------------------------------------- 5. playOnce / moodCue 的睡眠守卫
console.log('\n=== 5. 睡眠期间拒绝换动画（全局收口）===');
{
  const m = freshMachine();
  sleepToLoop(m);
  const before = m.log.length;
  m.playOnce('开心跃动');
  ok(m.anim === SLEEP_LOOP, '睡着时 playOnce 被拒，当前动画不变', m.anim);
  ok(m.log.length === before, '睡着时 playOnce 没有切任何东西');
  ok(m.once === false, 'once 也没被动过（守卫在改 anim 之前 return）');

  m.moodCue('happy');
  ok(m.anim === SLEEP_LOOP, '睡着时 moodCue 被拒');
  ok(m.log.length === before, '睡着时 moodCue 没切动画');

  // 醒来期间（Waking=true, On=true）同样要拦 —— 否则醒来被引导动画顶掉
  wakeUp(m);
  const mid = m.log.length;
  m.playOnce('打瞌睡被惊醒');
  ok(m.anim === SLEEP_WAKE, '醒来期间 playOnce 也被拒', m.anim);
  ok(m.log.length === mid, '醒来期间没切动画');
}

// ---------------------------------------------------------------- 6. EndSleep：投喂/菜单/工作/回归剧情专用
console.log('\n=== 6. PET_SLEEP_EndSleep（静默脱离）===');
{
  const m = freshMachine();
  sleepToLoop(m);
  ok(m.PET_SLEEP_On === true, '前置：睡着');
  const r = m.PET_SLEEP_EndSleep();
  ok(r === true, '返回「调用前确实在睡」');
  ok(m.PET_SLEEP_On === false, 'On 被清');
  ok(m.PET_SLEEP_Waking === false, 'Waking 被清（不会留僵尸标志）');
  ok(m.PET_SLEEP_WakeBy === 0, '看门狗被清');
  ok(m.PET_SLEEP_Timer === null, '睡眠定时器被清');
  ok(!m.log.some((x) => x === 'switchTo:' + SLEEP_WAKE + ':once'), '**没有**播醒来动画（正因为不播，才不会有东西被顶掉）');
  ok(m.moodEvents.filter((e) => e === 'wake').length === 1, '脱离睡眠仍记一次 wake（+3 不丢）');
  // 之后的动画必须能正常播
  m.playOnce('吃小鱼干');
  ok(m.anim === '吃小鱼干', '脱离后立刻能播自己的动画', m.anim);

  // 已处于醒来中再 EndSleep：不该重复记 wake（Wake 已经记过）
  const m2 = freshMachine();
  sleepToLoop(m2);
  wakeUp(m2);
  const r2 = m2.PET_SLEEP_EndSleep();
  ok(r2 === true, '从醒来态 EndSleep 也返回 true');
  ok(m2.PET_SLEEP_Waking === false && m2.PET_SLEEP_On === false, '醒来态也被彻底清干净');
  ok(m2.moodEvents.filter((e) => e === 'wake').length === 1, '不重复记 wake（Wake 那次已算）');

  // 没睡时调用是空操作
  const m3 = freshMachine();
  const r3 = m3.PET_SLEEP_EndSleep();
  ok(r3 === false, '没睡时 EndSleep 返回 false');
  ok(m3.moodEvents.length === 0, '没睡时不记任何心情事件');

  // 2026-10-31 回归：EndSleep 无条件重置 PET_SLEEP_At，而 WORK_Start() 每
  // 空闲 300 秒就调它一次 —— 午后档要 900 秒才睡，于是永远睡不成。
  // 清醒时调用必须是纯 no-op，绝不能碰睡眠计时。
  const m4 = freshMachine();
  m4.PET_SLEEP_At = 12345;
  clock += 60000;
  m4.PET_SLEEP_EndSleep();
  ok(m4.PET_SLEEP_At === 12345, '没睡时 EndSleep **不改**睡眠计时（否则自动工作会不断推远入睡）');

  // 睡着时反过来必须重置：醒来后要重新攒空闲时间
  const m5 = freshMachine();
  sleepToLoop(m5);
  const beforeAt = m5.PET_SLEEP_At;
  clock += 60000;
  m5.PET_SLEEP_EndSleep();
  ok(m5.PET_SLEEP_At !== beforeAt, '睡着时 EndSleep 重置睡眠计时（醒来重新攒空闲）');
  ok(m5.PET_SLEEP_At === clock, '重置到「现在」');
}

// ---------------------------------------------------------------- 7. 看门狗：醒来超时强制脱离
console.log('\n=== 7. 醒来看门狗 ===');
{
  const m = freshMachine();
  sleepToLoop(m);
  wakeUp(m);
  // 时间还没到：不该动手
  clock += WAKE_MAX_MS - 100;
  m.PET_SLEEP_Tick();
  ok(m.PET_SLEEP_Waking === true, '未超时 → 继续等醒来播完');
  ok(m.PET_SLEEP_On === true, '未超时 → 仍是睡眠态');
  // 超时：强制脱离
  clock += 200;
  m.PET_SLEEP_Tick();
  ok(m.PET_SLEEP_Waking === false, '超时 → Waking 被强制清掉');
  ok(m.PET_SLEEP_On === false, '超时 → 脱离睡眠态（不再永久定格）');
  ok(m.PET_SLEEP_WakeBy === 0, '超时 → 看门狗清零');
  ok(m.log.includes('playIdle'), '超时 → 回到随机链', m.log.slice(-3).join(' | '));
}

// ---------------------------------------------------------------- 8. 素材缺失时不进入「假睡」
console.log('\n=== 8. 素材缺失的兜底 ===');
{
  const m = freshMachine({ missing: [SLEEP_IN] });
  m.PET_SLEEP_Start();
  ok(m.PET_SLEEP_On === false, '第一段缺失 → 不置 On（不制造假睡）');
  ok(m.anim === '待机呼吸', '第一段缺失 → 当前动画不动', m.anim);

  const m2 = freshMachine();
  m2.PET_SLEEP_Start();
  m2.PET_SLEEP_Waking = false;
  const m3 = freshMachine({ missing: [SLEEP_LOOP] });
  m3.PET_SLEEP_On = true;        // 手工造「第一段有、第二段没有」的半边配置
  m3.PET_SLEEP_Loop();
  ok(m3.PET_SLEEP_On === false, '循环段缺失 → 直接脱离睡眠态（不回落到假睡）');
  ok(m3.log.includes('playIdle'), '循环段缺失 → 回随机链');

  const m4 = freshMachine({ missing: [SLEEP_WAKE] });
  m4.PET_SLEEP_On = true;
  m4.PET_SLEEP_Loop();
  m4.PET_SLEEP_Wake();
  ok(m4.PET_SLEEP_On === false, '醒来段缺失 → 直接脱离睡眠态');
  ok(m4.PET_SLEEP_Waking === false, '醒来段缺失 → 不留下 Waking 僵尸标志');
}

// ---------------------------------------------------------------- 9. 源码结构断言（顺序一颠倒 bug 就复发）
console.log('\n=== 9. 源码结构（顺序 / 调用点白名单）===');
{
  // 9.1 playOnce 的守卫必须在 `this.anim = name` 之前
  const onceBody = bodies.playOnce;
  const guardAt = onceBody.indexOf('if (this.PET_SLEEP_On)');
  const assignAt = onceBody.indexOf('this.anim = name');
  ok(guardAt > 0, 'playOnce 里有睡眠守卫');
  ok(guardAt < assignAt, '守卫写在 this.anim = name **之前**（否则 handleEnded 认不出醒来段）', `${guardAt} vs ${assignAt}`);

  // 9.2 PET_SLEEP_Wake 里对 Waking 的处理必须是「幂等返回」，绝不能调 Skip
  const wakeBody = bodies.PET_SLEEP_Wake;
  const wakingLine = wakeBody.split('\n').find((l) => /if \(this\.PET_SLEEP_Waking\)/.test(l)) || '';
  ok(/if \(this\.PET_SLEEP_Waking\) return;/.test(wakingLine), 'Waking 时是幂等 return（不是 Skip）', wakingLine.trim());
  ok(!/PET_SLEEP_Skip/.test(wakingLine), '那行里没有 PET_SLEEP_Skip（旧实现就是它掐掉醒来的）');

  // 9.3 handleEnded 的醒来完成分支必须排在「On → Loop」守卫之前
  const he = spriteSrc.match(/\n  handleEnded\(\) \{[\s\S]*?\n  \}\n/);
  ok(!!he, '找到 handleEnded 方法体');
  if (he) {
    const hb = he[0];
    const wakingAt = hb.indexOf('this.PET_SLEEP_Waking && this.anim === PET_SLEEP_WAKE');
    const onLoopAt = hb.indexOf('if (this.PET_SLEEP_On) { this.PET_SLEEP_Loop(); return; }');
    ok(wakingAt > 0, 'handleEnded 里有「醒来播完」分支');
    ok(onLoopAt > 0, 'handleEnded 里有「还在睡就回循环」分支');
    ok(wakingAt < onLoopAt, '醒来完成分支在睡姿守卫**之前**（否则醒来播完又睡回去）', `${wakingAt} vs ${onLoopAt}`);
  }

  // 9.4 PET_SLEEP_Wake() 的调用点白名单：只允许「真的要播醒来动画」的三类
  //     —— 菜单里明确点了第三段 / PET_SLEEP_Touch 内部（被摸被点）/ vitals 睡饱
  const lines = spriteSrc.split('\n');
  const touchStart = lines.findIndex((l) => /^\s+PET_SLEEP_Touch\(\) \{/.test(l));
  const touchEnd = touchStart >= 0 ? lines.findIndex((l, i) => i > touchStart && /^\s+\},\s*$|^\s+\}\s*$/.test(l)) : -1;
  const callLines = [];
  lines.forEach((line, i) => {
    if (/this\.PET_SLEEP_Wake\(\)/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) callLines.push({ n: i + 1, line: line.trim() });
  });
  const allowed = (c) => /picked === PET_SLEEP_WAKE/.test(c.line)     // 菜单里明确点了「睡觉第三段」
    || (touchStart >= 0 && c.n - 1 > touchStart && c.n - 1 < touchEnd) // PET_SLEEP_Touch 方法体内
    || /PET_SLEEP_On\) this\.PET_SLEEP_Wake\(\)/.test(c.line);         // vitals wakeUp 事件
  const stray = callLines.filter((c) => !allowed(c));
  ok(stray.length === 0, 'PET_SLEEP_Wake() 没有「先唤醒再立刻切走」的调用点', stray.map((s) => s.n + ':' + s.line).join(' | '));
  ok(callLines.length >= 3, `仍在调 PET_SLEEP_Wake() 的地方共 ${callLines.length} 处（菜单/触摸/睡饱自然醒）`);

  // 9.5 反方向：EndSleep 必须真的被那些「自己马上要播动画」的地方用上
  const endSleepCalls = (spriteSrc.match(/this\.PET_SLEEP_EndSleep\(\)/g) || []).length;
  ok(endSleepCalls >= 4, `EndSleep 至少被 4 处调用（投喂/菜单/工作/回归剧情），实际 ${endSleepCalls}`);

  // 9.5b 2026-10-31 回归源头：EndSleep 无条件重置 PET_SLEEP_At，而 WORK_Start()
  // 也调它（每空闲 300 秒自动工作一次）→ 午后档要 900 秒才睡，计时每 300 秒
  // 被清回 0，永远睡不着。这条断言钉死「只有真的在睡才重置」。
  ok(/if \(was\)\s*this\.PET_SLEEP_At = performance\.now\(\);/.test(bodies.PET_SLEEP_EndSleep || ''),
    'EndSleep 的睡眠计时重置被 `if (was)` 守住（否则自动工作会无限推远入睡）');
  ok(!/^\s*this\.PET_SLEEP_At = performance\.now\(\);\s*$/m.test(bodies.PET_SLEEP_EndSleep || ''),
    'EndSleep 里没有裸的 PET_SLEEP_At 重置');

  // 9.6 events.js 的两处守卫
  ok(/if \(this\.PET_SLEEP_On\) return;[\s\S]{0,120}?if \(!this\.pet\.workStatusEnabled\) return;/.test(rawEvents),
    'events.js onWorkTick 有睡眠守卫（本地检测器每 5 秒一次，旧版会顶掉醒来）');
  ok(/if \(this\.PET_SLEEP_On\) return;[\s\S]{0,120}?if \(!state \|\| !state\.ok\) return;/.test(rawEvents),
    'events.js showBalanceNow 有睡眠守卫');

  // 9.7 dispose 要清看门狗
  const disposeBody = spriteSrc.match(/\n  dispose\(\) \{[\s\S]*?\n  \}\n/);
  ok(!!disposeBody && /PET_SLEEP_WakeBy = 0/.test(disposeBody[0]), 'dispose() 里清掉 PET_SLEEP_WakeBy');
  ok(!!disposeBody && /clearInterval\(this\._sleepTimer\)/.test(disposeBody[0]), 'dispose() 里仍清 _sleepTimer');
}

// ---------------------------------------------------------------- 10. 徽标联动（睡着显示 😴）
console.log('\n=== 10. 与徽标的联动 ===');
{
  // PET_SLEEP_On 是 renderMood 判断 😴 的输入，改名/移动会静默失效，这里钉住它
  const moodEl = spriteSrc.match(/\n  renderMood\(\) \{[\s\S]*?\n  \}\n/);
  ok(!!moodEl, '找到 renderMood 方法体');
  if (moodEl) {
    ok(/sleeping:\s*this\.PET_SLEEP_On === true/.test(moodEl[0]), 'renderMood 用 this.PET_SLEEP_On 作为 sleeping 输入');
  }
}

// ---------------------------------------------------------------- 11. 自动工作不再阻止入睡（2026-10-31）
console.log('\n=== 11. 自动工作不会推远入睡计时 ===');
{
  // 真实参数：PET_WORK_IDLE_SEC = 300（空闲 5 分钟自动工作一次），
  // 午后档 need = 900（10 分钟基准 × 1.5）。旧代码每次都把 PET_SLEEP_At 清回 0，
  // 于是 900 秒永远攒不满 —— 用户看到的「她不会自己睡觉了」。
  // 注意单位：PET_SLEEP_Tick 用毫秒比较，need 传的是**秒**。
  const NEED_SEC = 900;
  const TICK_MS = 5000;                 // PET_SLEEP_Tick 每 5 秒一次
  const WORK_EVERY_MS = 300 * 1000;     // 每 300 秒自动工作一次
  const m = freshMachine({ secs: 600, need: NEED_SEC });
  let sleptAtMs = -1;
  let workRuns = 0;
  for (let elapsed = 0; elapsed <= 1200 * 1000; elapsed += TICK_MS) {
    clock += TICK_MS;
    // 到点就「自动工作」：WORK_Start() 对睡眠的唯一副作用就是这一句
    if (elapsed > 0 && elapsed % WORK_EVERY_MS === 0) {
      m.WORK_On = true;
      m.PET_SLEEP_EndSleep();
      m.WORK_On = false;
      workRuns++;
    }
    m.PET_SLEEP_Tick();
    if (m.PET_SLEEP_On && sleptAtMs < 0) sleptAtMs = elapsed + TICK_MS;
  }
  ok(workRuns >= 3, `期间确实自动工作过 ${workRuns} 次（每 ${WORK_EVERY_MS / 1000} 秒一次）`);
  ok(sleptAtMs > 0, '空闲期间会自己睡着（旧代码这里永远睡不成）', 'sleptAtMs=' + sleptAtMs);
  ok(sleptAtMs >= NEED_SEC * 1000 && sleptAtMs <= NEED_SEC * 1000 + 2 * TICK_MS,
    `入睡时刻约等于 need=${NEED_SEC} 秒（实际 ${sleptAtMs / 1000} 秒）`);

  // 反向：一次交互（PET_SLEEP_Touch）之后必须重新攒满一整轮
  const m2 = freshMachine({ secs: 600, need: NEED_SEC });
  for (let elapsed = 0; elapsed < 600 * 1000; elapsed += TICK_MS) { clock += TICK_MS; m2.PET_SLEEP_Tick(); }
  ok(m2.PET_SLEEP_On === false, '600 秒（< need）还没睡');
  m2.PET_SLEEP_Touch();
  for (let elapsed = 0; elapsed < 600 * 1000; elapsed += TICK_MS) { clock += TICK_MS; m2.PET_SLEEP_Tick(); }
  ok(m2.PET_SLEEP_On === false, '被摸一下之后重新计时，600 秒仍不睡');
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
