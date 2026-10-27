大肥鱼桌宠 功能合格性检查与修改方案
P2 四大功能（精力/饱食 · 好感度 · 离线演化 · 多宠互动）实测核查 ｜ 含逐项修改方案与代码
2026年10月27日
# 一、总体结论
经对运行进程、HTTP 配置接口、存档文件与 runtime 源码的逐项核查，确认：
- P2 四大功能在 runtime 层已真实实现并正在运行（非空壳、非仅方案），四维状态在持续变化。
- 核心逻辑（消耗/恢复、等级、离线推演、互动调度）合格，可正常使用。
- 存在 1 处功能漏接（投喂食物子菜单）、4 处工程质量问题、2 处素材/UI 待办，需按优先级处理。
当前实测存档（pet-state-main.json）：心情 50.4 ｜ 精力 74.9 ｜ 饱食 59.3 ｜ 好感 60。
# 二、四大功能完成度
| 功能 | 状态 | 已实现内容 | 缺口 |
| 精力/饱食 | 合格 | 活动判定（睡眠/工作/待机）、精力消耗与恢复、饱食消耗、自动入睡、饿了冒泡、四维联动、节流存盘 | 无 |
| 好感度 | 合格 | 6 级关系、每日上限防刷、离线衰减、喂食/陪玩/里程碑联动 | 无 |
| 离线演化 | 合格 | 离线状态推演（精力/饱食/心情）、6 档回归剧情、离家出走彩蛋 | 无 |
| 多宠互动 | 逻辑合格/动画占位 | 相遇扫描、关系值、互动冷却、5 类互动调度、心情好感联动 | 5 类互动全用现有单角色动画占位，待新素材 |

# 三、P0 修改项：投喂食物子菜单漏接
## 3.1 问题描述
foods.js 定义了 7 种食物（小鱼干、零食、白饭、盒饭、Token、奶茶、冰淇淋），PET_FEED(foodId) 方法也完整支持 foodId 参数、独立冷却、饱食拒绝、心情/精力/好感度联动。但右键菜单树里只有一个固定项 {投喂}，action 为 feed，调用 PET_FEED() 时不传参，默认只喂小鱼干（fish）。其余 6 种食物用户无法通过界面选择，等于已写好的食物体系被浪费。
## 3.2 代码位置
| 位置 | 文件 | 行号 |
| 食物定义（7种） | app/runtime/electron-helper/foods.js | 32–68 |
| 投喂逻辑（已支持 foodId） | app/runtime/electron-helper/sprite.js | 852–945 |
| 菜单固定项（待改） | app/runtime/electron-helper/sprite.js | 2786 |
| 菜单 action 分发（待改） | app/runtime/electron-helper/sprite.js | 2996–3000 |

## 3.3 修改方案
改动一：菜单树（sprite.js 第 2786 行）。把固定项替换为带子菜单的“投喂”，遍历当前生效的食物表，每项 action 携带 foodId。
// 原代码（第 2786 行）：
{ label: '投喂', action: 'feed' },

// 改为：
{
  label: '投喂',
  children: (() => {
    const F = window.PET_FOODS;
    const list = F ? F.sanitizeFoods(
      (this.vitals && this.vitals.cfg && this.vitals.cfg.foods) || undefined)
      : [];
    return list.map((f) => ({ label: f.name, action: 'feed:' + f.id }));
  })(),
},
改动二：action 分发（sprite.js 第 2996–3000 行）。让 feed 与 feed:xxx 都能命中，并解析出 foodId 传给 PET_FEED。
// 原代码（第 2996–3000 行）：
if (leaf.action === 'feed') {
  this.PET_FEED();
  this._feedCount = (this._feedCount || 0) + 1;
  return;
}

