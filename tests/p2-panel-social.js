// P2 第四批单元测试：status-panel / social
const path = require('node:path');
const ROOT = process.argv[2] || path.join(__dirname, '..');
const SP = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'status-panel.js'));
const SO = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'social.js'));

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// ============ status-panel ============
console.log('=== 1. 状态条配色档位（文档 §8.1）===');
{
  ok(SP.bandOf('mood', 80) === 'ok', '心情 80 → ok');
  ok(SP.bandOf('mood', 50) === 'warn', '心情 50 → warn');
  ok(SP.bandOf('mood', 30) === 'danger', '心情 30 → danger');
  ok(SP.bandOf('energy', 50) === 'ok', '精力 50 → ok');
  ok(SP.bandOf('energy', 30) === 'warn', '精力 30 → warn');
  ok(SP.bandOf('energy', 10) === 'danger', '精力 10 → danger');
  ok(SP.bandOf('hunger', 50) === 'ok', '饱食 50 → ok');
  ok(SP.bandOf('hunger', 25) === 'warn', '饱食 25 → warn');
  ok(SP.bandOf('hunger', 10) === 'danger', '饱食 10 → danger');
}

console.log('\n=== 2. 档位文字描述 ===');
{
  ok(SP.descOf('mood', 80) === '开心', '心情 80 开心');
  ok(SP.descOf('mood', 50) === '平静', '心情 50 平静');
  ok(SP.descOf('energy', 85) === '精力充沛', '精力 85 充沛');
  ok(SP.descOf('energy', 10) === '精疲力竭', '精力 10 精疲力竭');
  ok(SP.descOf('hunger', 85) === '吃饱', '饱食 85 吃饱');
  ok(SP.descOf('hunger', 10) === '饿坏了', '饱食 10 饿坏了');
}

console.log('\n=== 3. HTML 生成 ===');
{
  const d = {
    mood: 55, energy: 78, hunger: 62,
    affinity: { value: 45, lv: 3, name: '熟悉', toNext: 15, bonus: 1.2 },
    stats: { days: 5, feeds: 12 },
  };
  const html = SP.buildPanelHtml(d);
  ok(typeof html === 'string' && html.length > 100, '生成非空 HTML');
  ok(html.includes('心情') && html.includes('精力') && html.includes('饱食'), '三条状态都在');
  ok(html.includes('Lv.3') && html.includes('熟悉'), '好感度等级显示');
  ok(html.includes('距下一级还差 15'), '显示到下一级差距');
  ok(html.includes('×1.2'), '显示加成系数');
  ok(html.includes('陪伴 5 天'), '统计区显示天数');
  ok(html.includes('喂食 12 次'), '统计区显示喂食次数');
  ok(html.includes('width:55%') && html.includes('width:78%'), '进度条宽度正确');
}

console.log('\n=== 4. HTML 边界（缺数据不崩）===');
{
  const html1 = SP.buildPanelHtml(null);
  ok(typeof html1 === 'string' && html1.length > 0, 'null 不崩');
  const html2 = SP.buildPanelHtml({ mood: 50, energy: 50, hunger: 50 });
  ok(!html2.includes('Lv.'), '没有 affinity 就不渲染好感度区');
  const html3 = SP.buildPanelHtml({ mood: -50, energy: 999, hunger: NaN });
  ok(typeof html3 === 'string', '越界值不崩');
  ok(html3.includes('width:0%') && html3.includes('width:100%'), '越界被夹取（0/100）');
}

console.log('\n=== 5. 关系档位 ===');
{
  ok(SO.relationBand(85) === 'friend', '85 → 好朋友');
  ok(SO.relationBand(70) === 'friend', '70 → 好朋友（边界）');
  ok(SO.relationBand(50) === 'normal', '50 → 普通');
  ok(SO.relationBand(30) === 'normal', '30 → 普通（边界）');
  ok(SO.relationBand(20) === 'rival', '20 → 冤家');
  ok(SO.relationBand(0) === 'rival', '0 → 冤家');
}

