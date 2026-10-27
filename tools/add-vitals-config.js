// 给 config.jsonc 插入 vitals 段（精力/饱食）
// 用法: node add-vitals-config.js <config路径> [enabled]
const fs = require('node:fs');

const file = process.argv[2];
const enabled = process.argv[3] === 'true';

let txt = fs.readFileSync(file, 'utf8');
if (txt.includes('"vitals"')) {
  console.log('已存在 vitals，跳过');
  process.exit(0);
}

const block = `
  // ===================== 精力 / 饱食（P2 第一批） =====================
  // 两个按小时级演化的维度，与 mood 的分钟级互补：
  //   mood    短期情绪，事件驱动，会快速回归
  //   energy  精力，工作消耗 / 睡眠恢复
  //   hunger  饱食，随时间下降 / 喂食恢复
  //
  // 速率全部用「每分钟」，数字好读。默认值按文档给：
  //   工作 1.5/分 → 约 53 分钟从满精力到疲惫
  //   饱食 0.4/分 → 约 4 小时从吃饱到饥饿
  //   睡眠 4/分   → 约 25 分钟从 0 到满
  //
  // enabled: false 完全不启动（等价当前版本，一行代码都不跑）。
  "vitals": {
    "enabled": ${enabled},
    "energy": {
      "initial": 80,
      // 干活累得快；玩也累但慢；待机几乎不动
      "workDrainPerMin": 1.5,
      "playDrainPerMin": 0.5,
      "idleDrainPerMin": 0.2,
      // 睡眠恢复：4/分 ≈ 25 分钟回满
      "sleepRecoverPerMin": 4,
      // 低于这个值 → 触发"累了"事件（调用方可据此自动入睡）
      "autoSleepThreshold": 15,
      // 睡到高于这个值 → 自然醒
      "wakeThreshold": 90
    },
    "hunger": {
      "initial": 70,
      "drainPerMin": 0.4,
      "workDrainPerMin": 0.6,
      "sleepDrainPerMin": 0.1,
      // 低于这些值 → 饥饿 / 饿坏
      "hungryThreshold": 30,
      "starvingThreshold": 15
    },
    // 四维联动（按文档 §2，但幅度收窄 —— 桌宠是陪玩的，不是养成压力工具）
    "coupling": {
      // 饿/累会让心情慢慢掉（叠加在 mood 自身回归之外）
      "hungryMoodDrainPerMin": 0.5,
      "tiredMoodDrainPerMin": 0.3,
      // 心情好 / 吃饱 时精力恢复更快
      "happyEnergyBonus": 1.2,
      "fullEnergyBonus": 1.3
    }
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
console.log('已插入 vitals (enabled=' + enabled + ')');
