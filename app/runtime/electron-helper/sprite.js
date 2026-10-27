/**
 * dsh-pet desktop helper —— 宠物本体（PetSprite 类）。
 *
 * 播放 / 拖拽抛掷 / 跨窗碰撞 / 点击穿透 / 右键菜单 / 聊天弹窗 / 气泡渲染。
 * 事件联动（余额 / 碎碎念 / 广播 / 工作状态）不在此文件——见 events.js。
 * 依赖 constants.js 的全局（CONFIG / VIEW / BASE / S / config / sprites 等），须后加载。
 */
'use strict';

  // __petCountMenu —— these live at module scope on purpose: they were first
  // inserted inside the class body, which is not valid JavaScript.
const PET_COUNT_OPTIONS = [1,2,3,4,5,6,7,8,9,10,11,12];
const PET_COUNT_LADDER = [{"name":"蓝毛小女仆","size":420,"corner":"top-right"},{"name":"小鲸","size":300,"corner":"bottom-left"},{"name":"阿闲","size":240,"corner":"bottom-right"},{"name":"小团子","size":190,"corner":"top-left"},{"name":"阿糖","size":150,"corner":"bottom-left"},{"name":"小满","size":120,"corner":"top-right"},{"name":"元宝","size":100,"corner":"top-left"},{"name":"豆子","size":84,"corner":"bottom-right"}];
const PET_COUNT_EXTRA_NAMES = ["团子","小柚","阿梨","芝麻","汤圆","奶糖","小云","糯糯"];

// 睡觉相关：空闲超过 sleepSeconds 秒就播睡姿，碰一下立刻醒。
// 存 localStorage —— 多只宠物窗口天然共享同一个设置，重启也还在。
// 睡觉流程: 先打哈欠/伸懒腰, 再躺下三段
// 睡眠三连（照搬 dsh-whale-girl-pet lib/client.js L1157-1160 的定义）：
// 投喂（照搬 dsh-whale-girl-pet L1187-1188）：专属动画 + 三句台词 + 冷却
const PET_FEED_ANIM = "吃小鱼干";
const PET_FEED_LINES = ["（啊呜）小鱼干真好吃～", "谢谢款待！心情 +1！", "再来一根？真的可以吗！"];
const PET_FEED_COOLDOWN_MS = 8 * 1000; // 8 秒冷却，防止连点刷气泡
let petFeedLastAt = 0;
const PET_SLEEP_IN = "睡觉第一段"; // 进入：播一遍躺下
const PET_SLEEP_LOOP = "睡觉第二段"; // 持续：once=false，走 el.loop 呼吸
const PET_SLEEP_WAKE = "睡觉第三段"; // 被叫醒：播一遍坐起来

// 苏醒: 伸懒腰 -> 哈欠 -> 揉眼睛, 再回待机

// 睡着时偶尔冒的梦话
const PET_SLEEP_DREAMS = [
  "zzz……",
  "唔……好舒服……",
  "在做梦……梦到小鱼干了……",
  "呼……呼……",
  "再睡一会儿……",
  "梦到你在摸我……",
  "唔……不要叫我……"
];
const PET_SLEEP_OPTIONS = [
  { label: "永不睡觉", seconds: 0 },
  // 「跟随时段」= 回到默认模式：不写 localStorage，由 PET_SLEEP_BANDS 按时段决定。
  // 用 -1 表示这个"未设置"状态（0 已被「永不睡觉」占用）。
  { label: "跟随时段（默认）", seconds: -1 },
  { label: "3 分钟", seconds: 180 },
  { label: "5 分钟", seconds: 300 },
  { label: "10 分钟", seconds: 600 },
  { label: "30 分钟", seconds: 1800 },
];
/** 睡眠时长未手动设置时的基准值（秒）。时段倍率以它为基准。 */
const PET_SLEEP_BASE_SECONDS = 600;

/**
 * 空闲自动进入工作状态的参数。
 *
 * 为什么需要它：工作状态原本只有一个数据源 events.js 的 onWorkTick，而它读的是
 * DSH 宿主的会话快照。独立模式没有宿主 → snapshot 恒空 → workState 永远 null →
 * 工作动画永远不进。所以补一条独立触发路径：长时间没人理她 → 自己去做几个工作动作。
 */
const PET_WORK_IDLE_SEC = 300;  // 空闲多久后开始工作（5 分钟）

/**
 * 工作三态（与睡眠同构）。
 *   PET_WORK_IN   开始工作：站 → 坐（一次）
 *   PET_WORK_OUT  工作结束：坐 → 站，庆祝（一次）
 *   PET_WORK_MID  工作中的中间段池：从这 5 个里**随机不重复**抽
 */
const PET_WORK_IN = '开始工作';
const PET_WORK_OUT = '工作结束';
/** 工作分类的 id：随机链抽到它时不播单个动作，改走完整工作三态。 */
const PET_WORK_CAT = '工作';
const PET_WORK_MID = ['工作思考', '认真工作', '工作摸鱼', '摸鱼被抓', '工作被打扰'];
/** 中间段数量的随机范围（段数）。不超过池子大小，保证一轮内不重复。 */
const PET_WORK_MIN = 1;
const PET_WORK_MAX = 5;
/** 工作冷却：随机链抽到「工作」后，多久内不再触发工作三态（避免连续工作）。 */
const PET_WORK_RECHARGE_MS = 10 * 60 * 1000;
/** 工作中一段动画播多久再切下一段。 */
const PET_WORK_CLIP_MS = 10500;

/**
 * 动作之间的播放间隔（可在「设置」里改，存在 localStorage）。
 *
 * 一个动作演完后，先循环播「待机呼吸休闲」等这么久，再换下一个动作。
 * 选「无间隔」= 0，表示回到最初的行为：上一段播完立刻接下一段，
 * 整个停顿机制完全不参与。
 *
 * 停顿期间呼吸片段是**无限循环**的（loop=true），所以间隔设成 20 秒也没问题 ——
 * 她就一直呼吸到时间到，不需要单独配"呼吸播放多少秒"。
 */
const PET_IDLE_GAP_OPTIONS = [
  { label: '无间隔', seconds: 0 },
  { label: '1 秒', seconds: 1 },
  { label: '2 秒', seconds: 2 },
  { label: '3 秒', seconds: 3 },
  { label: '5 秒', seconds: 5 },
  { label: '8 秒', seconds: 8 },
  { label: '12 秒', seconds: 12 },
  { label: '20 秒', seconds: 20 },
];

/** 未设置时的默认间隔（秒）。 */
const PET_IDLE_GAP_DEFAULT_SEC = 5;

/** 读取「播放间隔」秒数。无效/缺失时返回 fallback。 */
function PET_IDLE_GapSecs(fallback) {
  try {
    const raw = localStorage.getItem('PET_IDLE_GAP_V1');
    if (raw === null || raw === undefined) return fallback;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return fallback;
    return Math.floor(v);
  } catch {
    return fallback;
  }
}

function PET_IDLE_SaveGap(sec) {
  try { localStorage.setItem('PET_IDLE_GAP_V1', String(Math.max(0, Math.floor(sec) || 0))); } catch {}
}

/** 停顿期间想播的待机片段：轻微起伏、无位移，用来填住空档。 */
const PET_IDLE_ANIM = '待机呼吸休闲';

/** 菜单标签上的当前值提示，例如「（3 秒）」；无间隔时不显示多余文字。 */
function PET_IDLE_GapHint() {
  const v = PET_IDLE_GapSecs(PET_IDLE_GAP_DEFAULT_SEC);
  return v ? '（' + v + ' 秒）' : '';
}
/**
 * 全天时段判定【何时容易睡】: 当前小时对应的等价惰置秒数。
 * 夜里睡得快，白天需要惰置更久才入睡；早上不自动睡。
 * 这里的数值是「惰置秒数的倍数」。
 */
/**
 * 睡眠时段表（默认值）。
 *
 * 每条 = { from, to, scale, label }：
 *   from/to  小时区间，左闭右开，支持跨午夜（from > to 表示跨过 0 点）
 *   scale    入睡时长的倍率：<1 睡得更快，>1 更慢
 *
 * 遍历顺序即优先级，第一条命中的生效；都没命中 → scale 1（按「睡眠时长」原值）。
 * 夜里更容易困，所以深夜/晚间给小于 1 的倍率；午后容易犯困，给大于 1 的。
 *
 * 说明：这个表放在前端代码里而不是用户配置里，是因为宿主的 eventsRefreshSec
 * 校验只接受「正数」值（eventsRefreshSecValid），放不下 {from,to,scale} 这类结构；
 * 而 flattenConfigPets 只把固定 8 个字段传给渲染端，新增顶层字段也读不到。
 * 要改时段，改这里的默认值即可。
 */
const PET_SLEEP_BANDS = [
  { from: 1, to: 7, scale: 0.5, label: '深夜' },
  { from: 22, to: 1, scale: 0.75, label: '晚间' },
  { from: 13, to: 18, scale: 1.5, label: '午后' },
];
/** 没有时段命中时的倍率。 */
const PET_SLEEP_SCALE_DEFAULT = 1;

/**
 * 菜单标签上的时段提示，例如「（深夜 5 分钟）」。
 * 只在实际生效时间与设定值不同时才显示，免得多一段噪音。
 */
function PET_SLEEP_BandHint() {
  const secs = PET_SLEEP_Seconds();
  if (!secs) return '（永不睡觉）';
  if (!PET_SLEEP_IsFollowingBands()) return '（固定）';   // 手动值，不受时段影响
  const band = PET_SLEEP_Band(new Date().getHours());
  if (!band || band.scale === PET_SLEEP_SCALE_DEFAULT) return '';
  const actual = Math.max(1, Math.round(secs * band.scale));
  return '（' + band.label + ' ' + Math.round(actual / 60) + ' 分钟）';
}

/** 当前小时落在哪个时段（返回该条，或 null）。 */
function PET_SLEEP_Band(hour) {
  for (const b of PET_SLEEP_BANDS) {
    const hit = b.from <= b.to
      ? (hour >= b.from && hour < b.to)          // 普通区间
      : (hour >= b.from || hour < b.to);         // 跨午夜，如 22→1
    if (hit) return b;
  }
  return null;
}

/**
 * 当前这个钟点该等的惰置秒数。
 *
 * 「跟随时段」模式下 = 基准值 × 该时段的倍率（夜里更快睡着）；
 * 手动选了固定时长时 = 那个固定值，不再叠加倍率 —— 用户明确点了「30 分钟」，
 * 就应该是 30 分钟，不该在深夜悄悄变成 15 分钟。
 * 「永不睡觉」（0）在任何模式下都不睡。
 */
function PET_SLEEP_IdleSeconds() {
  const secs = PET_SLEEP_Seconds();
  if (!secs) return 0; // 永不睡
  if (!PET_SLEEP_IsFollowingBands()) return secs;   // 手动固定值：原样使用
  const band = PET_SLEEP_Band(new Date().getHours());
  const scale = band ? band.scale : PET_SLEEP_SCALE_DEFAULT;
  return Math.max(1, Math.round(secs * scale));
}
/**
 * 当前生效的睡眠时长（秒）。
 *
 * 三种状态：
 *   · localStorage 里没值        → 跟随时段（默认模式），返回基准值，由时段倍率调整
 *   · 存的是 PET_SLEEP_FOLLOW    → 同上（用户在菜单里选了「跟随时段」）
 *   · 存的是具体秒数（含 0）     → 用这个固定值，时段倍率不再参与
 *
 * 存 -1 而不是删 localStorage，是因为「永不睡觉」（0）和「没设置」必须区分开：
 * 前者是一个明确选择，后者要走时段表。
 */
const PET_SLEEP_FOLLOW = -1;
function PET_SLEEP_Seconds() {
  try {
    const raw = localStorage.getItem("PET_SLEEP_V3");
    if (raw === null || raw === undefined) return PET_SLEEP_BASE_SECONDS;
    const v = Number(raw);
    if (!Number.isFinite(v)) return PET_SLEEP_BASE_SECONDS;
    if (v === PET_SLEEP_FOLLOW) return PET_SLEEP_BASE_SECONDS;   // 跟随时段
    return v >= 0 ? v : PET_SLEEP_BASE_SECONDS;
  } catch {
    return PET_SLEEP_BASE_SECONDS;
  }
}
/** 用户是否选了「跟随时段」（默认模式）。 */
function PET_SLEEP_IsFollowingBands() {
  try {
    const raw = localStorage.getItem("PET_SLEEP_V3");
    if (raw === null || raw === undefined) return true;
    const v = Number(raw);
    return !Number.isFinite(v) || v === PET_SLEEP_FOLLOW;
  } catch {
    return true;
  }
}
function PET_SLEEP_SaveSeconds(n) {
  try { localStorage.setItem("PET_SLEEP_V3", String(n)); } catch {}
}

// ---------- 单只宠物（行为与浏览器 PetCard 一致；纯逻辑来自 src/shared） ----------
class PetSprite {
  constructor(pet) {
    this.PET_SLEEP_At = performance.now(); // 上次被"摸"的时间
    this.PET_SLEEP_On = false; // 是否在睡
    this.PET_SLEEP_WokeByClick = false; // 本次按下是否为唤醒
    this.PET_SLEEP_Waking = false;      // 正在播醒来动画（此时仍视为"在睡"）
    this.PET_SLEEP_Timer = null; // 仅为兜底用, 正常靠 onended 接力
    // 两个轮询定时器的 handle 必须存下来：dispose 时要清。
    // 早先是裸 setInterval（不存 handle），sprite 销毁后它们仍活着 —— 每 5 秒对
    // 一个已卸载的实例调 PET_SLEEP_Tick / WORK_Tick。多开切换、重载配置（重建全部
    // sprite）时会累积，泄漏的实例越多，空转回调越多。
    this._sleepTimer = setInterval(() => this.PET_SLEEP_Tick(), 5000);

    // 开机自启动的当前状态（undefined = 还没查到，菜单会显示"读取中…"）。
    // 异步查一次真实注册表值，菜单据此显示开关状态。
    this.autoStartOn = undefined;
    this.refreshAutoStart();

    this.gapTimer = null; // 随机链两段之间的停顿定时器（见 scheduleNextIdle）

    // 已经成功加载过的片段。停顿期间只有在目标片段"已预热"时才敢 switchTo ——
    // 未预热的切过去会触发下载，加载期间画面是空的（就是"闪一下"）。
    this.warmedAnims = new Set();

    // 空闲自动进入工作状态：每 5 秒看一眼，够久没人理就让她去做几个工作动作。
    // （睡眠用 PET_SLEEP_Tick 的同款定时器；两者计时变量独立，互不影响。）
    this._workTimer = setInterval(() => { this.WORK_Tick(); this.VITALS_Tick(); this.SOCIAL_Tick(); }, 5000);

    this.pet = pet; // 这只宠物的配置段（拍平后的成品实例，条目级字段已吹入：动画池/权重/周期）
    // 页面级缩放（main 对窗口 setZoomFactor(CONFIG.scale)，见 DESIGN.md §3.5）统一放大整窗：
    // pet.size 即 CSS 像素基准，**不再手工乘 CONFIG.scale**——固定 px UI（菜单/积分/聊天）
    // 随同一缩放自动恢复 DIP 观感；跨进程交换（bounds/几何/碰撞）由 constants.js 的
    // toScreen/toLocal 收口换算，这里与 shared 组件一样零乘除。
    this.size = pet.size;
    this.height = (this.size * 9) / 16;
    this.halfW = this.size / 2;
    this.halfH = this.height / 2;
    this.bottomPad = (this.size * (9 / 16) * (S.CANVAS_H - S.FEET_Y)) / S.CANVAS_H;
    // 窗口高 = 舞台高 + 脚底垫高（stage 被 translateY(bottomPad) 下移的余量，防底部被窗口裁剪）
    this.winH = this.height + this.bottomPad;
    // 窗口内【可交互区域】= 身体命中区（像素，窗口坐标）。浏览器 overlay 只有 .dsh-pet-hit 是
    // pointer-events:auto（root/stage/气泡全 none）——桌面严格对齐：命中区外含透明像素一律穿透到下层应用。
    // HIT_BOX 是 640×360 舞台坐标：x 按窗口宽缩放；y 除舞台高外还要加 bottomPad（舞台被下移）。
    this.hitRect = {
      x: (S.HIT_BOX.x0 / 640) * this.size,
      y: this.bottomPad + (S.HIT_BOX.y0 / 360) * this.height,
      w: ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * this.size,
      h: ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * this.height,
    };
    window.__dshPetDebug.hitRect = this.hitRect;
    // 左右透明边余量（视频盒内宠物身体居中）：让边界按"身体"贴边——宠物能走到屏幕边缘，
    // 但身体永不越界（漫游/拖拽都不会弄丢宠物）。与浏览器 overlay 的 sideAllow 同一套语义。
    this.sideAllow = (S.HIT_BOX.x0 / 640) * this.size;
    window.__dshPetDebug.sideAllow = this.sideAllow;
    // 窗口四周外扩（= WINDOW_MARGIN_RATIO×宠物尺寸）：sprite 钉在 (margin.l, margin.t)，
    // 窗口 = sprite + 四边余量——气泡/未来弹窗显示在余量里；余量透明且点击穿透
    const m = this.size * WINDOW_MARGIN_RATIO;
    this.margin = { t: m, r: m, b: m, l: m };
    window.__dshPetDebug.winMargin = this.margin;
    // 宠物包围盒左上角在【工作区】坐标系里的位置（本窗口的位置 = 宠物的位置）
    this.pos = { x: 0, y: 0 };

    // 播放状态（与浏览器同构）
    // 动画池与权重按宠物取：文件宠物（pet/ 目录定义，extra）自带**完整独立**动画池；
    // main 等常规宠物（无 anims 段）用全局 cfg.animations（与浏览器 pet.ts 同一语义）。
    this.animations = pet.animations || cfg.animations;
    this.weights = pet.animationWeights || cfg.animationWeights;
    // 心情（情绪状态机）：与浏览器共用 shared-core 的 MoodState（src/shared/mood.ts）。
    // 每只宠物一份（各自演化互不影响）；moods.enabled=false（默认）时全透传
    // （categories 原样返回、event/tick 恒 null），所以下面无条件创建、无条件调用。
    this.mood = new S.MoodState(pet.moods || config.moods);
    this.moodLastTick = 0; // 上一次 tick 的 Date.now()（0 = 未 tick；首拍只记基线）
    // 上次用户交互时间（点击/拖拽/投喂/菜单）。用于「被忽视」惩罚：
    // 超过 NEGLECT_AFTER_MS 没交互，tick 里额外扣心情。
    this.lastInteractionAt = Date.now();
    this.moodSaveAt = 0;   // 上次落盘时间（节流：最多每 30 秒写一次，避免频繁 IO）
    this.moodRestored = false; // 是否已从磁盘恢复过（只恢复一次）
    // 分部位触摸：同部位连点计数（换部位/超 3s 归零）。递进语义见 shared-core 的 touch 模块。
    this.touchStreak = { zone: '', n: 0, at: 0 };
    // 拖拽抛掷物理参数（顶层全局；拍平已吹入实例，兜底回全局/默认）
    this.physics = pet.physics || config.physics || S.DEFAULT_PHYSICS;
    // 抛掷锁定在当前屏幕（根字段；拍平已吹入实例，兜底回主条目/默认）：
    // true = 甩出去只在松手时所在那块屏内弹（屏缝当墙），false = 照常跨屏飞行
    this.confineToScreen = pet.confineToScreen === true || config.confineToScreen === true;
    // 素材根按 assetRoot（文件宠物 = 配置文件前缀，多实例共享同一素材目录）或宠物 id 回落
    this.assetRoot = pet.assetRoot || pet.id;
    this.assetBase = BASE + '/thumb/' + encodeURIComponent(this.assetRoot) + '/';
    this.front = 0; // 0 = A, 1 = B
    this.pending = null;
    this.gen = 0;
    this.anim = this.animations.idle[0] ?? '';
    this.once = true;
    this.facing = 'left';
    // 心情快照（调试用：与浏览器端同一套字段，便于远程核对两端状态是否一致）
    window.__dshPetDebug.mood = () => ({
      enabled: this.mood.enabled,
      mood: this.mood.current,
      value: Number(this.mood.value0.toFixed(1)),
    });
    // ---- 精力 / 饱食（P2 第一批）----
    // 与 mood 互补：mood 是分钟级情绪，这两个是按小时演化的"身体状态"。
    // enabled=false（默认）时 VitalsState 全透传，不消耗任何东西。
    const vitalsCfg = pet.vitals || config.vitals;
    this.vitals = (typeof window !== 'undefined' && window.PET_VITALS)
      ? new window.PET_VITALS.VitalsState(vitalsCfg)
      : null;
    this._vitalsRestored = false;
    this._vitalsSaveAt = 0;
    this._vitalsLastTick = 0;
    this._vitalsLastTick = 0;

    // ---- 好感度（第三批）----
    // 长期关系值，与 mood 不同：不 decay 回归，只在长期缺席时下降。
    // 每日互动有上限（见 affinity.js DAILY_RULES），防止连点刷满。
    const affinityCfg = pet.affinity || config.affinity;
    this.affinity = (typeof window !== 'undefined' && window.PET_AFFINITY)
      ? new window.PET_AFFINITY.AffinityState(affinityCfg)
      : null;
    this._affinityRestored = false;

    // ---- 离线演化（第三批）----
    // 启动时读快照 → 算离线时长 → 一次性推演 → 播回归剧情。
    // 注意：推演必须在 vitalsRestore 之前完成，否则会先用旧值再推演导致双重计算。
    this._offlinePending = true;
    this._offlineResult = null;
    // ---- 状态面板 + 多宠社交（第四批）----
    this._panelEl = null;              // 状态面板 DOM（打开时创建，关闭时移除）
    this._panelOpen = false;
    // 社交：复用已有的跨窗口位置广播（reportFlight/onFlightStates），
    // 在 it 的基础上加关系值和互动调度。只有 petInteraction.enabled 才启用。
    const socialCfg = pet.petInteraction || config.petInteraction;
    this.social = (typeof window !== 'undefined' && window.PET_SOCIAL && socialCfg && socialCfg.enabled)
      ? new window.PET_SOCIAL.SocialScheduler(socialCfg)
      : null;
    this._lastSocialScan = 0;



    // 启动时从 data/memory.json 恢复上次的心情值（P1-4）。
    // 不 await —— 恢复是异步的，不该阻塞宠物首次渲染；
    // 失败（首次运行/文件损坏）静默保持基准值 50。
    this.moodRestore();
    // 恢复顺序**必须串行**（不能各自独立发起，否则有竞态）：
    //   vitalsRestore            读存档，把 energy/hunger 恢复到"离线前的值"
    //   affinityRestoreWithOffline 再基于这个值做离线推演
    // 若两者并发，推演结果可能被 vitalsRestore 写入的旧值覆盖 —— 表现为"离线推演没生效"。
    (async () => {
      try { await this.vitalsRestore(); } catch {}
      try { await this.affinityRestoreWithOffline(); } catch {}
    })();
    // 每日首次打开 = 她来打招呼（firstMeet +2，每天 1 次）
    setTimeout(() => { try { this.AFFINITY_Interact('firstMeet'); } catch {} }, 4000);
    // 交互/移动
    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0 };
    this.justDragged = false;
    this._interactive = null; // 已上报的可交互状态（setInteractive 去重用）
    this._inputBusy = null; // 已上报的"正在用输入"状态（syncInputBusy 去重用）
    // 拖拽抛掷物理（与浏览器 pet.ts 同构；纯计算在 shared-core S.*）：
    // 拖拽中弹簧跟随目标（包围盒左上角，工作区 px），松手按指针轨迹估速 → 抛掷（重力+边缘反弹）
    this.dragTrail = []; // 指针轨迹采样（screenX/Y + performance.now()，初速估算用）
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
    this.dragFollow = null; // 弹簧跟随 rAF handle
    this.dragFollowToken = 0;
    this.throwRef = null; // 抛掷 rAF handle
    this.throwToken = 0;
    this.space = null; // 抛掷空间（逐屏 AABB）缓存；显示器变化时由 relayout() 置空重建
    // Q 弹挤压（点击回应 / 抛掷落地）：rAF + 待压标记（等新动画成为前台再压，压新首帧）
    this.squashRef = null;
    this.squashToken = 0;
    this.pendingSquash = false;
    this._interactive = null; // 当前可交互状态（null=未定；只在变化时发 IPC，避免逐帧刷屏）
    this.moveRef = null;
    this.moveToken = 0;
    this.pendingMove = null;
    this.customPos = null; // 拖拽后的会话内位置（{rx, ry} 比例）；restart 回角落
    // 右键菜单（统一自绘组件，两端共用同一份：树+渲染均来自 shared-core）
    this.menuOpen = false; // 菜单开启期间强制整窗可交互（悬停菜单不触发穿透翻转）
    this.menuClose = null; // 当前菜单的 close()（打开时挂载，关闭后置空）
    // 余额气泡
    this.bubbleOn = false;
    this.bubbleTimer = null;
    this.balanceView = null;
    this.balanceWrap = false; // true = 当前余额气泡是不可用的「文字说明」（多行，需换行变体）
    this.prevTick = 0;
    // 说话（碎碎念 / 命令气泡 / 对话回复三合一）：文本/配图由容器统一轮询 /state 后经
    // showWhisper 送进来，本精灵不再自己轮询（改造前的 whisperLoopTimer / broadcastLoopTimer 已删）
    this.whisperOn = false;
    this.whisperTimer = null;
    this.whisperView = null;
    this.whisperText = '';
    // 配图名称（配置 memes 的键；whisperImageEnabled 开启时由 host 随机抽定，随文本一起来）
    this.whisperImage = '';
    // 工作状态联动（DSH 会话状态）：容器 1s 轮询 /state 递增 workTick → 本宠物按档位播动画+气泡。
    // 气泡单槽优先级 终态任务 > whisper > balance > 非终态任务（见 renderBubble）；
    // workStatusEnabled 未启用时完全免疫（与浏览器一致）
    this.workOn = false;
    this.workTimer = null;
    this.workText = null;
    this.workState = null; // 最近一次工作状态（互动/事件动画播完恢复档位循环用）
    this.prevWorkState = null; // 上一档状态（气泡只在状态变化时点亮/收起，Bug 2）
    this.prevWorkTick = 0;
    // ---- 空闲自动进入工作状态（独立模式专用）----
    // 原有工作状态只有 onWorkTick 一个数据源，而它读的是 DSH 宿主的会话快照；
    // 独立模式没有宿主，snapshot 恒为空 → workState 永远是 null → 工作动画永远不进。
    // 这套计时器补上那个缺口：长时间没人理她，就自己去做几个工作相关的动作。
    // 为什么用独立变量而不是复用 PET_SLEEP_At：睡眠时长（可调）和工作触发时长
    // （固定 5 分钟）是两回事，共用一个变量会让改睡眠设置意外影响工作触发。
    this.WORK_Idle_At = performance.now();
    this.WORK_On = false;        // 是否处于"空闲自动工作"状态
    this.WORK_Left = 0;          // 还剩几个工作动作没播
    this.WORK_Busy = false;      // 已进入但还没播第一个（防止重入）
    this.WORK_Timer = null;      // 工作中换段的定时器
    this.WORK_Pool = [];         // 本轮可用的中间段池
    this.WORK_Total = 0;         // 本轮要播几段（随机）
    this.WORK_Played = [];       // 本轮已播过的（用于去重）
    this.WORK_Left = 0;          // 还剩几段（兼容旧字段，WORK_Next 兜底会读）
    this.WORK_StartedAt = 0;     // 上次开始工作的时间戳（冷却用）

