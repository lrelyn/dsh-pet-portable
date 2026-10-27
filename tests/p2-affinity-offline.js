// P2 第二、三批单元测试：foods / affinity / offline
const path = require('node:path');
const ROOT = process.argv[2] || path.join(__dirname, '..');
const F = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'foods.js'));
const A = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'affinity.js'));
const O = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'offline.js'));

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// ============ foods ============
console.log('=== 1. 食物表 ===');
{
  ok(Array.isArray(F.DEFAULT_FOODS) && F.DEFAULT_FOODS.length >= 5, `内置 ${F.DEFAULT_FOODS.length} 种食物`);
  const ids = F.DEFAULT_FOODS.map((f) => f.id);
  ok(ids.includes('fish'), '有小鱼干');
  ok(ids.includes('bento'), '有盒饭');
  ok(ids.includes('token'), '有 Token');
  // 每种食物的三要素必须齐全
  let bad = 0;
  for (const f of F.DEFAULT_FOODS) {
    if (!f.id || !f.name || !f.anim || !Number.isFinite(f.hunger)) bad++;
  }
  ok(bad === 0, '每条食物都有 id/name/anim/hunger', String(bad));
  // 奶茶/冰淇淋对精力是负的
  const milktea = F.DEFAULT_FOODS.find((f) => f.id === 'milktea');
  ok(milktea && milktea.energy < 0, '奶茶对精力 -5（吃完更困）', String(milktea && milktea.energy));
}

console.log('\n=== 2. findFood / sanitizeFoods ===');
{
  ok(F.findFood('fish').name === '小鱼干', 'findFood(fish)');
  ok(F.findFood('nonexistent') === null, '不存在的 id 返回 null');
  ok(F.findFood('fish', []) && F.findFood('fish', []).id === 'fish', '空数组回落默认表');

  // 洗配置：缺字段补默认，缺必要字段丢弃
  const washed = F.sanitizeFoods([
    { id: 'a', name: 'A' },                          // 缺 anim → 丢弃
    { id: 'b', name: 'B', anim: '吃白饭', hunger: 20 }, // 合法
    null,
    'string',
    { name: 'no-id', anim: 'x' },                    // 缺 id → 丢弃
  ]);
  ok(washed.length === 1 && washed[0].id === 'b', '只保留合法条目', JSON.stringify(washed.map((x) => x.id)));
  ok(washed[0].cooldownMs === 8000, '缺 cooldownMs 补默认 8000', String(washed[0].cooldownMs));
  ok(F.sanitizeFoods(null).length === F.DEFAULT_FOODS.length, 'null 回落默认表');
}

console.log('\n=== 3. 食物冷却（每条独立）===');
{
  const cd = new F.FoodCooldowns();
  const now = 1000000;
  ok(cd.remaining('fish', now) === 0, '首次可喂');
  cd.mark('fish', now, 8000);
  ok(cd.remaining('fish', now + 3000) === 5000, '3 秒后还剩 5 秒', String(cd.remaining('fish', now + 3000)));
  ok(cd.remaining('bento', now + 3000) === 0, '另一条食物不受影响（独立冷却）');
  ok(cd.remaining('fish', now + 8000) === 0, '冷却结束');
}

// ============ affinity ============
console.log('\n=== 4. 六级划分 ===');
{
  ok(A.levelOf(0).lv === 1 && A.levelOf(0).name === '陌生', '0 → Lv1 陌生');
  ok(A.levelOf(20).lv === 2, '20 → Lv2');
  ok(A.levelOf(40).lv === 3, '40 → Lv3');
  ok(A.levelOf(60).lv === 4, '60 → Lv4');
  ok(A.levelOf(80).lv === 5, '80 → Lv5');
  ok(A.levelOf(95).lv === 6 && A.levelOf(100).lv === 6, '95+ → Lv6');
  ok(A.levelOf(-5).lv === 1, '负数夹到 Lv1');
  ok(A.levelOf(999).lv === 6, '超 100 仍是 Lv6');
}

console.log('\n=== 5. 到下一级 ===');
{
  ok(A.toNextLevel(10) === 10, '10 → 差 10 到 Lv2', String(A.toNextLevel(10)));
  ok(A.toNextLevel(0) === 20, '0 → 差 20 到 Lv2');
  ok(A.toNextLevel(100) === 0, '满级返回 0');
  ok(A.toNextLevel(94) === 1, '94 → 差 1 到 Lv6');
}

