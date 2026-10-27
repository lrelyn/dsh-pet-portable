大肥鱼桌宠全局优化深入方案
七大维度 · 三十项优化 · 可执行方案 ｜ 2026年10月22日
本文档将全局优化建议的七个维度、三十余个优化项逐一深化为可执行方案，每项包含问题分析、实现方案、代码修改点、配置设计、预估工时和优先级。工作状态系统已单独成文，本文不重复展开。
# 一、交互体验深化
### 1.1 多宠互动
| 维度 | 内容 |
| 问题 | 多开 1~12 只时，各只宠物独立运行，相遇时无任何互动，只是重叠在一起，多开体验单调。 |
| 实现方案 | 在 sprite.js 中新增宠物间碰撞检测（已有 petCollision 配置项但默认关闭），当两只宠物距离小于阈值时：① 概率触发贴贴动画（互相蹭一蹭）；② 小概率触发追逐（一只追另一只）；③ 心情联动：贴贴双方各 +3 心情，追逐被追方 -2。通过 standalone 的 WebSocket 广播各宠物位置实现跨窗口检测。 |
| 代码修改点 | sprite.js 新增 PetInteraction 类；standalone/server.ts 新增位置广播端点；physics.ts 启用 petCollision 并添加碰撞回调；mood.ts 新增 petSnuggle / petChase 事件。 |
| 配置项 | petInteraction: { enabled: true, snuggleChance: 0.3, chaseChance: 0.1, detectRadius: 120 } |
| 预估工时 | 6 小时 |
| 优先级 | P2（长期，依赖多开场景） |

### 1.2 拖拽手感优化
| 维度 | 内容 |
| 问题 | 当前拖拽只有物理参数（重力/弹性/摩擦），扔出去后没有情绪反馈，撞墙也无反应，手感偏“死”。 |
| 实现方案 | ① 拖拽时根据移动速度判断“轻拿”还是“猛甩”，猛甩触发“被吓一跳（炸毛）”动画；② 落地/撞墙时根据冲击速度播放对应反应（轻放=开心跃动，重摔=垂头叹气）；③ 拖拽超过 5 秒触发“放我下来嘛”气泡台词；④ 扔出去后有概率追着鼠标跑回来。 |
| 代码修改点 | sprite.js 的 handleDragStart / handleDragEnd / handleCollision 回调；新增 throwVelocity 计算；clicks 动画池按冲击速度分级。 |
| 配置项 | dragFeedback: { enabled: true, hardThrowThreshold: 800, slamAnim: “被吓一跳（炸毛）”, softDropAnim: “点击回应-开心跃动” } |
| 预估工时 | 3 小时 |
| 优先级 | P1（中期，体感提升明显） |

### 1.3 触摸分区深化
| 维度 | 内容 |
| 问题 | 已有 clicksHead / clicksBody / clicksFeet 三区分，但每个区只是固定动画池随机播放，没有递进感。 |
| 实现方案 | ① 连续摸同一部位触发递进：第1次随机、第2次中段、第3次起末段（已有配置注释但未完全实现递进逻辑）；② 摸头超过 3 次触发“打瞌睡”动画并 +5 心情；③ 摸脚第1次“被吓一跳”，连续摸脚触发“炸毛”并 -3 心情（她不喜欢被碰脚）；④ 新增摸手/摸尾分区（如果素材支持）。 |
| 代码修改点 | sprite.js 的 handleClick 中按部位和连续点击次数选择动画；新增 lastTouchZone / touchCount 状态；mood.ts 新增 headPet / footPoke 事件。 |
| 配置项 | touchZones: { head: { thresholdY: 0.42, progressive: true }, body: { thresholdY: 0.82 }, feet: { dislike: true } } |
| 预估工时 | 3 小时 |
| 优先级 | P1（中期，互动细腻度核心） |

### 1.4 双击特殊动作
| 维度 | 内容 |
| 问题 | 当前单击=点击反应，双击被当作两次单击处理，无特殊动作，浪费了一个交互维度。 |
| 实现方案 | ① 双击触发“抱抱”动画（如果有素材，否则用“开心跃动”+气泡“抱抱！”）；② 双击时桌宠向鼠标方向跳跃一小段；③ 三击触发“举高高”（桌宠向上弹起然后落下）；④ 双击间隔阈值 300ms。 |
| 代码修改点 | sprite.js 新增 clickCount / lastClickTime 检测；handleClick 中区分单击/双击/三击；新增 hug / lift 动画映射。 |
| 配置项 | doubleClick: { enabled: true, intervalMs: 300, anim: “点击回应-开心跃动”, bubble: “抱抱！” } |
| 预估工时 | 1.5 小时 |
| 优先级 | P0（立刻可做，成本低收益高） |

