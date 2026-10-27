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
// 2026-10-27 改版：睡着时不再报困（SUPPRESS 表）。旧版断言是 exhausted 胜出（55>50），
// 但那会渲染出「💤 😴」两个睡眠 emoji 并排，纯噪音——睡着本身就是对力竭的回应。
ok(I.pickIcon({ energy: 10, sleeping: true })?.key === 'sleeping', '又累又睡 → 显示睡着（睡着不再报困）', I.pickIcon({ energy: 10, sleeping: true })?.key);
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

console.log('\n=== 8. 状态栏多片模式（pickIcons / iconsSignature，2026-10-27 改版）===');
// 同族去重：饿坏+力竭 属两族，都该显示
const twoFam = I.pickIcons({ hunger: 10, energy: 15 });
ok(twoFam.length === 2, '饿坏 + 力竭 → 两个小片（不同族并列）', String(twoFam.length));
ok(twoFam[0].key === 'starving', '第 1 个是最紧急的（饿坏 60 > 力竭 55）', twoFam[0].key);
ok(twoFam[1].key === 'exhausted', '第 2 个是力竭', twoFam[1].key);
// 同族只留一个
const sleepOnly = I.pickIcons({ energy: 15, sleeping: true });
ok(sleepOnly.length === 1 && sleepOnly[0].key === 'sleeping',
  '力竭 + 睡着 → 只剩睡着（SUPPRESS 抑制了困）', JSON.stringify(sleepOnly.map((c) => c.key)));
ok(I.pickIcons({ hunger: 10, energy: 10, sleeping: true }).map((c) => c.key).join(',') === 'starving,sleeping',
  '饿了 + 睡着 → 饿了照常显示（进食信息有用）', I.pickIcons({ hunger: 10, energy: 10, sleeping: true }).map((c) => c.key).join(','));
const hungryOnly = I.pickIcons({ hunger: 25, energy: 100 });
ok(hungryOnly.length === 1 && hungryOnly[0].key === 'hungry', '只饿不累 → 一个小片', String(hungryOnly.length));
// 数值：饿/累带数字，睡眠/无聊/好感不带
ok(hungryOnly[0].value === 25, '有点饿带数值 25', String(hungryOnly[0].value));
ok(twoFam[1].value === 15, '力竭带数值 15', String(twoFam[1].value));
const sleepChip = I.pickIcons({ hunger: 100, energy: 100, sleeping: true })[0];
ok(sleepChip && sleepChip.value === null, '睡着不带数值（事件型没有可看的数字）', String(sleepChip && sleepChip.value));
const affChip = I.pickIcons({ hunger: 100, energy: 100, affectionJustUp: true })[0];
ok(affChip && affChip.value === null, '好感升级不带数值');
// limit
// 这里的状态组合：饿坏(hunger) + 力竭(energy, 被睡着抑制) + 睡着(sleep) + 好感(social) = 3 族
const many = I.pickIcons({ hunger: 10, energy: 10, sleeping: true, bored: true, affectionJustUp: true });
ok(many.map((c) => c.key).join(',') === 'starving,sleeping,affection',
  '三族并列：饿坏 / 睡着 / 好感（力竭被抑制，无聊被好感同族挤掉）', many.map((c) => c.key).join(','));
ok(I.pickIcons({ hunger: 10, energy: 10 }, 3).length === 2, 'limit=3 但只有 2 族 → 返回 2 个', String(I.pickIcons({ hunger: 10, energy: 10 }, 3).length));
ok(I.pickIcons({ hunger: 10, energy: 10, bored: true }, 1).length === 1, 'limit=1 只返回最紧急的');
ok(I.pickIcons({ hunger: 10, energy: 10 }, 0).length === 2, 'limit=0 等价不传（返回全部族）', String(I.pickIcons({ hunger: 10, energy: 10 }, 0).length));
// 空 / 非法
ok(Array.isArray(I.pickIcons(null)) && I.pickIcons(null).length === 0, 'null → 空数组（不崩）');
ok(I.pickIcons({ hunger: 90, energy: 90 }).length === 0, '都健康 → 空数组');
// 签名含数值
const sigA = I.iconsSignature(I.pickIcons({ hunger: 25 }));
const sigB = I.iconsSignature(I.pickIcons({ hunger: 26 }));
ok(sigA !== sigB, '数值变化 → 签名变化（数字要跟着跳）', sigA + ' vs ' + sigB);
ok(I.iconsSignature(I.pickIcons({ hunger: 100, energy: 100 })) === '', '空数组签名为空串');
ok(I.iconsSignature(I.pickIcons({ hunger: 10, energy: 15 })) === 'starving:10,exhausted:15',
  '两个小片签名是 key:value 逗号拼接', I.iconsSignature(I.pickIcons({ hunger: 10, energy: 15 })));
// pickIcon 与 pickIcons(...,1) 一致（历史 API 不漂移）
const s1 = { hunger: 12, energy: 18 };
ok(I.pickIcon(s1).key === I.pickIcons(s1, 1)[0].key, 'pickIcon 与 pickIcons(…,1) 结果一致');
// FAMILY 表覆盖全部图标
let noFam = 0;
for (const k of Object.keys(I.ICONS)) if (!I.FAMILY[k]) noFam++;
ok(noFam === 0, 'FAMILY 覆盖全部 7 个图标（漏一个就会重复显示）', String(noFam));

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