console.log('\n=== 6. 每日上限（关键：防刷满）===');
{
  const now = new Date(2026, 9, 27, 10, 0);
  const st = new A.AffinityState({ enabled: true }, { value: 10, lastSeen: A.dateKey(now) });

  // firstMeet 每天 1 次
  let r1 = st.interact('firstMeet', now);
  ok(r1.applied === 2 && !r1.capped, '首次互动 +2', JSON.stringify(r1));
  let r2 = st.interact('firstMeet', now);
  ok(r2.capped === true && r2.applied === 0, '同一天第二次被拦', JSON.stringify(r2));

  // feed 每天前 3 次
  const st2 = new A.AffinityState({ enabled: true }, { value: 10, lastSeen: A.dateKey(now) });
  let okCnt = 0;
  for (let i = 0; i < 5; i++) {
    const r = st2.interact('feed', now);
    if (r.applied > 0) okCnt++;
  }
  ok(okCnt === 3, '喂食每天只算 3 次', String(okCnt));

  // play 每天前 10 次
  const st3 = new A.AffinityState({ enabled: true }, { value: 10, lastSeen: A.dateKey(now) });
  let playCnt = 0;
  for (let i = 0; i < 15; i++) if (st3.interact('play', now).applied > 0) playCnt++;
  ok(playCnt === 10, '陪玩每天只算 10 次', String(playCnt));

  // milestone 不限
  const st4 = new A.AffinityState({ enabled: true }, { value: 10, lastSeen: A.dateKey(now) });
  let msCnt = 0;
  for (let i = 0; i < 20; i++) if (st4.interact('milestone', now).applied > 0) msCnt++;
  ok(msCnt === 20, '里程碑不限次数', String(msCnt));

  // 跨日重置
  const tomorrow = new Date(2026, 9, 28, 10, 0);
  const r3 = st.interact('firstMeet', tomorrow);
  ok(r3.applied === 2, '跨日后 firstMeet 恢复可用', JSON.stringify(r3));
}

console.log('\n=== 7. 升级检测 ===');
{
  const now = new Date(2026, 9, 27, 10, 0);
  const st = new A.AffinityState({ enabled: true }, { value: 19, lastSeen: A.dateKey(now) });
  ok(st.level.lv === 1, '19 是 Lv1');
  const r = st.interact('firstMeet', now);   // +2 → 21
  ok(r.levelUp === true, '19+2=21 触发升级', JSON.stringify(r));
  ok(st.level.lv === 2, '升级到 Lv2');
}

console.log('\n=== 8. 满级后收益减半 ===');
{
  const now = new Date(2026, 9, 27, 10, 0);
  const st = new A.AffinityState({ enabled: true }, { value: 96, lastSeen: A.dateKey(now) });
  const r = st.interact('firstMeet', now);   // 96 + 2*0.5 = 97
  ok(r.applied === 1, '满级后 +2 减半为 +1', String(r.applied));
}

console.log('\n=== 9. 离线衰减（缺席天数）===');
{
  // 语义：**逐日累加**（文档 "连续3天不在线 -3/天" = 从第3天起每天扣3）
  //   第1天不降 / 第2天起 -1/天 / 第3天起 -3/天 / 第7天起 -5/天
  ok(A.offlineDecay(0) === 0, '0 天不降');
  ok(A.offlineDecay(1) === 0, '1 天不降（免费期）');
  ok(A.offlineDecay(2) === -1, '2 天累计 -1', String(A.offlineDecay(2)));
  ok(A.offlineDecay(3) === -5, '3 天累计 -5（-1 再 -3 新档）', String(A.offlineDecay(3)));
  ok(A.offlineDecay(4) === -8, '4 天累计 -8', String(A.offlineDecay(4)));
  ok(A.offlineDecay(6) === -14, '6 天累计 -14', String(A.offlineDecay(6)));
  ok(A.offlineDecay(7) === -22, '7 天累计 -22（进 -5 档）', String(A.offlineDecay(7)));
  ok(A.offlineDecay(10) === -37, '10 天累计 -37', String(A.offlineDecay(10)));
  ok(A.offlineDecay(10) < A.offlineDecay(7), '越久扣越多');
  ok(A.offlineDecay(5) > A.offlineDecay(6), '相邻天数单调递减');
}

console.log('\n=== 10. 加成系数 ===');
{
  const mk = (v) => new A.AffinityState({ enabled: true }, { value: v });
  ok(mk(10).positiveBonus() === 1, 'Lv1 ×1.0');
  ok(Math.abs(mk(25).positiveBonus() - 1.1) < 0.001, 'Lv2 ×1.1', String(mk(25).positiveBonus()));
  ok(Math.abs(mk(100).positiveBonus() - 1.5) < 0.001, 'Lv6 ×1.5', String(mk(100).positiveBonus()));
}

console.log('\n=== 11. 关闭时透传 ===');
{
  const st = new A.AffinityState({ enabled: false }, { value: 50 });
  const r = st.interact('firstMeet', new Date());
  ok(r.applied === 0, '关闭时互动无效');
  ok(st.value === 50, '关闭时数值不变');
  ok(st.positiveBonus() === 1, '关闭时无加成');
  ok(st.applyOffline(10) === 0, '关闭时离线不扣');
}