// 改为：
if (leaf.action === 'feed' || leaf.action.startsWith('feed:')) {
  const foodId = leaf.action === 'feed' ? undefined : leaf.action.slice(5);
  this.PET_FEED(foodId);
  this._feedCount = (this._feedCount || 0) + 1;
  return;
}
注意：菜单树构建处的 this 指向需确认（菜单树可能在某方法内构建，this 即 PetSprite 实例）；若该作用域拿不到 this，可在构建菜单时先把食物列表存为实例字段再引用。
## 3.4 验收标准
- 右键“投喂”出现 7 个子项，名称与 foods.js 一致。
- 点击“盒饭”播放吃盒饭动画、饱食 +35；点击“奶茶”播放喝奶茶、精力 -5；不同食物独立冷却。
- 饱食满时任意食物均被拒绝并提示；冷却中提示剩余秒数。
# 四、P1 工程质量修改项
## 4.1 测试基础设施损坏（test-register.mjs 缺失）
package.json 的 test 命令为 node --experimental-strip-types --import ./scripts/test-register.mjs --test src/**/*.test.ts，但 scripts 目录下只有 ensure-electron.mjs，test-register.mjs 不存在，导致 npm test 时全部测试在加载阶段就报 ERR_MODULE_NOT_FOUND，无一可执行。
修复方案（二选一）：
- 方案 A（推荐，最省事）：当前 Node 为 22/24，--experimental-strip-types 已能直接运行 .ts 测试，把 package.json 的 test 命令中 --import ./scripts/test-register.mjs 去掉即可。
- 方案 B：补回 scripts/test-register.mjs（若它原本用于注册路径别名或全局加载器），内容需与原仓库一致，不能凭空编造。
验收：npm test 能正常进入测试执行阶段并输出 tests/pass/fail 统计。
## 4.2 mood 测试与实现不同步
绕过 register 后单独运行 mood.test.ts：40 个测试，36 通过，4 个失败（applyEvent 事件偏移、applyMoodFactors 权重倍率、MoodState 状态机）。原因是调整了事件值与心情权重后，没有同步更新测试断言（如期望 26 实际 28、期望 32 实际 36）。
修复方案：以当前 mood.ts 的实现为准，逐项更新 mood.test.ts 中过期的期望值；若发现是实现写错（而非测试过期），则改实现。改完后该文件应 40/40 全绿。
验收：mood.test.ts 40 个测试全部通过，且断言与当前参数表一致。
## 4.3 P2 模块无 TypeScript 源码与单测
vitals、affinity、offline、social 四个 P2 模块只在 runtime 用 .js 直接实现（vitals.js、affinity.js、offline.js、social.js），src/shared 下没有对应的 vitals.ts、affinity.ts、offline.ts、social.ts，也没有单测。这意味着：无类型检查、无回归保护；将来重新 bundle 时这些模块不会被纳入标准构建，存在丢失或与源码脱节的风险。
修复方案：
- 把四个 runtime .js 的纯逻辑部分（状态机、推演、扫描，不含 DOM/动画）抽回 src/shared，写成 .ts 并补类型定义。
- 为每个模块补 .test.ts，覆盖：消耗/恢复边界、等级阈值、每日上限、离线各档、互动冷却与关系值。
- runtime 保留薄封装，只负责调用 shared 逻辑 + 操作 DOM/动画。
验收：npm run typecheck 通过；四个模块均有单测且全绿；runtime 与 src 逻辑一致。
## 4.4 memory.json 为测试残留（乱码）
data/dsh-pet/memory.json 是 MOCK 测试数据：两层 key 都是空字符串，用户消息显示为 ???,???????，助手消息显示为 MOCK-OK 鎴戞槸妗屽疇鐨勭纰庡康（GBK/UTF-8 编码混乱），会污染对话记忆。
修复方案：清空该文件的测试内容（保留为合法空结构，如 {}），让对话记忆从干净状态开始；同时排查产生该 MOCK 的测试脚本，避免再次写入。
验收：memory.json 不含空 key 与 MOCK/乱码内容；对话功能读写正常。
# 五、P2 素材与 UI 待办
## 5.1 头顶状态图标未实现
方案中设计的饭碗（饿）、Zzz（困/睡）、爱心（好感）、玩具（想玩）等头顶状态图标均未实现，目前只有 renderMood 渲染的心情徽标（一个角标）。用户无法一眼看出宠物当前饿不饿、困不困。
实现建议：
- 复用现有心情徽标的 DOM 与定位方式，在宠物头顶新增一个状态图标层，按 vitals/affinity 当前状态切换图标（可用 emoji 或小图，无需新动画素材）。
- 触发时机：饥饿/饿坏、精力低/自动睡、好感升级、长时间无聊时显示，状态恢复后淡出，避免常驻干扰。
- 图标优先级：同时命中多个状态时只显示最紧急的一个（饿坏 > 困 > 想玩 > 好感）。
验收：饿/困/睡/好感升级时头顶出现对应图标，恢复后消失，不遮挡宠物主体。
## 5.2 多宠互动动画为占位
social.js 的 5 类互动（贴贴、追逐、一起玩、聊天、打架）目前都用现有单角色动画占位（如贴贴=挠痒笑、追逐=原地奔跑、打架=傲娇生气），缺少双角色/专属动画，表现与方案预期有差距。
素材清单（P0 仅 5 个，可先做）：捂肚子（饿）、饿趴、扑过来迎接、委屈巴巴、单角色贴贴；其余双角色互动素材可在后续补齐。素材到位后把 social.js 中各类互动的 anim 字段替换为新动画即可。
验收：新素材到位并替换后，5 类互动有对应动画，贴贴/追逐等动作可辨识。
# 六、配置路径治理
核查中发现配置存在多份，需理清，避免以后改配置时改错位置：
| 配置文件 | 大小/时间 | 内容 | 作用 |
| app/assets/config.jsonc | 36KB / 10-27 13:46 | 含完整 P2 段 | 内置默认配置，P2 实际由它启用 |
| ~/.dsh/dsh-pet/main-config.jsonc | 8.9KB / 10-26 9:39 | 无 P2 段（旧版） | 用户覆盖层，只覆盖部分字段，不影响 P2 |
| data/dsh-pet/main-config.jsonc | 15KB / 10-27 13:46 | 完整 P2 副本 | 运行目录下的完整副本 |

配置链路：standalone.js（3080 端口）读取内置默认配置 app/assets/config.jsonc，再叠加用户配置 ~/.dsh 下的覆盖项；Electron 渲染端通过 http://127.0.0.1:3080/dsh-pet-7340/config 拉取合并结果。
治理建议：
- 把 ~/.dsh 下的旧配置同步为最新（含 P2 段），或删除使其完全回落默认，避免新旧两份长期并存。
- 明确“唯一编辑入口”：以后改配置只改一处（建议用户层 ~/.dsh），其余为默认/副本。
- 清理各目录下的 .bak / .before-* 备份（确认无用后）。
# 七、修改优先级与实施顺序
| 批次 | 事项 | 预计工作量 | 是否需新素材 |
| 第一批（P0） | 投喂食物子菜单（两处改动） | 小 | 否 |
| 第二批（P1） | 修复 test 命令、清空 memory.json | 小 | 否 |
| 第三批（P1） | 更新 mood 测试断言、补回 TS 源码与单测 | 中 | 否 |
| 第四批（P2） | 头顶状态图标 | 中 | 否（可用 emoji） |
| 第五批（P2） | 多宠互动新素材与动画替换 | 大 | 是（P0 5 个） |
| 贯穿 | 配置路径治理与备份清理 | 小 | 否 |

建议先做第一批（立即可用、改动小、收益明显），第二、三批保证工程质量，第四、五批再逐步提升表现。