    // ---- 本地工作状态检测（独立版 workStatus 触发源）----
    // 上面的 onWorkTick 读的是 DSH 宿主 /state 的 workStatus 快照。独立版没有宿主事件，
    // 那 6 段动画 + 18 句台词就一直躺着。这里用「前台窗口 → 档位」把它救活：
    //   foreground-watcher.js  spawn 一个常驻 PowerShell，每 N 秒读前台窗口（实测 51ms/次）
    //   work-state-map.js     把 {进程名,标题} 映射成六档，带防抖 + 最小持续 + 久坐里程碑
    // 只在 pet.workStatusDetector.enabled 时启动；关掉后完全等价原行为。
    this._detector = null;       // ForegroundWatcher 实例
    this._stateMachine = null;   // WorkStateMachine 实例
    this._detectorTimer = null;
    this._localWorkState = null; // 本地检测出的档位（与宿主的 workState 分开记，避免互相覆盖）
    this._localDetectOn = false; // 检测是否已启动（幂等守卫）
    this.workInterleave = 0; // 工作动画交替计数（每 2 段插一次随机待机，见 resumeWorkStatusAnim）
    this._lastMilestone = undefined;
    this.mood = this.mood;       // 占位：mood 已在上面创建，这里只提醒后续代码它可用
    // 对话弹窗（shared 组件）：当前挂载的 close() 句柄 + 开启标记
    // （chatOpen 是穿透守卫：弹窗是窗口内 DOM，期间整窗保持可交互，与 menuOpen 同语义——否则
    //   光标移到输入框（不在身体命中区）就会被 onMouseMove 翻回穿透，点击全被透传）
    this.chatClose = null;
    this.chatOpen = false;

    // DOM：sprite 钉在窗口内 (margin.l, margin.t)；宠物"位置"= sprite 位置，窗口随余量外扩
    this.el = document.createElement('div');
    this.el.className = 'pet-sprite';
    this.el.style.left = this.margin.l + 'px';
    this.el.style.top = this.margin.t + 'px';
    this.el.style.setProperty('--pet-size', this.size + 'px');
    const stage = document.createElement('div');
    stage.className = 'pet-stage';
    stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.stage = stage;
    this.videoA = document.createElement('video');
    this.videoA.className = 'pet-video is-front';
    this.videoB = document.createElement('video');
    this.videoB.className = 'pet-video';
    for (const v of [this.videoA, this.videoB]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.title = this.pet.name;
    }
    this.hit = document.createElement('div');
    this.hit.className = 'pet-hit';
    this.hit.style.left = (S.HIT_BOX.x0 / 640) * 100 + '%';
    this.hit.style.top = (S.HIT_BOX.y0 / 360) * 100 + '%';
    this.hit.style.width = ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * 100 + '%';
    this.hit.style.height = ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * 100 + '%';
    this.hit.title = this.pet.name;
    // 心情徽标（moods.enabled=false 时永远 is-on 都不加，完全不出现——零视觉影响）
    this.moodEl = document.createElement('div');
    this.moodEl.className = 'pet-mood';
    this.moodEmoji = document.createElement('span');
    this.moodEmoji.className = 'pet-mood-emoji';
    this.moodText = document.createElement('span');
    this.moodText.className = 'pet-mood-text';
    this.moodVal = document.createElement('span');
    this.moodVal.className = 'pet-mood-val';
    this.moodEl.appendChild(this.moodEmoji);
    this.moodEl.appendChild(this.moodText);
    this.moodEl.appendChild(this.moodVal);
    // 头顶状态图标（P2 §5.1）：纯 emoji，无素材成本。
    // 与心情徽标错开位置（徽标在右上、图标在正上方），避免互相遮挡。
    this.statusIconEl = document.createElement('div');
    this.statusIconEl.className = 'pet-status-icon';
    this.statusIconEl.title = '';
    this._statusIconSig = '';
    this._affectionJustUp = false;   // 好感度刚升级（一次性标记）
    this._boredFlag = false;         // 长时间没玩（一次性标记）
    this.bubble = document.createElement('div');
    this.bubble.className = 'pet-bubble';

    stage.appendChild(this.videoA);
    stage.appendChild(this.videoB);
    stage.appendChild(this.hit);
    this.el.appendChild(this.bubble);
    this.el.appendChild(this.moodEl);
    this.el.appendChild(this.statusIconEl);
    this.el.appendChild(stage);
    rootEl.appendChild(this.el);
    this.position();
    this.renderMood(); // 初始渲染一次（关闭态 = 不加 is-on，徽标不可见）

