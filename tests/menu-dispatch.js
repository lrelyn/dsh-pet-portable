// 回归：右键菜单「动作」下点具体动画没反应（0ceff62 引入，sprite.js feed 分支缺 typeof 守卫）。
// 关键点：本测试真跑 sprite.js 的 onMenuAction 方法体，并喂它**真实 buildMenuTree 产出的叶子**，
// 而不是复刻菜单构建逻辑 —— tests/feed-menu.js 就是因为复刻逻辑（叶子带 action 字段）才漏掉了这个回归。
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'app', 'runtime', 'electron-helper');
const spriteSrc = fs.readFileSync(path.join(HELPER, 'sprite.js'), 'utf8').replace(/\r\n/g, '\n');
const sharedSrc = fs.readFileSync(path.join(HELPER, 'shared-core.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) {
    pass++;
    console.log('  OK   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '  ' + extra : ''));
  }
};

// ---------- 1. 加载真实的 shared-core（拿真实 buildMenuTree） ----------
console.log('=== 1. 加载 shared-core.js 的 buildMenuTree ===');
const sharedSandbox = { console };
sharedSandbox.window = sharedSandbox;
vm.createContext(sharedSandbox);
let sharedLoaded = true;
try {
  vm.runInContext(sharedSrc, sharedSandbox);
} catch (e) {
  sharedLoaded = false;
  ok(false, 'shared-core.js 可在 sandbox 中加载', String(e));
}
const S = sharedLoaded ? sharedSandbox.PetShared : null;
ok(sharedLoaded && !!S, '加载出 PetShared');
ok(!!S && typeof S.buildMenuTree === 'function', 'buildMenuTree 可用');
ok(!!S && typeof S.isNoMirrorAnimation === 'function', 'isNoMirrorAnimation 可用');

// ---------- 2. 抽取 sprite.js 的 onMenuAction 与相关常量 ----------
console.log('\n=== 2. 从 sprite.js 抽取 onMenuAction 与常量 ===');
const bodyMatch = spriteSrc.match(/\n  onMenuAction\(leaf\) \{[\s\S]*?\n  \}\n/);
ok(!!bodyMatch, '抽到 onMenuAction 方法体');
const body = bodyMatch ? bodyMatch[0].trim() : '';
// 截断保护：非贪婪匹配若提前收尾，尾部兜底分发就会丢失，测试会假绿
ok(body.includes('PET_FEED_Play(leaf.anim)'), '方法体完整（含尾部兜底 PET_FEED_Play(leaf.anim)）');
ok(body.includes('if (!leaf.anim) return;'), '方法体含 leaf.anim 分发入口');

const strConst = (name) => {
  const m = spriteSrc.match(new RegExp('const ' + name + ' = "([^"]*)";'));
  return m ? m[1] : null;
};
const PET_SLEEP_IN = strConst('PET_SLEEP_IN');
const PET_SLEEP_LOOP = strConst('PET_SLEEP_LOOP');
const PET_SLEEP_WAKE = strConst('PET_SLEEP_WAKE');
ok(!!PET_SLEEP_IN && !!PET_SLEEP_LOOP && !!PET_SLEEP_WAKE, '从源码解析出三个睡眠动画名', [PET_SLEEP_IN, PET_SLEEP_LOOP, PET_SLEEP_WAKE].join('/'));

// ---------- 3. 真实 buildMenuTree 的叶子形态（回归根因：没有 action 字段） ----------
console.log('\n=== 3. buildMenuTree 叶子形态 ===');
const animations = {
  idle: ['待机1', '待机2'],
  turn: ['转向1'],
  drag: ['拖拽1'],
  clicks: ['点击1', '点击2'],
  moves: { actions: [{ name: '移动到左边' }] },
  categories: [
    { id: '吃东西', actions: ['吃东西1'], noMirror: false },
    { id: '文字类', actions: ['举牌1'], noMirror: true },
  ],
  events: { sleep: [['睡觉第一段', '睡觉第二段', '睡觉第三段']], balance: ['余额1'], whisper: ['碎碎念1'] },
};
const tree = S && typeof S.buildMenuTree === 'function' ? S.buildMenuTree(animations) : [];
const leaves = [];
const walk = (node) => {
  if (node && Array.isArray(node.children)) node.children.forEach(walk);
  else if (node) leaves.push(node);
  };
tree.forEach(walk);
ok(leaves.length > 0, 'buildMenuTree 产出叶子', 'leaves=' + leaves.length);
ok(
  leaves.every((l) => !Object.prototype.hasOwnProperty.call(l, 'action')),
  '动画叶子没有 action 字段（onMenuAction 的分发必须容得下这一点）',
);
ok(
  leaves.every((l) => typeof l.anim === 'string' && typeof l.label === 'string'),
  '动画叶子只有 label + anim',
);

// ---------- 4. 真跑 onMenuAction 分发真实叶子 ----------
console.log('\n=== 4. 用真实叶子真跑 onMenuAction ===');
const makeShell = (rec) => {
  const hit = (name) => (...args) => {
    rec.push(name + (args.length ? ':' + args.join(',') : ''));
  };
  return {
    closeMenu: hit('closeMenu'),
    showMenuNotice: hit('showMenuNotice'),
    showBalanceFromMenu: hit('showBalanceFromMenu'),
    showWhisperFromMenu: hit('showWhisperFromMenu'),
    showChatFromMenu: hit('showChatFromMenu'),
    goHome: hit('goHome'),
    setAutoStart: hit('setAutoStart'),
    quitPet: hit('quitPet'),
    PET_SLEEP_Set: hit('PET_SLEEP_Set'),
    PET_SLEEP_FromMenu: hit('PET_SLEEP_FromMenu'),
    PET_SLEEP_Wake: hit('PET_SLEEP_Wake'),
    // 2026-10-30：菜单点播改为「静默脱离睡眠态再播自己的动画」。
    // 这里两个都桩，断言只看"有没有脱离睡眠"，具体走哪个方法不重要。
    PET_SLEEP_EndSleep: hit('PET_SLEEP_EndSleep'),
    PET_FEED_Play: hit('PET_FEED_Play'),
    PET_FEED: hit('PET_FEED'),
    workBreakRec: hit('WORK_Break'),
    WORK_Break: hit('WORK_Break'),
    WORK_Start: hit('WORK_Start'),
    setPetCount: hit('setPetCount'),
    PANEL_Open: hit('PANEL_Open'),
    tryMove: (name) => {
      rec.push('tryMove:' + name);
      return true;
    },
    playOnce: hit('playOnce'),
    animations: {
      moves: { actions: [{ name: '移动到左边' }] },
      categories: [{ id: '文字类', actions: ['举牌1'], noMirror: true }],
    },
    facing: 'right',
  };
};

let runner = null;
try {
  // 参数顺序与真实脚本作用域对齐：window / S / 睡眠常量 / BASE / fetch / PET_IDLE_SaveGap / parseInt
  runner = new Function(
    'window',
    'S',
    'PET_SLEEP_IN',
    'PET_SLEEP_LOOP',
    'PET_SLEEP_WAKE',
    'BASE',
    'fetch',
    'PET_IDLE_SaveGap',
    'return ({ ' + body + ' }).onMenuAction;',
  );
} catch (e) {
  ok(false, 'onMenuAction 方法体可被编译', String(e));
}
ok(typeof runner === 'function', '造出可执行的 onMenuAction');

const callLeaf = (shell, leaf) => {
  const rec = [];
  const obj = makeShell(rec);
  Object.assign(obj, shell || {});
  const win = { petBridge: undefined, __dshPetDebug: {} };
  let threw = null;
  if (typeof runner === 'function') {
    try {
      const fn = runner.call(
        null,
        win,
        S,
        PET_SLEEP_IN,
        PET_SLEEP_LOOP,
        PET_SLEEP_WAKE,
        '',
        () => Promise.reject(new Error('no host')),
        () => {},
      );
      fn.call(obj, leaf);
    } catch (e) {
      threw = String(e && e.message ? e.message : e);
    }
  }
  return { rec: rec.filter((x) => x !== 'closeMenu'), threw, debug: win.__dshPetDebug };
};

const silentLeaves = [];
const throwLeaves = [];
for (const leaf of leaves) {
  const { rec, threw } = callLeaf(null, leaf);
  if (threw) throwLeaves.push(leaf.label + ' → ' + threw);
  else if (rec.length === 0) silentLeaves.push(leaf.label);
}
ok(throwLeaves.length === 0, '所有动画叶子分发都不抛错', throwLeaves.slice(0, 3).join(' | '));
ok(silentLeaves.length === 0, '所有动画叶子都产生了实际分发（不是点了没反应）', silentLeaves.slice(0, 5).join(','));

// 具体路径核对：睡眠三段走状态机，移动类走真实移动，其余走带锁连播
const sleepLeaf = leaves.find((l) => l.anim === PET_SLEEP_IN);
const sleepRes = sleepLeaf ? callLeaf(null, sleepLeaf) : { rec: [] };
ok(
  sleepRes.rec.includes('PET_SLEEP_FromMenu:' + PET_SLEEP_IN),
  '睡眠动画走 PET_SLEEP_FromMenu（不是兜底连播）',
  JSON.stringify(sleepRes.rec),
);
const moveLeaf = leaves.find((l) => l.anim === '移动到左边');
const moveRes = moveLeaf ? callLeaf(null, moveLeaf) : { rec: [] };
ok(moveRes.rec.includes('tryMove:移动到左边'), '移动类动画走 tryMove', JSON.stringify(moveRes.rec));
const plainLeaf = leaves.find((l) => l.anim === '待机1');
const plainRes = plainLeaf ? callLeaf(null, plainLeaf) : { rec: [] };
ok(
  plainRes.rec.includes('PET_FEED_Play:待机1') && plainRes.rec.includes('PET_SLEEP_EndSleep'),
  '普通动画先脱离睡眠态再连播',
  JSON.stringify(plainRes.rec),
);
// noMirror 类：朝右站姿先强制朝左（靠 shell.facing 观察）
const mirrorLeaf = leaves.find((l) => l.anim === '举牌1');
if (mirrorLeaf && typeof runner === 'function') {
  const rec = [];
  const obj = makeShell(rec);
  let threw = null;
  try {
    const fn = runner.call(null, {}, S, PET_SLEEP_IN, PET_SLEEP_LOOP, PET_SLEEP_WAKE, '', () => Promise.reject(new Error('x')), () => {});
    fn.call(obj, mirrorLeaf);
  } catch (e) {
    threw = String(e);
  }
  ok(!threw && obj.facing === 'left', 'noMirror 动画点播前强制朝左', threw || ('facing=' + obj.facing));
} else {
  ok(false, 'noMirror 动画点播前强制朝左', '未拿到举牌1 叶子');
}

// ---------- 5. 工具类叶子语义不变 ----------
console.log('\n=== 5. 工具类叶子分发不变 ===');
const feedRes = callLeaf(null, { label: '投喂', action: 'feed' });
ok(feedRes.rec.includes('PET_FEED:undefined') || feedRes.rec.some((r) => r.startsWith('PET_FEED')), 'feed 命中投喂', JSON.stringify(feedRes.rec));
const fishRes = callLeaf(null, { label: '小鱼干', action: 'feed:fish' });
ok(fishRes.rec.includes('PET_FEED:fish'), 'feed:fish 带食物 id', JSON.stringify(fishRes.rec));
const panelRes = callLeaf(null, { label: '她的状态', action: 'status-panel' });
ok(panelRes.rec.includes('PANEL_Open'), 'status-panel 打开面板', JSON.stringify(panelRes.rec));
const countRes = callLeaf(null, { label: '多开数量 3', action: 'pet-count:3' });
ok(countRes.rec.includes('setPetCount:3'), 'pet-count 设数量', JSON.stringify(countRes.rec));
const sleepSetRes = callLeaf(null, { label: '睡眠 10 分钟', action: 'pet-sleep:600' });
ok(sleepSetRes.rec.includes('PET_SLEEP_Set:600'), 'pet-sleep 设时长', JSON.stringify(sleepSetRes.rec));

// ---------- 6. 源码级守卫：裸 leaf.action.startsWith 一律不许出现 ----------
console.log('\n=== 6. startsWith 必须带 typeof 字符串守卫 ===');
const bareStartsWith = body
  .split('\n')
  .filter((line) => line.includes('leaf.action.startsWith('))
  .filter((line) => !line.includes("typeof leaf.action === 'string'"));
ok(bareStartsWith.length === 0, '没有裸 leaf.action.startsWith 调用（会抛 TypeError 中断全部分发）', bareStartsWith.map((l) => l.trim()).join(' | '));
ok(
  body.split('\n').filter((line) => line.includes('leaf.action.startsWith(')).length >= 4,
  'startsWith 分支仍存在（防止整段被误删）',
);

// ---------- 7. 埋点：菜单点了什么必须能被冒烟自检读到 ----------
// 没有这条埋点，main.js 的冒烟自检只能证明「菜单挂载了」，证明不了「叶子点下去发生了什么」。
console.log('\n=== 7. __dshPetDebug.menuAction 埋点 ===');
ok(body.includes('__dshPetDebug'), 'onMenuAction 写 __dshPetDebug（冒烟自检的观测点）');
ok(/dbg\.menuAction\s*=/.test(body), 'onMenuAction 记录 menuAction');
const dbgLeaf = leaves.find((l) => l.anim === '待机1');
const dbgRes = dbgLeaf ? callLeaf(null, dbgLeaf) : { debug: {} };
ok(
  !!dbgRes.debug.menuAction && dbgRes.debug.menuAction.anim === '待机1',
  '点击后 menuAction 记下 anim',
  JSON.stringify(dbgRes.debug.menuAction),
);
ok(
  dbgRes.debug.menuAction && dbgRes.debug.menuAction.action === null,
  '纯动画叶子的 action 记为 null（而不是 undefined 崩掉）',
  JSON.stringify(dbgRes.debug.menuAction && dbgRes.debug.menuAction.action),
);
// constants.js 必须声明该字段，否则渲染端首次写入前读到的是 undefined
const constSrc = fs.readFileSync(path.join(HELPER, 'constants.js'), 'utf8');
ok(/menuAction:\s*null/.test(constSrc), 'constants.js 声明 __dshPetDebug.menuAction 初值');

console.log('\n=== ' + pass + ' 通过 / ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
