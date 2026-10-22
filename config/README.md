# config/ — 真正生效的配置快照

> ⚠️ **这个目录不是运行时读取的位置，是备份/版本控制用的快照。**

## 真正生效的配置在哪

```
C:\Users\Administrator\.dsh\dsh-pet\main-config.jsonc
```

即 `$DSH_HOME/dsh-pet/main-config.jsonc`。改这个才生效。

**注意**：`Desktop\大肥鱼桌宠\data\dsh-pet\main-config.jsonc` 是**旧遗留文件**，改它没用（曾经踩过这个坑，白折腾半天）。

判断方法：看 standalone 启动日志里打印的「配置」路径。

## 为什么这里要放一份

配置里有大量手工调过的内容，重新配一遍很痛苦：

| 内容 | 说明 |
|---|---|
| `moods` | 心情系统的阈值和分类权重倍率 |
| `animations.clicksHead/clicksBody/clicksFeet` | 分部位触摸的三个池 |
| `animations.categories` | 5 个分类共 47 个动作的精选池 |
| `workStatusTexts` | 6 档工作状态的中文文案 |
| `memes` | 27 张表情包的名称→描述映射 |
| `whisperPrompt` | 碎碎念/对话的人设 |
| `physics` | 拖拽抛掷手感参数 |

丢了要重调很久，所以纳入版本控制。

## 怎么同步

**从项目 → 生效位置**（恢复时）：
```powershell
Copy-Item "config\main-config.jsonc" "$env:USERPROFILE\.dsh\dsh-pet\main-config.jsonc" -Force
```

**从生效位置 → 项目**（改了配置后备份）：
```powershell
Copy-Item "$env:USERPROFILE\.dsh\dsh-pet\main-config.jsonc" "config\main-config.jsonc" -Force
```

## 敏感信息检查

本文件**不含**任何密钥/Token/密码。检查过的关键词：`token` / `api_key` / `secret` / `password` / `sk-` / `ghp_` / `Bearer` —— 全部无命中。

`whisperModel` / `chatModel` 里只有 provider 和 model 名称（`deepseek` / `deepseek-chat`），不含凭据。