### 1.5 跟随鼠标模式
| 维度 | 内容 |
| 问题 | 桌宠只能在固定区域随机游走，无法主动跟随用户，缺乏“跟着你”的陪伴感。 |
| 实现方案 | ① 右键菜单新增“跟随鼠标”开关；② 开启后桌宠以较慢速度（比鼠标慢，有延迟感）向鼠标位置移动；③ 距离鼠标小于阈值时停下并播放“到啦”动画；④ 鼠标静止超过 10 秒后桌宠在附近随机溜达；⑤ 可切换为“跟随活动窗口”模式（跟着前台窗口走）。 |
| 代码修改点 | sprite.js 新增 followMode 状态；tick 中计算目标位置并移动；菜单新增 toggle-follow 动作。 |
| 配置项 | followMouse: { enabled: false, speed: 120, stopRadius: 80, idleAfterSec: 10 } |
| 预估工时 | 3 小时 |
| 优先级 | P1（中期，陪伴感强） |

# 二、独立版功能补全深化
工作状态系统已单独成文（见《大肥鱼桌宠优化建议与工作状态方案》），本节重点展开通知系统和多平台余额。
### 2.1 系统通知接入
| 维度 | 内容 |
| 问题 | notificationsEnabled 配置项已存在，notify.ts / notify-events.ts 模块已写好，但独立版没有通知来源，整套通知系统完全休眠。已有 6 张通知图标（approval/done/error/question/test/truncated）但从未显示。 |
| 实现方案 | ① 接入 Windows 系统通知监听：通过 PowerShell 或 Windows UI Automation 检测系统通知（邮件/日历/微信/飞书）；② 收到通知时桌宠冒气泡显示摘要，并播放对应动画（邮件=好奇探头，日历=看表叹气，微信=举牌“有消息”）；③ 可配置忽略的应用列表；④ 通知超过 3 条时桌宠显示“消息堆积”动画。 |
| 代码修改点 | standalone 新增 notification-watcher.ts（PowerShell 监听系统通知）；sprite.js 新增 showNotification 方法；已有 notify.ts 模块直接复用。 |
| 配置项 | notifications: { enabled: false, watchApps: [“WeChat”,“Lark”,“DingTalk”,“Outlook”], ignoreApps: [], maxBubbleLen: 40 } |
| 预估工时 | 5 小时 |
| 优先级 | P2（长期，Windows 通知监听兼容性较复杂） |

### 2.2 多平台余额支持
| 维度 | 内容 |
| 问题 | 当前余额只支持 DeepSeek 官方 API（deepseek-account.ts），用户如果用其他平台（OpenAI/通义/豆包/OpenRouter）则余额功能完全无用。 |
| 实现方案 | ① 重构 balance/providers 目录，新增 OpenAI / 通义千问 / 豆包 / OpenRouter / 自定义 API 提供商；② 每个提供商实现统一的 BalanceProvider 接口（fetchBalance 方法）；③ 配置中可添加多个账户，桌宠轮询显示最低余额或总余额；④ 余额低于阈值时触发“袋空如洗”动画 + 气泡提醒。 |
| 代码修改点 | balance/providers/ 新增各平台文件；balance/index.ts 重构为多 provider 轮询；config 新增 balance.accounts 数组。 |
| 配置项 | balance: { enabled: true, refreshSec: 1800, lowThreshold: 2, accounts: [{ provider: “deepseek”, key: “...” }, { provider: “openai”, key: “...” }] } |
| 预估工时 | 6 小时 |
| 优先级 | P2（长期，依赖用户实际使用多平台） |

### 2.3 独立版工作状态（已单独方案）
| 维度 | 内容 |
| 问题 | 详见《大肥鱼桌宠优化建议与工作状态方案》，通过前台窗口检测实现工作/摸鱼/空闲识别。 |
| 实现方案 | 前台窗口检测 + 6 阶段状态机 + 心情联动。 |
| 代码修改点 | 新增 foreground-watcher.ts；修改 standalone/server.ts 和 sprite.js。 |
| 配置项 | workStatusDetector: { enabled: true, detectIntervalSec: 5, ... } |
| 预估工时 | 8.5 小时 |
| 优先级 | P0（最高优先级，最大哑功能） |

