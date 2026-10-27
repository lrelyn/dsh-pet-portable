大肥鱼桌宠优化建议与工作状态系统方案
基于 dsh-pet 0.3.6 独立桌面版 · 2026年10月22日
# 第一部分：全局优化建议总览
除心情系统外，从交互体验、功能补全、AI 能力、配置易用性、性能稳定性、实用工具、素材个性化七个维度梳理可优化方向。
## 1.1 交互体验
| 优化项 | 现状 | 改进方向 |
| 多宠互动 | 多开只是复制，各玩各的 | 两只相遇触发贴贴/打架/追逐动画，互相影响心情 |
| 拖拽手感 | 物理参数固定 | 加甩出去力度反馈，撞墙有疼的动画和台词 |
| 触摸分区深化 | 头/身/脚三区固定反应 | 连续摸头递增（害羞→享受→打瞌睡），摸脚炸毛 |
| 双击特殊动作 | 单击=点击反应，双击无特殊 | 双击触发抱抱或举高高动画 |
| 跟随鼠标 | 无 | 可选模式：桌宠慢慢跟随鼠标光标移动 |

## 1.2 独立版功能补全（最大哑功能）
| 优化项 | 现状 | 改进方向 |
| 工作状态 | 独立版完全不触发（需 DSH 宿主） | 接本地前台窗口检测，识别工作/摸鱼/空闲 |
| 通知系统 | notificationsEnabled 存在但无来源 | 接系统通知（邮件/日历/微信），桌宠冒气泡提醒 |
| 余额显示 | 只支持 DeepSeek 官方 API | 扩展支持 OpenAI / 通义 / 豆包等多平台余额 |

## 1.3 AI 能力深化
| 优化项 | 现状 | 改进方向 |
| 碎碎念上下文 | 每句独立生成，不记得上一句 | 带最近 3~5 句上下文，形成连续吐槽 |
| 碎碎念看屏幕 | chatImageEnabled 开着但碎碎念不用图 | 定时截屏（低频），评论用户在看什么 |
| TTS 语音 | 只有气泡文字 | 接 Edge TTS（免费），让她真能说出来 |
| 语音输入 | 无 | 全局快捷键录音→ASR→对话，不用打字 |

## 1.4 配置易用性
| 优化项 | 现状 | 改进方向 |
| 可视化设置面板 | 所有参数手改 main-config.jsonc | 右键→设置打开图形面板，滑块调参 |
| 台词编辑器 | 手改 idleLines 数组 | 图形化增删台词，按心情分类管理 |
| 配置路径混乱 | config/、data/dsh-pet/、~/.dsh/ 三处 | 统一到一处，其余做软链或删除 |
| 预设方案 | 无 | 一键切换安静模式/话痨模式/省电模式 |

## 1.5 性能与稳定性
| 优化项 | 现状 | 改进方向 |
| 内存占用 | 单只约 150~200MB | 动画按需加载，多开共享素材缓存 |
| 启动速度 | 冷启动约 3~5 秒 | 预加载常用动画，首帧先出待机 |
| 进程残留 | 退出时偶发 electron 没退干净 | 加单实例锁 + 退出强制清理子进程 |
| 崩溃恢复 | crashpad 有但无自动重启 | 崩溃后自动重启并恢复位置和心情 |

## 1.6 实用工具（从摆件变助手）
| 优化项 | 说明 |
| 番茄钟 | 右键开始 25 分钟计时，结束时桌宠跳起来提醒 |
| 久坐提醒 | 45 分钟无键鼠活动，自动播伸懒腰+气泡提醒 |
| 便签 | 右键记一笔，气泡旁贴小纸条，重启不丢 |
| 快捷启动 | 右键菜单加打开软件列表，桌宠变第二个开始菜单 |
| 系统状态浮标 | 头顶小图标显示电量/CPU，电量低自动播没电了 |
| 老板键 | 全局快捷键一键隐藏所有桌宠 |

## 1.7 素材与个性化
| 优化项 | 说明 |
| 自定义导入动画 | 拖一个 webm 进窗口就自动注册成新动作 |
| 换装/皮肤 | 已有换装试色动画，但没有真正的皮肤切换系统 |
| 节日自动触发 | 按日期自动切换动作池（端午吃粽子、春节收红包） |
| 真实天气台词 | 接天气 API，让碎碎念有真实天气依据 |

