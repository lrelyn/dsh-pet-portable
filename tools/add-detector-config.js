// 给 config.jsonc 插入 workStatusDetector 段（放在 workStatusTexts 之后）
// 用法: node add-detector-config.js <config路径> [enabled]
const fs = require('node:fs');

const file = process.argv[2];
const enabled = process.argv[3] === 'true';

let txt = fs.readFileSync(file, 'utf8');

if (txt.includes('"workStatusDetector"')) {
  console.log('已存在 workStatusDetector，跳过');
  process.exit(0);
}

const block = `
  // ===================== 独立版工作状态检测（前台窗口 → 六档） =====================
  // 背景：workStatus 六档原本靠 DSH 会话事件驱动（turn/start、tool/call…）。独立版没有
  // 宿主事件，那 6 段动画 + 18 句台词就一直躺着。这一段让它靠「前台窗口」反推状态。
  //
  // 原理：主进程常驻一个 PowerShell，每 detectIntervalSec 秒读一次前台窗口的
  //   进程名 + 标题（实测 50ms/次，Add-Type 只编译一次），广播给各宠物窗口；
  //   各窗口用自己的状态机映射成六档并驱动动画。
  //
  // 隐私：进程名/标题只在内存里做关键词匹配，不落盘、不上传、不记录。
  //
  // enabled: false 完全不启动（等价当前版本，一行代码都不跑）。
  "workStatusDetector": {
    "enabled": ${enabled},
    // 采样间隔（秒）。5 是平衡点：更密费电，更疏状态滞后。
    "detectIntervalSec": 5,
    // 防抖：连续命中同一档位 N 次才切换（用户 Alt+Tab 很频繁，没有防抖会疯狂切动画）
    "confirmCount": 2,
    // 进入新档位后至少保持这么多秒，防止闪烁
    "minStateDurationSec": 10,
    // 前台窗口内容超过这么多分钟没变 → 判为"发呆"
    "idleThresholdMin": 3,
    // 连续工作这么久 → 触发一次"完成一段"（stepDone 里程碑，心情 +12）
    "workStretchMin": 25,
    // 连续工作这么久 → 触发"该休息了"（longDone 里程碑，心情 +10）
    "longWorkStretchMin": 50,
    // 自定义规则：**优先于内置规则**。格式 [{\\"match\\":{\\"process\\":[\\"进程名\\"],\\"titleContains\\":[\\"关键词\\"]},\\"state\\":\\"档位\\"}]
    // 档位可选：thinking / working / result / waiting / success / error / hold（hold = 保持不动）
    // 例：把 PyCharm 从 working 改成 thinking → [{\\"match\\":{\\"process\\":[\\"pycharm64\\"]},\\"state\\":\\"thinking\\"}]
    "customRules": []
  },
`;

// 插到 workStatusTexts 数组结束之后（找紧跟其后的第一个顶层字段前的空行位置）
// 插到 "physics": { 之前（workStatusTexts 之后、物理参数之前，语义相近的动画/状态参数区）
const marker = '  "physics": {';
if (txt.includes(marker)) {
  txt = txt.replace(marker, block + '\n' + marker);
} else {
  const alt = '  "pets": [';
  if (txt.includes(alt)) {
    txt = txt.replace(alt, block + '\n' + alt);
  } else {
    console.error('找不到插入点');
    process.exit(1);
  }
}

fs.writeFileSync(file, txt, 'utf8');
console.log('已插入 workStatusDetector (enabled=' + enabled + ')');
