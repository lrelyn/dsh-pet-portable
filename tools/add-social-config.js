// 给 config.jsonc 插入 petInteraction 段（P2 第四批：多宠社交）
// 用法: node add-social-config.js <config路径> [enabled]
const fs = require('node:fs');

const file = process.argv[2];
const enabled = process.argv[3] === 'true';
let txt = fs.readFileSync(file, 'utf8');

if (txt.includes('"petInteraction"')) {
  console.log('已存在 petInteraction，跳过');
  process.exit(0);
}

const block = `
  // ===================== 多宠社交（P2 第四批） =====================
  //
  // 复用已有的跨窗口位置广播（physics 的 reportFlight/onFlightStates），
  // 在物理碰撞之外加「关系值 + 社交互动」。
  //
  // 关系值（每两只之间独立，0~100，默认 50）：
  //   70~100 好朋友：贴贴/一起玩概率高，从不打架
  //   30~69  普通：各类型都有一点
  //   0~29   冤家：打架/追逐概率高，很少贴贴
  //
  // 注意：**不做双角色动画**（没有那个素材），改成单角色动画 + 位置对齐。
  // 所以贴贴看起来是「各自蹭一蹭」，不是两只抱在一起。
  "petInteraction": {
    "enabled": ${enabled},
    // 互动触发半径（像素）
    "detectRadius": 130,
    // 同一对宠物的互动冷却（毫秒），避免相遇时疯狂触发
    "cooldownMs": 20000,
    // 各类互动的基础概率（relation=普通时；好朋友/冤家会在此基础上偏移）
    "snuggleChance": 0.20,
    "chaseChance": 0.10
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
console.log('已插入 petInteraction (enabled=' + enabled + ')');