console.log('\n=== 6. 互动概率偏向（关键：关系值要真的影响行为）===');
{
  // 固定随机序列做统计
  function sample(relation, n = 2000) {
    const counts = {};
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < n; i++) {
      const t = SO.pickInteraction(relation, { myMood: 60, otherMood: 60, myEnergy: 80, otherEnergy: 80 }, rnd);
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }
  const friend = sample(85);
  const rival = sample(10);

  ok((friend.fight || 0) === 0, '好朋友从不打架', String(friend.fight));
  ok((friend.snuggle || 0) > (rival.snuggle || 0), '好朋友贴贴更多',
    `${friend.snuggle || 0} vs ${rival.snuggle || 0}`);
  ok((rival.fight || 0) > 0, '冤家会打架', String(rival.fight || 0));
  ok((rival.snuggle || 0) === 0, '冤家很少贴贴（此样本为 0）', String(rival.snuggle));
}

console.log('\n=== 7. 双方心情都差 → 可能打架 ===');
{
  let seed = 999;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const t = SO.pickInteraction(50, { myMood: 20, otherMood: 20, myEnergy: 80, otherEnergy: 80 }, () => 0.1);
  ok(t === 'fight', '心情都差 + 随机 0.1 → 打架', t);
  const t2 = SO.pickInteraction(50, { myMood: 20, otherMood: 20 }, () => 0.9);
  ok(t2 === 'none', '心情都差 + 随机 0.9 → 不互动', t2);
}

console.log('\n=== 8. 关系值表 ===');
{
  const rm = new SO.RelationMap();
  ok(rm.get('unknown') === 50, '未记录的关系默认 50');
  rm.set('a', 80);
  ok(rm.get('a') === 80, 'set 生效');
  const after = rm.apply('a', -5);
  ok(after === 75, 'apply 减 5 → 75', String(after));
  rm.set('b', 150);
  ok(rm.get('b') === 100, 'set 越界夹到 100');
  rm.apply('c', -200);
  ok(rm.get('c') === 0, 'apply 越界夹到 0');
  const o = rm.toObject();
  ok(typeof o.a === 'number' && o.a === 75, 'toObject 含正确值');
}

console.log('\n=== 9. 社交调度器：距离判定 ===');
{
  const s = new SO.SocialScheduler({ detectRadius: 130, cooldownMs: 20000 });
  const me = { id: 'me', x: 0, y: 0, mood: 60, energy: 80 };
  // 距离 5000：太远
  ok(s.scan(me, [{ id: 'far', x: 5000, y: 5000 }], 1000, () => 0.1) === null, '太远不触发');
  // 距离 100：在半径内
  const hit = s.scan(me, [{ id: 'near', x: 100, y: 0 }], 1000, () => 0.01);
  ok(hit && hit.target === 'near', '半径内触发', JSON.stringify(hit));
}

console.log('\n=== 10. 社交调度器：冷却 ===');
{
  const s = new SO.SocialScheduler({ detectRadius: 130, cooldownMs: 20000 });
  const me = { id: 'me', x: 0, y: 0, mood: 60, energy: 80 };
  const other = [{ id: 'o', x: 50, y: 0 }];
  const h1 = s.scan(me, other, 100000, () => 0.01);
  ok(h1 !== null, '首次触发');
  const h2 = s.scan(me, other, 100000 + 5000, () => 0.01);
  ok(h2 === null, '冷却内不重复触发');
  const h3 = s.scan(me, other, 100000 + 21000, () => 0.01);
  ok(h3 !== null, '冷却后重新可触发');
}

console.log('\n=== 11. 社交调度器：排除自己 ===');
{
  const s = new SO.SocialScheduler({ detectRadius: 500 });
  const me = { id: 'me', x: 0, y: 0 };
  ok(s.scan(me, [{ id: 'me', x: 0, y: 0 }], 1000, () => 0.01) === null, '不跟自己互动');
  ok(s.scan(me, [], 1000, () => 0.01) === null, '空列表返回 null');
  ok(s.scan(null, [{ id: 'a' }], 1000) === null, 'me 为 null 不崩');
}

console.log('\n=== 12. 互动定义完整性 ===');
{
  let bad = 0;
  for (const [k, v] of Object.entries(SO.INTERACTIONS)) {
    if (!v.anim || !v.desc) bad++;
    if (!Number.isFinite(v.mood) || !Number.isFinite(v.relation)) bad++;
  }
  ok(bad === 0, '每个互动都有 anim/desc/mood/relation', String(bad));
  ok(SO.INTERACTIONS.fight.relation < 0, '打架降低关系值', String(SO.INTERACTIONS.fight.relation));
  ok(SO.INTERACTIONS.snuggle.relation > 0, '贴贴提升关系值');
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
