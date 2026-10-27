// 验证 extraDrainPerMin（第 4 参）真的生效
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const src = fs.readFileSync(
  path.join(ROOT, 'app', 'runtime', 'electron-helper', 'shared-core.js'), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const S = sandbox.PetShared || sandbox.window.PetShared;
if (!S) { console.error('取不到 PetShared'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const CFG = {
  enabled: true,
  decayPerSec: 0,          // 关掉自身回归，单独看额外衰减
  thresholds: { happy: 60, tired: 40, grumpy: 25 },
  specs: {},
};
const mk = (v) => {
  const m = new S.MoodState(CFG);
  m.restore(v);
  return m;
};

console.log('=== 1. 第 4 参生效（decay=0 隔离观察）===');
{
  const m = mk(50);
  m.tick(60, 12, undefined, 0.5);   // 60 秒 × 0.5/分 = -0.5
  ok(Math.abs(m.value0 - 49.5) < 0.01, '60 秒 × 0.5/分 → 49.5', String(m.value0));

  const m2 = mk(50);
  m2.tick(600, 12, undefined, 0.5);  // 600 秒 × 0.5/分 = -5
  ok(Math.abs(m2.value0 - 45) < 0.01, '600 秒 × 0.5/分 → 45', String(m2.value0));

  const m3 = mk(50);
  m3.tick(600, 12, undefined, 0.8);  // 又饿又累
  ok(Math.abs(m3.value0 - 42) < 0.01, '600 秒 × 0.8/分 → 42', String(m3.value0));
}

console.log('\n=== 2. 不传第 4 参 = 老行为不变（向后兼容）===');
{
  const m = mk(50);
  m.tick(600, 12);                    // 不传 → 不该有额外衰减
  ok(Math.abs(m.value0 - 50) < 0.01, '不传第 4 参 → 数值不变', String(m.value0));

  const m2 = mk(50);
  m2.tick(600, 12, undefined);        // 显式传 undefined
  ok(Math.abs(m2.value0 - 50) < 0.01, '显式 undefined → 不变', String(m2.value0));

  const m3 = mk(50);
  m3.tick(600, 12, undefined, 0);     // 传 0
  ok(Math.abs(m3.value0 - 50) < 0.01, '传 0 → 不变', String(m3.value0));

  const m4 = mk(50);
  m4.tick(600, 12, undefined, NaN);   // 传 NaN
  ok(Math.abs(m4.value0 - 50) < 0.01, '传 NaN → 忽略（不变）', String(m4.value0));

  const m5 = mk(50);
  m5.tick(600, 12, undefined, -5);    // 负数应该被忽略（不是"加心情"）
  ok(Math.abs(m5.value0 - 50) < 0.01, '传负数 → 忽略（不变）', String(m5.value0));
}

console.log('\n=== 3. 与自身 decay 叠加（真实场景）===');
{
  // decay=0.005，从 58 向 50 回归，同时额外 -0.5/分
  const m = mk(58);
  const cfg2 = { ...CFG, decayPerSec: 0.005 };
  const m2 = new S.MoodState(cfg2);
  m2.restore(58);
  m2.tick(600, 12, undefined, 0.5);   // 10 分钟
  // 纯 decay 单独算：50 + 8*exp(-0.005*600) = 50 + 8*0.0498 = 50.40
  const decayOnly = 50 + 8 * Math.exp(-0.005 * 600);
  // 再加额外 -5（0.5/分 × 10 分）
  const expected = Math.max(0, decayOnly - 5);
  ok(Math.abs(m2.value0 - expected) < 0.05,
    `叠加生效：${m2.value0.toFixed(2)} ≈ ${expected.toFixed(2)}（纯 decay 会是 ${decayOnly.toFixed(2)}）`,
    String(m2.value0));
  ok(m2.value0 < decayOnly, '叠加后比纯 decay 更低（额外衰减确实起作用）');
}

console.log('\n=== 4. 跨档位能被捕获（sync 在额外衰减之后）===');
{
  const m = mk(41);   // 刚在 tired 边界之上（tired=40）
  ok(m.current === 'normal', '初始 normal', m.current);
  m.tick(600, 12, undefined, 0.5);   // -5 → 36，应跨到 tired
  ok(m.current === 'tired', '额外衰减跨档 → tired', m.current);
}

console.log('\n=== 5. 下限夹取（不会掉到负数）===');
{
  const m = mk(3);
  m.tick(6000, 12, undefined, 10);   // 100 分钟 × 10/分 = -1000
  ok(m.value0 === 0, '夹在 0（不为负）', String(m.value0));
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