# 三、AI 能力深化
### 3.1 碎碎念上下文记忆
| 维度 | 内容 |
| 问题 | 当前碎碎念每句独立生成（whisper.ts），不记得上一句说了什么，导致可能连续说矛盾的话（刚说“好开心”下一句“我好难过”）。 |
| 实现方案 | ① whisper.ts 中维护最近 3~5 句碎碎念的上下文；② 调用 DeepSeek 时将上下文拼入 prompt，要求“承接上一句的情绪和话题”；③ 新增话题连贯性评分，避免突然跳话题；④ 上下文在配置的 chatMemoryRounds 基础上单独设置 whisperMemoryRounds。 |
| 代码修改点 | whisper.ts 新增 contextQueue；llm 调用时拼接上下文；config 新增 whisperMemoryRounds。 |
| 配置项 | whisper: { memoryRounds: 3, contextAware: true, topicCoherence: true } |
| 预估工时 | 2 小时 |
| 优先级 | P1（中期，碎碎念质量核心） |

### 3.2 碎碎念看屏幕
| 维度 | 内容 |
| 问题 | chatImageEnabled 已开启且支持多模态，但碎碎念不使用图片能力，永远是“盲聊”。 |
| 实现方案 | ① 低频（每 10~15 分钟）截取屏幕缩略图（降分辨率到 512px 宽，控制 token 消耗）；② 将截图传给 DeepSeek 多模态，让她评论“你在看什么”；③ 可配置截图频率和是否启用；④ 截图只在本地处理后发送 API，不存储；⑤ 检测到用户在看她相关的内容时触发特殊反应（“你在看我？好害羞”）。 |
| 代码修改点 | whisper.ts 新增 screenshotAndComment 方法；使用 electron 的 desktopCapturer 截图；config 新增 whisperImage 段。 |
| 配置项 | whisperImage: { enabled: false, intervalMin: 15, maxDim: 512, saveScreenshot: false } |
| 预估工时 | 3 小时 |
| 优先级 | P2（长期，token 消耗需用户接受） |

### 3.3 TTS 语音朗读
| 维度 | 内容 |
| 问题 | 当前所有对话和碎碎念只有气泡文字，没有声音，缺乏“真的在说话”的感觉。 |
| 实现方案 | ① 接入 Edge TTS（免费，无需 API key，通过 edge-tts 库或直接调用微软语音接口）；② 碎碎念和对话回复自动朗读；③ 可选择音色（中文女声/男声/童声）；④ 可调节语速和音量；⑤ 右键菜单“静音”开关；⑥ 气泡文字和语音同步显示。 |
| 代码修改点 | 新增 tts.ts 模块（封装 edge-tts）；sprite.js 在 bubble 显示时调用 tts.speak；菜单新增 toggle-mute。 |
| 配置项 | tts: { enabled: false, voice: “zh-CN-XiaoxiaoNeural”, rate: “+0%”, volume: 80, autoSpeakWhisper: true, autoSpeakChat: true } |
| 预估工时 | 4 小时 |
| 优先级 | P1（中期，拟人感大幅提升） |

### 3.4 语音输入对话
| 维度 | 内容 |
| 问题 | 当前对话只能打字输入，对于桌宠这种轻量场景不够自然。 |
| 实现方案 | ① 全局快捷键（如 Ctrl+Alt+V）启动录音；② 录音通过 Whisper（本地或 API）转文字；③ 文字送入对话系统；④ 回复通过 TTS 朗读；⑤ 录音时桌宠显示“倾听中”动画；⑥ 可配置录音时长上限和静音自动停止。 |
| 代码修改点 | 新增 voice-input.ts（麦克风录音 + Whisper ASR）；全局快捷键注册；sprite.js 新增 listening 状态。 |
| 配置项 | voiceInput: { enabled: false, hotkey: “Ctrl+Alt+V”, asr: “whisper-api”, maxDurationSec: 30, silenceStopMs: 1500 } |
| 预估工时 | 6 小时 |
| 优先级 | P2（长期，依赖 TTS 和 ASR） |

