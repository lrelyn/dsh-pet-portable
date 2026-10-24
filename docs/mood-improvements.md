# 心情系统改进说明（P0 + P1）

> 依据：`Desktop/大肥鱼桌宠心情系统改进建议.docx`（2026-10-22）
> 落实情况：**P0 全部 + P1 全部**；P2（精力/饱食/好感度/离线演化/多宠）未做，属长期演进。

## 改了什么

### P0 —— 立刻改善手感

| 项 | 改前 | 改后 | 为什么 |
|---|---|---|---|
| `thresholds` | happy 70 / tired 30 / grumpy 15 | **60 / 40 / 25** | normal 区间从 39 个分值点缩到 19，跨档明显更容易。实测**连点 2 次**就开心（原来要 4 次） |
| `decayPerSec` | 0.05（时间常数 20 秒） | **0.005**（约 3 分钟） | 原来点一下开心、倒杯水回来就没了；现在能维持十几分钟，有"趋势感" |
| 投喂事件 | **不存在** | `feed: +8` | 原来台词写「心情 +1」但代码里没调 `mood.event`，投喂后心情条毫无变化——最直观的逻辑断裂 |
| 忽视惩罚 | **不存在** | 5 分钟无交互后 **−0.5/分钟** | 原来心情只由事件驱动，用户不理它时恒定不变，缺少"需要陪伴"的驱动力 |

### P1 —— 让心情"看得见"

| 项 | 实现 |
|---|---|
| idle 池随心情替换 | `moods.specs.<档>.idle`：开心时「可爱宅舞/轻快摇摆舞」，困倦时「哈欠连天/迷糊犯困」，烦躁时「看表叹气」 |
| clicks 池随心情替换 | `moods.specs.<档>.clicks`：开心时被点优先「开心跃动」，烦躁时优先「傲娇生气/炸毛」 |
| 烦躁时正收益减半 | `applyEvent(v, name, thresholds)`：已在 grumpy 档时 `click`/`feed` 的 +值只有一半，需要更多耐心才能哄好。负收益不打折 |
| 睡眠/醒来事件 | `sleep: −5`（入睡）、`wake: +3`（醒来） |
| 心情持久化 | 每次 tick/事件节流写 `data/dsh-pet/memory.json` 的 `mood` 键；启动时恢复 |

## 未做（P2，需要新增素材或新系统）

- 精力 / 饱食维度
- 好感度（VPet 式长期养成）
- 离线演化（关闭期间的衰减与台词）
- 多宠互动（相遇/贴贴/打架）

这几项都需要新维度的素材与 UI，建议单独一轮做。

## 关键实现细节

### 1. 「烦躁时正收益减半」是可选参数

```js
applyEvent(value, event)          // 老行为：全额
applyEvent(value, event, thresholds)  // 新行为：grumpy 时正收益减半
```

`MoodState.event()` 内部传了 `thresholds`，所以 UI 侧透明生效；直接调 `applyEvent` 的老代码不受影响。

### 2. 忽视惩罚是 tick 的可选第三参

```js
mood.tick(dt, hour)            // 老行为：只做回归
mood.tick(dt, hour, idleMs)    // 新行为：超 5 分钟额外扣分
```

`sprite.js` 的 `handleEnded` 里传入 `Date.now() - this.lastInteractionAt`。

### 3. 持久化走 IPC，不走 HTTP

渲染进程 `contextIsolation` 下没有 fs 权限，所以：

```
sprite.js → window.petBridge.saveMood(v)      （preload 暴露）
         → ipcRenderer.invoke('pet:save-mood')
         → main.js ipcMain.handle → 读-改-写 data/dsh-pet/memory.json
```

**读-改-写**很重要：这个文件和宿主的**对话记忆**共用，直接覆盖会抹掉 `messages`。
测试里专门验证了「写入 mood 后 messages 结构/条数/内容都不变」。

路径也踩过坑：宿主 `userRoot = join(dshHome, 'dsh-pet')`，所以是
`data/dsh-pet/memory.json`，**不是** `data/memory.json`（我第一版写错了）。

### 4. 心情池会过滤不存在的素材

`moodPoolOrNull()` 会先用 `hasAnim()` 过滤——配置里写了不存在的动画名也不会 404，
只是那一项被跳过。池为空则回落到原池（等价未启用）。

## 测试

```
tests/mood-improvements.js   36 项  心情逻辑（事件/减半/惩罚/池/阈值）
tests/mood-persistence.js    15 项  持久化（读改写/messages 保全/边界/损坏降级）
```

跑法（项目根目录）：

```powershell
& "D:\workbuddy\binaries\node\versions\22.22.2-6\node.exe" tests\mood-improvements.js
& "D:\workbuddy\binaries\node\versions\22.22.2-6\node.exe" tests\mood-persistence.js
```

> 注：`shared-core.js` 是 UMD 包装（`var PetShared = (function(exports){...})({})`），
> 不走 `module.exports`。测试里用 `vm.runInContext` 跑一遍再取 `PetShared`。

## 改动的文件

| 文件 | 改动 |
|---|---|
| `app/src/shared/mood.ts` | 新事件、阈值/decay 默认值、`MoodSpec.idle/clicks`、`applyEvent` 第三参、`tick` 第三参、`restore/snapshot`、`moodPool` |
| `app/runtime/electron-helper/shared-core.js` | 同上（UMD 手工镜像，**桌面端实际运行的**） |
| `app/runtime/electron-helper/sprite.js` | 投喂/睡眠/醒来接心情、忽视惩罚、idle/clicks 池替换、持久化、启动恢复 |
| `app/runtime/electron-helper/preload.js` | 暴露 `loadMood` / `saveMood` |
| `app/runtime/electron-helper/main.js` | `pet:load-mood` / `pet:save-mood` 两个 IPC handler（读-改-写） |
| `app/assets/config.jsonc` | `moods` 默认段同步（仍 `enabled: false`） |
| 用户生效配置 | 已更新为 `enabled: true` + 新参数 |