优先级建议：可视化设置面板（最大使用门槛）> 独立版工作状态（最大哑功能）> 番茄钟+久坐提醒（最实用工具属性）。
# 第二部分：深入方案——独立版工作状态系统
## 2.1 为什么选这个方向
工作状态（workStatus）是 dsh-pet 原生设计的核心功能之一，代码中已有完整的 6 阶段状态机、6 套对应动画、6 组台词文案，但在独立桌面版中由于缺少 DSH 宿主的事件推送，这套系统完全处于休眠状态。这是当前桌宠最大的哑功能，没有之一。
救活它的价值：
- 桌宠立刻有眼力见——你写代码时她认真工作，你刷视频时她摸鱼，你离开时她发呆
- 与心情系统天然联动——工作顺利加心情，出错扣心情，摸鱼久了变无聊
- 技术方案明确——Windows 前台窗口检测是成熟技术，不依赖任何外部服务
- 纯本地运行——不联网、不上传数据，符合桌宠纯本地的定位
## 2.2 现状分析
已有代码资产（无需重写，只需接入触发源）：
| 模块 | 位置 | 状态 |
| 工作状态类型定义 | src/shared/work-status.ts | 已完成，6 阶段枚举 |
| 工作状态生命周期 | src/host/work-status.ts | 已完成，状态机逻辑 |
| 工作状态动画池 | main-config.jsonc → animations.events.workStatus | 已配置，6 段动画 |
| 工作状态台词 | main-config.jsonc → workStatusTexts | 已配置，6 组共 18 句 |
| 浏览器端接入 | src/client/pet.ts | 已接入（依赖 DSH 事件） |
| 桌面端接入 | runtime/electron-helper/sprite.js | 已接入（依赖 DSH 事件） |
| 独立版触发源 | 无 | 缺失——这是要做的部分 |

6 个工作阶段及现有动画：
| 阶段 | 含义 | 现有动画 | 现有台词（示例） |
| thinking | 思考中 | 工作状态-思考冒泡 | 正在认真想下一步呢 |
| working | 处理中 | 工作状态-忙碌点按 | 正在处理任务呢 |
| stepDone | 完成一步 | 工作状态-清点归档 | 这一步处理好啦 |
| needConfirm | 需确认 | 工作状态-原地踱步张望 | 需要你确认一下呢 |
| allDone | 全部完成 | 工作状态-雀跃庆祝 | 这一轮搞定啦，真棒 |
| error | 出错 | 工作状态-垂头叹气冒汗 | 这一步好像没跑通呢 |

## 2.3 技术方案：前台窗口检测
核心思路：通过 Windows API 定时获取当前前台窗口的进程名和窗口标题，映射到工作状态。不依赖 DSH 宿主，纯本地实现。
### 2.3.1 检测原理
// Windows API 获取前台窗口
// 方案 A：Node.js 调用 user32.dll（通过 ffi-napi 或 edge-js）
const ffi = require('ffi-napi');
const user32 = ffi.Library('user32', {
  GetForegroundWindow: ['pointer', []],
  GetWindowThreadProcessId: ['uint32', ['pointer', 'pointer']],
  GetWindowTextW: ['int', ['pointer', 'string', 'int']],
});

// 方案 B（推荐）：PowerShell 命令行获取，无需原生依赖
// powershell -Command "Get-Process -Id (Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1).Id | Select-Object ProcessName,MainWindowTitle"

// 方案 C（最轻量）：通过 electron 的 BrowserWindow 监听 focus/blur
// 但这只能检测桌宠自己的窗口，不能检测其他应用，不适用
推荐方案 B（PowerShell 子进程）：
- 无需安装 ffi-napi 等原生依赖（Electron 原生模块编译麻烦）
- PowerShell 是 Windows 自带，零依赖
- 每次检测耗时约 50~100ms，每 5 秒检测一次完全无感
- 桌宠已有 runtime/node.exe，spawn 一个 powershell 子进程即可
### 2.3.2 检测频率与防抖
| 参数 | 建议值 | 说明 |
| 检测间隔 | 5 秒 | 太频繁费电，太频繁状态切换抖动；5 秒是平衡点 |
| 状态确认次数 | 连续 2 次 | 避免用户临时切窗口导致状态抖动 |
| 空闲阈值 | 3 分钟无前台窗口变化 | 进入 idle（发呆）状态 |
| 状态最小持续 | 10 秒 | 进入新状态后至少保持 10 秒，防止闪烁 |