# 四、配置易用性深化
### 4.1 可视化设置面板
| 维度 | 内容 |
| 问题 | 当前所有参数（大小/位置/物理/心情阈值/动作池）都要手改 main-config.jsonc，对普通用户门槛极高，改错一个逗号就全崩。这是最大的使用障碍。 |
| 实现方案 | ① 右键菜单新增“设置”项，打开一个 Electron 子窗口（或浏览器端设置页）；② 面板分区：基础设置（大小/位置/多开数量）、物理参数（滑块）、心情系统（阈值/decay/开关）、动作池（勾选启用哪些分类）、AI 设置（API key/模型/碎碎念开关）、高级（配置导入导出/重置）；③ 所有修改实时预览（改大小立刻生效）；④ 保存时自动校验 JSON 合法性，非法则提示不保存。 |
| 代码修改点 | 新增 settings.html + settings.js（设置面板 UI）；standalone 新增 /settings 路由；sprite.js 菜单新增 open-settings；config.ts 新增 validate 和 hot-reload。 |
| 配置项 | 无新增配置项（面板就是配置的图形化） |
| 预估工时 | 12 小时 |
| 优先级 | P0（最高优先级，最大使用门槛） |

### 4.2 台词图形化编辑器
| 维度 | 内容 |
| 问题 | 当前 idleLines 是 115 句的 JSON 数组，增删改都要手编辑 JSON，且无法按心情分类管理。 |
| 实现方案 | ① 设置面板中新增“台词管理”标签页；② 按心情档位（happy/normal/tired/grumpy）分组显示台词；③ 支持增删改、批量导入（粘贴文本每行一句）、导出；④ 台词长度实时校验（超过 20 字标红）；⑤ 支持“测试播放”（立刻让桌宠说这句）。 |
| 代码修改点 | settings 面板新增台词编辑 Tab；config.ts 新增 idleLines 的 CRUD 接口；sprite.js 新增 sayLine(line) 调试方法。 |
| 配置项 | idleLines 结构升级为 { happy: [...], normal: [...], tired: [...], grumpy: [...] }（向后兼容旧数组格式） |
| 预估工时 | 5 小时 |
| 优先级 | P1（中期，依赖设置面板） |

### 4.3 配置路径统一
| 维度 | 内容 |
| 问题 | 当前配置分散在三处：config/main-config.jsonc（开发用）、data/dsh-pet/main-config.jsonc（旧版残留）、~/.dsh/dsh-pet/main-config.jsonc（实际生效）。三处内容不一致，用户容易改错文件。 |
| 实现方案 | ① 确认唯一生效路径为 ~/.dsh/dsh-pet/main-config.jsonc（standalone.js 第518行已写死）；② 删除 data/dsh-pet/ 下的旧配置（或改为软链）；③ config/ 目录在文档中明确标注为“开发模板，不生效”；④ 启动时检测多处配置并警告用户；⑤ 右键菜单新增“打开配置文件夹”直接定位到生效路径。 |
| 代码修改点 | standalone.js 启动时增加多配置检测警告；sprite.js 菜单新增 open-config-folder；清理 data/dsh-pet/ 旧文件。 |
| 配置项 | 无 |
| 预估工时 | 1 小时 |
| 优先级 | P0（立刻可做，消除困惑） |

### 4.4 预设方案一键切换
| 维度 | 内容 |
| 问题 | 当前所有参数都是单一配置，无法快速在“安静摸鱼”和“话痨陪伴”之间切换。 |
| 实现方案 | ① 内置 3 套预设：安静模式（碎碎念关闭/动作少/体积小）、标准模式（当前默认）、话痨模式（碎碎念 2 分钟一次/动作丰富/体积大）；② 右键菜单新增“模式切换”子菜单；③ 切换时动画过渡（桌宠转个圈表示换模式）；④ 支持用户自定义预设并保存。 |
| 代码修改点 | config.ts 新增 presets 段；sprite.js 菜单新增 preset 子菜单；新增 applyPreset(name) 方法。 |
| 配置项 | presets: { quiet: {...}, standard: {...}, chatty: {...}, custom: {} } |
| 预估工时 | 2 小时 |
| 优先级 | P1（中期，依赖设置面板） |