    // 事件（与浏览器同一套：pointerdown/move、click、window pointerup/cancel）
    const ac = new AbortController();
    this.ac = ac;
    this.hit.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal: ac.signal });
    this.hit.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal: ac.signal });
    this.hit.addEventListener('click', (e) => this.onClick(e), { signal: ac.signal });
    this.hit.addEventListener('contextmenu', (e) => this.onContextMenu(e), { signal: ac.signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal: ac.signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal: ac.signal });
    this.hit.addEventListener('lostpointercapture', (e) => this.onPointerUp(e), { signal: ac.signal });
    // 点击穿透：窗口默认整窗穿透（main 设 setIgnoreMouseEvents(true, {forward:true})），
    // 光标进/出身体命中区时翻转可交互；穿透期间 mousemove 由 main 转发进来（forward:true），
    // mouseleave 保证光标离开窗口立即恢复穿透（透明像素不挡下层应用，与浏览器一致）。
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });
    window.addEventListener(
      'mouseleave',
      () => {
        // 光标离开窗口：菜单若开着立刻收起（菜单是窗口内 DOM，离开即不可达），再恢复穿透；
        // 对话弹窗开着则不恢复——弹窗是窗口内 DOM，鼠标还要回来点输入框（与 menuOpen 同守卫）
        this.closeMenu();
        if (!this.chatOpen) this.setInteractive(false);
      },
      { signal: ac.signal },
    );

    // 宠物间碰撞（跨窗 broker）：订阅其它宠物状态广播（碰撞检测用）+ 「被撞」事件 → onDeskHit。
    // 注意：退订由窗口销毁自然回收（webContents 销毁后 ipc 事件不再派发），无需显式取消。
    this.others = {}; // petId -> {x,y,vx,vy,size,bottomPad}（其它宠物的最新状态，来自主进程广播）
    this.throwState = null; // 飞行中的实时状态（被撞查询 / 其它窗碰撞检测时上报用）
    this.pressScoreFired = false; // 按下瞬间已触发过积分（pointerdown 即触发；click 据此不重复弹，同浏览器）
    this.lastFlightReport = 0;
    if (window.petBridge && window.petBridge.onFlightStates) {
      window.petBridge.onFlightStates((states) => {
        if (!states || typeof states !== 'object') return;
        const next = {};
        for (const pid of Object.keys(states)) {
          if (pid === this.pet.id) continue; // 排除自己
          const s = states[pid];
          next[pid] = {
            // 碰撞 broker 协议单位是物理像素（与窗口 bounds 一致）：÷scale 进本窗口 CSS 系（§3.5）
            x: toLocal(Number(s && s.x) || 0),
            y: toLocal(Number(s && s.y) || 0),
            vx: toLocal(Number(s && s.vx) || 0),
            vy: toLocal(Number(s && s.vy) || 0),
            size: toLocal(Number(s && s.size) || 0),
            bottomPad: toLocal(Number(s && s.bottomPad) || 0),
          };
        }
        this.others = next;
      });
      window.petBridge.onPetHit((payload) => {
        const vx = Number(payload && payload.vx);
        const vy = Number(payload && payload.vy);
        if (Number.isFinite(vx) && Number.isFinite(vy)) this.onDeskHit(toLocal(vx), toLocal(vy));
      });
    }
  }

  dispose() {
    this.ac.abort();
    // 两个轮询定时器（睡眠/工作探测）：必须在删 DOM 之前清掉。
    // 它们捕获的是 this，sprite 销毁后继续跑会对一个已卸载的实例空转——
    // 重载配置会重建全部 sprite，不清就会越攒越多。
    if (this._sleepTimer !== null && this._sleepTimer !== undefined) {
      clearInterval(this._sleepTimer);
      this._sleepTimer = null;
    }
    if (this._workTimer !== null && this._workTimer !== undefined) {
      clearInterval(this._workTimer);
      this._workTimer = null;
    }
    // 本地工作状态检测：停订阅 + 拆状态机。重载配置会重建 sprite，
    // 不拆的话旧实例会继续响应主进程的 foreground 广播（空转 + 泄漏）。
    try { this.DETECTOR_Stop(); } catch { /* 销毁阶段不抛 */ }
    // 关闭前把精力/饱食落盘（force 写，不等节流窗口）——
    // 否则最后一次状态变化会丢，离线演化算出来的是旧值。
    try { this.VITALS_Save(); } catch { /* 销毁阶段不抛 */ }
    try { this.PANEL_Close(); } catch { /* 销毁阶段不抛 */ }
    this.statusIconEl = null;   // 断开 DOM 引用
    // 睡眠兜底定时器同理（8s 接力的那个）
    if (this.PET_SLEEP_Timer) {
      clearTimeout(this.PET_SLEEP_Timer);
      this.PET_SLEEP_Timer = null;
    }
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
    }
    this.closeMenu();
    this.stopThrow();
    this.stopDragFollow();
    this.stopSquash();
    this.stopMove();
    this.el.remove();
  }

  // 目标包围盒左上角（视口相对坐标）→ 移动窗口：窗口 = sprite + 四周外扩余量
  // （sprite 钉在窗口 (margin.l, margin.t)，气泡/弹窗显示在余量里）。
  // setContentBounds 要**屏幕**坐标：pos 是视口（桌面外接矩形）相对坐标，先加 VIEW.x/y
  // 再统一 ×scale 回物理像素（§3.5 IPC 收口）——主进程收到的数字与线性化旧行为逐位一致，
  // 主进程侧（bounds/去重/碰撞 broker）完全不用改。
  sendBounds(px, py) {
    this.pos = { x: Math.round(px), y: Math.round(py) };
    window.__dshPetDebug.dragPos = { x: this.pos.x, y: this.pos.y };
    if (window.petBridge) {
      // 完整状态一次捎带：size/bottomPad 让静止宠物从首帧起就登记进碰撞站场
      // （此前只有 report-flight 带尺寸，从没飞过的宠物 size=0 被碰撞检测直接跳过）；
      // vx/vy 带当前速度——飞行中实时值、静止/拖拽 = 0，避免落地后残留上次飞行速度干扰碰撞动量。
      const fly = this.throwState;
      window.petBridge.setBounds(
        toScreen(this.pos.x - this.margin.l + VIEW.x),
        toScreen(this.pos.y - this.margin.t + VIEW.y),
        toScreen(this.size + this.margin.l + this.margin.r),
        toScreen(this.winH + this.margin.t + this.margin.b),
        toScreen(this.pos.x), // 包围盒左上角（碰撞站场用：窗口坐标 ≠ 包围盒坐标）
        toScreen(this.pos.y),
        toScreen(this.size),
        toScreen(this.bottomPad),
        fly ? toScreen(fly.vx) : 0,
        fly ? toScreen(fly.vy) : 0,
      );
    }
  }

  // 角落/边距 → 窗口位置；拖拽后按会话内位置（比例）还原——**松手无任何边界夹取**，
  // 宠物停在哪就算哪（与浏览器一致：可以完全拖出工作区/屏幕；漫游仍有 planMove 边界检查兜底）
  position() {
    const W = VIEW.w;
    const H = VIEW.h;
    let x;
    let y;
    if (this.customPos) {
      x = this.customPos.rx * W - this.halfW;
      y = this.customPos.ry * H - this.halfH;
    } else {
      // 角落取**主屏**而不是外接矩形：不规则多屏布局下外接矩形的角落可能不属于任何显示器
      // （实测右倒 T 型双屏，top-left 落在主屏上方的空洞里），配了该角落的宠物开机即隐身。
      const anchor = S.anchorPixel({
        corner: this.pet.position.corner,
        // marginX/marginY 是配置里的绝对像素：页面级缩放（§3.5）已统一放大整窗，
        // 配置值不再手工乘 CONFIG.scale——150% 屏上与「线性化 + 旧 CONFIG.scale 补偿」观感一致
        marginX: this.pet.position.marginX,
        marginY: this.pet.position.marginY,
        size: this.size,
        W,
        H,
        area: PRIMARY_AREA || undefined,
      });
      x = anchor.x;
      y = anchor.y;
    }
    this.sendBounds(x, y);
  }

  /** 抛掷空间（逐屏 AABB）。AREAS/PANELS 变化时由 relayout() 置空重建——飞行中每帧重算太浪费 */
  throwSpaceOf() {
    if (!this.space || this.space.areas !== AREAS || this.space.panels !== PANELS) {
      this.space = S.throwSpace({ areas: AREAS, panels: PANELS, size: this.size, sideAllow: this.sideAllow });
    }
    return this.space;
  }

  /**
   * 显示器几何变化（改分辨率/缩放、插拔屏、旋转）后就地重挂：
   * 抛掷空间作废，并把宠物从可能变成空洞的位置拉回可见区。
   * 拖拽中不动它（用户正握着，位置由指针决定）；飞行中也不动（下一帧物理自会按新边界夹取）。
   */
  relayout() {
    this.space = null;
    if (this.dragState.active || this.throwRef !== null) return;
    this.stopMove();
    const cx = this.pos.x + this.halfW;
    const cy = this.pos.y + this.halfH;
    const p = S.clampPointToRegion(AREAS, cx, cy);
    if (p.x !== cx || p.y !== cy) {
      this.customPos = { rx: p.x / VIEW.w, ry: p.y / VIEW.h };
    }
    this.position();
  }

  currentCenterX() {
    if (this.customPos) return this.customPos.rx * VIEW.w;
    return this.pos.x + this.halfW;
  }
  currentCenterY() {
    if (this.customPos) return this.customPos.ry * VIEW.h;
    return this.pos.y + this.halfH;
  }

  // 双缓冲切换（与浏览器同一套：前台 opacity 切换 + 降级视频清 handler 并停播，防残留 ended 雪崩）
  switchTo(next, nextOnce) {
    if (!next) return;
    const pending = this.pending;
    if (pending && pending.anim === next && pending.once === nextOnce) {
      // 防重命中（单动画点击时目标=当前动画，不重播）：仍消费 Q 弹标记，压当前前台视频，
      // 保证「点击唯一动画」时挤压反馈不丢（与浏览器同构）。
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(this.front === 0 ? this.videoA : this.videoB);
      }
      return;
    }
    // 照搬上游 dsh-whale-girl-pet 的修复: 切换一开始就清掉旧视频的 onended,
    // 否则旧动画播完会触发 handleEnded 把状态机拉回随机链, 打断睡眠/工作循环。
    // 两个 <video> 是 A/B 复用的, 不清就会残留上一个片段的结束回调。
    const oldElNow = this.front === 0 ? this.videoA : this.videoB;
    if (oldElNow) oldElNow.onended = null;
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const target = this.front === 0 ? this.videoB : this.videoA;
    const el = target;
    if (!el) return;
    el.src = this.assetBase + encodeURIComponent(next) + (S.ANIMATION_EXT || '.webm');
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.onended = nextOnce ? () => this.handleEnded() : null;
    // 加载兜底（与浏览器 web 端 fetch+blob 的 10s 超时同义）：素材加载失败或卡住时必须释放
    // pending，否则它永久挂起——之后相同目标会被防重分支吞掉、不同目标靠 gen 覆盖，
    // 表现就是"点了没反应"（#62 报告的就是 web 端同一类问题，桌面端此前完全没有兜底）。
    const loadGuard = (why) => {
      if (!this.pending || this.pending.gen !== gen) return;
      this.pending = null;
      console.warn('[dsh-pet] 素材加载失败 pet=' + this.pet.id + ' anim=' + next + '：' + why + '（已释放本次切换）');
    };
    const loadTimer = window.setTimeout(() => loadGuard('10s 超时'), 10000);
    el.onerror = () => {
      window.clearTimeout(loadTimer);
      loadGuard('video error');
    };
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      window.clearTimeout(loadTimer);
      el.onerror = null;
      if (this.pending && this.pending.gen !== gen) return;
      const old = this.front === 0 ? this.videoA : this.videoB;
      // 加载成功 → 标记为"已预热"。之后再来切它就不用等下载，停顿期间才敢用。
      if (this.warmedAnims) this.warmedAnims.add(next);
      el.classList.add('is-front');
      if (old && old !== el) {
        old.classList.remove('is-front');
        old.onended = null;
        old.pause();
      }
      this.front = this.front === 0 ? 1 : 0;
      this.pending = null;
      el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      el.play().catch(() => {});
      // 点击 Q 弹：等新动画就位后才压（压的是新点击动画的首帧，与浏览器一致）
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(el);
      }
      if (this.pendingMove) this.startMoveDrive(el);
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  }


  /** 睡眠时长（秒），0 = 关闭。存本地，设置在多窗口间天然共享。 */


  /**
   * 在动画链里判断该不该睡觉。被 playIdle 调用，所以每次选下一个动作时都会检查。
   * 返回 true 表示已经切到睡觉动作，本次选动作的结果作废。
   */

  // ---- 睡觉 ----
  /**
   * 设置睡眠时长。seconds 语义：
   *     -1  → 跟随时段（默认模式，清掉手动值）
   *      0  → 永不睡觉
   *    > 0  → 固定秒数
   * 三种都要原样存进 localStorage —— 所以这里不能用 Math.max(0, ...) 把 -1 抹成 0。
   */
  PET_SLEEP_Set(seconds) {
    const raw = Number(seconds);
    const n = Number.isFinite(raw) ? Math.floor(raw) : PET_SLEEP_FOLLOW;
    if (n < 0) {
      PET_SLEEP_SaveSeconds(PET_SLEEP_FOLLOW);
    } else {
      PET_SLEEP_SaveSeconds(n);
    }
    this.PET_SLEEP_At = performance.now();
    this.PET_SLEEP_On = false;
    let what;
    if (n < 0) what = 'follow time bands';
    else if (n === 0) what = 'never';
    else what = n + 's';
    console.info('[dsh-pet] sleep after ' + what + ' of no interaction');
  }

  /** 每 5 秒看一眼: 该睡了就播睡姿。待机片段 loop=true 无限播, 动画链给不了钩子, 只能定时轮询。 */
  // ---- 投喂 ----
  /**
   * 连续播放一段动画到完, 中途不让随机链抢回去。
   * handleEnded 里对当前台词做带锁, 播完才自然交回随机链。
   */
  PET_FEED_Play(clip) {
    this.PET_FEED_Clip = clip;
    this.anim = clip;
    this.once = true;
    this.switchTo(clip, true);
  }

  /**
   * 投喂（P2 第二批：支持食物菜单）。
   *
   * @param {string} [foodId] 食物 id（foods.js 的表里找）。不传 = 默认「小鱼干」，
   *                          与旧行为完全兼容。
   *
   * 与旧版的差异：
   *   - 食物恢复量/动画/台词/冷却都从食物表读，不再写死
   *   - 每条食物独立冷却（不同食物互不影响）
   *   - 动画名不存在时**跳过动画但仍生效**（配置写了不存在的素材不该让投喂失效）
   */
  PET_FEED(foodId) {
    const now = Date.now();
    const foods = (typeof window !== 'undefined' && window.PET_FOODS)
      ? window.PET_FOODS : null;
    const food = foods ? foods.findFood(foodId || 'fish', foods.sanitizeFoods(
      (this.vitals && this.vitals.cfg && this.vitals.cfg.foods) || undefined)) : null;

    // 没有 foods 模块（被裁剪的构建）：退回旧的写死行为
    if (!food) {
      if (now - petFeedLastAt < PET_FEED_COOLDOWN_MS) {
        this.showMenuNotice('吃饱啦，等会儿再喂～');
        return;
      }
      petFeedLastAt = now;
      this.PET_SLEEP_Wake();
      this.stopMove();
      this.stopThrow && this.stopThrow();
      this.PET_FEED_Clip = PET_FEED_ANIM;
      this.anim = PET_FEED_ANIM;
      this.once = true;
      this.switchTo(PET_FEED_ANIM, true);
      this.lastInteractionAt = now;
      const m = this.mood.event('feed');
      this.VITALS_Feed(15);
      this.renderMood();
      if (m) this.moodSaveThrottled();
      this.PET_FEED_Say(PET_FEED_LINES[Math.floor(Math.random() * PET_FEED_LINES.length)]);
      return;
    }

    // 这套食物是否在冷却中
    if (!this._foodCooldowns) this._foodCooldowns = new foods.FoodCooldowns();
    const remain = this._foodCooldowns.remaining(food.id, now);
    if (remain > 0) {
      this.showMenuNotice('「' + food.name + '」还吃不下了，' + Math.ceil(remain / 1000) + ' 秒后再试～');
      return;
    }

    // 饱食太满：拒绝（文档 §3.2「吃饱摆手拒绝」）。放在动画之前 —— 拒绝了就不该播吃的动画。
    const feedRes = this.VITALS_Feed(food.hunger);
    if (feedRes.refused) {
      // VITALS_Feed 内部已经 showMenuNotice('吃饱啦…')，这里不重复提示
      return;
    }

    this._foodCooldowns.mark(food.id, now, food.cooldownMs);
    petFeedLastAt = now;

    // 睡着时投喂 = 用户主动操作：先唤醒
    this.PET_SLEEP_Wake();
    this.stopMove();
    this.stopThrow && this.stopThrow();

    // 动画：素材不存在就跳过（配置写了不存在的名字不该让投喂失效）
    const anim = this.hasAnim(food.anim) ? food.anim : PET_FEED_ANIM;
    if (this.hasAnim(anim)) {
      this.PET_FEED_Clip = anim;
      this.anim = anim;
      this.once = true;
      this.switchTo(anim, true);
    }

    this.lastInteractionAt = now;

    // 心情：食物自己的 mood 偏移（默认 8），走事件表外的直加不了 ——
    // 用 'feed' 事件（+8）保持一致心智，食物若配了不同 mood 则额外补差。
    const feedMood = this.mood.event('feed');
    const extraMood = (Number(food.mood) || 8) - 8;
    if (extraMood !== 0 && this.mood && this.mood.enabled) {
      // 通过临时事件名补差（避免给 MOOD_EVENTS 加无意义条目）
      const cur = this.mood.value0;
      this.mood.restore(Math.max(0, Math.min(100, cur + extraMood)));
    }
    this.renderMood();
    if (feedMood) this.moodSaveThrottled();

    // 精力影响（奶茶/冰淇淋 -5 之类）
    if (Number(food.energy) && this.vitals && this.vitals.enabled) {
      const cur = this.vitals.energy;
      this.vitals.restore(cur + Number(food.energy), this.vitals.hunger);
      if (Number(food.energy) < 0) {
        this.showMenuNotice('（喝完有点困…）');
      }
    }

    // 投喂 = 好感度 +1（每天前 3 次）
    this.AFFINITY_Interact('feed');

    // 台词
    const lines = (food.lines && food.lines.length) ? food.lines : PET_FEED_LINES;
    this.PET_FEED_Say(lines[Math.floor(Math.random() * lines.length)]);

    this.VITALS_SaveThrottled(true);
  }

  /** 投喂台词走宿主 broadcast（与碎碎念共用同一气泡槽与优先级） */
  PET_FEED_Say(line) {
    try {
      fetch(BASE + "/broadcast?pet=" + encodeURIComponent(this.pet.id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: line }),
      }).catch((err) => console.warn("[dsh-pet] 投喂台词发送失败", err));
    } catch (e) {
      console.warn("[dsh-pet] 投喂台词失败", e);
    }
  }

  // ---- 睡眠（对齐上游 dsh-whale-girl-pet 的三段式）----
  /**
   * 菜单里点了睡眠三段中的任意一段: 走完整流程, 而不是播一段就被随机链打断。
   * picked: 被点击的那个动作名。
   */
  PET_SLEEP_FromMenu(picked) {
    if (this.PET_SLEEP_On) return;
    // 素材缺失守卫：菜单点播同样不能把宠物送进假睡。三段全没有就明说，然后当没发生。
    if (!this.hasAnim(picked)) {
      console.warn('[dsh-pet] 菜单点播的睡眠素材缺失（' + picked + '），已忽略');
      return;
    }
    // 投饲 / 点击响应类动画的锁：只清锁不 return（与 handleEnded 同款修复），
    // 否则点菜单会静默无效果。
    if (this.PET_FEED_Clip && this.anim === this.PET_FEED_Clip) { this.PET_FEED_Clip = null; }
    this.PET_SLEEP_On = true;
    this.stopMove();
    this.stopThrow && this.stopThrow();
    console.info("[dsh-pet] menu sleep: " + picked);
    // 点到「醒来」就直接播醒来; 点到「持续」就直接进循环; 其余(第一段)先躺下。
    // 注意：不能先置 PET_SLEEP_On=false 再调 Wake —— Wake 开头有
    // `if (!this.PET_SLEEP_On) return;` 守卫，先置 false 会让唤醒被吞掉（点菜单无效果）。
    if (picked === PET_SLEEP_WAKE) { this.PET_SLEEP_Wake(); return; }
    if (picked === PET_SLEEP_LOOP) { this.PET_SLEEP_Loop(); return; }
    this.anim = PET_SLEEP_IN;
    this.once = true;
    this.switchTo(PET_SLEEP_IN, true);
    this.PET_SLEEP_Timer = setTimeout(() => this.PET_SLEEP_Loop(), 8000);
  }
  /** 空闲到期: 播「睡觉第一段」躺下, 播完自动接「睡觉第二段」循环。 */
  PET_SLEEP_Start() {
    if (this.PET_SLEEP_On) return;
    // 素材缺失守卫：睡眠三段是代码写死的名字，配置里没有就**不进睡眠**。
    // 曾经的写法直接 switchTo，video 404 → loadGuard 释放 pending → 没有任何动画在播，
    // 而 PET_SLEEP_On 已置 true 把随机链挡住（handleEnded 里 `if (On) { Loop(); return; }`）
    // —— 表现为宠物永久静止的"假睡"（#68 报告的触发不了，实为卡死）。
    // 宁可这一轮不睡，也绝不能把宠物定格。
    const missing = [PET_SLEEP_IN, PET_SLEEP_LOOP].filter((n) => !this.hasAnim(n));
    if (missing.length) {
      console.warn('[dsh-pet] 睡眠素材缺失（' + missing.join(' / ') + '），本轮不入睡；请在配置里补上这些动画名');
      // 不置 On：随机链照常推进。同时把计时器推远，避免每 5 秒重试刷屏。
      this.PET_SLEEP_At = performance.now();
      return;
    }
    this.PET_SLEEP_On = true;
    this.clearGap(); // 取消排队中的随机动作，别在入睡时插播一段
    this.stopMove();
    this.stopThrow && this.stopThrow();
    console.info("[dsh-pet] dozing off");
    // 入睡扣一点心情（-5）：困了本身就是低能量状态。
    // 不播 cue —— 正要播睡觉动画，插引导动画会把睡姿顶掉。
    this.mood.event('sleep');
    this.renderMood();
    this.moodSaveThrottled();
    // once=true: 整段播完, 由 onended 接力到循环段
    this.anim = PET_SLEEP_IN;
    this.once = true;
    this.switchTo(PET_SLEEP_IN, true);
    // 兜底: 若 onended 因素材异常没触发, 8 秒后也进入循环, 不至于卡在第一段
    this.PET_SLEEP_Timer = setTimeout(() => this.PET_SLEEP_Loop(), 8000);
  }

  /** 持续睡姿: once=false -> el.loop = true, 由浏览器原生循环(呼吸), 不用定时器模拟。 */
  PET_SLEEP_Loop() {
    if (!this.PET_SLEEP_On) return;
    if (this.PET_SLEEP_Timer) {
      clearTimeout(this.PET_SLEEP_Timer);
      this.PET_SLEEP_Timer = null;
    }
    // 循环段素材缺失（第一段有、第二段没有的半边配置）：不能就这么空转，
    // 否则 On 仍为 true、随机链仍被挡 —— 同一副假睡模样。直接脱离睡眠态回随机链。
    if (!this.hasAnim(PET_SLEEP_LOOP)) {
      console.warn('[dsh-pet] 睡眠循环段素材缺失（' + PET_SLEEP_LOOP + '），脱离睡眠态回随机链');
      this.PET_SLEEP_On = false;
      this.PET_SLEEP_At = performance.now();
      this.playIdle();
      return;
    }
    this.anim = PET_SLEEP_LOOP;
    this.once = false;
    this.switchTo(PET_SLEEP_LOOP, false);
  }

  /**
   * 被叫醒: 播「睡觉第三段」, 播完回随机链并重置计时。
   *
   * 关键：这里**不能**先把 PET_SLEEP_On 置 false 再 switchTo。
   * switchTo 是异步的（要 load 素材，几百毫秒），这期间 On=false 会让随机链/
   * 碎碎念/工作状态有机可乘，把正在加载的醒来动画覆盖掉 —— 表现为"醒来被随机打断"。
   * 所以引入 Waking 中间态：醒来动画播完前，On 保持 true（挡住随机链），
   * 由 handleEnded 在真正播完后才清标志。
   */
  PET_SLEEP_Wake() {
    if (!this.PET_SLEEP_On) return;
    // 唤醒动画素材缺失：没有过渡可播，直接脱离睡眠态回随机链（同 PET_SLEEP_Skip 语义）。
    // 不能照旧 switchTo 一个不存在的名字 —— 那会重新制造一次"On 仍 true 但无动画"的空转。
    if (!this.hasAnim(PET_SLEEP_WAKE)) {
      console.warn('[dsh-pet] 唤醒素材缺失（' + PET_SLEEP_WAKE + '），直接脱离睡眠态');
      this.PET_SLEEP_Skip();
      return;
    }
    // 唤醒动画**已在播放**时再被触发（单击 / 投喂 / 菜单）= 跳过，
    // 直接进入随机链 —— 而不是把醒来动画从头重播一遍。
    if (this.PET_SLEEP_Waking) { this.PET_SLEEP_Skip(); return; }
    if (this.PET_SLEEP_Timer) {
      clearTimeout(this.PET_SLEEP_Timer);
      this.PET_SLEEP_Timer = null;
    }
    this.anim = PET_SLEEP_WAKE;
    this.once = true;
    // Waking = true 期间 PET_SLEEP_On 仍为 true（见 PET_SLEEP_WasAsleep），
    // 随机链/碎碎念/工作状态都被挡住；handleEnded 里播完才清。
    this.PET_SLEEP_Waking = true;
    this.switchTo(PET_SLEEP_WAKE, true);
    // 醒来 +3（睡饱了心情好一点）。不播 cue —— 正在播醒来动画。
    this.mood.event('wake');
    this.renderMood();
    this.moodSaveThrottled();
  }

  /** 跳过醒来动画：立刻脱离睡眠态，回随机链（不播任何过渡）。 */
  PET_SLEEP_Skip() {
    if (this.PET_SLEEP_Timer) {
      clearTimeout(this.PET_SLEEP_Timer);
      this.PET_SLEEP_Timer = null;
    }
    this.PET_SLEEP_Waking = false;
    this.PET_SLEEP_On = false;
    this.PET_SLEEP_At = performance.now();
    console.info('[dsh-pet] wake skipped, back to random chain');
    this.playIdle();
  }

  /** 每 5 秒检查一次是否空闲到期。 */
  PET_SLEEP_Tick() {
    if (this.PET_SLEEP_On) return;
    const secs = PET_SLEEP_Seconds();
    if (!secs) return;
    const need = PET_SLEEP_IdleSeconds();
    if (!need) return;
    if (performance.now() - this.PET_SLEEP_At < need * 1000) return;
    this.PET_SLEEP_Start();
  }

  /** 任何交互: 重置计时, 并叫醒她。 */
  /** 睡着(或正在醒来过程中)时为真 */
  PET_SLEEP_WasAsleep() {
    return !!this.PET_SLEEP_On;
  }

  PET_SLEEP_Touch() {
    this.PET_SLEEP_At = performance.now();
    this.PET_SLEEP_Wake();
  }
  playOnce(name) {
    this.anim = name;
    this.once = true;
    this.switchTo(name, true);
  }

  // 动画链（与浏览器 pickNext 语义一致，纯逻辑在 shared）
  playIdle() {
    this.stopMove();
    const { animations, animationWeights } = { animations: this.animations, animationWeights: this.weights };
    const roll = Math.random();
    // 宠物固定（pets[].fixedEnabled）：掷骰时把「转向 / 移动」两档权重按 0 算（与浏览器同一份
    // 决策）——随机链不再让宠物自己翻朝向或走开。右键菜单点播与 /anim 接口不走这里，不受影响。
    const k = S.rollKind(roll, animationWeights, { fixed: this.pet.fixedEnabled });
    let next;
    if (k === 'idle') {
      // 心情替换 idle 池（P1-1）：开心时多蹦跶、困倦时多打哈欠。
      // moodPoolOrNull 已过滤掉不存在的素材；null = 该档没配 → 用原池。
      next = S.pick(this.moodPoolOrNull('idle') || animations.idle, this.anim);
    } else if (k === 'turn') {
      next = S.pick(animations.turn, this.anim);
    } else if (k === 'move') {
      const moved = this.tryMove();
      if (moved === false) {
        const act = S.pickCategoryAction(this.mood.categories(animations.categories), animations.idle, this.facing, this.anim);
        // 抽到「工作」分类 → 不播单个动作，改走完整工作三态
        // （开始工作 → 随机 1~5 个中间段 → 工作结束）
        if (this.shouldRunWork(act)) return;
        next = act.name;
      } else if (typeof moved === 'string') {
        next = moved;
      } else {
        // 已有一场移动进行中（占用）：与浏览器一致，重播当前动画，不另设（绝不重复加载不存在的动作）
        this.playOnce(this.anim);
        return;
      }
    } else {
      // 分类池按当前心情改写权重（关闭时原样返回入参，见 shared-core 的 MoodState）
      const act = S.pickCategoryAction(this.mood.categories(animations.categories), animations.idle, this.facing, this.anim);
      // 抽到「工作」分类 → 走完整工作三态，而不是单独播其中一个动作
      if (this.shouldRunWork(act)) return;
      next = act.name;
    }
    this.playOnce(next);
  }

  /**
   * 心情切档：播该档的引导动画一段（once），并打印一行日志。
   * 只在**跨档**那一刻调（MoodState.event/tick 只在跨档时返回非 null），不会一直霸屏。
   */
  moodCue(to) {
    const name = this.mood.cue();
    if (!name) return;
    console.log('[dsh-pet] pet=' + this.pet.id + ' 心情切档 -> ' + to +
      ' (v=' + this.mood.value0.toFixed(1) + ') 引导动画 ' + name);
    this.playOnce(name);
  }

  // ---- 好感度 + 离线演化（P2 第三批）--------------------------------------
  //
  // 好感度是长期关系（天~周），与 mood（分钟级情绪）互补：
  //   mood      频繁波动、会 decay 回归
  //   affinity  缓慢累积、只随长期缺席下降、决定解锁内容
  //
  // 离线演化是"关闭期间状态继续走"的实现：启动时读快照算离线时长，
  // 一次性推演（不是跑 N 次 tick），再播对应回归剧情。

  /**
   * 启动时恢复好感度 + 推演离线变化。
   * 必须在 vitalsRestore **之后**调用（要先有真实的 energy/hunger 才谈得上离线衰减）。
   *
   * 顺序：
   *   1. 读 pet-state 快照（vitalsRestore 已经读过一次，这里复用它存下的 raw）
   *   2. simulateOffline 推演
   *   3. 应用结果 + 播回归剧情
   */
  /** 诊断落盘（渲染进程 console 不进文件，只能经主进程落 pet.log） */
  DIAG(msg) {
    try {
      const b = window.petBridge;
      if (b && typeof b.diag === 'function') b.diag(String(msg));
    } catch {}
  }
  /**
   * 启动时恢复好感度 + 推演离线变化。
   * 必须在 vitalsRestore **之后**调用（要先有真实的 energy/hunger 才谈得上离线衰减）。
   */
  async affinityRestoreWithOffline() {
    if (this._affinityRestored) return;
    this._affinityRestored = true;
    if (!this.affinity || !this.affinity.enabled) return;

    const bridge = window.petBridge;
    if (!bridge || typeof bridge.loadState !== 'function') return;

    try {
      const r = await bridge.loadState(this.pet.id);
      if (!r || !r.ok || !r.state) return;
      const snap = r.state;

      // 先恢复好感度（用存档里的值）
      this.affinity.restore(snap.affinity, snap.lastSeen, snap.counters);

      // 再推演离线（用存档时间戳算离线多久）
      const O = (typeof window !== 'undefined' && window.PET_OFFLINE) ? window.PET_OFFLINE : null;
      if (!O) return;
      const cfg = { vitals: this.vitals && this.vitals.cfg, affinity: this.affinity.cfg };
      const sim = O.simulateOffline(snap, new Date(), cfg);
      this._offlineResult = sim;

      if (!sim.changed) return;   // 没离线（或时间戳非法）→ 什么都不做

      // 应用推演结果
      if (this.vitals && this.vitals.enabled) {
        this.vitals.restore(sim.energy, sim.hunger);
      }
      if (this.mood && this.mood.enabled) this.mood.restore(sim.mood);
      this.affinity.restore(sim.affinity, this.affinity.lastSeen, snap.counters);

      console.log('[dsh-pet] 离线 ' + sim.offlineHours.toFixed(1) + ' 小时 → 回归剧情「' +
        sim.reunion + '」 energy=' + sim.energy.toFixed(0) +
        ' hunger=' + sim.hunger.toFixed(0) + ' affinity=' + sim.affinity.toFixed(1));

      this.renderMood();
      this.OFFLINE_PlayReunion(sim);
    } catch (e) {
      console.warn('[dsh-pet] 离线推演失败（忽略，按当前值继续）: ' + (e && e.message));
    }
  }

  /** 从 pet-state-<id>.json 恢复精力/饱食（启动时调一次，失败静默走默认值） */
  async vitalsRestore() {
    if (this._vitalsRestored) return;
    this._vitalsRestored = true;
    if (!this.vitals || !this.vitals.enabled) return;
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.loadState !== 'function') return;
    try {
      const r = await bridge.loadState(this.pet.id);
      if (r && r.ok && r.state) {
        this.vitals.restore(r.state.energy, r.state.hunger);
        if (r.repaired && r.repaired.length) {
          console.warn('[dsh-pet] 状态存档有修复字段: ' + r.repaired.join(', '));
        }
      }
      this._vitalsLastTick = Date.now();
    } catch { /* 首次运行没有存档，正常 */ }
  }

  /**
   * 播放回归剧情：动画 + 台词。
   * 只播一次（启动时），之后正常进随机链。
   */
  OFFLINE_PlayReunion(sim) {
    const rd = sim.reunionData;
    if (!rd) return;
    // 动画：素材不存在就跳过（回归剧情不该因为缺素材而静默）
    if (rd.anim && this.hasAnim(rd.anim)) {
      // 延后一点：preload/资源预热需要时间，立刻播可能闪
      setTimeout(() => {
        try {
          if (this.PET_SLEEP_On) this.PET_SLEEP_Wake();
          this.playOnce(rd.anim);
        } catch { /* 播放失败不影响主体 */ }
      }, 1200);
    }
    // 台词
    if (Array.isArray(rd.lines) && rd.lines.length) {
      const line = rd.lines[Math.floor(Math.random() * rd.lines.length)];
      setTimeout(() => {
        try {
          fetch(BASE + '/broadcast?pet=' + encodeURIComponent(this.pet.id), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: line }),
          }).catch(() => {});
        } catch { /* 静默 */ }
      }, 2200);
    }
  }

  /**
   * 记一次好感互动（带每日上限）。
   * @param {string} rule affinity.DAILY_RULES 里的键：
   *                      firstMeet / feed / play / milestone / accompany / care
   * @returns {{applied:number, levelUp:boolean, capped:boolean}}
   */
  AFFINITY_Interact(rule) {
    if (!this.affinity || !this.affinity.enabled) return { applied: 0, levelUp: false, capped: false };
    const r = this.affinity.interact(rule, new Date());
    if (r.levelUp) {
      // 升级反馈：气泡 + 心情小奖励
      const lv = this.affinity.level;
      this.showMenuNotice('好感度提升 → Lv.' + lv.lv + '「' + lv.name + '」');
      if (this.mood && this.mood.enabled) {
        this.mood.event('workSlack');   // 用已有的正向小事件（不新增事件名）
        this.renderMood();
      }
      console.info('[dsh-pet] 好感度升级 Lv.' + lv.lv + ' ' + lv.name);
      this._affectionJustUp = true;   // 头顶显示 💗，下次 tick 后清掉
      this.renderStatusIcon();
    }
    if (r.applied !== 0) this.VITALS_SaveThrottled();
    return r;
  }

  // ---- 多宠社交（第四批）--------------------------------------------------
  //
  // 复用已有的跨窗口位置广播：`this.others` 里就存着其它宠物的最新位置
  // （由 preload 的 onFlightStates 每 ~30ms 刷新）。社交只做「靠近 → 触发互动」。
  //
  // 为什么不做双角色动画：没有那个素材。改成单角色动画 + 位置对齐
  //（文档 §6.4 的方案 B，成本低且不需要新素材）。

  /** 定期扫描周围宠物（由既有 _workTimer 每 5 秒调一次，不额外起定时器） */
  SOCIAL_Tick() {
    if (!this.social) return;
    const now = Date.now();
    if (now - this._lastSocialScan < 5000) return;   // 最多 5 秒一次
    this._lastSocialScan = now;

    const others = this.others ? Object.entries(this.others) : [];
    if (!others.length) return;

    const me = {
      id: this.pet.id,
      x: this.pos.x, y: this.pos.y,
      mood: this.mood ? this.mood.value0 : 50,
      energy: (this.vitals && this.vitals.enabled) ? this.vitals.energy : 100,
    };
    const list = others.map(([id, s]) => ({
      id,
      x: Number(s && s.x) || 0,
      y: Number(s && s.y) || 0,
      mood: 50,    // 其它宠物的心情不广播（省带宽），当普通值处理
      energy: 100,
    }));

    const hit = this.social.scan(me, list, now);
    if (!hit) return;

    const S = window.PET_SOCIAL;
    const def = S && S.INTERACTIONS ? S.INTERACTIONS[hit.type] : null;
    if (!def) return;

    // 更新关系值
    const rel = this.social.record(hit.target, hit.type);
    console.info('[dsh-pet] 多宠互动：' + def.desc + '（与 ' + hit.target +
      ' 的关系 ' + rel.toFixed(0) + '）');

    // 播动画（单角色 + 位置对齐：往对方方向靠一点）
    if (def.anim && this.hasAnim(def.anim)) {
      this.stopMove();
      this.playOnce(def.anim);
    }

    // 心情 / 好感度联动
    if (def.mood && this.mood && this.mood.enabled) {
      // 用已有事件名承载（不新增事件）：正向用 workSlack，负向用 workError
      const p = def.mood > 0 ? this.mood.event('workSlack') : this.mood.event('workError');
      if (p) this.moodCue(p);
      this.renderMood();
    }
    if (def.affinity > 0) this.AFFINITY_Interact('play');
    this.VITALS_SaveThrottled();
  }

  // ---- 状态面板（第四批）--------------------------------------------------
  //
  // 做成窗口内浮层而不是新开 Electron 窗口：新窗口要改 main.js 的窗口管理、
  // 加 IPC、处理层级与穿透，成本高且容易和「宠物窗口单实例」逻辑打架。
  // 现有菜单/气泡/聊天弹窗都是窗口内 DOM + 穿透守卫，这里沿用同一套做法。

  /** 汇总当前四维状态（供面板显示） */
  STATUS_Snapshot() {
    const moodV = this.mood ? this.mood.value0 : 50;
    const energyV = (this.vitals && this.vitals.enabled) ? this.vitals.energy : 100;
    const hungerV = (this.vitals && this.vitals.enabled) ? this.vitals.hunger : 100;
    const aff = this.AFFINITY_Summary();
    let days = 0;
    try {
      // 陪伴天数：从好感度首次记录算起（粗略：按 lastSeen 与今天的天数差 +1）
      const ls = this.affinity && this.affinity.lastSeen;
      if (ls) {
        const d = Math.floor((Date.now() - new Date(ls + 'T00:00:00').getTime()) / 86400000);
        days = Math.max(1, d + 1);
      }
    } catch { days = 0; }
    return {
      mood: moodV, energy: energyV, hunger: hungerV,
      affinity: aff, stats: { days, feeds: this._feedCount || 0 },
    };
  }

  /** 打开状态面板（幂等：已开则不重复创建） */
  PANEL_Open() {
    if (this._panelOpen && this._panelEl) return;
    const SP = (typeof window !== 'undefined' && window.PET_STATUS_PANEL) ? window.PET_STATUS_PANEL : null;
    if (!SP) {
      this.showMenuNotice('状态面板不可用（模块未加载）');
      return;
    }
    // 注入样式（只注入一次）
    if (!document.getElementById('pet-panel-style')) {
      const st = document.createElement('style');
      st.id = 'pet-panel-style';
      st.textContent = SP.CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.className = 'pet-panel';
    el.innerHTML =
      '<div class="pet-panel-title"><span>她的状态</span>' +
      '<span class="pet-panel-close" data-pet-panel-close="1">✕</span></div>' +
      SP.buildPanelHtml(this.STATUS_Snapshot());
    // 关闭按钮
    el.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-pet-panel-close')) {
        ev.stopPropagation();
        this.PANEL_Close();
      }
    });
    // 位置：宠物上方，超出窗口就贴边
    const rect = this.el.getBoundingClientRect ? this.el.getBoundingClientRect() : null;
    const winW = window.innerWidth || 400, winH = window.innerHeight || 300;
    const panelW = 292, panelH = 250;
    let left = rect ? rect.left + rect.width / 2 - panelW / 2 : 20;
    left = Math.max(8, Math.min(left, winW - panelW - 8));
    let top = rect ? rect.top - panelH - 8 : 20;
    if (top < 8) top = (rect ? rect.bottom + 8 : 20);
    top = Math.max(8, Math.min(top, winH - panelH - 8));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';

    document.body.appendChild(el);
    this._panelEl = el;
    this._panelOpen = true;
    // 面板是窗口内 DOM：期间整窗要保持可交互，否则光标移出身体命中区就会被翻回穿透
    this.menuOpen = true;
    this.syncInputBusy && this.syncInputBusy();
  }

  /** 关闭状态面板 */
  PANEL_Close() {
    if (this._panelEl) {
      try { this._panelEl.remove(); } catch {}
      this._panelEl = null;
    }
    this._panelOpen = false;
    this.menuOpen = false;
    this.syncInputBusy && this.syncInputBusy();
  }

  /** 好感度加成的正收益系数（1.0~1.5），供 mood 事件放大用 */
  AFFINITY_Bonus() {
    if (!this.affinity || !this.affinity.enabled) return 1;
    return this.affinity.positiveBonus();
  }

  /** 状态面板/徽标用的汇总（第三批先提供数据，UI 第四批做） */
  AFFINITY_Summary() {
    if (!this.affinity || !this.affinity.enabled) return null;
    const lv = this.affinity.level;
    return {
      value: Math.round(this.affinity.value * 10) / 10,
      lv: lv.lv,
      name: lv.name,
      desc: lv.desc,
      toNext: this.affinity.toNext,
      bonus: this.affinity.positiveBonus(),
    };
  }

  // ---- 精力 / 饱食（P2 第一批）--------------------------------------------
  //
  // 三个入口：
  //   vitalsRestore()      启动时从 pet-state-<id>.json 恢复
  //   VITALS_Tick()        每拍推进（复用既有定时器，不额外起定时器）
  //   VITALS_Feed(amount)  喂食
  //
  // 与 mood 的关系：mood 是分钟级情绪（事件驱动、快速回归）；这两个是按小时演化的
  // "身体状态"。enabled=false 时 VitalsState 全透传，不消耗任何东西。

  /** 从 pet-state-<id>.json 恢复精力/饱食（启动时调一次，失败静默走默认值） */

  /** 每拍推进（由既有定时器调用） */
  VITALS_Tick() {
    if (!this.vitals || !this.vitals.enabled) return;
    const now = Date.now();
    if (!this._vitalsLastTick) { this._vitalsLastTick = now; return; }
    const dt = (now - this._vitalsLastTick) / 1000;
    if (!(dt > 0)) return;
    this._vitalsLastTick = now;

    // 活动判定：睡眠 > 工作 > 待机
    let activity = 'idle';
    if (this.PET_SLEEP_On) activity = 'sleep';
    else if (this.WORK_On || this.WORK_Busy) activity = 'working';
    else if (this.workState && this.workState !== 'success' && this.workState !== 'error') activity = 'working';

    const hour = new Date().getHours();
    const moodVal = this.mood ? this.mood.value0 : 50;
    const ev = this.vitals.tick(dt, activity, hour, moodVal);

    // 联动：饿/累会让心情慢慢掉（叠加在 mood 自身回归之外）
    const drain = this.vitals.moodDrainPerMin();
    if (drain > 0 && this.mood && this.mood.enabled) {
      this.mood.tick(dt, hour, undefined, drain);
      this.renderMood();
    }

    for (const e of ev) {
      if (e === 'energyLow') {
        // 精力见底：夜里自动睡，白天先播累的动画
        const night = (hour >= 22 || hour < 6);
        if (night) this.PET_SLEEP_Start();
        else if (this.hasAnim('迷糊犯困')) this.playOnce('迷糊犯困');
      } else if (e === 'wakeUp') {
        if (this.PET_SLEEP_On) this.PET_SLEEP_Wake();
      } else if (e === 'hungry' || e === 'starving') {
        this.VITALS_SayHungry(e === 'starving');
      }
    }

    // 常态位置上报（多宠社交需要）：reportFlight 原本只在被甩飞时上报，
    // 静止/走路时 others 恒空 → 社交永远触发不了。这里每 5 秒补一次，
    // 复用同一 broker 通道（不新增 IPC），碰撞检测也会因此受益。
    try {
      if (window.petBridge && window.petBridge.reportFlight) {
        window.petBridge.reportFlight({
          x: toScreen(this.pos.x),
          y: toScreen(this.pos.y),
          vx: 0, vy: 0,
          size: toScreen(this.size),
          bottomPad: toScreen(this.bottomPad),
        });
      }
    } catch { /* 广播失败不影响主体 */ }

    this.renderStatusIcon();   // 头顶状态图标（饿/困/睡），随 vitals 变化
    this.VITALS_SaveThrottled();
  }

  /** 饿了冒泡（没有宿主通道时静默跳过） */
  VITALS_SayHungry(starving) {
    try {
      const text = starving ? '肚子好饿……真的没力气了' : '肚子有点饿了，有吃的吗';
      fetch(BASE + '/broadcast?pet=' + encodeURIComponent(this.pet.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(() => {});
    } catch { /* 宿主不可用不影响主体 */ }
  }

  /** 喂食：恢复饱食。返回 { applied, refused } 供调用方决定台词 */
  VITALS_Feed(amount) {
    if (!this.vitals || !this.vitals.enabled) return { applied: 0, refused: false };
    const r = this.vitals.feed(amount);
    if (r.refused) this.showMenuNotice('吃饱啦，等会儿再吃～');
    this.VITALS_SaveThrottled(true);
    return r;
  }

  /** 节流存盘（默认 30 秒一次；force=true 立即写） */
  VITALS_SaveThrottled(force) {
    if (!this.vitals || !this.vitals.enabled) return;
    const now = Date.now();
    if (!force && now - this._vitalsSaveAt < 30000) return;
    this._vitalsSaveAt = now;
    this.VITALS_Save();
  }

  /** 写完整快照到 pet-state-<id>.json */
  VITALS_Save() {
    if (!this.vitals || !this.vitals.enabled) return;
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.saveState !== 'function') return;
    const s = this.vitals.snapshot();
    const state = {
      mood: this.mood ? Math.round(this.mood.value0 * 10) / 10 : 50,
      energy: s.energy,
      hunger: s.hunger,
      affinity: (this.affinity && this.affinity.enabled)
        ? Math.round(this.affinity.value * 10) / 10 : 10,
      affinityLastSeen: (this.affinity && this.affinity.enabled) ? this.affinity.lastSeen : undefined,
      lastSeen: (typeof window.PET_STATE_DATE_KEY === 'function')
        ? window.PET_STATE_DATE_KEY(new Date())
        : new Date().toISOString().slice(0, 10),
      counters: {},
    };
    bridge.saveState(this.pet.id, state).catch(() => {});
  }

  /**
   * 按当前心情取 idle / clicks 的替代池（P1-1 / P1-2）。
   * 返回 null = 该档没配、调用方用原池（`mood.pool()` 关闭时恒为空数组）。
   *
   * 为什么要这个：分类权重倍率是**概率性**变化（玩耍 20%→32%），用户不一定察觉。
   * 直接替换 idle/clicks 这类高频池，心情的影响才明显。
   * 池里的动画名会先过 hasAnim 过滤——配置里写了不存在的素材也不会 404。
   */
  moodPoolOrNull(which) {
    const pool = this.mood.pool(which);
    if (pool.length === 0) return null;
    const usable = pool.filter((n) => this.hasAnim(n));
    return usable.length ? usable : null;
  }

  /**
   * 心情持久化：节流写入（默认 30 秒最多一次）。
   * 为什么节流：心情每次 tick/事件都想存，但 handleEnded 触发很频繁，
   * 不节流会造成大量小文件写入（桌宠长期挂着时很明显）。
   */
  moodSaveThrottled(force) {
    const now = Date.now();
    if (!force && now - this.moodSaveAt < 30000) return;
    this.moodSaveAt = now;
    this.moodSave();
  }

  /** 把当前心情写到 data/memory.json（与宿主的对话记忆同文件，只加 mood 键）。
   *  走 preload 暴露的 petBridge.saveMood → 主进程 ipcMain 'pet:save-mood'
   *  （渲染进程 contextIsolation，没有 fs 权限）。 */
  moodSave() {
    const v = this.mood.snapshot();
    if (v === null) return; // 心情系统关闭 → 不写盘
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.saveMood !== 'function') return; // DSH 宿主模式没有这个通道
    bridge.saveMood(Math.round(v * 10) / 10).catch(() => {});
  }

  /** 启动时从 memory.json 恢复心情（只恢复一次；失败静默保持基准值）。 */
  async moodRestore() {
    if (this.moodRestored) return;
    this.moodRestored = true;
    if (!this.mood.enabled) return;
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.loadMood !== 'function') return;
    try {
      const r = await bridge.loadMood();
      if (r && r.ok && typeof r.mood === 'number') {
        this.mood.restore(r.mood);
        this.renderMood();
        console.log('[dsh-pet] 恢复心情 ' + r.mood.toFixed(1) +
          (r.updatedAt ? '（存档于 ' + new Date(r.updatedAt).toLocaleString() + '）' : ''));
      }
    } catch { /* 首次运行没有存档，正常 */ }
  }

  /** 心情徽标文案表（emoji + 中文档名；normal 不显示档名，只留 emoji + 数值，减少常驻干扰） */
  static MOOD_LABEL = {
    happy:  { emoji: '😄', text: '开心' },
    normal: { emoji: '🙂', text: '' },
    tired:  { emoji: '🥱', text: '疲倦' },
    grumpy: { emoji: '😾', text: '烦躁' },
  };

  /**
   * 刷新头顶状态图标（P2 §5.1）。
   *
   * 只在**状态键变化**时动 DOM（签名短路），避免每 5 秒 tick 都重设样式。
   * 多个状态同时存在时只显示最紧急的一个（见 status-icons.js 的优先级表）——
   * 同时显示多个会变成噪音，反而失去"抬眼就能看懂"的价值。
   */
  renderStatusIcon() {
    if (!this.statusIconEl) return;
    const I = (typeof window !== 'undefined' && window.PET_STATUS_ICONS) ? window.PET_STATUS_ICONS : null;
    if (!I) return;

    const energy = (this.vitals && this.vitals.enabled) ? this.vitals.energy : 100;
    const hunger = (this.vitals && this.vitals.enabled) ? this.vitals.hunger : 100;
    const icon = I.pickIcon({
      energy,
      hunger,
      sleeping: this.PET_SLEEP_On === true,
      affectionJustUp: this._affectionJustUp === true,
      bored: this._boredFlag === true,
    });

    const sig = I.iconSignature(icon);
    if (sig === this._statusIconSig) return;   // 没变就短路
    this._statusIconSig = sig;

    if (!icon) {
      this.statusIconEl.className = 'pet-status-icon';
      this.statusIconEl.textContent = '';
      this.statusIconEl.title = '';
      return;
    }
    this.statusIconEl.className = 'pet-status-icon is-on';
    this.statusIconEl.textContent = icon.emoji;
    this.statusIconEl.title = icon.text;
  }

  /**
   * 随机链抽到「工作」分类时是否改走完整工作三态。
   * 带冷却：刚做完一轮工作不能立刻再来一轮，否则她会长时间卡在工作里。
   * 返回 true 表示已接管（调用方应直接 return）。
   */
  shouldRunWork(act) {
    if (!act || act.id !== PET_WORK_CAT) return false;
    if (this.WORK_On || this.WORK_Busy) return false;
    if (this.PET_SLEEP_On) return false;
    if (performance.now() - this.WORK_StartedAt < PET_WORK_RECHARGE_MS) {
      // 冷却中：退回普通分类动作（不能卡住随机链）
      return false;
    }
    this.WORK_Start();
    return true;
  }

  /**
   * 清掉一次性状态标记（好感度升级、无聊）。
   * 这些是"事件型"而非"持续型"，显示一段时间后应消失。
   */
  clearTransientIconFlags() {
    this._affectionJustUp = false;
    this._boredFlag = false;
  }

  /**
   * 刷新心情徽标：emoji + 档位 + 数值。
   * 只在签名变化时动 DOM（避免每次 tick 都重设），关闭态不加 is-on（徽标不可见）。
   */
  renderMood() {
    const enabled = this.mood.enabled;
    const key = enabled ? this.mood.current : 'normal';
    const val = this.mood.value0.toFixed(0);
    const sig = (enabled ? '1' : '0') + '|' + key + '|' + val;
    if (this._moodSig === sig) return;
    this._moodSig = sig;
    const label = PetSprite.MOOD_LABEL[key] || PetSprite.MOOD_LABEL.normal;
    this.moodEmoji.textContent = label.emoji;
    this.moodText.textContent = label.text;
    this.moodVal.textContent = val;
    this.moodEl.className = 'pet-mood' + (enabled ? ' is-on pet-mood-' + key : '');
  }
  handleEnded() { // __feedLockV2
    // 心情时钟：以"动画播完"为天然节拍（不另起定时器）。dt 取真实经过时间，
    // hour 决定回归目标——夜里越待越困，白天自然回暖（与浏览器 pet.ts 同一语义）。
    const nowMs = Date.now();
    if (this.moodLastTick > 0) {
      // 第三参数 idleMs = 距上次用户交互多久，超过 5 分钟开始扣心情（"被忽视"惩罚）。
      // 原来心情只由事件驱动，用户不理它时恒定不变——桌宠不会因被冷落而低落。
      const idleMs = this.lastInteractionAt ? nowMs - this.lastInteractionAt : 0;
      const to = this.mood.tick((nowMs - this.moodLastTick) / 1000, new Date().getHours(), idleMs);
      if (to) this.moodCue(to);
      this.moodSaveThrottled();
    }
    this.moodLastTick = nowMs;
    this.renderMood();
    // 睡觉第一段播完 -> 接入睡觉第二段的原生循环
    if (this.PET_SLEEP_On && this.anim === PET_SLEEP_IN) { this.PET_SLEEP_Loop(); return; }
    // 睡觉第三段(醒来)播完 -> 真正脱离睡眠态, 回随机链并重置计时。
    // **必须在下面那条 PET_SLEEP_On 守卫之前**：醒来期间 On 故意保持 true（挡随机链），
    // 若被守卫先命中就会 PET_SLEEP_Loop() 掉回睡觉二段 —— 表现为"醒来播完又睡回去"。
    if (this.PET_SLEEP_Waking && this.anim === PET_SLEEP_WAKE) {
      this.PET_SLEEP_Waking = false;
      this.PET_SLEEP_On = false; // 醒完了, 之后的点击恢复正常点击回应
      this.PET_SLEEP_At = performance.now();
      if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
      return;
    }
    // 睡着时任何一次性动画结束都不许回随机链(否则睡姿会被别的动作顶掉)。
    // 但**不能直接 return** —— 那会让动画链失去推进信号，永久停在打断动画的最后一帧
    // （碎碎念/工作状态等打断睡眠后"静止不动"的根源）。正确做法：切回躺睡循环，继续睡。
    if (this.PET_SLEEP_On) { this.PET_SLEEP_Loop(); return; }
    // 投饲/菜单点播带锁连播: 当前片段播完才交回随机链, 不被抢断
    // 注意这里**不能直接 return** —— 早年的写法是清掉标志就返回, 结果动画链拿不到推进
    // 信号, 片段播完就永久停在最后一帧（表现为"点一个动作然后卡住"）。
    // 正确做法: 只清锁, 让流程继续往下走到随机链推进。
    if (this.PET_FEED_Clip && this.anim === this.PET_FEED_Clip) {
      this.PET_FEED_Clip = null;
    }
    if (this.dragState.active) return;
    const { animations } = { animations: this.animations };

    // ---- 空闲自动工作状态（工作三态）----
    // 必须放在 isEvent 门**外面**：三态用的动画（开始工作/认真工作/工作结束）在
    // categories.工作 里，不在 events 池中，isEventAnim 判不到 —— 放在里面会被
    // 整个跳过，于是"播一个动作就回随机链站着轮换"。
    //   开始工作（站→坐）播完 → 进坐姿轮播
    //   工作结束（坐→站）播完 → 退出并继续走随机链
    // 坐姿轮播段本身是 loop=true，不触发 onended，由 WORK_NextClip 的定时器换段。
    if (this.WORK_On) {
      this.WORK_Next();
      // 工作状态还在继续（轮播中）→ 就此打住，别回随机链
      // 已经结束 → 继续往下走，让随机链接住
      if (this.WORK_On) return;
    }

    // 事件动画播完：回 idle（与 drag/clicks 同分支，不进随机链）；气泡由定时器自动消失，与动画解耦
    const isEvent = S.isEventAnim(animations.events, this.anim);
    if (isEvent) {
      // 工作状态多候选档位：播完一段自动轮换到下一候选（排除当前段，避免连抽），继续循环——
      // 长时间状态不单段重复（与浏览器 ended 护栏共用同一决策 nextWorkStatusAnim）。
      // 仅非终态档位轮换；终态（success/error）播完一次即结束，绝不轮换续播。单候选档位由
      // loop 无限循环（不触发 ended，不会走到这里）。
      const nonTerminal = this.workState && this.workState !== 'success' && this.workState !== 'error';
      const nextWork = nonTerminal ? S.nextWorkStatusAnim(animations.events?.workStatus ?? [], this.anim) : null;
      if (nextWork !== null) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' workStatus 档内轮换: ' +
            this.anim +
            ' -> ' +
            nextWork,
        );
        this.playOnce(nextWork); // 继续播一遍（once=true）→ ended 再轮换
        return;
      }
      // 非 workStatus 事件动画（余额/碎碎念）播完：workStatus 仍非终态 → 立即恢复档位循环动画，
      // 不进随机链（长事件期间状态不变，随机链会一直播到状态切换才被拉回）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    if (animations.turn.includes(this.anim)) {
      const next = this.facing === 'left' ? 'right' : 'left';
      this.facing = next; // 立即同步：翻转后的 pickNext 用新朝向过滤 noMirror
    }
    if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {
      // 互动动画播完：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器同一语义）
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    // 随机链推进：在换下一段之前先停 GAP_MS，让她"演完停一下"再动。
    // 之前是直接 this.playIdle()，两段之间没有任何停顿，看起来一直在赶场。
    // 定时器句柄挂在实例上，交互/睡眠开始时会被 clearGap() 取消，避免她已经被
    // 拖走/睡着了还突然蹦出下一个动作。
    this.scheduleNextIdle();
  }

  // ---- 空闲自动进入工作状态 ----
  // 原有工作状态只有 onWorkTick 一个数据源，而它读的是 DSH 宿主的会话快照；
  // 独立模式没有宿主 → snapshot 恒空 → workState 永远 null → 工作动画永远不进。
  // 这里补一条独立触发：久久没人理她 → 自己去做几个工作相关的动作。

  /** 每 5 秒看一眼：空闲够久就进入工作状态。 */
  WORK_Tick() {
    if (this.WORK_On || this.WORK_Busy) return;
    // 睡着时不启动工作（她都睡着了，不该又去工作）
    if (this.PET_SLEEP_On) return;
    if (performance.now() - this.WORK_Idle_At < PET_WORK_IDLE_SEC * 1000) return;
    // 中间池全空（配置里没有工作类素材）时加冷却：否则每 5 秒进一次 WORK_Start、
    // 打一条 warn，日志会被同一条刷满。冷却内直接跳过，静默。
    const mid = PET_WORK_MID.filter((n) => this.hasAnim(n));
    if (!mid.length) {
      if (performance.now() - this.WORK_StartedAt >= PET_WORK_RECHARGE_MS) {
        this.WORK_StartedAt = performance.now();
        console.warn('[dsh-pet] 没有可用的工作中间动作，本轮不工作；请在配置里补上这些动画名');
      }
      return;
    }
    this.WORK_Start();
  }

  /**
   * 进入工作状态（三段式，与睡眠同构）。
   *
   *   ① 开始工作（站→坐，一次）        —— PET_WORK_IN
   *   ② 工作中：从中间池**随机不重复**抽 N 段 —— PET_WORK_MID（洗牌）
   *   ③ 工作结束（坐→站，庆祝，一次）    —— PET_WORK_OUT
   *
   * ② 的数量随机（PET_WORK_MIN..MAX 之间），且一轮内不重复播放
   * （用完洗牌重来，池子小也不会连续同段）。
   * 中间池固定为用户指定的 5 个动作，不再从整个工作分类里捞。
   */
  WORK_Start() {
    // 睡着时被要求工作 = 用户主动操作：先唤醒再工作。
    this.PET_SLEEP_Wake();
    if (this.WORK_On) return;

    const mid = PET_WORK_MID.filter((n) => this.hasAnim(n));
    if (!mid.length) {
      console.warn('[dsh-pet] 没有可用的工作中间动作，退回随机链');
      return;
    }

    this.WORK_On = true;
    this.WORK_Busy = true;
    this.WORK_Pool = mid;
    // 本轮要播的段数：随机，且不超过池子大小（保证不重复）
    this.WORK_Total = PET_WORK_MIN +
      Math.floor(Math.random() * (Math.min(PET_WORK_MAX, mid.length) - PET_WORK_MIN + 1));
    this.WORK_Played = [];   // 本轮已播过的（用于去重）
    this.WORK_StartedAt = performance.now();
    this.stopMove();
    this.clearGap();

    // ① 有「开始工作」就播站→坐过渡；素材缺失则直接进中间段
    if (this.hasAnim(PET_WORK_IN)) {
      this.anim = PET_WORK_IN;
      this.once = true;
      this.switchTo(PET_WORK_IN, true);
    } else {
      this.WORK_NextClip();
    }
    console.info('[dsh-pet] work: start, ' + this.WORK_Total + ' clips from ' + mid.length);
  }

  /** ② 中：从池里抽一段**没播过**的（池空了就洗牌重来，保证数量能凑够）。 */
  WORK_PickMid() {
    const left = this.WORK_Pool.filter((n) => !this.WORK_Played.includes(n));
    if (left.length) return S.pick(left, this.anim);
    // 全部播过一遍了：洗牌重来（数量 > 池大小时才会走到）
    this.WORK_Played = [];
    return S.pick(this.WORK_Pool, this.anim);
  }

  /** 工作中：切下一段（循环播放，由定时器换段 —— loop 不触发 onended）。 */
  WORK_NextClip() {
    if (!this.WORK_On) return;
    const next = this.WORK_PickMid();
    this.WORK_Played.push(next);
    this.WORK_Busy = false;
    this.WORK_Left = this.WORK_Total - this.WORK_Played.length;
    this.anim = next;
    this.once = false;              // loop=true：原地循环
    this.switchTo(next, false);
    if (this.WORK_Left > 0) {
      // 还有剩余 → 定时器换下一段
      if (this.WORK_Timer !== null) window.clearTimeout(this.WORK_Timer);
      this.WORK_Timer = window.setTimeout(() => {
        if (this.WORK_On && !this.PET_SLEEP_On) this.WORK_NextClip();
      }, PET_WORK_CLIP_MS);
    } else {
      // 播够了 → ③ 工作结束
      if (this.WORK_Timer !== null) { window.clearTimeout(this.WORK_Timer); this.WORK_Timer = null; }
      if (this.hasAnim(PET_WORK_OUT)) {
        this.anim = PET_WORK_OUT;
        this.once = true;
        this.switchTo(PET_WORK_OUT, true);   // onended → handleEnded → WORK_End
      } else {
        this.WORK_End();
      }
    }
  }

  /** 一个工作动作播完（onended）：坐姿轮播期间不适用，只有过渡段/结束段会走到。 */
  WORK_Next() {
    if (!this.WORK_On) return false;
    this.WORK_Busy = false;
    // 开始工作（站→坐）播完 → 进轮播
    if (this.anim === PET_WORK_IN) { this.WORK_NextClip(); return true; }
    // 工作结束（坐→站）播完 → 退出
    if (this.anim === PET_WORK_OUT) { this.WORK_End(); return false; }
    // 兜底：其它情况（比如素材缺失走了旧路径）也推进
    if (this.WORK_Left > 0) { this.WORK_NextClip(); return true; }
    this.WORK_End();
    return false;
  }

  /** 工作状态结束：回随机链，并从现在开始计下一轮空闲。 */
  WORK_End() {
    if (this.WORK_Timer !== null) { window.clearTimeout(this.WORK_Timer); this.WORK_Timer = null; }
    this.WORK_On = false;
    this.WORK_Busy = false;
    this.WORK_Left = 0;
    this.WORK_Idle_At = performance.now();
    console.info('[dsh-pet] work run finished, back to random chain');
  }
  // ---- 本地工作状态检测（独立版 workStatus 触发源）--------------------------------
  //
  // 和上面的 WORK_* 不是一回事：
  //   WORK_*      = 没人理她时自己找活干（5 分钟无交互触发，纯演出）
  //   DETECTOR_*  = 看你在干什么，跟着切六档动画（真实反映用户状态）
  // 宿主模式（DSH 插件）下 onWorkTick 已有数据源；这里只在 workStatusDetector.enabled
  // 时叠加，独立版靠它把 6 段动画 + 18 句台词救活。

  /** 启动本地检测。幂等：重复调用只启动一次。 */
  DETECTOR_Start() {
    if (this._localDetectOn) return;
    // workStatusDetector 是**顶层字段**（main.workStatusDetector），不是宠物条目字段。
    // 写法与上面 mood 一致：优先读条目（将来支持单宠覆盖），回落到全局。
    const cfg = this.pet.workStatusDetector || config.workStatusDetector;
    if (!cfg || cfg.enabled !== true) return;
    if (!this.pet.workStatusEnabled) return;
    if (typeof window === 'undefined' || !window.PET_WORK_DETECT) {
      console.warn('[dsh-pet] 本地工作状态检测不可用（缺少 PET_WORK_DETECT）');
      return;
    }
    const intervalSec = Number(cfg.detectIntervalSec) > 0 ? Number(cfg.detectIntervalSec) : 5;
    const sm = new window.PET_WORK_DETECT.WorkStateMachine({
      confirmCount: cfg.confirmCount,
      minStateDurationSec: cfg.minStateDurationSec,
      idleThresholdMin: cfg.idleThresholdMin,
      workStretchMin: cfg.workStretchMin,
      longWorkStretchMin: cfg.longWorkStretchMin,
    });
    sm.opts = { customRules: Array.isArray(cfg.customRules) ? cfg.customRules : [] };
    this._stateMachine = sm;
    // 采样在主进程做（渲染进程拿不到 child_process），这里只订阅结果。
    // 状态机留在本 renderer：多开时每只宠物的检测参数可能不同，不能共享状态。
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.onForeground !== 'function') {
      console.warn('[dsh-pet] 本地工作状态检测不可用（preload 缺少 onForeground）');
      return;
    }
    bridge.onForeground((info) => this.DETECTOR_OnSample(info));
    bridge.startForegroundWatch(intervalSec).catch(() => {});
    this._localDetectOn = true;
    console.info('[dsh-pet] 本地工作状态检测已启动（每 ' + intervalSec + 's 一次）');
  }

  /** 停止本地检测（dispose / 配置热重载时调）。 */
  DETECTOR_Stop() {
    if (this._localDetectOn) {
      const bridge = window.petBridge;
      if (bridge && typeof bridge.stopForegroundWatch === 'function') {
        bridge.stopForegroundWatch();
      }
      this._localDetectOn = false;
    }
    this._stateMachine = null;
    this._localWorkState = null;
  }

  /** 一拍采样 -> 状态机 -> 驱动动画 + 心情联动。 */
  DETECTOR_OnSample(sample) {
    if (!this._stateMachine) return;
    const r = this._stateMachine.feed(sample, Date.now());
    if (!r) return;
    if (r.milestone) this.DETECTOR_Milestone(r.milestone);
    if (!r.changed || !r.state) return;
    const prev = this._localWorkState;
    if (r.state === prev) return;
    this._localWorkState = r.state;
    // 心情联动。幅度比文档 2.5 收窄：真实窗口切换远比 DSH 事件频繁，
    // 用原设计的 +3/+12 会几分钟把心情顶满，反而失去意义。
    if (this.mood && this.mood.enabled) {
      let ev = null;
      if (r.state === 'working' && prev !== 'working') ev = 'workStart';
      else if (r.state === 'result' && prev === 'working') ev = 'workSlack';
      else if (r.state === 'thinking' && prev === 'result') ev = 'backToWork';
      if (ev) {
        const to = this.mood.event(ev);
        if (to) this.moodCue(to);
        this.renderMood();
        this.moodSaveThrottled();
      }
    }
    // 驱动动画：复用宿主那条链路的同一个函数（气泡驻留 / 循环语义完全一致）
    window.__dshPetWorkTick = (window.__dshPetWorkTick || 0) + 1;
    this.onWorkTick({ state: r.state, task: null }, window.__dshPetWorkTick);
  }

  /** 久坐里程碑：25 分钟（完成一段）/ 50 分钟（该休息了）。 */
  DETECTOR_Milestone(kind) {
    const isLong = kind === 'longDone';
    if (this.mood && this.mood.enabled) {
      const to = this.mood.event(isLong ? 'workBigSuccess' : 'workSuccess');
      if (to) this.moodCue(to);
      this.renderMood();
      this.moodSaveThrottled();
    }
    console.info('[dsh-pet] 久坐里程碑：' + (isLong ? '50 分钟，该休息了' : '25 分钟，完成一段'));
  }

  /** 用户交互（拖拽 / 点击）时中断工作状态，剩余次数清零。 */
  WORK_Break() {
    if (this.WORK_Timer !== null) { window.clearTimeout(this.WORK_Timer); this.WORK_Timer = null; }
    if (!this.WORK_On && !this.WORK_Busy) return;
    this.WORK_On = false;
    this.WORK_Busy = false;
    this.WORK_Left = 0;
    this.WORK_Idle_At = performance.now();
  }

  /** 这个动画名在配置里存在吗（坐姿池探测，素材缺失自动剔除）。 */
  hasAnim(name) {
    if (!name) return false;
    const a = this.animations;
    if (!a) return false;
    if ((a.idle || []).includes(name)) return true;
    if ((a.turn || []).includes(name)) return true;
    if ((a.drag || []).includes(name)) return true;
    if ((a.clicks || []).includes(name)) return true;
    if ((a.moves?.actions || []).some((m) => m.name === name)) return true;
    for (const c of a.categories || []) if ((c.actions || []).includes(name)) return true;
    for (const pool of Object.values(a.events || {})) {
      for (const slot of pool) {
        if (typeof slot === 'string' && slot === name) return true;
        if (Array.isArray(slot) && slot.includes(name)) return true;
      }
    }
    return false;
  }

  scheduleNextIdle() {
    if (this.gapTimer) return; // 已经排了一个，别叠

    // 从 localStorage 读「播放间隔」。选「无间隔」(0) = 最初的行为：立刻接下一段。
    const gapSec = PET_IDLE_GapSecs(PET_IDLE_GAP_DEFAULT_SEC);
    if (!gapSec) { this.playIdle(); return; }

    this.stopMove();

    const breathe = this.animations.idle.includes(PET_IDLE_ANIM)
      ? PET_IDLE_ANIM
      : this.animations.idle[0];
    const warm = !!breathe && this.warmedAnims && this.warmedAnims.has(breathe);

    if (warm) {
      // 已预热：切过去循环播（瞬时，不会闪）。loop=true，她会一直呼吸到时间到。
      this.anim = breathe;
      this.once = false;
      this.switchTo(breathe, false);
    } else {
      // 未预热（只有开机第一次）：不换素材，把当前这段从头重播，同样零加载
      this.replayFront();
    }

    // 一个定时器就够了：到点若还没到期就重播一次当前片段（未预热时），
    // 或什么都不做（已预热时它自己在循环呼吸）。到期才换下一个动作。
    // step 只是"检查频率"。
    const at = Date.now();
    const gapMs = gapSec * 1000;
    const step = Math.min(1000, Math.max(200, Math.round(gapMs / 4)));

    const tick = () => {
      this.gapTimer = null;
      if (this.dragState && (this.dragState.active || this.dragState.dragging)) return;
      if (this.PET_SLEEP_On) return;
      if (Date.now() - at >= gapMs) { this.playIdle(); return; }
      if (!warm) {
        // 只在当前片段播完（或接近结尾）时才从头重播。
        // 之前是每个 tick 都 replayFront() —— 间隔 3 秒时 step=750ms，
        // 动画每 750ms 就被倒回开头，永远播不完（"卡在开头几秒"的根源）。
        const el = this.front === 0 ? this.videoA : this.videoB;
        if (el && (el.ended || (Number.isFinite(el.duration) && el.duration > 0 && el.currentTime >= el.duration - 0.15))) {
          this.replayFront();
        }
      }
      this.gapTimer = window.setTimeout(tick, step);
    };

    this.gapTimer = window.setTimeout(tick, step);
  }

  /** 当前前台视频从头重播。不改 src，所以没有加载空窗。
   *
   * 关键：这里**不能**把 loop 改成 true、也不能清 onended。
   * 停顿发生在 handleEnded 之后 —— 一旦把 once 的片段改成循环并摘掉 ended 回调，
   * 这个 video 就再也不会触发 onended，动画链从此断掉（表现为"播完卡住不动"）。
   * 所以只重置播放位置，loop / onended 一律交给原状态。
   */
  replayFront() {
    const el = this.front === 0 ? this.videoA : this.videoB;
    if (!el) return;
    try {
      el.currentTime = 0;
      el.play().catch(() => {});
    } catch { /* 已销毁 */ }
  }

  /** 取消排队中的停顿（交互开始时调用）。 */
  clearGap() {
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
  }

  // 互动/事件动画播完后恢复 workStatus 档位循环：非终态 → 按当前状态档位重选动画（多候选档内
  // 随机并避开当前段）；终态/空闲 → false 不接管，调用方走原逻辑（回 idle / 随机池，与浏览器一致）。
  resumeWorkStatusAnim() {
    const state = this.workState;
    if (!state || state === 'success' || state === 'error') return false;
    const pool = this.animations.events?.workStatus;
    // 单候选档位不再无限 loop（见 events.js onWorkTick 注释）。这里控制交替节奏：
    // 每播完 2 段工作动画，插一次随机待机，让"平常动作"继续出现。
    // 为什么是 2：工作动画单段约 3~5 秒，2 段≈8 秒 —— 既有持续工作感，
    // 又不至于让随机链消失太久；用户切窗口频率远高于 8 秒，切换时计数会重置。
    if (this.workInterleave === undefined) this.workInterleave = 0;
    this.workInterleave += 1;
    if (this.workInterleave > 2) {
      this.workInterleave = 0;
      return false; // 交给调用方走随机链
    }
    if (!pool || pool.length === 0) return false;
    const idx = S.WORK_STATUS_INDEX[state];
    const slot = pool[idx];
    if (slot === undefined) return false;
    const name = S.pickSlot(slot, this.anim); // 避开当前正播动画（避免连续重复）
    console.log(
      '[dsh-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + this.pet.id + ' 恢复工作状态动画: ' + name,
    );
    const rotating = Array.isArray(slot) && slot.length > 1;
    if (rotating)
      this.playOnce(name); // 多候选：播完由 handleEnded 轮换
    else this.switchTo(name, false); // 单候选：无限循环
    return true;
  }

  // ---- 漫游（rAF 驱动，动画首尾各 leadSec/tailSec 秒原地不动；几何在 shared/planMove） ----
  // preferredName 传入时固定使用该动画（右键菜单点播移动动画），否则与随机链一致随机选
  tryMove(preferredName) {
    if (this.moveRef !== null || this.pendingMove || this.throwRef !== null) return true;
    const moves = this.animations.moves;
    const actions = moves.actions;
    if (!actions.length) return false;
    const chosen = preferredName
      ? actions.find((a) => a.name === preferredName) || null
      : actions[Math.floor(Math.random() * actions.length)];
    if (!chosen) return false;
    const mp = Object.assign({}, moves.default, chosen.params || {});
    const dir = (this.facing === 'right') !== this.animations.turn.includes(this.anim) ? 1 : -1;
    const W = VIEW.w;
    const H = VIEW.h;
    const distScale = this.size / S.PET_REF_WIDTH;
    const plan = S.planMove({
      cx: this.currentCenterX(),
      cy: this.currentCenterY(),
      W,
      H,
      dir,
      minDist: mp.minDist * distScale,
      maxDist: mp.maxDist * distScale,
      margin: mp.margin, // 同 position() 的 marginX/marginY：页面级缩放统一放大，配置值不再乘 scale（§3.5）
      halfW: this.halfW,
      sideAllow: this.sideAllow,
      // 落点按显示器并集判定：能骑缝跨屏走，但走不进外接矩形里的空洞
      areas: AREAS,
    });
    if (!plan) return false;
    this.pendingMove = { ...plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.anim = chosen.name;
    this.once = true;
    this.switchTo(chosen.name, true);
    return chosen.name;
  }

  startMoveDrive(el) {
    const pm = this.pendingMove;
    if (!pm || this.moveRef !== null) return;
    this.pendingMove = null;
    const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const W = VIEW.w;
    const H = VIEW.h;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let ratioX;
      if (t <= leadSec) ratioX = startRatio;
      else if (t >= duration - tailSec) ratioX = targetRatio;
      else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
      // 移动的是窗口（宠物包围盒跟随），sprite 在本窗口内不动
      this.sendBounds(ratioX * W - this.halfW, startYRatio * H - this.halfH);
      if (t < duration - tailSec) {
        this.moveRef = requestAnimationFrame(step);
      } else {
        this.moveRef = null;
        this.customPos = { rx: targetRatio, ry: startYRatio };
      }
    };
    this.moveRef = requestAnimationFrame(step);
  }

  stopMove() {
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
  }

  // ---- 拖拽抛掷物理（弹簧跟手 + 甩抛 + 重力反弹；与浏览器 pet.ts 同构）----
  stopDragFollow() {
    this.dragFollowToken++;
    if (this.dragFollow !== null) {
      cancelAnimationFrame(this.dragFollow);
      this.dragFollow = null;
    }
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
  }

  /** rAF 弹簧跟随：窗口朝拖拽目标过阻尼追赶（不再硬贴指针），抹平高频抖动 */
  startDragFollow() {
    if (this.dragFollow !== null) return;
    const token = ++this.dragFollowToken;
    let last = performance.now();
    const step = () => {
      if (this.dragFollowToken !== token) return;
      const target = this.dragTarget;
      if (!target) {
        this.dragFollow = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const vel = this.dragVel;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = S.springStep(vel.vx, x, target.x, dt, this.physics.throwPower);
      vel.vy = S.springStep(vel.vy, y, target.y, dt, this.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y); // 移动的是窗口（this.pos 实时更新）；sprite 在本窗口内不动
      this.dragFollow = requestAnimationFrame(step);
    };
    this.dragFollow = requestAnimationFrame(step);
  }

  /** 停止抛掷（空中被抓/点菜单/回家时立即定格在当前落点）。
   *  同时清速度状态 throwState——否则「抓住后温柔放下」会残留最后一次飞行速度，
   *  静止的宠物点一下就误判为飞行中。点击积分用的飞行动态由 onPointerDown 提前记录。 */
  stopThrow() {
    this.throwToken++;
    if (this.throwRef !== null) {
      cancelAnimationFrame(this.throwRef);
      this.throwRef = null;
    }
    this.throwState = null;
  }

  /** 抛掷驱动：重力 + 边缘反弹 + 落地摩擦，落定后写入 customPos */
  startThrow(px, py, vx, vy) {
    this.stopDragFollow();
    this.stopMove();
    // 边界 = 显示器工作区**并集**：空洞是墙（宠物再也飞不进不可见区域），屏缝不是墙（跨屏弹跳照旧）
    // confineToScreen 开启时改为锁定**松手这一刻所在的那块屏**：屏缝同样当墙，只在目标屏内弹。
    // 锁定屏在抛掷开始时定下、飞行途中不重取；relayout 改了屏数时由 throwStepRegion 退回不锁定。
    const lockScreen = this.confineToScreen ? S.screenOfBox(this.throwSpaceOf(), px, py) : -1;
    const token = ++this.throwToken;
    let state = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false; // 落地 Q 弹：只在空中→地面转换帧触发一次
    const step = () => {
      if (this.throwToken !== token) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fallingVy = state.vy; // 本帧积分前的竖直速度（正=下落）：即落地冲击速度
      // 每帧重取：显示器变化时 relayout() 会让缓存失效，res.screen 必须与这一份对应
      const sp = this.throwSpaceOf();
      const res = S.throwStepRegion(state, dt, sp, this.physics, lockScreen);
      state = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      this.throwState = state;
      // 上报飞行状态（节流 ~30ms）：主进程 broker 汇聚后广播，其它窗口用它做跨窗碰撞检测；
      // broker 协议单位 = 物理像素，这里 ×scale（§3.5 收口）
      if (window.petBridge && window.petBridge.reportFlight && now - this.lastFlightReport > 30) {
        window.petBridge.reportFlight({
          x: toScreen(state.x),
          y: toScreen(state.y),
          vx: toScreen(state.vx),
          vy: toScreen(state.vy),
          size: toScreen(this.size),
          bottomPad: toScreen(this.bottomPad),
        });
        this.lastFlightReport = now;
      }
      // 宠物间碰撞（仅 petCollision 开启）：飞行中的自己撞到其它宠物 → 动量弹开
      if (this.physics && this.physics.petCollision) {
        const myBody = S.bodyPixelBox({ x: state.x, y: state.y, size: this.size, bottomPad: this.bottomPad });
        for (const pid of Object.keys(this.others)) {
          const o = this.others[pid];
          if (!o || !o.size) continue;
          const otherBody = S.bodyPixelBox({ x: o.x, y: o.y, size: o.size, bottomPad: o.bottomPad });
          if (!S.rectsOverlap(myBody, otherBody)) continue;
          const hit = S.collidePet(
            { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: this.size },
            { x: o.x, y: o.y, vx: o.vx, vy: o.vy, size: o.size },
          );
          if (hit) {
            // 飞行方：按动量结果继续弹开；被撞方：主进程转发给目标窗口 → 目标窗 startThrow
            state.vx = hit.fvx;
            state.vy = hit.fvy;
            this.throwState = state;
            if (window.petBridge && window.petBridge.reportCollide) {
              // 被撞方初速同为 broker 物理像素协议：×scale（§3.5 收口）
              window.petBridge.reportCollide(pid, toScreen(hit.hvx), toScreen(hit.hvy));
            }
            break; // 一帧只处理一次碰撞（避免连锁触发抖动）
          }
        }
      }
      this.sendBounds(res.x, res.y);
      // 落地 Q 弹：只在空中→地面转换帧触发一次，力度随冲击速度（轻落 0.8 ~ 重砸 0.55）。
      // 「地面」是**当前所在屏**的底边——多屏各有各的地面高度
      const curBounds = sp.bounds[res.screen] || sp.bounds[0];
      const grounded = curBounds ? res.y >= curBounds.maxY - 1 : false;
      if (res.bounced && grounded && !prevGrounded) {
        const frontEl = this.front === 0 ? this.videoA : this.videoB;
        this.startSquash(frontEl, S.landingSquash(fallingVy));
      }
      prevGrounded = grounded;
      if (res.atRest) {
        this.throwRef = null;
        this.throwState = null;
        this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
        return;
      }
      this.throwRef = requestAnimationFrame(step);
    };
    this.throwRef = requestAnimationFrame(step);
  }

  /** 被撞回调（跨窗碰撞 broker 转发）：停当前动作，从落点以新初速抛出去（全复用现有物理） */
  onDeskHit(vx, vy) {
    this.stopMove();
    this.stopDragFollow();
    this.stopThrow();
    this.startThrow(this.pos.x, this.pos.y, vx, vy);
  }

  /** Q 弹挤压：前台视频垂直压扁（贴地锚定，transform-origin:bottom）再回弹；
   *  与浏览器同构，曲线在 shared（S.squashScale）。depth = 下压幅度（点击固定 0.55；
   *  落地按冲击速度 S.landingSquash 动态取）。reduce-motion 时跳过。 */
  startSquash(el, depth = S.SQ_SQUASH) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const token = ++this.squashToken;
    if (this.squashRef !== null) cancelAnimationFrame(this.squashRef);
    const origin = el.style.transformOrigin;
    el.style.transformOrigin = 'bottom';
    const t0 = performance.now();
    const step = () => {
      if (this.squashToken !== token) return;
      const u = Math.min((performance.now() - t0) / S.SQ_DURATION_MS, 1);
      const scale = S.squashScale(u, depth);
      el.style.transform = (this.facing === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scale + ')';
      if (u < 1) {
        this.squashRef = requestAnimationFrame(step);
      } else {
        this.squashRef = null;
        el.style.transformOrigin = origin;
        // 恢复纯镜像（若期间 switchTo 重置过 transform，也以镜像为准）
        el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      }
    };
    this.squashRef = requestAnimationFrame(step);
  }

  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  }

  // ---- 点击 vs 拖拽（与浏览器一致：阈值/抓取偏移/释放回循环待机；移动的是窗口） ----
  onPointerDown(e) {
    // 用户开始交互：取消排队中的"停顿后播下一段"，
    // 否则拖到一半/刚点完，她会自己蹦出下一个随机动作。
    this.clearGap();
    // 被碰了就别再自己忙活：中断空闲触发的工作状态，剩余次数清零（下次空闲重新 3 个）。
    this.WORK_Break();
    // 交互打断正在播的投喂/菜单点播动画：清掉它的锁。否则锁会一直残留
    // （this.anim 已被拖拽动画替换，条件永远不匹配，锁永远清不掉 —— 无害但脏）。
    this.PET_FEED_Clip = null;
    // 记录本次按下是否为唤醒 —— 唤醒只发生在这里（按下的瞬间），
    // 随后的 click 读它来决定只收尾、还是播点击回应动画。
    this.PET_SLEEP_WokeByClick = this.PET_SLEEP_WasAsleep();
    if (this.PET_SLEEP_WasAsleep()) { this.PET_SLEEP_Touch(); return; }
    this.PET_SLEEP_Touch();
    // 心情：被拎起来它不高兴（-4）。写在 pointerdown 而不是松手：拎一下就该不高兴，
    // 而不是等甩出去才算；且 pointerdown 每次抓起都会走到，不会漏掉"只是拎着没甩"。
    this.lastInteractionAt = Date.now();
    const grabMood = this.mood.event('throwDrag');
    if (grabMood) this.moodCue(grabMood);
    this.renderMood();
    this.moodSaveThrottled();
    // 只认左键：右键进入拖拽判定会与右键菜单打架（右键不拖拽，两端一致）
    if (e.button !== 0) return;
    // 抓取速度日志：stopThrow 之前读，否则飞行速度就没了；静止时记录 0（与浏览器同构）
    const grabState = this.throwState;
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' grab vx=' +
        (grabState ? Math.round(grabState.vx) : 0) +
        ' vy=' +
        (grabState ? Math.round(grabState.vy) : 0) +
        ' |v|=' +
        (grabState ? Math.round(Math.hypot(grabState.vx, grabState.vy)) : 0),
    );
    // 点击积分：**按下瞬间即触发**（不等松开）。读取 stopThrow 之前的飞行速度，
    // 在飞行中且达标 → 立即粒子爆发 + 积分弹窗；pressScoreFired 标记本次按下已触发，
    // 松开的 click 据此不再重复弹、也不再播普通点击动画（与浏览器同构）。
    this.pressScoreFired = false;
    if (grabState) {
      const grabSpeed = Math.hypot(grabState.vx, grabState.vy);
      if (grabSpeed >= S.SCORE_MIN_SPEED) {
        this.pressScoreFired = true;
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' click-score speed=' +
            Math.round(grabSpeed) +
            ' size=' +
            this.size +
            ' -> +' +
            S.clickScore(grabSpeed, this.size),
        );
        S.spawnScoreBurst(e.clientX, e.clientY);
        S.mountScorePopup({
          x: e.clientX,
          y: e.clientY,
          score: S.clickScore(grabSpeed, this.size),
          speed: grabSpeed,
          size: this.pet.size,
        });
      }
    }
    this.stopThrow(); // 空中抓取：从当前落点开始新拖拽（this.pos 实时）
    this.stopDragFollow();
    this.stopMove();
    this.dragTrail = [];
    this.hit.classList.add('dragging');
    this.stopMove();
    try {
      this.hit.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略捕获失败 */
    }
    // 记录【按下时的指针屏幕坐标】与【按下时的宠物窗口位置】——之后全部用 e.screenX/Y
    // 做增量：指针屏幕坐标与窗口位置无关，不受窗口被逐帧移动影响（window.screenX 会滞后/缓存）。
    // 屏幕坐标是物理像素，除以 CONFIG.scale 进 CSS 系（§3.5）——增量公式两边同一单位。
    this.dragState = {
      active: true,
      dragging: false,
      sx: toLocal(e.screenX),
      sy: toLocal(e.screenY),
      petX: this.pos.x,
      petY: this.pos.y,
    };
    // 拖拽信号（桌面端专有）：主进程的兜底穿透通道按**光标与窗口矩形**判定，而窗口比宠物身体大一圈；
    // 拖拽中宠物滞后于光标，光标可能跑到窗口外→窗口翻回穿透→本窗口收不到 pointermove/pointerup
    // （宠物"飞"出去，见 pointer-target.js）。这里上报"我正在用输入"，主进程据此绝不翻回穿透。
    this.syncInputBusy();
    // 注意：舞台「拍平」（去掉 translateY(bottomPad)）不能在这里做——
    // 纯点击（按下即松开）会让人物瞬移上移再落下。与浏览器一致：只有拖拽超过阈值才拍平。
  }

  onPointerMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    // 阈值判定用屏幕坐标增量（clientX 会随窗口移动而变化，屏幕坐标稳定）；屏幕坐标 ÷scale 进 CSS 系
    const dx = toLocal(e.screenX) - d.sx;
    const dy = toLocal(e.screenY) - d.sy;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;
      d.dragging = true;
      // 真正开始拖拽才把舞台拍平（人物随光标拿起；与浏览器 dragging 语义一致）
      this.stage.style.transform = 'none';
      if (this.animations.drag.length) {
        this.playOnce(S.pick(this.animations.drag));
      }
      this.syncInputBusy(); // 拖拽成立：主进程兜底通道闭嘴（见 inputBusy）
    }
    // 记录指针轨迹（screenX/Y 采样：与视口坐标只差常数偏移，速度一致；初速估算用；÷scale 进 CSS 系）
    const now = performance.now();
    this.dragTrail.push({ t: now, x: toLocal(e.screenX), y: toLocal(e.screenY) });
    this.dragTrail = S.trimTrail(this.dragTrail, now);
    // 弹簧目标 = 按下时的宠物位置 + 指针屏幕增量（窗口怎么动都不影响坐标）——不再硬贴指针，
    // 由 rAF 弹簧跟随逐帧追赶（抹平高频抖动，与浏览器同构）
    this.dragTarget = { x: d.petX + dx, y: d.petY + dy };
    this.startDragFollow();
  }

  onPointerUp(e) {
    const d = this.dragState;
    const wasDragging = d.dragging;
    d.active = false;
    d.dragging = false;
    this.hit.classList.remove('dragging');
    this.stopDragFollow(); // 弹簧跟随立即停（位置定格在实时 this.pos）
    this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.syncInputBusy(); // 拖拽结束：交还给常规判定（幂等，非拖拽时多调一次不发 IPC）
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      if (e && Number.isFinite(e.screenX)) {
        // 原始输入留痕（实机排查用：验证指针屏幕坐标与窗口位移是否一致，如 DPI 缩放问题）
        window.__dshPetDebug.lastDragRaw = {
          petX: d.petX,
          petY: d.petY,
          sxDown: d.sx,
          syDown: d.sy,
          xUp: e.screenX,
          yUp: e.screenY,
        };
      }
      // 拖拽松手：workStatus 非终态时恢复状态循环，否则回 idle（与浏览器 handlePointerUp 一致）
      // 修复：旧实现 switchTo(idle,false)（loop=true，ended 永不触发）→ 随机链永远回不来，
      // 永远卡在同一段待机动画；改为 playOnce（once=true）播一遍 → ended → handleEnded → playIdle 随机链
      if (!this.resumeWorkStatusAnim()) {
        if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
      }
      // 释放位置 = 弹簧跟随后的实际包围盒左上角（this.pos 实时；不是指针目标——
      // 跟手滞后时落点跟随宠物实际位置，与浏览器 boxPx 同语义）
      const px = this.pos.x;
      const py = this.pos.y;
      // 初速估算：够快就抛掷（重力+边缘反弹+落地摩擦），否则原地放下
      const vel = S.estimateReleaseVelocity(this.dragTrail, performance.now(), this.physics);
      this.dragTrail = [];
      if (vel) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' release vx=' +
            Math.round(vel.vx) +
            ' vy=' +
            Math.round(vel.vy) +
            ' |v|=' +
            Math.round(Math.hypot(vel.vx, vel.vy)),
        );
        this.startThrow(px, py, vel.vx, vel.vy);
      } else {
        // customPos 语义 = 宠物**中心**比例（position() 用 rx*W - halfW 还原左上角；
        // startThrow 落定也按同一公式存），松手无边界夹取
        this.customPos = { rx: (px + this.halfW) / VIEW.w, ry: (py + this.halfH) / VIEW.h };
        this.position();
        // 释放后的最终窗口位置（position() 换算后，松手无夹取），冒烟断言"释放不位移"用
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
      }
    }
  }

  // ---- 点击穿透（严格对齐浏览器：只有身体命中区可交互，透明像素穿透到下层应用） ----
  /**
   * 本窗口是否**必须保持可交互**（= "我正在用这个窗口的鼠标输入"）。
   *
   * 三个来源：拖拽中 / 右键菜单开着 / 对话弹窗开着——它们都是"窗口内的 DOM 或事件链正在被使用"，
   * 而它们的输入全部来自**窗口级鼠标事件**（pointermove/pointerup/click）：窗口一旦变回穿透，
   * 输入链就断了（拖拽会定格在最后一次采样上，松手也没人报 pointerup → 宠物按旧速度飞出去）。
   *
   * 这个信号是**渲染端专有的知识**：只有它知道"我正在用输入"，主进程无从推断（光看光标位置和窗口
   * 位移分不清"拖拽跟手"和"漫游/抛掷"）。所以由渲染端上报，主进程的兜底通道据此闭嘴。
   */
  inputBusy() {
    return this.dragState.active || this.menuOpen || this.chatOpen;
  }

  /**
   * 上报一次"要不要保持可交互"。**所有**状态变化点都走这里（幂等：值没变不发 IPC）。
   * 与 setInteractive 的分工：setInteractive 表达"光标在不在身体上"（常规判定），
   * 本方法表达"我有没有在用输入"（优先级更高，覆写常规判定）。
   */
  syncInputBusy() {
    const busy = this.inputBusy();
    if (busy === this._inputBusy) return;
    this._inputBusy = busy;
    window.__dshPetDebug.inputBusy = busy;
    if (window.petBridge) window.petBridge.setInputBusy(busy);
  }

  setInteractive(flag) {
    const next = !!flag;
    if (next === this._interactive) return; // 只在状态变化时发 IPC，避免逐帧刷屏
    this._interactive = next;
    window.__dshPetDebug.interactive = next;
    if (window.petBridge) window.petBridge.setInteractive(next);
  }

  onMouseMove(e) {
    // 拖拽中窗口逐帧跟随光标、指针相对窗口坐标会有帧级抖动——强制保持可交互，绝不翻转（翻转会断拖拽）
    if (this.dragState.active) {
      this.setInteractive(true);
      return;
    }
    // 右键菜单/对话弹窗开启：整窗保持可交互（悬停菜单项/点输入框都不触发穿透翻转）；关闭后恢复命中区判定
    if (this.menuOpen || this.chatOpen) {
      this.setInteractive(true);
      return;
    }
    const r = this.hitRect;
    // forwarded 事件坐标以窗口为原点（与页坐标一致）；转换到 sprite 坐标需扣减窗口余量；
    // 异常时退回屏幕坐标 − 窗口屏幕位置推导（hitRect/pos 均为 CSS 系）：屏幕坐标 ÷scale 后
    // 减去窗口屏幕原点（CSS 系）即窗口内坐标
    const wx = Number.isFinite(e.clientX) ? e.clientX : toLocal(e.screenX) - (this.pos.x + VIEW.x - this.margin.l);
    const wy = Number.isFinite(e.clientY) ? e.clientY : toLocal(e.screenY) - (this.pos.y + VIEW.y - this.margin.t);
    const px = wx - this.margin.l;
    const py = wy - this.margin.t;
    this.setInteractive(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  }

  // e = 原生 MouseEvent（分部位触摸要用它的 clientY 算命中区内的纵向比例）。
  // 形参必须显式声明：本文件是 'use strict'，函数体里引用未声明的标识符会直接抛
  // ReferenceError 把整个点击处理干掉（曾经 onClick() 不签名却用了 e，症状就是"点击没反应"）。
  onClick(e) {
    // 按下那一刻已经因为唤醒而起身了：这次 click 只收尾，不再播点击回应。
    // （此前 onPointerDown 先播醒来动画、onClick 下一行又 playOnce(click 池)，
    //   把醒来动作一帧顶掉，看上去就是"点了没反应"。）
    if (this.PET_SLEEP_WokeByClick) {
      this.PET_SLEEP_WokeByClick = false;
      return;
    }
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    // 积分判定已在 onPointerDown（按下即触发）完成：
    // 本次按下已触发过积分 → 只收手停住、**不**再播普通点击动画（粒子+弹窗即反馈，与浏览器同构）
    if (this.pressScoreFired) {
      this.pressScoreFired = false;
      this.stopThrow();
      this.stopMove();
      return;
    }
    this.stopThrow(); // 点击飞行中的宠物 = 收手停住（再播点击回应）
    this.stopMove();
    // 心情：点击 = 逗它（最频繁的开心来源）。跨档时才播引导动画，
    // 连续点也不会每下都打断当前动作刷存在感（与浏览器 pet.ts 同一语义）。
    this.lastInteractionAt = Date.now();
    // 点击 = 陪玩，好感度 +0.5（每天前 10 次，见 affinity.DAILY_RULES）
    this.AFFINITY_Interact('play');
    const clickMood = this.mood.event('click');
    if (clickMood) this.moodCue(clickMood);
    this.renderMood();
    this.moodSaveThrottled();

    // ---- 分部位触摸：点击处的纵向比例 → 部位 → 该部位的池（与浏览器同一份逻辑）----
    // ry 归一化到**命中区内部**（0=区顶 1=区底）。命中区是 this.hit 这个 div，
    // 它按 HIT_BOX 定位在舞台内，所以 getBoundingClientRect 就是身体那一块。
    let ry = 0.5;
    if (e && typeof e.clientY === 'number') {
      const r = this.hit.getBoundingClientRect();
      if (r.height > 0) ry = (e.clientY - r.top) / r.height;
    }
    const zone = S.zoneOf(ry);
    // 同部位连点才递进；换部位或间隔 3 秒重新从 1 数（见 shared/touch.ts）
    const now = Date.now();
    const st = this.touchStreak;
    st.n = st.zone === zone && now - st.at < 3000 ? st.n + 1 : 1;
    st.zone = zone;
    st.at = now;

    // 分部位触摸的池取用：如果当前心情档配了 clicks 替代池，就整体替换 clicks
    // （分部位池 clicksHead/Body/Feet 优先级高于 clicks，见 shared/touch.ts 的 poolForZone）。
    // 这样"开心时被点更开心 / 烦躁时被点更烦"才会在高频点击里体现（P1-2）。
    // 心情池为空 → 原样用 this.animations（等价原行为）。
    const moodClicks = this.moodPoolOrNull('clicks');
    const animsForTouch = moodClicks
      ? { ...this.animations, clicks: moodClicks, clicksHead: [], clicksBody: [], clicksFeet: [] }
      : this.animations;
    const name = S.decideTouch({ zone, anims: animsForTouch, streak: st.n, current: this.anim });
    if (!name) return; // 这个宠物没有任何点击动画
    console.error(
      '[dsh-pet] pet=' + this.pet.id + ' -> [' + S.ZONE_LABEL[zone] + (st.n > 1 ? ' ×' + st.n : '') + '] ' + name,
    );
    this.pendingSquash = true; // 等新点击动画切到前台后 Q 弹（压新首帧，与浏览器一致）
    this.playOnce(name);
  }

  // ---- 右键菜单（统一自绘组件：树+渲染都来自 shared-core 的同一份 menu 模块） ----
  // 菜单/弹窗可视矩形（窗口局部坐标）= 窗口 ∩ 工作区（#41）：宠物贴屏幕底/右时窗口外扩余量
  // 伸出屏幕，窗口内固定定位的菜单/弹窗会走进被屏幕裁掉的部分。把菜单/弹窗约束到这个矩形内
  // 即可完整显示——**窗口和宠物零移动**，不存在跨进程位移竞态，也就不会瞬移闪帧。
  // 退化（可视区过小/窗口整体出屏，光标也点不到宠物）返回 null → 调用方按窗口视口兜底。
  visibleClampRect() {
    // pos 是视口相对坐标，窗口屏幕位置 = pos + VIEW 原点 − 外扩余量（见 sendBounds）；
    // 比较双方都用屏幕坐标（坐标系不混），返回的夹取矩形仍是窗口局部坐标。
    // 夹取用**宠物所在的那块屏**而不是外接矩形：外接矩形含空洞，按它夹菜单会伸进
    // 不属于任何显示器的区域（看不见）；菜单本来也不该跨屏显示。
    const area = S.resolveRect(AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH);
    if (!area) return null;
    const winX = this.pos.x + VIEW.x - this.margin.l;
    const winY = this.pos.y + VIEW.y - this.margin.t;
    const winW = this.size + this.margin.l + this.margin.r;
    const winH = this.winH + this.margin.t + this.margin.b;
    const ax = area.x + VIEW.x;
    const ay = area.y + VIEW.y;
    const vx0 = Math.max(ax, winX);
    const vy0 = Math.max(ay, winY);
    const vx1 = Math.min(ax + area.width, winX + winW);
    const vy1 = Math.min(ay + area.height, winY + winH);
    const w = vx1 - vx0;
    const h = vy1 - vy0;
    if (w < 40 || h < 40) return null;
    return { x: vx0 - winX, y: vy0 - winY, w, h };
  }

  onContextMenu(e) {
    this.PET_SLEEP_Touch();
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged || this.menuOpen) return;
    e.preventDefault();
    this.stopThrow(); // 菜单弹出前停住飞行中的宠物
    this.stopMove(); // 菜单悬停期间宠物不漫游
    // 桌面专属工具根项（碎碎念 / 对话 / 回到初始位置 / 投喂）+ 共享菜单树（动作→分类→具体动画）
    // 碎碎念/对话项无条件显示：手动触发不受 whisperEnabled 限制（该字段只影响自动周期轮询）
    // 「设置」子菜单收配置/维护类：使用说明 / 多开数量 / 睡眠时长 / 播放间隔 / 进入工作状态 /
    // 开机自启动。原「打开网站」已换成「使用说明」——独立打包版没有 DSH webServer，
    // 从 configUrl 推出来的 127.0.0.1 打不开任何有用内容（死入口），改为打开包内网页。
    const tools = [];
    tools.push(
      { label: '碎碎念', action: 'whisper' },
      { label: '对话', action: 'chat' },
      { label: '回到初始位置', action: 'home' },
      // 改配置文件后免去回设置页点保存：请宿主重启桌面 Helper（全部桌面宠物窗口按最新配置重建）。
      // 放在最后：它是"重新加载"这类维护动作，与上面几个宠物互动项语义不同。
      // __petCountMenu: how many copies run at once. Each copy is one entry in
      // the config's pets[]; POST /reload then rebuilds every window.
      //
      // 设置子菜单只收"配置/维护"类选项：使用说明 / 多开数量 / 睡眠时长 / 播放间隔 / 工作 / 自启。
      // 碎碎念、对话、回到初始位置留在顶层——它们是对宠物的互动动作，不是设置。
      // 顶层不再重复列出「重载配置」，避免同一个功能在菜单里出现两次。
      // 固定入口，handler 内部仍会自行校验，所以关着余额也不会出错。
      // 投喂子菜单（P0）：PET_FEED(foodId) 早支持 7 种食物，但菜单只传无参的 'feed'，
      // 导致 6 种食物用户点不到。这里遍历当前生效的食物表，每项 action 带 foodId。
      // 食物表来源：vitals.cfg.foods（用户覆盖）→ sanitizeFoods 兜底（内置 7 种）。
      {
        label: '投喂',
        children: (() => {
          const F = (typeof window !== 'undefined' && window.PET_FOODS) ? window.PET_FOODS : null;
          if (!F) return [{ label: '小鱼干', action: 'feed:fish' }];
          const list = F.sanitizeFoods(
            (this.vitals && this.vitals.cfg && this.vitals.cfg.foods) || undefined);
          return list.map((f) => ({ label: f.name, action: 'feed:' + f.id }));
        })(),
      },
      // 状态面板（第四批）：图形化展示四维状态 + 好感度等级
      { label: '她的状态', action: 'status-panel' },
      {
        label: '设置',
        children: [
          // 使用说明（含赞助码）——「设置」里**置顶**：新用户最先要找的东西。
          // 做成网页（使用说明.html）而非 txt：能排标题/表格/勾叉，赞助码直接嵌在
          // 「制作不易」那行下方，一眼能看到又不会盖住正文。用系统默认浏览器打开。
          { label: '使用说明', action: 'open-help' },
          {
            label: '多开数量',
            children: PET_COUNT_OPTIONS.map((n) => ({ label: String(n), action: 'pet-count:' + n })),
          },
          {
            // 标签带上「当前时段的实际等待时间」，让用户看得到时段规则在起作用。
            // 例：设 10 分钟、当前是深夜 → 显示「睡眠时长（深夜 5 分钟）」
            label: '睡眠时长' + PET_SLEEP_BandHint(),
            children: PET_SLEEP_OPTIONS.map((o) => ({ label: o.label, action: 'pet-sleep:' + o.seconds })),
          },
          {
            // 动作之间的播放间隔：演完后循环播「待机呼吸休闲」等这么久再换下一个。
            // 选「无间隔」= 最初的行为：立刻接下一段。
            label: '播放间隔' + PET_IDLE_GapHint(),
            children: PET_IDLE_GAP_OPTIONS.map((o) => ({ label: o.label, action: 'pet-idle-gap:' + o.seconds })),
          },
          {
            // 手动触发空闲时会做的那串工作动作。等 5 分钟太久的适合用这个。
            label: '进入工作状态',
            action: 'work-now',
          },
          // 开机自启动做成开关：菜单树只认 label/children（没有勾选字段），
          // 所以把当前状态写进标签本身，再用「开启/关闭」两个明确选项 ——
          // 点击前就知道现在是开还是关，也不会出现"点一下不知道切到哪"。
          {
            label: this.autoStartLabel(),
            children: [
              { label: '开启', action: 'autostart:on' },
              { label: '关闭', action: 'autostart:off' },
            ],
          },
          { label: '退出桌宠', action: 'quit' },
        ],
      },
    );
    const tree = tools.concat(S.buildMenuTree(this.animations));
    if (!tree.length) return;
    this.menuOpen = true;
    this.setInteractive(true); // 菜单是窗口内 DOM：悬停期间整窗保持可交互，关闭后恢复命中区穿透
    this.syncInputBusy();
    window.__dshPetDebug.menuOpen = true;
    const m = S.mountContextMenu({
      tree,
      x: e.clientX,
      y: e.clientY,
      // 只允许在「窗口 ∩ 工作区」内显示：宠物贴边时外扩余量伸出屏幕，菜单走进那里会被 OS 裁掉（#41）
      clamp: this.visibleClampRect(),
      onAction: (leaf) => this.onMenuAction(leaf),
      // 菜单被点外/Esc 关闭（非菜单项路径）：同样复位可交互标记，恢复命中区判定
      onClose: () => {
        this.menuOpen = false;
        window.__dshPetDebug.menuOpen = false;
        this.syncInputBusy();
      },
    });
    this.menuClose = m.close;
  }

  // __petCountMenu
  // Which numbers the submenu offers. 1..MAX, capped so the menu stays usable.
  // Size / corner / nickname ladder; extra copies keep shrinking and rotate
  // through the corners so they never land on top of each other.

  /**
   * Resize the pets[] array to `count` entries and reload the host.
   * Preserves every per-pet setting of the pets that survive, so changing
   * 3 -> 2 -> 4 does not lose the size or corner you dragged them to.
   */
  async setPetCount(count) {
    const want = Math.max(1, Math.min(Math.floor(count) || 1, 24));
    try {
      const res = await fetch(BASE + '/config', { cache: 'no-store' });
      if (!res.ok) throw new Error('config http ' + res.status);
      const merged = await res.json();
      const entry = Object.keys(merged)[0];
      const conf = entry ? merged[entry] : null;
      if (!conf || !Array.isArray(conf.pets) || conf.pets.length === 0) {
        console.warn('[dsh-pet] menu pet-count: no pets[] in the config, cannot adjust');
        return;
      }
      if (conf.pets.length === want) return;

      const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
      const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
      const DISPLAYS = ['web', 'desktop', 'both', 'none'];
      const mkPet = (i, src) => {
        const l = PET_COUNT_LADDER[i] || {
          name: PET_COUNT_EXTRA_NAMES[i % PET_COUNT_EXTRA_NAMES.length] +
            (i >= PET_COUNT_EXTRA_NAMES.length ? Math.floor(i / PET_COUNT_EXTRA_NAMES.length) + 1 : ''),
          size: Math.max(70, Math.round(420 * Math.pow(0.82, i))),
          corner: CORNERS[i % CORNERS.length],
        };
        const pos = (src && src.position) || {};
        const corner = CORNERS.includes(pos.corner) ? pos.corner : l.corner;
        return {
          id: i === 0 ? 'main' : 'pet' + i,
          name: typeof (src && src.name) === 'string' && src.name.trim() ? src.name : l.name,
          size: Math.max(20, num(src && src.size, l.size)),
          balanceEnabled: src && typeof src.balanceEnabled === 'boolean' ? src.balanceEnabled : i === 0,
          whisperEnabled: src && typeof src.whisperEnabled === 'boolean' ? src.whisperEnabled : i < 2,
          workStatusEnabled: src && typeof src.workStatusEnabled === 'boolean' ? src.workStatusEnabled : i === 0,
          fixedEnabled: src && typeof src.fixedEnabled === 'boolean' ? src.fixedEnabled : false,
          display: src && DISPLAYS.includes(src.display) ? src.display : 'desktop',
          position: {
            corner: corner,
            marginX: num(pos.marginX, 32),
            marginY: num(pos.marginY, 96),
          },
        };
      };

      const pets = [];
      for (let i = 0; i < want; i++) pets.push(mkPet(i, conf.pets[i]));

      // PUT /config takes a BARE { pets: [...] } body: saveUserConfig reads
      // raw.pets, not the aggregated { <entry>: {...} } shape that GET returns.
      const put = await fetch(BASE + '/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pets: pets }),
      });
      if (!put.ok) {
        console.error('[dsh-pet] menu pet-count: PUT /config http ' + put.status +
          ' ' + (await put.text()).slice(0, 200));
        return;
      }
      await fetch(BASE + '/reload', { method: 'POST' });
      console.info('[dsh-pet] menu pet-count: set to ' + want);
    } catch (e) {
      console.error('[dsh-pet] menu pet-count failed', e);
    }
  }

  onMenuAction(leaf) {
    this.closeMenu();
    if (!leaf || typeof leaf !== 'object') return;
    if (leaf.action === 'open-help') {
      // 使用说明（含赞助码）——网页版：使用说明.html + 赞助码.jpg + logo.png 同放在
      // 桌宠文件夹根目录。路径由**主进程**拼（它知道包根，渲染端不知道），
      // 渲染端只发语义动作。主进程用 shell.openExternal 开 file:// —— 稳定落到系统默认
      // 浏览器（openPath 会把 .html 交给"默认程序"，有些机器是编辑器，那就看到源码了）。
      if (window.petBridge && window.petBridge.openHelpPage) {
        console.error('[dsh-pet] open-help: calling openHelpPage()');
        window.petBridge.openHelpPage();
      } else {
        console.error('[dsh-pet] open-help: petBridge.openHelpPage 不可用');
        this.showMenuNotice('当前模式不支持打开说明页面');
      }
      return;
    }
    if (leaf.action === 'show-balance') {
      this.showBalanceFromMenu(); // 立即拉余额并展示（无需等 1s 触发轮询，展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'whisper') {
      this.showWhisperFromMenu(); // 立即让 host 强制新生成一句并展示（绕过节流；展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'chat') {
      this.showChatFromMenu(); // 打开对话弹窗（记忆经 host /chat 读写，浏览器/桌面同一实例共享）
      return;
    }
    if (leaf.action === 'home') {
      this.goHome(); // 停漫游/移动，清会话位置，回配置角落
      return;
    }
    // 开机自启动开关：菜单里是两个明确选项，这里只负责设成想要的值。
    // 每次都先读回真实状态再写，写不进去会如实报错，不会假装成功。
    if (leaf.action === 'autostart:on' || leaf.action === 'autostart:off') {
      this.setAutoStart(leaf.action === 'autostart:on');
      return;
    }
    // 退出桌宠：关掉宿主与窗口，直接结束进程
    if (leaf.action === 'quit') {
      this.quitPet();
      return;
    }
    // __petCountMenu: set the copy count, then let the host rebuild the windows.
    // 菜单选了睡眠时长：存下来, 立刻重置计时, 醒了继续待机
    if (typeof leaf.action === 'string' && leaf.action.startsWith('pet-sleep:')) {
      const secs = parseInt(leaf.action.slice('pet-sleep:'.length), 10);
      this.PET_SLEEP_Set(secs);
      return;
    }
    // 动作节奏设置：存 localStorage 即可，不用重载配置。
    if (typeof leaf.action === 'string' && leaf.action.startsWith('pet-idle-gap:')) {
      PET_IDLE_SaveGap(parseInt(leaf.action.slice('pet-idle-gap:'.length), 10));
      return;
    }
    // 手动触发工作状态：和空闲 5 分钟自动触发走同一条路径（同一个 WORK_Start）。
    if (leaf.action === 'work-now') {
      this.WORK_Break();   // 先清掉可能正在跑的一轮，避免重入
      this.WORK_Start();
      return;
    }
    if (typeof leaf.action === 'string' && leaf.action.startsWith('pet-count:')) {
      this.setPetCount(parseInt(leaf.action.slice('pet-count:'.length), 10));
      return;
    }
    // 投喂: 播吃小鱼干, 随后冒一句台词（走 host, 气泡槽与碎碎念共用）
    // 投喂：'feed'（旧菜单/无参数）与 'feed:<foodId>'（子菜单）都命中
    if (leaf.action === 'feed' || leaf.action.startsWith('feed:')) {
      const foodId = leaf.action === 'feed' ? undefined : leaf.action.slice(5);
      this.PET_FEED(foodId);
      this._feedCount = (this._feedCount || 0) + 1;
      return;
    }
    // 状态面板（第四批）：图形化展示四维状态 + 好感度等级
    if (leaf.action === 'status-panel') {
      this.closeMenu();
      this.PANEL_Open();
      return;
    }
    if (!leaf.anim) return;
    // 睡眠三段优先走状态机(躺下→呼吸循环→唤来)。
    // 注意：不能先置 PET_SLEEP_On=false 再进 FromMenu —— FromMenu 开头有
    // `if (this.PET_SLEEP_On) return;` 守卫，先置 false 会让它直接返回，点菜单无效果。
    if (leaf.anim === PET_SLEEP_IN || leaf.anim === PET_SLEEP_LOOP || leaf.anim === PET_SLEEP_WAKE) {
      this.PET_SLEEP_FromMenu(leaf.anim);
      return;
    }
    // 文字类(noMirror)朝右站姿是镜像的: 点播前强制朝左
    if (S.isNoMirrorAnimation(this.animations.categories, leaf.anim) && this.facing === 'right') {
      this.facing = 'left';
    }
    // 移动类动画: 走真实移动, 挪不动则退化纯播放
    if (this.animations.moves.actions.some((a) => a.name === leaf.anim)) {
      if (this.tryMove(leaf.anim) === false) this.playOnce(leaf.anim);
      return;
    }
    // 其余(投饲/点击回应等)带锁连播: 播完才交回随机链
    // 睡着时点播任意动画 = 用户主动操作：先唤醒，避免在睡眠标记里播其它动画（会卡死睡眠链）。
    this.PET_SLEEP_Wake();
    this.PET_FEED_Play(leaf.anim);
  }

  /**
   * 菜单上显示的开关状态文字。
   * 菜单树是同步构建的，拿不到异步的注册表查询结果，所以这里读**上次查询的缓存**：
   * 构造时查一次、每次改动后再查一次，因此显示的状态始终是最近一次的真实值。
   */
  autoStartLabel() {
    if (this.autoStartOn === undefined) return '开机自启动：读取中…';
    return this.autoStartOn ? '开机自启动：已开启 ✓' : '开机自启动：已关闭';
  }

  /** 启动时查一次真实状态，供菜单显示。 */
  async refreshAutoStart() {
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.getAutoStart !== 'function') {
      this.autoStartOn = false;
      return;
    }
    try {
      const r = await bridge.getAutoStart();
      this.autoStartOn = !!(r && r.enabled);
    } catch {
      this.autoStartOn = false;
    }
  }

  /**
   * 把开机自启动设成 want。
   * 写完后**回读**确认（主进程会再查一次注册表），只有回读一致才算成功 ——
   * 不靠本地变量记状态，才不会出现"菜单显示已开、实际没写进去"。
   */
  async setAutoStart(want) {
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.setAutoStart !== 'function') {
      this.showMenuNotice('这个版本不支持开机自启动');
      return;
    }
    try {
      const r = await bridge.setAutoStart(want);
      if (r && r.ok) {
        this.autoStartOn = want;
        this.showMenuNotice(want ? '已开启开机自启动' : '已关闭开机自启动');
      } else {
        // 写失败时状态可能没变，回读一次以免菜单显示错
        await this.refreshAutoStart();
        this.showMenuNotice('设置失败：' + ((r && r.error) || '未知原因'));
      }
    } catch (e) {
      await this.refreshAutoStart();
      this.showMenuNotice('设置失败：' + (e && e.message ? e.message : e));
    }
  }

  /** 退出桌宠：交给主进程关掉宿主与窗口。 */
  quitPet() {
    const bridge = window.petBridge;
    if (bridge && typeof bridge.quitPet === 'function') {
      bridge.quitPet();
      return;
    }
    this.showMenuNotice('这个版本不支持退出，请用任务管理器结束 electron.exe');
  }

  /** 菜单操作的即时反馈：复用气泡槽，几秒后自动消失。 */
  showMenuNotice(text) {
    try {
      if (this.bubble) {
        // 完整走碎碎念气泡的渲染契约：whisperOn 决定气泡槽位，whisperView 提供文案，
        // 定时器负责收起。只设 whisperText 的话 renderBubble 会读 whisperView[0] 出错，
        // 气泡根本弹不出来（这是之前"菜单提示静默"的原因）。
        this.whisperOn = true;
        this.whisperImage = '';
        this.whisperView = [{ text }];
        if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
        this.whisperTimer = window.setTimeout(() => {
          this.whisperOn = false;
          this.renderBubble();
        }, 4000);
        this.renderBubble();
      }
    } catch { /* 气泡不可用也不影响功能本身 */ }
    console.info('[dsh-pet] ' + text);
  }

  closeMenu() {
    if (this.menuClose) {
      this.menuClose();
      this.menuClose = null;
    }
    this.menuOpen = false;
    window.__dshPetDebug.menuOpen = false;
    this.syncInputBusy(); // 菜单关：若没有别的占用（拖拽/弹窗）则交还常规判定
  }

  // （0 延迟，不用等下一个 1s；展示走 showBalanceNow/showBalanceNotice 同一路径）。
  // 注意这里不再直接拉余额：数据只有一个出口（S），菜单只负责"让它刷新"。
  showBalanceFromMenu() {
    if (!this.pet.balanceEnabled) return;
    S.postAction(BALANCE_URL)
      .then((ok) => {
        if (!ok) console.warn('[dsh-pet] 菜单查看余额：刷新动作未成功');
        pollStateNow(); // 立即拉一拍：结果 0 延迟可见（失败也会由 /state 里的 ok:false 弹文字说明）
      })
      .catch((e) => {
        console.error('[dsh-pet] 菜单查看余额异常', e);
      });
  }

  // 「碎碎念」菜单：POST 动作让 host 立即新生成一句（写进 S），随即立刻跑一拍 /state 拿文本展示
  // （0 延迟，不用等下一个 1s）。动作不回文本——文本只有一个出口（S）。
  // 手动触发不受 whisperEnabled 限制——该字段只关自动周期，手动永远可用。
  showWhisperFromMenu() {
    S.postAction(WHISPER_URL + '?pet=' + encodeURIComponent(this.pet.id))
      .then((ok) => {
        if (!ok) console.warn('[dsh-pet] 菜单碎碎念：生成动作未成功 pet=' + this.pet.id);
        pollStateNow(); // 立即拉一拍：文本随这一拍到达并展示
      })
      .catch((e) => {
        console.warn('[dsh-pet] 菜单碎碎念异常', e);
      });
  }

  // 「对话」菜单：最简输入框（shared 组件，与浏览器同一份）——回车发送后弹窗消失，
  // 回复用**碎碎念同款显示**（说话动画 + 白色气泡 10s），只多一步用户输入。
  // 记忆经 host /chat 读写（memory.json，同一实例的浏览器/桌面共享同一份）。
  // 弹窗跟随宠物：基准是**身体命中区** this.hit（与气泡同一定位源——桌宠在视频中间，
  // 视频框右上角 ≠ 宠物右上角），取身体右上角，超出视口自动夹回（窗口右侧外扩区容纳）；
  // 弹窗是窗口内 DOM，期间整窗保持可交互（可点输入框），关闭后恢复命中区穿透。
  showChatFromMenu() {
    if (this.chatClose) {
      this.chatClose();
      this.chatClose = null;
      return; // 已开着：先关旧的
    }
    const m = S.mountChatDialog({
      petId: this.pet.id,
      baseUrl: BASE + '/chat',
      x: Math.max(4, this.hit.getBoundingClientRect().right + 6),
      y: Math.max(4, this.hit.getBoundingClientRect().top + 6),
      // 弹窗同菜单：只允许在「窗口 ∩ 工作区」内显示，贴边时不被屏幕裁掉（#41）
      clamp: this.visibleClampRect(),
      onSent: () => {
        // 发送成功：回复已写进 S，立刻跑一拍 /state 让气泡 0 延迟出现（不必等下一个 1s）
        console.info('[dsh-pet] 对话已发送 pet=' + this.pet.id);
        pollStateNow();
      },
      onClose: () => {
        this.chatClose = null;
        this.chatOpen = false;
        window.__dshPetDebug.chatOpen = false;
        this.syncInputBusy(); // 弹窗关：交还常规判定（菜单还开着的话仍保持忙，见 inputBusy）
        if (!this.menuOpen) this.setInteractive(false); // 弹窗关了且无菜单：恢复命中区穿透
      },
    });
    this.chatClose = m.close;
    this.chatOpen = true; // 穿透守卫：弹窗期间整窗保持可交互，光标移到输入框不被翻回穿透
    window.__dshPetDebug.chatOpen = true;
    this.syncInputBusy();
    this.setInteractive(true);
  }

  // 「回到初始位置」菜单：停掉漫游/移动，清掉拖拽/漫游留下的会话位置，回到配置角落
  goHome() {
    this.stopThrow();
    this.stopMove();
    this.customPos = null;
    this.position();
  }

  // 原「重载配置」入口已删除。它只对本窗口发 POST /reload，而这个进程随即被换掉，
  // 响应根本回不来 → 点下去没有任何可见反馈。真正需要重建窗口的「多开数量」
  // 在 setPetCount 内部自己调 POST /reload，不依赖这个菜单项。

  renderBubble() {
    // 气泡单槽：同一时刻只显示一个（优先级：终态任务 > 碎碎念/对话 > 余额 > 非终态任务）。
    // 为什么终态任务不让位：完成/失败气泡只活 10s，被事件顶掉就彻底看不到了；非终态任务气泡
    // 常驻（不设自动收起），让位 10s 零损失。与浏览器 src/client/pet.ts 的单槽优先级同一套。
    // 工作气泡与碎碎念同款弹窗样式：宽度自适应 + 自动换行（is-whisper：正常 white-space、宽随内容）
    // 配图标记交给 CSS：带图时取消 min-width（样式在 shared 的 MEME_BUBBLE_CSS，两端同一份）。
    // 图片 URL 与视频同规则：传 BASE 前缀（桌面是 file:// 页面，必须绝对地址）
    // 素材根同理（配图的归属与动画一致：pet/<素材根>-memes/ 独占 → 用户目录 → 包内）
    const workOn = !!(this.workOn && this.workText);
    const whisperOn = !!(this.whisperOn && this.whisperView);
    const balanceOn = !!(this.bubbleOn && this.balanceView);
    const workTerminal = this.workState === 'success' || this.workState === 'error';
    const slot =
      workTerminal && workOn ? 'work' : whisperOn ? 'whisper' : balanceOn ? 'balance' : workOn ? 'work' : 'none';
    const whisperImg = slot === 'whisper' ? S.createMemeImage(this.whisperImage, BASE, this.assetRoot) : null;
    this.bubble.classList.toggle(
      'is-whisper',
      // 余额「文字说明」（不可用状态）同样要换行变体：默认 nowrap 会把长文案顶出宠物宽度
      slot === 'whisper' || slot === 'work' || (slot === 'balance' && this.balanceWrap),
    );
    this.bubble.classList.toggle(S.MEME_BUBBLE_CLASS, !!whisperImg);
    if (slot === 'none') {
      // 三者都没有可显示的内容：隐藏（不占位，也就不会挡住任何一层）
      this.bubble.classList.remove('is-on');
      window.__dshPetDebug.lastBubbleTitle = '';
      return;
    }
    this.bubble.innerHTML = '';
    if (slot === 'work') {
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.workText;
      this.bubble.appendChild(line);
    } else if (slot === 'whisper') {
      // 配图（shared 生成的 <img> + 共用样式）：先看图再读话，符合"配图"的阅读顺序
      if (whisperImg) this.bubble.appendChild(whisperImg);
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.whisperView[0]?.text ?? '';
      this.bubble.appendChild(line);
    } else {
      const rows = this.balanceView;
      const hasTier = rows.some((r) => r.role === 'tier');
      if (hasTier) {
        // deepseek 余额单行：余额（峰/谷）¥x — 档位字着色
        const line = document.createElement('div');
        line.className = 'pet-bub-row';
        for (const r of rows) {
          const span = document.createElement('span');
          if (r.role === 'tier') span.className = 'pet-bub-tier pet-bub-tier-' + r.tier;
          span.textContent = r.text;
          line.appendChild(span);
        }
        this.bubble.appendChild(line);
      } else {
        for (const r of rows) {
          const div = document.createElement('div');
          if (r.role === 'error') div.className = 'pet-bub-err';
          else if (r.role === 'sub') div.className = 'pet-bub-row pet-bub-sub';
          else div.className = 'pet-bub-row';
          div.textContent = r.text;
          this.bubble.appendChild(div);
        }
      }
    }
    this.bubble.classList.add('is-on');
    window.__dshPetDebug.lastBubbleTitle = this.bubble.textContent.slice(0, 60);
  }
}
