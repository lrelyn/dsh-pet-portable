// 头顶状态图标（status-icons.js）单元测试
const path = require('node:path');
const ROOT = process.argv[2] || path.join(__dirname, '..');
const I = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'status-icons.js'));

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

console.log('=== 1. 图标表完整性 ===');
ok(Object.keys(I.ICONS).length === 7, '定义 7 个状态图标', String(Object.keys(I.ICONS).length));
let bad = 0;
for (const [k, v] of Object.entries(I.ICONS)) {
  if (!v.emoji || !v.text || !Number.isFinite(v.priority)) bad++;
}
ok(bad === 0, '每个图标都有 emoji/text/priority', String(bad));
// 确认是纯 emoji（不含图片路径）
let notEmoji = 0;
for (const v of Object.values(I.ICONS)) {
  if (/\.(png|jpg|gif|svg|webm)/i.test(v.emoji)) notEmoji++;
}
ok(notEmoji === 0, '全部是 emoji 字符，无图片依赖', String(notEmoji));

console.log('\n=== 2. 单状态命中 ===');
ok(I.pickIcon({ hunger: 10 })?.key === 'starving', '饱食 10 → 饿坏');
ok(I.pickIcon({ hunger: 25 })?.key === 'hungry', '饱食 25 → 有点饿');
ok(I.pickIcon({ energy: 15 })?.key === 'exhausted', '精力 15 → 精疲力竭');
ok(I.pickIcon({ energy: 35 })?.key === 'tired', '精力 35 → 有点困');
ok(I.pickIcon({ sleeping: true })?.key === 'sleeping', '睡着 → 😴');
ok(I.pickIcon({ affectionJustUp: true })?.key === 'affection', '好感升级 → 💗');
ok(I.pickIcon({ bored: true })?.key === 'lonely', '无聊 → 🎈');

console.log('\n=== 3. 无状态 → null（不显示图标）===');
ok(I.pickIcon({ hunger: 80, energy: 80 }) === null, '都健康 → 不显示图标');
ok(I.pickIcon({}) === null, '空对象 → null');
ok(I.pickIcon(null) === null, 'null 不崩');
ok(I.pickIcon(undefined) === null, 'undefined 不崩');

console.log('\n=== 4. 优先级：只显示最紧急的一个 ===');
// 饿坏(60) > 精疲力竭(55) > 睡着(50) > 有点饿(40) > 有点困(35) > 好感(30) > 无聊(20)
ok(I.pickIcon({ hunger: 10, energy: 10 })?.key === 'starving', '又饿坏又精疲力竭 → 显示饿坏', I.pickIcon({ hunger: 10, energy: 10 })?.key);
ok(I.pickIcon({ energy: 10, sleeping: true })?.key === 'exhausted', '又累又睡 → 显示精疲力竭', I.pickIcon({ energy: 10, sleeping: true })?.key);
ok(I.pickIcon({ hunger: 25, energy: 35 })?.key === 'hungry', '有点饿+有点困 → 显示有点饿', I.pickIcon({ hunger: 25, energy: 35 })?.key);
ok(I.pickIcon({ tired: true, boredom: true, energy: 35, bored: true })?.key === 'tired', '有点困+无聊 → 显示有点困');
ok(I.pickIcon({ affectionJustUp: true, bored: true })?.key === 'affection', '好感+无聊 → 显示好感');

console.log('\n=== 5. 边界值 ===');
ok(I.pickIcon({ hunger: 15 })?.key === 'hungry', '饱食正好 15 → 不触发饿坏（<15 才是）', I.pickIcon({ hunger: 15 })?.key);
ok(I.pickIcon({ hunger: 14.9 })?.key === 'starving', '饱食 14.9 → 饿坏');
ok(I.pickIcon({ energy: 20 })?.key === 'tired', '精力正好 20 → 有点困（<20 才是力竭）', I.pickIcon({ energy: 20 })?.key);
ok(I.pickIcon({ energy: 19.9 })?.key === 'exhausted', '精力 19.9 → 精疲力竭');
ok(I.pickIcon({ hunger: NaN }) === null, 'NaN 不误判');
ok(I.pickIcon({ hunger: 'abc' }) === null, '字符串不误判');

console.log('\n=== 6. 签名短路（变了才更新 DOM）===');
const a = I.pickIcon({ hunger: 25 });
const b = I.pickIcon({ hunger: 26 });
ok(I.iconSignature(a) === I.iconSignature(b), '同一状态签名相同（饥饿值微变不算变）', I.iconSignature(a));
ok(I.iconSignature(a) !== I.iconSignature(I.pickIcon({ energy: 15 })), '不同状态签名不同');
ok(I.iconSignature(null) === '', 'null 签名为空串');

console.log('\n=== 7. 阈值与配置一致性检查 ===');
// 这些阈值要与 vitals.js 的 hungryThreshold(30) / starvingThreshold(15) 对齐
const V = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'vitals.js'));
const hcfg = V.DEFAULT_VITALS_CONFIG.hunger;
ok(I.pickIcon({ hunger: hcfg.hungryThreshold - 1 })?.key === 'hungry',
  `饱食低于 hungryThreshold(${hcfg.hungryThreshold}) → 有点饿`);
ok(I.pickIcon({ hunger: hcfg.starvingThreshold - 1 })?.key === 'starving',
  `饱食低于 starvingThreshold(${hcfg.starvingThreshold}) → 饿坏`);
const ecfg = V.DEFAULT_VITALS_CONFIG.energy;
ok(I.pickIcon({ energy: ecfg.autoSleepThreshold - 1 })?.key === 'exhausted',
  `精力低于 autoSleepThreshold(${ecfg.autoSleepThreshold}) → 精疲力竭`);

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