## 2.4 详细设计：窗口→工作状态映射
将前台窗口按进程名和标题关键词分类，映射到 6 个工作阶段。映射规则可配置。
| 窗口分类 | 识别规则（进程名 / 标题关键词） | 映射状态 | 心情联动 |
| 编程开发 | Code.exe、devenv.exe、idea64.exe、pycharm64.exe、webstorm.exe、标题含 .py/.js/.ts/.html | working | 无（持续工作不加减） |
| 文档办公 | WINWORD.EXE、EXCEL.EXE、POWERPNT.EXE、wps.exe、notepad++.exe | working | 无 |
| 设计创作 | Photoshop.exe、Illustrator.exe、Figma.exe、blender.exe | working | 无 |
| 终端命令行 | powershell.exe、cmd.exe、WindowsTerminal.exe、tabby.exe | thinking | 无 |
| 浏览器-工作 | chrome.exe/msedge.exe 且标题含 文档/邮箱/后台/管理/控制台/GitHub/StackOverflow | working | 无 |
| 浏览器-摸鱼 | chrome.exe/msedge.exe 且标题含 抖音/B站/微博/知乎/淘宝/视频/直播 | stepDone（摸鱼=完成一步休息） | 心情 +2/分钟 |
| 视频娱乐 | PotPlayer.exe、QQMusic.exe、netease cloud music.exe、斗鱼.exe、虎牙.exe | allDone（休息模式） | 心情 +3/分钟 |
| 游戏 | 英雄联盟、原神、csgo、dota2、steam 相关进程 | allDone | 心情 +5/分钟 |
| 聊天社交 | WeChat.exe、QQ.exe、DingTalk.exe、Lark.exe、飞书 | needConfirm | 无 |
| 桌面/无活动 | explorer.exe 或无前台窗口或锁屏 | thinking（发呆） | 超过 3 分钟心情 -1/分钟 |
| 桌宠自己 | WorkBuddy.exe、electron.exe（桌宠自身） | 保持上一状态 | 无 |

状态转换规则：
- working 持续超过 25 分钟 → 自动触发 stepDone（完成一个阶段），播庆祝动画，心情 +5
- working 持续超过 50 分钟 → 触发 allDone（该休息了），播雀跃动画，心情 +8，并弹出久坐提醒
- 从 working 切到摸鱼/视频/游戏 → stepDone（忙完了歇会儿）
- 从摸鱼切回 working → thinking（重新进入状态）
- error 状态：暂时不自动触发（独立版无法检测程序报错），保留手动触发入口
## 2.5 与心情系统联动设计
工作状态是心情系统的重要事件来源，弥补独立版事件太少的问题。
| 触发条件 | 心情事件 | 偏移量 | 说明 |
| 进入 working 状态 | workStart | +3 | 开始工作，有点干劲 |
| 持续工作 25 分钟（stepDone） | workSuccess | +12 | 完成一个阶段，成就感 |
| 持续工作 50 分钟（allDone） | workBigSuccess | +15 | 大功告成，该休息了 |
| 摸鱼超过 10 分钟 | slackOff | +2/分钟 | 摸鱼使人快乐，但有上限（最多 +20） |
| 空闲超过 3 分钟 | idleLonely | -1/分钟 | 被忽视会低落 |
| 从摸鱼切回工作 | backToWork | -2 | 又要干活了，有点不情愿 |

需要在 mood.ts 的 MOOD_EVENTS 中新增以下事件：
export const MOOD_EVENTS: Record<string, number> = {
  // 原有事件
  click: 6,
  workSuccess: 12,
  balanceRich: 8,
  workError: -15,
  balanceLow: -12,
  throwDrag: -4,
  // 新增：工作状态联动
  workStart: 3,
  workBigSuccess: 15,
  slackOff: 2,
  idleLonely: -1,
  backToWork: -2,
  feed: 8,  // 喂食（P0 改进）
};
## 2.6 配置项设计
在 main-config.jsonc 中新增 workStatusDetector 段：
"workStatusDetector": {
  "enabled": true,
  "detectIntervalSec": 5,
  "confirmCount": 2,
  "idleThresholdMin": 3,
  "minStateDurationSec": 10,
  "workStretchMin": 25,
  "longWorkStretchMin": 50,
  "slackOffMoodCap": 20,
  "customRules": [
    { "process": "Code.exe", "state": "working" },
    { "process": "chrome.exe", "titleContains": ["抖音","B站","微博"], "state": "slack" },
    { "process": "chrome.exe", "titleContains": ["GitHub","StackOverflow","文档"], "state": "working" }
  ],
  "moodIntegration": true
}
## 2.7 代码修改点
### 2.7.1 新增文件：前台窗口检测器
路径：app/src/standalone/foreground-watcher.ts
// 前台窗口检测器——独立版工作状态的触发源
// 通过 PowerShell 子进程获取前台窗口，映射为工作状态
import { spawn } from 'child_process';
import { WorkStatusState } from '../shared/work-status';

export interface ForegroundInfo {
  processName: string;
  windowTitle: string;
  detectedAt: number;
}