# 五、性能与稳定性深化
### 5.1 内存占用优化
| 维度 | 内容 |
| 问题 | 单只桌宠约 150~200MB（Electron + 136 个 webm），多开 12 只可达 2GB 以上。主要原因是所有 webm 一次性加载到内存。 |
| 实现方案 | ① 动画按需加载：只解码当前播放和最近播放的 5~10 个动画，其余从内存卸载；② LRU 缓存策略，超过阈值自动淘汰；③ 多开时共享同一份素材缓存（通过 standalone 中心化管理）；④ 闲置超过 5 分钟进入“省电模式”，降低帧率到 15fps。 |
| 代码修改点 | sprite.js 新增 AnimationLRU 类；standalone 新增素材共享服务；tick 中根据闲置状态调节 requestAnimationFrame 频率。 |
| 配置项 | performance: { animationCacheSize: 10, powerSaveIdleMin: 5, powerSaveFps: 15, sharedCache: true } |
| 预估工时 | 6 小时 |
| 优先级 | P2（长期，多开用户才明显感知） |

### 5.2 启动速度优化
| 维度 | 内容 |
| 问题 | 冷启动约 3~5 秒，主要耗时在 Electron 初始化 + 136 个 webm 元数据读取 + 配置加载。 |
| 实现方案 | ① 首帧优先：先显示待机动画（只加载 1 个 webm），后台异步加载其他动画；② 配置文件预读取（launcher.js 阶段就读好配置传给 Electron）；③ Electron 启用 --enable-fast-unload --v8-cache-options=off；④ 常用动画元数据缓存到本地 JSON，避免每次扫描目录。 |
| 代码修改点 | launcher.js 新增预加载逻辑；sprite.js 首帧优先渲染；新增 animation-manifest.json 缓存。 |
| 配置项 | performance: { fastStart: true, preloadAnims: [“待机呼吸休闲”,“东张西望”] } |
| 预估工时 | 4 小时 |
| 优先级 | P1（中期，启动体验明显） |

### 5.3 进程残留与单实例锁
| 维度 | 内容 |
| 问题 | 退出桌宠时偶发 electron 子进程没退干净（类似 WorkBuddy 的 10 进程残留问题），导致下次启动时端口被占、配置文件被锁。 |
| 实现方案 | ① 启动时检测单实例锁（Electron 的 requestSingleInstanceLock）；② 如果已有实例，聚焦已有窗口并退出；③ 退出时遍历所有子进程并强制终止（process-tree kill）；④ 新增“强制退出”菜单项（右键→退出，清理所有进程）；⑤ 启动时检测残留进程并自动清理。 |
| 代码修改点 | standalone.js 新增 singleInstanceLock；新增 graceful-shutdown.ts 遍历子进程；launcher.js 启动前清理残留。 |
| 配置项 | 无 |
| 预估工时 | 2 小时 |
| 优先级 | P0（立刻可做，稳定性基础） |

### 5.4 崩溃自动恢复
| 维度 | 内容 |
| 问题 | crashpad 已配置（崩溃上报到腾讯伽利略），但崩溃后不会自动重启，用户看到桌宠消失只能手动重开。 |
| 实现方案 | ① launcher.js 监控 standalone 进程，崩溃退出码非 0 时自动重启（最多 3 次，间隔 5 秒）；② 重启后恢复桌宠位置和心情（从 memory.json 读取）；③ 连续崩溃 3 次后停止重启并提示用户；④ 崩溃时保存当前状态快照（位置/心情/当前动画）。 |
| 代码修改点 | launcher.js 新增进程监控和自动重启；sprite.js 退出前保存状态快照；memory.json 新增 lastState 字段。 |
| 配置项 | crashRecovery: { enabled: true, maxRetries: 3, retryIntervalSec: 5, restoreState: true } |
| 预估工时 | 3 小时 |
| 优先级 | P1（中期，稳定性提升） |

# 六、实用工具深化（从摆件变助手）
### 6.1 番茄钟
| 维度 | 内容 |
| 问题 | 桌宠缺乏实用工具属性，纯摆件容易被用户遗忘。番茄钟是最契合桌宠形态的工具。 |
| 实现方案 | ① 右键菜单新增“番茄钟”→ 25分钟/50分钟/自定义；② 计时中桌宠播放“认真工作”动画，头顶显示倒计时；③ 结束时桌宠跳起来播放“雀跃庆祝”+气泡“时间到！休息一下”；④ 休息时间到了提醒回来；⑤ 可配置自动循环（工作25+休息5，4轮后长休息15）；⑥ 完成的番茄数记录在 memory.json。 |
| 代码修改点 | sprite.js 新增 PomodoroTimer 类；菜单新增 pomodoro 子菜单；头顶新增倒计时显示元素；mood.ts 新增 pomodoroDone 事件(+8)。 |
| 配置项 | pomodoro: { workMin: 25, breakMin: 5, longBreakMin: 15, roundsBeforeLong: 4, autoLoop: false } |
| 预估工时 | 4 小时 |
| 优先级 | P0（最高优先级，最实用工具） |

