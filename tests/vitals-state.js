// pet-state.js + vitals.js 单元测试
const path = require('node:path');
const ROOT = process.argv[2] || path.join(__dirname, '..');
const PS = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'pet-state.js'));
const V = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'vitals.js'));

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// ============ pet-state ============
console.log('=== 1. 默认快照 ===');
{
  const d = PS.defaultState(new Date('2026-10-27T10:00:00+08:00'));
  ok(d.energy === 80, '默认精力 80', String(d.energy));
  ok(d.hunger === 70, '默认饱食 70', String(d.hunger));
  ok(d.affinity === 10, '默认好感度 10（Lv.1 陌生）', String(d.affinity));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(d.lastSeen), 'lastSeen 是 YYYY-MM-DD', d.lastSeen);
  ok(typeof d.savedAt === 'string' && Number.isFinite(Date.parse(d.savedAt)), 'savedAt 是合法 ISO', d.savedAt);
  ok(d.version === 1, '有 version 字段');
}

console.log('\n=== 2. 损坏存档修复（不能让桌宠起不来）===');
{
  const cases = [
    [null, '(整个文件)'],
    ['not an object', '(整个文件)'],
    [{ energy: 'abc' }, 'energy'],
    [{ savedAt: 'not-a-date' }, 'savedAt'],
    [{ hunger: -50 }, null],          // 会被夹取成 0，但不是"修正"
    [{ energy: 999 }, null],          // 夹取成 100
    [{ lastSeen: '2026/10/27' }, 'lastSeen'],
    [{ counters: 'bad' }, 'counters'],
  ];
  for (const [input, expectRepaired] of cases) {
    const { state, repaired } = PS.sanitize(input, new Date());
    const got = repaired.join(',');
    if (expectRepaired === null) {
      ok(repaired.length === 0, `输入 ${JSON.stringify(input)} 无需修正`, got);
    } else {
      ok(repaired.includes(expectRepaired), `输入 ${JSON.stringify(input)} 标记 ${expectRepaired}`, got);
    }
    ok(typeof state.energy === 'number' && state.energy >= 0 && state.energy <= 100,
      `  → 修复后 energy 合法 (${state.energy})`);
  }
}

console.log('\n=== 3. 夹取边界 ===');
{
  const { state } = PS.sanitize({ energy: 999, hunger: -50, mood: 150, affinity: -1 }, new Date());
  ok(state.energy === 100, 'energy 999 → 100', String(state.energy));
  ok(state.hunger === 0, 'hunger -50 → 0', String(state.hunger));
  ok(state.mood === 100, 'mood 150 → 100', String(state.mood));
  ok(state.affinity === 0, 'affinity -1 → 0', String(state.affinity));
}

console.log('\n=== 4. 文件名按宠物隔离 ===');
{
  ok(PS.stateFileName('main') === 'pet-state-main.json', 'main → pet-state-main.json');
  ok(PS.stateFileName('a b/c') === 'pet-state-a_b_c.json', '名字里的空格和斜杠被替换', PS.stateFileName('a b/c'));
  ok(PS.stateFileName('') === 'pet-state-main.json', '空 id 回落 main');
  ok(PS.stateFileName('猫咪') === 'pet-state-猫咪.json', '中文 id 保留');
}

console.log('\n=== 5. 日期键按本地时区 ===');
{
  const k = PS.dateKey(new Date(2026, 9, 27, 23, 59));  // 本地 10/27 23:59
  ok(k === '2026-10-27', '本地日期正确', k);
  const k2 = PS.dateKey(new Date(2026, 0, 1, 0, 1));
  ok(k2 === '2026-01-01', '跨年日期补零', k2);
}

// ============ vitals ============
console.log('\n=== 6. 精力：工作消耗 ===');
{
  const v = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true });
  ok(v.energy === 80 && v.hunger === 70, '初始 80/70');
  // 工作 10 分钟：-1.5/分 × 10 = -15
  v.tick(600, 'working', 14, 50);
  ok(Math.abs(v.energy - 65) < 0.01, '工作 10 分钟 → 精力 65', String(v.energy));
  // 饱食：工作 -0.6/分 × 10 = -6
  ok(Math.abs(v.hunger - 64) < 0.01, '工作 10 分钟 → 饱食 64', String(v.hunger));
}

console.log('\n=== 7. 精力：睡眠恢复 ===');
{
  const v = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 10, hunger: 50 });
  v.tick(600, 'sleep', 2, 50);   // 睡 10 分钟：+4/分 × 10 = +40
  ok(Math.abs(v.energy - 50) < 0.01, '睡 10 分钟 → 精力 50', String(v.energy));
  // 饱食：睡眠 -0.1/分 × 10 = -1
  ok(Math.abs(v.hunger - 49) < 0.01, '睡 10 分钟 → 饱食 49', String(v.hunger));
}

console.log('\n=== 8. 四维联动：吃饱/心情好，恢复更快 ===');
{
  const base = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 0, hunger: 50 });
  base.tick(60, 'sleep', 2, 50);   // 1 分钟，饿度正常
  const full = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 0, hunger: 90 });
  full.tick(60, 'sleep', 2, 80);   // 吃饱+心情好 → ×1.3×1.2
  ok(full.energy > base.energy, '吃饱+心情好恢复更快', `${full.energy.toFixed(2)} vs ${base.energy.toFixed(2)}`);

  const hungry = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 0, hunger: 10 });
  hungry.tick(60, 'sleep', 2, 50);  // 饿肚子 → ×0.5
  ok(hungry.energy < base.energy, '饿肚子恢复更慢', `${hungry.energy.toFixed(2)} vs ${base.energy.toFixed(2)}`);
}

