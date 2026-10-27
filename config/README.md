# config/ — 生效配置的版本控制快照

> ⚠️ **这个目录不是运行时读取的位置，是备份 / 版本控制用的快照。**

## 真正生效的配置在哪（按运行方式区分）

| 运行方式 | 读取的配置 | 说明 |
|---|---|---|
| **便携版 exe**（`大肥鱼桌宠.exe`） | `<包根>\data\dsh-pet\main-config.jsonc` | `launcher.js` 设 `DSH_HOME=<包根>\data`，所以读包内这份 |
| **源码跑**（`node app/lib/standalone.js`） | 同上（若设了 `DSH_HOME`） | 只设 `DSH_PET_ROOT` 不改读路径 |
| **DSH 插件模式** | `%USERPROFILE%\.dsh\dsh-pet\main-config.jsonc` | 只有这种模式才读 `~/.dsh` |
| 兜底（无任何用户配置） | `app\assets\config.jsonc` | 内置默认，**P2 全关**（vitals.enabled=false） |

**判断方法（唯一可靠）**：看启动日志里打印的那行「配置 <路径>」。
便携版启动后 `pet.log` / 控制台会明确写：

```
配置 C:\...\大肥鱼桌宠\data\dsh-pet\main-config.jsonc
```

## 历史坑（务必不要再踩）

早期文档曾写「真正生效的是 `~/.dsh\dsh-pet\main-config.jsonc`，`data\dsh-pet\` 是旧遗留改了没用」——
**这个结论是反的**，只在 DSH 插件模式下成立。便携版的 `DSH_HOME` 被 launcher 指到包内，
`~/.dsh` 那份**完全不参与**。

后果：曾按错误认知把配置改到 `~/.dsh`，便携版读的还是包内旧值，表现为
「配置改了但心情/阈值/P2 一点变化都没有」。若照某些外部建议「同步或删除 `~/.dsh`」，
便携版的 P2（精力/饱食/好感度/离线演化）会全部失效。

## 三份配置当前状态（内容并不一致）

| 位置 | 大小 | P2 | 参与便携版 |
|---|---|---|---|
| `app\assets\config.jsonc`（内置默认） | 35.3 KB | `vitals.enabled=false` | 仅兜底 |
| `data\dsh-pet\main-config.jsonc` | 14.8 KB | `vitals.enabled=true` | ✅ **唯一生效** |
| `%USERPROFILE%\.dsh\dsh-pet\main-config.jsonc` | 8.7 KB | 无 P2 段 | ❌ 不参与 |

> 内置那份比生效那份**更大**是因为它带全部注释与默认动作池；
> 生效那份是用户层，只写覆盖项（`mergeEntry` 按字段深度合并）。

## 为什么这里要放一份

配置里有大量手工调过的内容，重新配一遍很痛苦：

| 内容 | 说明 |
|---|---|
| `moods` | 心情系统的阈值和分类权重倍率 |
| `animations.clicksHead/clicksBody/clicksFeet` | 分部位触摸的三个池 |
| `animations.categories` | 5 个分类共 132 个动作的精选池 |
| `workStatusTexts` | 6 档工作状态的中文文案 |
| `vitals` / `affinity` / `offline` / `foods` | P2 四模块参数 |
| `memes` | 27 张表情包的名称→描述映射 |
| `whisperPrompt` | 碎碎念/对话的人设 |
| `physics` | 拖拽抛掷手感参数 |

丢了要重调很久，所以纳入版本控制。

## 怎么同步

**从快照 → 便携版生效位置**（恢复 / 换机）：
```powershell
Copy-Item "config\main-config.jsonc" ".\data\dsh-pet\main-config.jsonc" -Force
```

**从生效位置 → 快照**（改完配置后备份）：
```powershell
Copy-Item ".\data\dsh-pet\main-config.jsonc" "config\main-config.jsonc" -Force
```

**只有用 DSH 插件模式时**才需要同步到 `~/.dsh`：
```powershell
Copy-Item "config\main-config.jsonc" "$env:USERPROFILE\.dsh\dsh-pet\main-config.jsonc" -Force
```

## 存档文件（不进版本控制）

同目录下还有两个运行时存档，`*.json` 但**不**纳入 git：

| 文件 | 内容 |
|---|---|
| `memory.json` | 宿主的对话记忆 `messages` + 心情值（宿主随时可能改写，本 fork 只做读-改-写） |
| `pet-state-<id>.json` | 精力 / 饱食 / 好感度 / 每日计数（每只宠物一个） |

分开存是有意的：`memory.json` 归宿主所有，`pet-state-*.json` 归桌宠自己所有。
混在一起会互相踩。`.gitignore` 已排除这两类。

## 敏感信息检查（本仓库已公开）

本文件**不含**任何密钥/Token/密码。检查过的关键词：`token` / `api_key` / `secret` / `password` / `sk-` / `ghp_` / `Bearer` —— 全部无命中。

**为公开做的处理**：

| 项 | 处理 | 原因 |
|---|---|---|
| `whisperModel` / `chatModel` | 清空为 `{"provider":"","model":""}` | 原值会暴露使用哪家模型服务商。空串语义 = 跟随当前对话的模型（正常配置） |
| 本地绝对路径 | 改成 `%USERPROFILE%` | 避免暴露用户名 |
| `whisperPrompt`（人设） | **保留** | 只是提示词，无隐私 |
| `memes` 映射 | **保留** | 表情包描述，无隐私 |
| `赞助码.jpg` | **保留** | 自愿赞助，公开可扫 |

恢复自己的 model 配置：在**生效位置**（便携版即 `data\dsh-pet\main-config.jsonc`）填回
provider/model 即可，不要改本快照。
