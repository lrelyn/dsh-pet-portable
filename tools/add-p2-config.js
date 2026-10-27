// 给 config.jsonc 插入 affinity / offline / foods 配置（P2 第二、三批）
// 用法: node add-p2-config.js <config路径> [enabled]
const fs = require('node:fs');

const file = process.argv[2];
const enabled = process.argv[3] === 'true';
let txt = fs.readFileSync(file, 'utf8');

if (txt.includes('"affinity"')) {
  console.log('已存在 affinity，跳过');
  process.exit(0);
}

const block = `
  // ===================== 好感度 + 离线演化（P2 第二/三批） =====================
  //
  // affinity 与 mood 的区别：
  //   mood      短期情绪，分钟~小时，频繁波动，会 decay 回归
  //   affinity  长期关系，天~周，缓慢累积，只随长期缺席下降
  //
  // 六级：Lv1 陌生(0) / Lv2 认识(20) / Lv3 熟悉(40) / Lv4 亲密(60) / Lv5 羁绊(80) / Lv6 心灵相通(95)
  //
  // 每日上限是关键设计：没有它的话连点 100 下就刷满了，失去"长期"的意义。
  // 规则见代码 affinity.js 的 DAILY_RULES：
  //   每日首次互动 +2（1 次）/ 喂食 +1（3 次）/ 陪玩 +0.5（10 次）
  //   工作里程碑 +2（不限）/ 全天陪伴 +1（1 次）/ 及时照顾 +1.5（不限）
  "affinity": {
    "enabled": ${enabled},
    // 连续缺席多久开始掉好感（天）
    "decayAfterDays": 1
  },

  // 离线演化：桌宠关闭期间状态继续走，下次启动按离线时长推演并播回归剧情。
  //   精力：离线前 30 分钟按睡眠恢复，之后保持满（假设她自己睡了一觉）
  //   饱食：持续按睡眠速率消耗，扣到 0 为止
  //   心情：前 2 小时不变，之后每小时 -1（孤独）
  //   好感：见 affinity 的缺席规则（7 天以上触发"离家出走"彩蛋）
  "offline": {
    "enabled": ${enabled},
    // 自动存档间隔（分钟）
    "autosaveMin": 5,
    // 超过这么多天不回 → 离家出走彩蛋（可哄回，不是永久惩罚）
    "runawayAfterDays": 7
  },
`;

const marker = '  "workStatusDetector": {';
if (txt.includes(marker)) {
  txt = txt.replace(marker, block + '\n' + marker);
} else {
  const alt = '  "physics": {';
  if (txt.includes(alt)) txt = txt.replace(alt, block + '\n' + alt);
  else { console.error('找不到插入点'); process.exit(1); }
}

fs.writeFileSync(file, txt, 'utf8');
console.log('已插入 affinity + offline (enabled=' + enabled + ')');