export class ForegroundWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastState: WorkStatusState = 'idle';
  private confirmCounter = 0;
  private stateSince = Date.now();
  private workingSince: number | null = null;

  constructor(private config: DetectorConfig) {}

  start(onStateChange: (state: WorkStatusState, info: ForegroundInfo) => void) {
    this.timer = setInterval(() => this.poll(onStateChange), this.config.detectIntervalSec * 1000);
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  private async poll(onStateChange: ...) {
    const info = await this.getForeground();
    const mapped = this.mapToState(info);
    // 防抖：连续 confirmCount 次才切换
    if (mapped === this.lastState) {
      this.confirmCounter = 0;
      return;
    }
    this.confirmCounter++;
    if (this.confirmCounter < this.config.confirmCount) return;
    // 状态最小持续时间
    if (Date.now() - this.stateSince < this.config.minStateDurationSec * 1000) return;
    this.lastState = mapped;
    this.stateSince = Date.now();
    this.confirmCounter = 0;
    onStateChange(mapped, info);
  }

  private async getForeground(): Promise<ForegroundInfo> {
    // 调用 PowerShell 获取前台窗口进程名和标题
    const ps = spawn('powershell', ['-NoProfile','-Command',
      '$h=Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1;' +
      'if($h){Write-Output "$($h.ProcessName)|$($h.MainWindowTitle)"}else{Write-Output "||"}'
    ]);
    // ... 解析输出
  }

  private mapToState(info: ForegroundInfo): WorkStatusState {
    // 按 2.4 节的映射规则实现
  }
}
### 2.7.2 修改文件：standalone 入口接入
路径：app/src/standalone/server.ts（或 cli.ts）
- 在 standalone 模式启动时创建 ForegroundWatcher 实例
- 将状态变更通过 WebSocket 推送给桌面端（sprite.js）
- 桌面端收到后调用已有 workStatus.setStatus() 方法（该方法已存在）
### 2.7.3 修改文件：桌面端 sprite.js
- 在 WebSocket 消息处理中新增 workStatus 事件监听
- 收到状态变更时调用已有 this.workStatus.setStatus(state)
- 在状态转换时联动心情：this.mood.event(对应事件名)
- 已有 workStatus 动画播放逻辑无需修改（events.workStatus 已配置）
### 2.7.4 修改文件：心情系统 mood.ts
- MOOD_EVENTS 新增 workStart / workBigSuccess / slackOff / idleLonely / backToWork / feed
- slackOff 和 idleLonely 是速率型事件（每分钟偏移），需要在 MoodState 中新增 tickWithRate 方法
## 2.8 实施步骤
| 阶段 | 内容 | 预估工时 | 依赖 |
| 第 1 步 | 实现 ForegroundWatcher（PowerShell 检测 + 映射规则） | 2 小时 | 无 |
| 第 2 步 | standalone 入口接入，WebSocket 推送状态 | 1 小时 | 第 1 步 |
| 第 3 步 | 桌面端 sprite.js 接收并调用已有 workStatus | 1 小时 | 第 2 步 |
| 第 4 步 | 心情系统联动（新增事件 + 速率型 tick） | 1.5 小时 | 第 3 步 |
| 第 5 步 | 配置项 + 自定义规则支持 | 1 小时 | 第 1 步 |
| 第 6 步 | 测试调优（映射规则、防抖参数） | 2 小时 | 全部 |
| 合计 |  | 约 8.5 小时（1 个工作日） |  |

## 2.9 风险与边界
| 风险 | 影响 | 应对方案 |
| PowerShell 子进程开销 | 每 5 秒 spawn 一次，约 50ms | 可接受；如需优化可改为常驻 PowerShell 进程 + stdin 通信 |
| 窗口标题识别不准 | 状态误判 | 提供 customRules 配置，用户可自行添加规则；误判不影响核心功能 |
| 全屏游戏/视频检测不到 | 部分独占模式窗口无标题 | 降级为 idle 状态，不报错 |
| 公司电脑权限限制 | PowerShell 执行策略限制 | 降级为仅检测进程名（不用标题），或提供 ffi-napi 备选方案 |
| 多显示器 | 前台窗口概念清晰，无影响 | 无需特殊处理 |
| 隐私顾虑 | 读取窗口标题可能涉及敏感信息 | 纯本地处理，不上传；标题只做关键词匹配，不存储不记录 |

## 2.10 验收标准
- 打开 VS Code 写代码，桌宠在 10 秒内进入 working 状态，播放忙碌动画
- 切到浏览器刷 B 站，桌宠在 10 秒内切换为 stepDone（摸鱼休息），心情缓慢上升
- 持续工作 25 分钟，桌宠自动播放 stepDone 庆祝动画，心情 +12
- 锁屏或离开 3 分钟，桌宠进入 thinking（发呆），心情缓慢下降
- 回到桌面后 10 秒内恢复正常状态
- 关闭检测开关（workStatusDetector.enabled=false）后，桌宠行为完全等价于当前版本
- 全程不联网、不上传任何数据