console.log('\n=== 9. 喂食 ===');
{
  const v = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 80, hunger: 40 });
  const r1 = v.feed(25);
  ok(r1.applied === 25 && !r1.refused, '喂 25 → 恢复 25', JSON.stringify(r1));
  ok(v.hunger === 65, '饱食 40 → 65', String(v.hunger));

  v.restore(80, 95);
  const r2 = v.feed(15);
  ok(r2.refused === true && r2.applied === 0, '饱食 >90 拒绝喂食', JSON.stringify(r2));

  // 夹取上限：从 85 开始（<90 所以能喂），喂 100 应该停在 100
  v.restore(80, 85);
  const r3 = v.feed(100);
  ok(r3.applied === 15, '从 85 喂 100 → 实际只涨 15', JSON.stringify(r3));
  ok(v.hunger === 100, '喂食夹取上限 100', String(v.hunger));

  // 边界：恰好 90 还能喂（>90 才拒绝）
  v.restore(80, 90);
  const r4 = v.feed(5);
  ok(r4.refused === false, '恰好 90 不拒绝', JSON.stringify(r4));

  // 90.5 就拒绝
  v.restore(80, 90.5);
  const r5 = v.feed(5);
  ok(r5.refused === true, '90.5 拒绝', JSON.stringify(r5));
}

console.log('\n=== 10. 档位划分 ===');
{
  ok(V.energyBand(85) === 'energetic', '85 精力充沛');
  ok(V.energyBand(50) === 'normal', '50 正常');
  ok(V.energyBand(30) === 'tired', '30 疲惫');
  ok(V.energyBand(10) === 'exhausted', '10 精疲力竭');
  ok(V.hungerBand(85) === 'full', '85 吃饱');
  ok(V.hungerBand(50) === 'normal', '50 正常');
  ok(V.hungerBand(25) === 'hungry', '25 饥饿');
  ok(V.hungerBand(10) === 'starving', '10 饿坏');
}

console.log('\n=== 11. 跨阈值事件 ===');
{
  const v = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 80, hunger: 70 });
  const ev = v.tick(600, 'working', 14, 50);
  ok(Array.isArray(ev), 'tick 返回数组');

  // 精力跌到 15 以下
  const v2 = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 20, hunger: 70 });
  const ev2 = v2.tick(300, 'working', 14, 50);   // -1.5 × 5 = -7.5 → 12.5
  ok(ev2.includes('energyLow'), '精力跌破 15 → energyLow', JSON.stringify(ev2));

  // 睡眠恢复越过 90
  const v3 = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 88, hunger: 50 });
  const ev3 = v3.tick(60, 'sleep', 2, 50);
  ok(ev3.includes('wakeUp'), '精力恢复过 90 → wakeUp', JSON.stringify(ev3));

  // 饱食跌到 30 以下
  const v4 = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 80, hunger: 32 });
  const ev4 = v4.tick(300, 'working', 14, 50);   // -0.6 × 5 = -3 → 29
  ok(ev4.includes('hungry'), '饱食跌破 30 → hungry', JSON.stringify(ev4));
}

console.log('\n=== 12. moodDrainPerMin（联动心情）===');
{
  const v = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 80, hunger: 70 });
  ok(v.moodDrainPerMin() === 0, '状态都好 → 不掉心情', String(v.moodDrainPerMin()));
  v.restore(80, 20);
  ok(v.moodDrainPerMin() === 0.5, '饿 → -0.5/分', String(v.moodDrainPerMin()));
  v.restore(10, 70);
  ok(v.moodDrainPerMin() === 0.3, '累 → -0.3/分', String(v.moodDrainPerMin()));
  v.restore(10, 20);
  ok(Math.abs(v.moodDrainPerMin() - 0.8) < 0.001, '又饿又累 → 0.8/分', String(v.moodDrainPerMin()));
}

console.log('\n=== 13. 关闭时完全透传 ===');
{
  const off = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: false }, { energy: 50, hunger: 50 });
  const ev = off.tick(600, 'working', 14, 50);
  ok(ev.length === 0, '关闭时 tick 不产生事件');
  ok(off.energy === 50 && off.hunger === 50, '关闭时数值不变', `${off.energy}/${off.hunger}`);
  ok(off.moodDrainPerMin() === 0, '关闭时不联动心情');
}

console.log('\n=== 14. snapshot / restore 往返 ===');
{
  const v = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true }, { energy: 43.7, hunger: 61.2 });
  const snap = v.snapshot();
  ok(snap.energy === 43.7 && snap.hunger === 61.2, 'snapshot 保留一位小数', JSON.stringify(snap));
  const v2 = new V.VitalsState({ ...V.DEFAULT_VITALS_CONFIG, enabled: true });
  v2.restore(snap.energy, snap.hunger);
  ok(v2.energy === 43.7 && v2.hunger === 61.2, 'restore 往返一致');

  v2.restore('bad', null);
  ok(v2.energy === 43.7, 'restore 忽略非法输入（保持原值）');
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