### 6.2 久坐提醒
| 维度 | 内容 |
| 问题 | 用户长时间盯屏幕时桌宠没有任何健康提醒，浪费了“一直盯着你”的优势。 |
| 实现方案 | ① 检测键鼠活动（通过 Windows API 或 Electron 的 powerMonitor / idleDetector）；② 连续 45 分钟无休息时，桌宠播放“超大伸懒腰”+气泡“起来走走啦”；③ 可配置提醒间隔和是否启用；④ 提醒后用户起来活动（检测到键鼠离开超过 2 分钟），桌宠播放“真棒”动画；⑤ 久坐超过 2 小时触发“看表叹气”+严肃提醒。 |
| 代码修改点 | standalone 新增 idle-detector.ts（Windows 调用 GetLastInputInfo）；sprite.js 新增久坐提醒逻辑；config 新增 sedentary 段。 |
| 配置项 | sedentaryReminder: { enabled: true, intervalMin: 45, strictAfterMin: 120, anim: “超大伸懒腰” } |
| 预估工时 | 3 小时 |
| 优先级 | P0（最高优先级，健康向实用） |

### 6.3 便签
| 维度 | 内容 |
| 问题 | 用户临时想记点东西（电话号码/待办/灵感）时，桌宠可以充当便签载体。 |
| 实现方案 | ① 右键“记一笔”打开输入框（或直接在气泡中输入）；② 便签贴在桌宠旁边的小纸条上，显示前 20 字；③ 鼠标悬停显示完整内容；④ 多条便签轮播显示；⑤ 右键可删除/标记完成；⑥ 便签存在 memory.json，重启不丢；⑦ 可设置提醒时间（到点桌宠举着便签提醒）。 |
| 代码修改点 | sprite.js 新增 StickyNote 类和便签 DOM 元素；菜单新增 add-note；memory.json 新增 notes 数组。 |
| 配置项 | notes: { enabled: true, maxVisible: 3, rotateSec: 8 } |
| 预估工时 | 4 小时 |
| 优先级 | P1（中期，实用工具） |

### 6.4 快捷启动器
| 维度 | 内容 |
| 问题 | 桌宠常驻桌面，天然适合做快捷入口，但当前右键菜单只有动作点播。 |
| 实现方案 | ① 右键菜单新增“打开软件”子菜单；② 用户可配置常用软件路径（VS Code/浏览器/微信/文件夹等）；③ 点击直接启动；④ 支持“打开常用网站”（配置 URL，用默认浏览器打开）；⑤ 支持“运行命令”（高级用户）；⑥ 可拖拽文件到桌宠身上用指定软件打开。 |
| 代码修改点 | sprite.js 菜单新增 launcher 子菜单；config 新增 quickLaunch 数组；新增 shell.openPath / shell.openExternal 调用。 |
| 配置项 | quickLaunch: { apps: [{name:“VS Code”, path:“...”}, {name:“B站”, url:“...”}], commands: [] } |
| 预估工时 | 2 小时 |
| 优先级 | P1（中期，效率工具） |

### 6.5 系统状态浮标
| 维度 | 内容 |
| 问题 | 桌宠可以成为系统状态的可视化入口，比任务栏图标更直观。 |
| 实现方案 | ① 桌宠头顶/身旁显示小图标：电量（低时变红）、CPU（高时桌宠冒汗）、网络（断网时桌宠举“断网了”牌）；② 电池低于 20% 自动播“没电了”动画 + 提醒充电；③ CPU 持续 >90% 超过 1 分钟，桌宠播放“压力一只大肥鱼”；④ 可配置显示哪些指标；⑤ 鼠标悬停浮标显示详细数值。 |
| 代码修改点 | standalone 新增 system-monitor.ts（PowerShell 获取电量/CPU/网络）；sprite.js 新增浮标 DOM；config 新增 systemHud 段。 |
| 配置项 | systemHud: { enabled: false, battery: true, cpu: true, network: true, lowBatteryThreshold: 20, highCpuThreshold: 90 } |
| 预估工时 | 4 小时 |
| 优先级 | P2（长期，信息过载风险） |