// ============ offline ============
console.log('\n=== 12. 回归剧情分档 ===');
{
  ok(O.reunionOf(0.5 * 3600) === 'brief', '<1h → brief');
  ok(O.reunionOf(4 * 3600) === 'short', '1~8h → short');
  ok(O.reunionOf(12 * 3600) === 'medium', '8~24h → medium');
  ok(O.reunionOf(2 * 86400) === 'long', '1~3d → long');
  ok(O.reunionOf(5 * 86400) === 'veryLong', '3~7d → veryLong');
  ok(O.reunionOf(10 * 86400) === 'runaway', '>7d → runaway');
  // 每个档位都有动画和台词
  let bad = 0;
  for (const [k, v] of Object.entries(O.REUNION)) {
    if (!v.anim || !Array.isArray(v.lines) || !v.lines.length) bad++;
  }
  ok(bad === 0, '每档都有 anim + lines', String(bad));
}

console.log('\n=== 13. 离线推演 ===');
{
  const now = new Date('2026-10-27T12:00:00Z');
  const snap = {
    savedAt: new Date('2026-10-27T09:00:00Z').toISOString(),  // 3 小时前
    mood: 60, energy: 40, hunger: 80, affinity: 50,
  };
  const sim = O.simulateOffline(snap, now, {});
  ok(Math.abs(sim.offlineHours - 3) < 0.01, '离线 3 小时', String(sim.offlineHours));
  // 精力：前 30 分钟 +4/分 = +120 → 夹到 100
  ok(sim.energy === 100, '精力恢复满（30 分钟足够）', String(sim.energy));
  // 饱食：3 小时 = 180 分钟 × -0.1 = -18
  ok(Math.abs(sim.hunger - 62) < 0.5, '饱食 80-18=62', String(sim.hunger));
  // 心情：3 小时 - (2 小时免费) = 1 小时 × -1 = -1
  ok(Math.abs(sim.mood - 59) < 0.1, '心情 60-1=59', String(sim.mood));
  ok(sim.reunion === 'short', '3 小时 → short 剧情', sim.reunion);
  ok(sim.changed === true, 'changed=true');
}

console.log('\n=== 14. 离线推演：极端与边界 ===');
{
  const now = new Date('2026-10-27T12:00:00Z');
  // 时间戳非法 → 不推演
  const bad = O.simulateOffline({ savedAt: 'not-a-date', mood: 50, energy: 50, hunger: 50, affinity: 10 }, now, {});
  ok(bad.changed === false, '时间戳非法 → 不推演');
  ok(bad.mood === 50 && bad.energy === 50, '数值原样返回', `${bad.mood}/${bad.energy}`);

  // 时钟倒拨（savedAt 在未来）→ 不推演
  const future = O.simulateOffline({ savedAt: new Date('2026-10-28T00:00:00Z').toISOString(), mood: 50, energy: 50, hunger: 50, affinity: 10 }, now, {});
  ok(future.changed === false, '时钟倒拨 → 不推演（不惩罚用户）');

  // 离线 30 天：饱食归零，好感度大降但仍可哄回
  const long = O.simulateOffline({
    savedAt: new Date('2026-09-27T12:00:00Z').toISOString(),
    mood: 60, energy: 40, hunger: 80, affinity: 50,
  }, now, {});
  ok(long.hunger === 0, '离线 30 天 → 饱食归零', String(long.hunger));
  ok(long.affinity >= 0, '好感度不为负（可哄回）', String(long.affinity));
  ok(long.reunion === 'runaway', '30 天 → 离家出走剧情', long.reunion);

  // 超过 365 天被夹住
  const huge = O.simulateOffline({
    savedAt: new Date('2020-01-01T00:00:00Z').toISOString(),
    mood: 60, energy: 40, hunger: 80, affinity: 50,
  }, now, {});
  ok(huge.offlineSec <= 365 * 86400, '离线时长夹在 365 天内', String(huge.offlineSec));
}

console.log('\n=== 15. 离线推演：心情 2 小时免费期 ===');
{
  const now = new Date('2026-10-27T12:00:00Z');
  const snap1h = {
    savedAt: new Date('2026-10-27T11:00:00Z').toISOString(),
    mood: 60, energy: 80, hunger: 80, affinity: 50,
  };
  const s1 = O.simulateOffline(snap1h, now, {});
  ok(s1.mood === 60, '离线 1 小时 → 心情不变（在免费期内）', String(s1.mood));

  const snap3h = {
    savedAt: new Date('2026-10-27T09:00:00Z').toISOString(),
    mood: 60, energy: 80, hunger: 80, affinity: 50,
  };
  const s3 = O.simulateOffline(snap3h, now, {});
  ok(s3.mood === 59, '离线 3 小时 → 心情 -1', String(s3.mood));
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
