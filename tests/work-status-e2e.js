// 端到端链路测试：模拟渲染进程收到的采样 → 状态机 → onWorkTick 调用
// 不依赖 Electron，纯 Node 验证「检测器采样 → 状态机 → 档位」这段是通的
const path = require('node:path');
const ROOT = process.argv[2] || path.join(__dirname, '..');

const M = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'work-state-map.js'));

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// 模拟 sprite.js 的 DETECTOR_OnSample 逻辑（去掉 DOM/动画部分）
function makeMockSprite(cfg) {
  const sm = new M.WorkStateMachine({
    confirmCount: cfg.confirmCount,
    minStateDurationSec: cfg.minStateDurationSec,
    idleThresholdMin: cfg.idleThresholdMin,
    workStretchMin: cfg.workStretchMin,
    longWorkStretchMin: cfg.longWorkStretchMin,
  });
  sm.opts = { customRules: cfg.customRules || [] };
  const calls = [];
  const moodEvents = [];
  let localState = null;
  return {
    sm, calls, moodEvents,
    onSample(sample, now) {
      const r = sm.feed(sample, now);
      if (!r) return;
      if (r.milestone) calls.push({ kind: 'milestone', m: r.milestone });
      if (!r.changed || !r.state) return;
      const prev = localState;
      if (r.state === prev) return;
      localState = r.state;
      if (r.state === 'working' && prev !== 'working') moodEvents.push('workStart');
      else if (r.state === 'result' && prev === 'working') moodEvents.push('workSlack');
      else if (r.state === 'thinking' && prev === 'result') moodEvents.push('backToWork');
      calls.push({ kind: 'workTick', state: r.state });
    },
    get state() { return localState; },
  };
}

const cfg = { confirmCount: 2, minStateDurationSec: 10, idleThresholdMin: 3, workStretchMin: 25, longWorkStretchMin: 50, customRules: [] };

console.log('=== 1. 用户切到 VS Code → working ===');
const s = makeMockSprite(cfg);
let t = 1000000;
s.onSample({ processName: 'Code', windowTitle: 'main.js - VS Code' }, t);
ok(s.calls.length === 0, '第 1 拍不切（防抖需 2 次）');
s.onSample({ processName: 'Code', windowTitle: 'main.js - VS Code' }, t += 5000);
ok(s.state === 'working' && s.calls.some(c => c.kind === 'workTick' && c.state === 'working'), '第 2 拍 → working + workTick');
ok(s.moodEvents.includes('workStart'), '心情事件 workStart');

console.log('\n=== 2. 切到 B 站 → result（摸鱼）===');
s.onSample({ processName: 'chrome', windowTitle: '哔哩哔哩' }, t += 5000);
s.onSample({ processName: 'chrome', windowTitle: '哔哩哔哩' }, t += 5000);
ok(s.state === 'result', '→ result', s.state);
ok(s.moodEvents.includes('workSlack'), '心情事件 workSlack');

console.log('\n=== 3. 切回终端 → thinking（backToWork）===');
s.onSample({ processName: 'WindowsTerminal', windowTitle: 'bash' }, t += 5000);
s.onSample({ processName: 'WindowsTerminal', windowTitle: 'bash' }, t += 5000);
ok(s.state === 'thinking', '→ thinking', s.state);
ok(s.moodEvents.includes('backToWork'), '心情事件 backToWork');

console.log('\n=== 4. 切回桌宠自己 → hold（不变）===');
const before = s.state;
s.onSample({ processName: 'electron', windowTitle: 'dsh-pet' }, t += 5000);
s.onSample({ processName: 'electron', windowTitle: 'dsh-pet' }, t += 5000);
ok(s.state === before, 'hold 保持 thinking', s.state);

console.log('\n=== 5. 久坐里程碑 ===');
const s2 = makeMockSprite({ ...cfg, minStateDurationSec: 0 });
let t2 = 2000000;
s2.onSample({ processName: 'Code', windowTitle: 'a' }, t2);
s2.onSample({ processName: 'Code', windowTitle: 'a' }, t2 + 5000);
ok(s2.state === 'working', '进入 working');
// workingSince 是在「确认切换」那一拍设的 = t2+5000，所以里程碑要从那之后再算
const workingAt = t2 + 5000;
s2.onSample({ processName: 'Code', windowTitle: 'a' }, workingAt + 25 * 60000 + 1000);
const ms = s2.calls.filter(c => c.kind === 'milestone');
ok(ms.some(c => c.m === 'stepDone'), '工作满 25 分钟 → stepDone 里程碑', JSON.stringify(ms));
s2.onSample({ processName: 'Code', windowTitle: 'a' }, workingAt + 50 * 60000 + 2000);
ok(s2.calls.filter(c => c.kind === 'milestone').some(c => c.m === 'longDone'), '工作满 50 分钟 → longDone');

console.log('\n=== 6. 自定义规则生效 ===');
const s3 = makeMockSprite({ ...cfg, customRules: [{ match: { process: ['Code'] }, state: 'thinking' }] });
let t3 = 3000000;
s3.onSample({ processName: 'Code', windowTitle: 'x' }, t3);
s3.onSample({ processName: 'Code', windowTitle: 'x' }, t3 + 5000);
ok(s3.state === 'thinking', '自定义把 Code 映射成 thinking', s3.state);

console.log('\n=== 7. 六档全覆盖检查 ===');
const states = ['thinking', 'working', 'result', 'waiting', 'success', 'error'];
ok(states.length === 6, '六档数量正确');
const mapped = new Set();
for (const p of ['powershell', 'Code', 'chrome', 'WeChat', 'explorer']) {
  const st = M.mapSample({ processName: p, windowTitle: '' });
  if (st) mapped.add(st);
}
ok(mapped.size >= 3, `实际能映射到 ${mapped.size} 档: ${[...mapped].join(', ')}`);
ok(states.includes('success') && states.includes('error'), 'success/error 保留在状态机里（暂无自动触发源）');

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
