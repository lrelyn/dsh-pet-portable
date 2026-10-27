// 验证新增的心情逻辑（直接测 shared-core.js —— 桌面端实际运行的代码）
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
// shared-core.js 是 UMD 包装：`var PetShared = (function(exports){...})({})`
// 它不改 module.exports，而是把对象赋给全局 PetShared。所以在 vm 里跑一遍再取。
const ROOT = process.argv[2] || path.join(__dirname, '..');
const src = fs.readFileSync(
  path.join(ROOT, 'app', 'runtime', 'electron-helper', 'shared-core.js'), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const S = sandbox.PetShared || sandbox.window.PetShared;
if (!S) { console.error('取不到 PetShared'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

console.log('=== 1. 新事件已注册 ===');
for (const [name, expect] of [['feed', 8], ['sleep', -5], ['wake', 3]]) {
  ok(S.MOOD_EVENTS[name] === expect, `${name} = ${expect}`, `实际 ${S.MOOD_EVENTS[name]}`);
}

console.log('\n=== 2. applyEvent 基本行为 ===');
ok(S.applyEvent(50, 'feed') === 58, '50 + feed(8) = 58', String(S.applyEvent(50, 'feed')));
ok(S.applyEvent(50, 'sleep') === 45, '50 + sleep(-5) = 45');
ok(S.applyEvent(50, 'wake') === 53, '50 + wake(3) = 53');
ok(S.applyEvent(50, 'unknown') === 50, '未知事件不变');

console.log('\n=== 3. grumpy 时正收益减半 ===');
const T = { happy: 60, tired: 40, grumpy: 25 };
// value=20 → grumpy，click(+6) 应该只 +3
ok(S.applyEvent(20, 'click', T) === 23, 'grumpy 时 click +6 减半为 +3', String(S.applyEvent(20, 'click', T)));
// value=50 → normal，click 全额 +6
ok(S.applyEvent(50, 'click', T) === 56, 'normal 时 click 全额 +6');
// grumpy 时负收益不打折
ok(S.applyEvent(20, 'workError', T) === 5, 'grumpy 时 workError(-15) 不打折');
// 不传 T 时老行为（全額）
ok(S.applyEvent(20, 'click') === 26, '不传 thresholds 时保持全额（兼容）');

console.log('\n=== 4. 忽视惩罚 ===');
ok(S.NEGLECT_AFTER_MS === 300000, 'NEGLECT_AFTER_MS = 5 分钟');
ok(S.NEGLECT_RATE_PER_MIN === 0.5, 'NEGLECT_RATE_PER_MIN = 0.5');

const mk = (v) => {
  const m = new S.MoodState({ enabled: true, decayPerSec: 0, thresholds: T, specs: {} });
  m.restore(v);
  return m;
};
// decayPerSec=0 → 只看惩罚
let m1 = mk(50);
m1.tick(60, 12, 0);              // idle 0ms，不惩罚
ok(Math.abs(m1.value0 - 50) < 0.01, '未超时不扣分', String(m1.value0));
m1 = mk(50);
m1.tick(60, 12, 6 * 60 * 1000);  // 空闲 6 分钟，推进 60 秒 → 扣 0.5
ok(Math.abs(m1.value0 - 49.5) < 0.01, '超时后 60 秒扣 0.5', String(m1.value0));
m1 = mk(50);
m1.tick(600, 12, 6 * 60 * 1000); // 推进 600 秒 → 扣 5
ok(Math.abs(m1.value0 - 45) < 0.01, '超时后 600 秒扣 5', String(m1.value0));
m1 = mk(50);
m1.tick(60, 12);                 // 不传 idleMs → 不惩罚（兼容老调用）
ok(Math.abs(m1.value0 - 50) < 0.01, '不传 idleMs 不惩罚');

console.log('\n=== 5. restore / snapshot ===');
m1 = mk(70);
ok(Math.abs(m1.value0 - 70) < 0.01, 'restore(70) 生效');
ok(m1.current === 'happy', 'restore 后档位正确 = happy', m1.current);
m1.restore(999);
ok(m1.value0 === 100, 'restore 越界夹取到 100');
m1.restore('abc');
ok(Math.abs(m1.value0 - 100) < 0.01, 'restore 非数字忽略（保持原值）');
m1.restore(NaN);
ok(Math.abs(m1.value0 - 100) < 0.01, 'restore NaN 忽略');
ok(m1.snapshot() === 100, 'snapshot 返回当前值');
const off = new S.MoodState({ enabled: false, decayPerSec: 0, thresholds: T, specs: {} });
ok(off.snapshot() === null, '关闭时 snapshot 返回 null（不写盘）');
off.restore(80);
ok(off.value0 === 50, '关闭时 restore 无效（透传）');

console.log('\n=== 6. 心情池 moodPool ===');
const cfgFull = {
  enabled: true, decayPerSec: 0, thresholds: T,
  specs: {
    happy: { weights: {}, idle: ['A', 'B'], clicks: ['C'] },
    normal: { weights: {} },
    tired: { weights: {}, idle: ['D'] },
    grumpy: { weights: {}, clicks: ['E'] },
  },
};
ok(JSON.stringify(S.moodPool('happy', 'idle', cfgFull)) === '["A","B"]', 'happy.idle');
ok(JSON.stringify(S.moodPool('happy', 'clicks', cfgFull)) === '["C"]', 'happy.clicks');
ok(S.moodPool('normal', 'idle', cfgFull).length === 0, 'normal 无池（用原池）');
ok(JSON.stringify(S.moodPool('tired', 'idle', cfgFull)) === '["D"]', 'tired.idle');
ok(S.moodPool('tired', 'clicks', cfgFull).length === 0, 'tired 没配 clicks → 空');

console.log('\n=== 7. 默认配置的阈值与 decay ===');
ok(S.DEFAULT_MOOD_CONFIG.decayPerSec === 0.005, 'decay 0.005');
ok(S.DEFAULT_MOOD_CONFIG.thresholds.happy === 60, 'happy 60');
ok(S.DEFAULT_MOOD_CONFIG.thresholds.tired === 40, 'tired 40');
ok(S.DEFAULT_MOOD_CONFIG.thresholds.grumpy === 25, 'grumpy 25');

console.log('\n=== 8. 阈值区间检查（连点几次到 happy）===');
// 从 50 起，每次 click +6（normal 全额），到 >=60 需要几次
let v = 50, n = 0;
while (v < 60 && n < 10) { v = S.applyEvent(v, 'click', T); n++; }
ok(n <= 2, `连点 ${n} 次到 happy（原来要 4 次）`, `value=${v}`);
ok(v >= 60, '确实到 happy 区间');

console.log(`\n=== 合计: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