### 6.6 老板键
| 维度 | 内容 |
| 问题 | 上班摸鱼时桌宠在屏幕上蹦跶可能被老板看到，需要一键隐藏。 |
| 实现方案 | ① 全局快捷键（默认 Ctrl+Alt+W，可配置）按下后所有桌宠窗口瞬间隐藏到托盘；② 再按一次恢复；③ 隐藏时桌宠进程不退出，状态保持；④ 托盘图标右键可恢复；⑤ 可配置“智能老板键”：检测到特定前台窗口（如公司 OA/会议软件）自动隐藏。 |
| 代码修改点 | launcher.js / standalone 注册全局快捷键；sprite.js 新增 hideAll/showAll；新增 tray 图标支持。 |
| 配置项 | bossKey: { enabled: true, hotkey: “Ctrl+Alt+W”, autoHideApps: [“会议”,“OA”] } |
| 预估工时 | 2 小时 |
| 优先级 | P0（立刻可做，刚需） |

# 七、素材与个性化深化
### 7.1 自定义动画导入
| 维度 | 内容 |
| 问题 | 当前 136 个动画是固定的，用户无法添加自己的素材，UGC 能力为零。 |
| 实现方案 | ① 支持拖拽 webm/gif 到桌宠窗口，自动导入为新动画；② 导入时要求填写动画名和分类（小动作/玩耍/吃什么等）；③ 自动生成预览缩略图；④ 导入的动画出现在右键菜单和随机池中；⑤ 支持删除自定义动画；⑥ 动画素材存到 data/dsh-pet/custom-anims/，不污染 app/assets。 |
| 代码修改点 | sprite.js 新增拖拽导入处理；config.ts 合并内置+自定义动画池；新增 anim-importer.ts（格式校验/缩略图生成）。 |
| 配置项 | customAnimations: { enabled: true, dir: “custom-anims”, allowedExt: [“.webm”,“.gif”] } |
| 预估工时 | 5 小时 |
| 优先级 | P2（长期，UGC 生态） |

### 7.2 换装/皮肤系统
| 维度 | 内容 |
| 问题 | 已有“整体换装试色”动画，但只是播放一段动画，没有真正的皮肤切换功能。 |
| 实现方案 | ① 皮肤 = 一组 webm 动画文件（替换待机/点击/移动等基础动作）；② 皮肤包格式：zip 包含 anims/ + preview.png + skin.json（元数据）；③ 右键菜单“换装”选择已安装皮肤；④ 切换时播放“整体换装试色”过渡动画；⑤ 支持皮肤市场（从 GitHub 下载社区皮肤）；⑥ 默认皮肤始终可恢复。 |
| 代码修改点 | 新增 skin-manager.ts（加载/切换/校验皮肤包）；config 新增 currentSkin；sprite.js 动画加载时优先用皮肤包。 |
| 配置项 | skins: { current: “default”, installedDir: “skins”, autoUpdate: false } |
| 预估工时 | 8 小时 |
| 优先级 | P2（长期，个性化核心但工作量大） |

### 7.3 节日自动触发
| 维度 | 内容 |
| 问题 | 已有 20+ 个节气/节日动画（中秋/圣诞/粽子/饺子/南瓜灯等），但全部需要手动点播，节日当天不会自动出现。 |
| 实现方案 | ① 启动时检测当前日期，匹配节日表（春节/元宵/清明/端午/七夕/中秋/国庆/万圣/冬至/圣诞/用户生日等）；② 节日当天动作池中该节日动画权重 ×5；③ 节日首次启动时播放专属动画 + 节日祝福台词；④ 可配置节日列表和用户生日；⑤ 节日当天碎碎念自动加入节日话题。 |
| 代码修改点 | config.ts 新增 festivalCalendar；sprite.js 启动时检测节日并调整权重；whisper prompt 动态加入节日上下文。 |
| 配置项 | festivals: { autoTrigger: true, custom: [{ date: “01-01”, name: “元旦”, anims: [“放烟花”] }, { date: “用户生日”, anims: [“收红包”] }] } |
| 预估工时 | 3 小时 |
| 优先级 | P1（中期，惊喜感强） |

### 7.4 真实天气联动
| 维度 | 内容 |
| 问题 | 当前碎碎念里“今天天气不错”是瞎猜的，和实际天气无关，用户会觉得“她在胡说”。 |
| 实现方案 | ① 接和风天气免费 API（或 OpenWeather），根据 IP 定位城市；② 每 30 分钟更新一次天气；③ 碎碎念 prompt 中加入当前天气/温度，让台词有依据（下雨说“外面下雨了呢”，高温说“好热啊”）；④ 极端天气（暴雨/高温/寒潮）触发对应动画（摇扇纳凉/裹紧小被子）；⑤ API key 用户自行配置，不配置则不启用。 |
| 代码修改点 | 新增 weather.ts（API 调用+缓存）；whisper.ts 拼接天气上下文；config 新增 weather 段；mood.ts 可新增 weatherBad 事件（极端天气-心情）。 |
| 配置项 | weather: { enabled: false, provider: “qweather”, apiKey: “”, city: “auto”, refreshMin: 30 } |
| 预估工时 | 3 小时 |
| 优先级 | P1（中期，真实感提升） |

# 八、总体实施路线图
按优先级和依赖关系，建议分四个阶段推进：
## 阶段一：基础夯实（第 1 周，约 16 小时）
| 编号 | 优化项 | 工时 | 理由 |
| 4.3 | 配置路径统一 | 1h | 消除用户改错文件的困惑 |
| 5.3 | 进程残留与单实例锁 | 2h | 稳定性基础，防止多进程混乱 |
| 6.6 | 老板键 | 2h | 刚需，成本极低 |
| 1.4 | 双击特殊动作 | 1.5h | 成本低收益高 |
| 2.3 | 独立版工作状态 | 8.5h | 最大哑功能，救活后桌宠立刻有眼力见 |

## 阶段二：实用工具（第 2 周，约 11 小时）
| 编号 | 优化项 | 工时 | 理由 |
| 6.1 | 番茄钟 | 4h | 最实用工具属性，从摆件变助手 |
| 6.2 | 久坐提醒 | 3h | 健康向，用户粘性高 |
| 1.3 | 触摸分区深化 | 3h | 互动细腻度核心 |
| 1.2 | 拖拽手感优化 | 3h | 体感提升明显 |

## 阶段三：体验升级（第 3-4 周，约 25 小时）
| 编号 | 优化项 | 工时 | 理由 |
| 4.1 | 可视化设置面板 | 12h | 最大使用门槛，必须攻克 |
| 4.2 | 台词图形化编辑器 | 5h | 依赖设置面板，个性化核心 |
| 4.4 | 预设方案一键切换 | 2h | 依赖设置面板 |
| 3.1 | 碎碎念上下文记忆 | 2h | 碎碎念质量核心 |
| 3.3 | TTS 语音朗读 | 4h | 拟人感大幅提升 |
| 7.3 | 节日自动触发 | 3h | 惊喜感强，成本适中 |

## 阶段四：长期演进（第 5 周+，按需推进）
| 编号 | 优化项 | 工时 | 理由 |
| 1.1 | 多宠互动 | 6h | 多开场景才有意义 |
| 1.5 | 跟随鼠标模式 | 3h | 陪伴感强 |
| 2.1 | 系统通知接入 | 5h | Windows 兼容性复杂 |
| 2.2 | 多平台余额 | 6h | 依赖用户实际需求 |
| 3.2 | 碎碎念看屏幕 | 3h | token 消耗需用户接受 |
| 3.4 | 语音输入对话 | 6h | 依赖 TTS |
| 5.1 | 内存占用优化 | 6h | 多开用户才明显 |
| 5.2 | 启动速度优化 | 4h | 体验优化 |
| 5.4 | 崩溃自动恢复 | 3h | 稳定性提升 |
| 6.3 | 便签 | 4h | 实用工具 |
| 6.4 | 快捷启动器 | 2h | 效率工具 |
| 6.5 | 系统状态浮标 | 4h | 信息过载风险 |
| 7.1 | 自定义动画导入 | 5h | UGC 生态 |
| 7.2 | 换装/皮肤系统 | 8h | 个性化核心但工作量大 |
| 7.4 | 真实天气联动 | 3h | 真实感提升 |

总计：30 项优化，约 120 小时工作量。阶段一和阶段二（约 27 小时）完成后，桌宠将从“会动的摆件”升级为“有眼力见的实用助手”；阶段三完成后达到“可配置的智能陪伴”；阶段四按需演进。