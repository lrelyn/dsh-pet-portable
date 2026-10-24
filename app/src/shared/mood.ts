// 心情（情绪状态机）—— src/shared 纯逻辑，浏览器 bundle 与桌面 shared-core 共用一份。
//
// 设计原则：**不新增配置结构、不新增素材、不改既有行为**。
//   · 心情是一个 0~100 的连续值（50 = 平静，>50 偏开心，<50 偏低落）；
//   · 外部事件（点击互动 / 工作成功 / 工作出错 / 余额告急 / 被拖拽）只写**偏移量**，
//     由 `MoodState.event` 累加并夹在 [0,100]；
//   · 每 tick 按 `decayPerSec` 向**回归目标**收缩；白天目标 50，深夜目标 30
//     （`restValue`）——深夜不是"一次性事件"，而是把回归的锚点压下去，
//     于是夜里待机越久越容易犯困，天亮了自然回暖。这比"进深夜时扣一次分"
//     更能表现"熬到后半夜"，也不会出现"扣过一次就再也不变"的死状态。
//   · 心情**只通过 weight 倍率影响随机链**（`applyMoodFactors`），
//     不新增动画池索引、不改变池内容——配置里不写 moods 段时全链路等价于原行为。
//
// 为什么用「连续值 + 倍率」而不是 VPet 那种四态硬切换：
//   VPet 的 Happy/Nomal/PoorCondition/Ill 是**互斥目录**，需要每种心情各一套完整素材；
//   本项目 136 段素材是平铺池，硬切四套要么砍掉 3/4 的表现力、要么重造素材。
//   倍率方案让现有池子在同一时刻整体偏向某类情绪，是成本最低的"活物感"来源。

/** 心情档位名（与 config.jsonc 的 `moods.<key>` 对应；`normal` 是基准） */
export type MoodKey = 'happy' | 'normal' | 'tired' | 'grumpy';

/** 一个心情档位的配置（config.jsonc 的 moods.specs 里的一项） */
export interface MoodSpec {
  /** 该档位的分类权重倍率：分类 id → 倍率（1 = 不变，>1 更常出现，<1 更少；0 = 不出现） */
  weights: Record<string, number>;
  /** 进入该档位时优先播放的动画池（可空；只在**切换**的那一次用，避免一直霸屏）。
   *  动画名必须存在于该宠物的素材目录，否则静默不播（与菜单/配置的宽容口径一致）。 */
  anims?: string[];
  /** 该档位下 **idle 待机池** 的候选（可空）。传了就用它替代原 idle 池——
   *  这是「开心时多蹦跶、困倦时多打哈欠」的实现方式（P1-1）。
   *  池里的动画名必须真实存在，缺失的会被调用方静默跳过。 */
  idle?: string[];
  /** 该档位下 **点击回应池** 的候选（可空）。传了就用它替代原 clicks 池——
   *  「开心时被点更开心，生气时被点会烦躁」（P1-2）。 */
  clicks?: string[];
}

/** 心情档位阈值（value → key）：>=happy 线判开心，<=tired 线判疲倦，<=grumpy 线判烦躁 */
export interface MoodThresholds {
  /** >= 此值 → happy */
  happy: number;
  /** <= 此值 → tired */
  tired: number;
  /** <= 此值 → grumpy */
  grumpy: number;
}

/** 心情系统配置（config.jsonc 顶层 `moods` 段） */
export interface MoodConfig {
  /** 总开关：false / 缺失 = 心情系统关闭（全链路等价原行为） */
  enabled: boolean;
  /** 每 tick 向回归目标收缩的比例（/s）：0 = 不回归（只受事件影响） */
  decayPerSec: number;
  /** 各档位阈值 */
  thresholds: MoodThresholds;
  /** 各档位定义（键 = MoodKey） */
  specs: Record<MoodKey, MoodSpec>;
}

/** 内置默认（与 assets/config.jsonc 的 moods 段保持一致） */
export const DEFAULT_MOOD_CONFIG: MoodConfig = {
  enabled: false, // 默认关闭：不写配置就完全等价原行为
  // 时间常数约 3 分钟（0.005/s）。原先是 0.05/s（20 秒），太快——
  // 用户点一下让它开心，去倒杯水回来就恢复平静了，完全感知不到心情趋势。
  // 改慢 10 倍后开心能维持十几分钟，有"趋势感"（参照 VPet/拓麻歌子是小时级，
  // 但桌宠场景下 3 分钟时间常数已足够，太快或太慢都不自然）。
  decayPerSec: 0.005,
  // 阈值收窄：normal 从 39 个分值点缩到 19 个（41~59），更容易跨档。
  // 原来的 62/38/24 配合 +6 的点击偏移，要连点 4 次才到 happy，用户感知不到。
  thresholds: { happy: 60, tired: 40, grumpy: 25 },
  specs: {
    happy: {
      weights: { 玩耍: 1.8, 小动作: 1.4, 吃什么: 1.2, 时节: 0.8, 文字: 0.5 },
      anims: ['点击回应-开心跃动', '点击回应-元气挥手', '蓝鲸现世'],
      // 开心时待机更活跃（P1-1）
      idle: ['待机呼吸休闲', '可爱宅舞', '轻快摇摆舞', '原地漂浮踏步', '悠闲哼歌'],
      // 开心时被点更开心（P1-2）
      clicks: ['点击回应-开心跃动', '点击回应-元气挥手', '点击回应-挠痒咯咯笑'],
    },
    normal: { weights: {} },
    tired: {
      weights: { 小动作: 1.6, 文字: 1.3, 吃什么: 0.9, 玩耍: 0.3, 时节: 0.4 },
      anims: ['哈欠连天', '迷糊犯困', '睡眼惺忪'],
      // 困倦时待机多打哈欠、少动弹（P1-1）
      idle: ['哈欠连天', '迷糊犯困', '睡眼惺忪', '原地小憩沉眠', '待机呼吸休闲'],
      // 困倦时被点反应迟钝（P1-2）
      clicks: ['点击回应-害羞惊讶', '点击回应-傲娇生气', '打喷嚏'],
    },
    grumpy: {
      weights: { 小动作: 1.3, 玩耍: 0.2, 吃什么: 0.3, 时节: 0.2, 文字: 1.2 },
      anims: ['看表叹气', '玩游戏气急败坏', '摸鱼被抓'],
      // 烦躁时待机也不耐烦（P1-1）
      idle: ['看表叹气', '长时间工作看表', '打瞌睡被惊醒', '待机呼吸休闲'],
      // 烦躁时被点会更烦（P1-2，配合「烦躁时正收益减半」）
      clicks: ['点击回应-傲娇生气', '被吓一跳（炸毛）', '打喷嚏'],
    },
  },
};

/** 心情初始值（= 平静） */
export const MOOD_BASE = 50;

/** 事件 → 心情偏移。**语义固定的业务规则**（与 workStatusTexts 的档位一样属于代码契约）：
 *  改这些数字等于改"什么算开心/什么算难过"，不是表现层参数，所以不放配置。 */
export const MOOD_EVENTS: Record<string, number> = {
  // —— 日常互动 ——
  click: 6, // 点击互动（逗它）
  feed: 8, // 投喂小鱼干（此前台词说"心情 +1"但没有实际偏移，是最明显的逻辑断裂）
  throwDrag: -4, // 被拖拽抛掷（它不喜欢被甩）
  // —— 工作状态（依赖 DSH 宿主，独立版基本不触发）——
  workSuccess: 12, // 工作状态 success
  workError: -15, // 工作状态 error
  // —— 余额 ——
  balanceRich: 8, // 余额 >= 80%（钱袋满溢）
  balanceLow: -12, // 余额 < 20%（袋空如洗）
  // —— 作息 ——
  sleep: -5, // 进入睡眠（她困了，心情略微下沉）
  wake: 3, // 醒来（睡饱了心情好一点）
};

/** 「被忽视」惩罚：超过这个时长没交互，每 tick 额外扣心情。
 *  为什么要它：原来的心情只有"事件驱动"——用户不理它时心情恒定不变，
 *  桌宠不会因为被冷落而低落，缺少"需要陪伴"的驱动力。
 *  参照经典电子鸡：长时间不互动 → 孤独 → 生病。 */
export const NEGLECT_AFTER_MS = 5 * 60 * 1000; // 5 分钟
/** 被忽视时每分钟扣多少心情（-0.5/分钟，10 分钟才 -5，不激进） */
export const NEGLECT_RATE_PER_MIN = 0.5;

/** 深夜的回归目标：夜里待机越久越往疲倦漂（见文件头注释） */
export const NIGHT_REST = 30;

/** 白天（及非深夜时段）的回归目标 */
export const DAY_REST = MOOD_BASE;

/** 深夜小时集合（22,23,0..5） */
const NIGHT_HOURS: ReadonlySet<number> = new Set([22, 23, 0, 1, 2, 3, 4, 5]);

/** 该小时是否算深夜（供调用方决定回归目标；纯函数，可单测） */
export const isNightHour = (hour: number): boolean => NIGHT_HOURS.has(hour);

/** 该小时的回归目标（深夜压到 30，其余 50） */
export const restValue = (hour: number): number => (isNightHour(hour) ? NIGHT_REST : DAY_REST);

/** 夹取到 [0,100] */
const clamp = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v);

/** value → 档位（grumpy 线最低，先判它，防低值被判成 tired） */
export const moodOf = (value: number, t: MoodThresholds): MoodKey => {
  if (value <= t.grumpy) return 'grumpy';
  if (value <= t.tired) return 'tired';
  if (value >= t.happy) return 'happy';
  return 'normal';
};

/** 一次事件写入后的新值（事件名未知 → 原值不变，不抛）。
 *
 *  `t` 可选：传了就启用「烦躁时被点会更烦」——
 *  已经在 grumpy 档时，正收益的互动（click/feed）只有一半效果。
 *  为什么要它：原来 grumpy 状态下点它还是 +6，点几下就把它点回 normal 了，
 *  情绪状态形同虚设。半衰后它需要更多耐心才能哄好，负面情绪才有存在感。
 *  负收益事件（workError 等）不受影响（已经很糟了，不该再打折）。
 */
export const applyEvent = (value: number, event: string, t?: MoodThresholds): number => {
  const delta = MOOD_EVENTS[event];
  if (delta === undefined) return value;
  let effective = delta;
  if (t !== undefined && delta > 0 && moodOf(value, t) === 'grumpy') {
    effective = delta / 2;
  }
  return clamp(value + effective);
};

/**
 * 一次 tick 的回归：向 `target` 收缩 `decayPerSec * dt` 比例的**剩余距离**。
 * 指数收缩（而不是匀速减）：远离目标时回得快、靠近时回得慢，不会在目标附近震荡；
 * decayPerSec <= 0（或 dt <= 0）→ 原值不变（合法配置：只受事件影响）。
 */
export const decayValue = (value: number, decayPerSec: number, dt: number, target: number = DAY_REST): number => {
  if (decayPerSec <= 0 || dt <= 0) return value;
  const rest = target - value;
  return clamp(value + rest * (1 - Math.exp(-decayPerSec * dt)));
};

/**
 * 心情倍率：分类 id → weight 倍率。
 * normal / 未配置倍率 → 空对象（调用方拿到就等于"不改权重"）。
 */
export const moodWeightFactors = (mood: MoodKey, cfg: MoodConfig): Record<string, number> => {
  const spec = cfg.specs?.[mood];
  if (!spec || mood === 'normal') return {};
  return spec.weights ?? {};
};

/**
 * 把倍率应用到分类池（返回新数组，成员对象浅拷贝后换 weight）。
 * 倍率缺失 / 非有限数 → 原 weight；倍率 <0 当 0（不可能负权重）。
 * 空池 / 空 factors → **原样返回入参数组**（引用相等，调用方无需拷贝，见 mood.test.ts 守卫）。
 */
export const applyMoodFactors = <T extends { id: string; weight: number }>(
  categories: T[],
  mood: MoodKey,
  cfg: MoodConfig,
): T[] => {
  const factors = moodWeightFactors(mood, cfg);
  const keys = Object.keys(factors);
  if (keys.length === 0) return categories;
  return categories.map((c) => {
    const f = factors[c.id];
    if (f === undefined || !Number.isFinite(f)) return c;
    return { ...c, weight: Math.max(0, c.weight) * Math.max(0, f) };
  });
};

/** 当前档位是否配置了"切换时优先播放"的动画池（供调用方决定要不要播引导动画） */
export const moodAnims = (mood: MoodKey, cfg: MoodConfig): string[] => {
  const spec = cfg.specs?.[mood];
  if (!spec || mood === 'normal') return [];
  return spec.anims ?? [];
};

/**
 * 按心情取某个池的替代候选（idle / clicks）。
 *
 * 返回**空数组**表示"该档没配、用原池"——调用方据此判断要不要替换：
 *   `const alt = moodPool(key, 'idle', cfg); const pool = alt.length ? alt : anims.idle;`
 *
 * 为什么要这个：分类权重倍率是**概率性**变化（玩耍 20%→32%），用户不一定察觉得到。
 * 直接替换 idle / clicks 这类**高频**池，心情的影响才会被明显感知（P1-1 / P1-2）。
 */
export const moodPool = (mood: MoodKey, which: 'idle' | 'clicks', cfg: MoodConfig): string[] => {
  const spec = cfg.specs?.[mood];
  if (!spec || mood === 'normal') return [];
  return spec[which] ?? [];
};

/**
 * 一只宠物的心情运行时（两端共用的薄状态机）。
 *
 * 用法（浏览器 PetCard / 桌面 sprite 各持一个实例）：
 *   const mood = new MoodState(cfg.moods);
 *   // 随机链里：const cats = mood.categories(petAnims.categories);
 *   // 事件处：  const switched = mood.event('click');   // 返回新档位或 null
 *   // tick 里： const switched = mood.tick(dt, new Date().getHours());
 *   // switched 非 null 时播 moodAnims(switched, cfg.moods) 里的一段（可选）。
 *
 * `enabled=false` 时所有方法都是原样透传（categories 返回入参、event/tick 返回 null），
 * 调用方因此可以**无条件**调用，不需要在外层再判一次开关。
 */
export class MoodState {
  declare private readonly cfg: MoodConfig;
  declare private value: number;
  declare private key: MoodKey;

  constructor(cfg: MoodConfig | undefined) {
    // cfg 缺省（老配置没有 moods 段）→ 用内置默认（enabled=false = 关闭），绝不让调用方判空
    this.cfg = cfg ?? DEFAULT_MOOD_CONFIG;
    this.value = MOOD_BASE;
    this.key = moodOf(this.value, this.cfg.thresholds);
  }

  /** 心情系统是否开启（关闭时下面所有方法都是透传） */
  get enabled(): boolean {
    return this.cfg.enabled === true;
  }

  /** 当前档位（关闭时恒为 normal） */
  get current(): MoodKey {
    return this.enabled ? this.key : 'normal';
  }

  /** 当前心情值（调试/设置页展示用；关闭时恒为基准值） */
  get value0(): number {
    return this.enabled ? this.value : MOOD_BASE;
  }

  /** 把分类池按当前心情改写权重（关闭时原样返回入参，引用相等） */
  categories<T extends { id: string; weight: number }>(categories: T[]): T[] {
    if (!this.enabled) return categories;
    return applyMoodFactors(categories, this.key, this.cfg);
  }

  /** 按当前心情取 idle / clicks 的**替代池**；空数组 = 该档没配、调用方用原池。
   *  关闭时恒为空数组（= 永不替换，等价原行为）。 */
  pool(which: 'idle' | 'clicks'): string[] {
    if (!this.enabled) return [];
    return moodPool(this.key, which, this.cfg);
  }

  /** 切换时该播的引导动画名（无切换 / 无配置 / 关闭 → null） */
  cue(): string | null {
    if (!this.enabled) return null;
    const anims = moodAnims(this.key, this.cfg);
    if (anims.length === 0) return null;
    return anims[Math.floor(Math.random() * anims.length)];
  }

  /** 写入一个事件；档位发生变化时返回新档位（否则 null）。
   *  传了 thresholds 就启用「烦躁时正收益减半」（见 applyEvent 注释）。 */
  event(name: string): MoodKey | null {
    if (!this.enabled) return null;
    this.value = applyEvent(this.value, name, this.cfg.thresholds);
    return this.sync();
  }

  /** 一次时间推进（dt 秒，hour = 当前小时，决定回归目标）；档位变化时返回新档位。
   *
   *  `idleMs` 可选：距离上次用户交互过了多久（毫秒）。传入且超过 NEGLECT_AFTER_MS 时，
   *  在回归之外**额外**扣一点心情（NEGLECT_RATE_PER_MIN/分钟）——这是"被忽视"惩罚。
   *  为什么要它：原来心情只有事件驱动，用户不理它时心情恒定不变，
   *  桌宠不会因为被冷落而低落，缺少"需要陪伴"的驱动力。
   *  不传 idleMs = 不做惩罚（老调用方行为不变）。 */
  tick(dt: number, hour: number, idleMs?: number): MoodKey | null {
    if (!this.enabled) return null;
    this.value = decayValue(this.value, this.cfg.decayPerSec, dt, restValue(hour));
    if (idleMs !== undefined && idleMs > NEGLECT_AFTER_MS && dt > 0) {
      // 只在超过阈值**之后**的那段时间扣，不追溯之前的空闲
      const penalty = NEGLECT_RATE_PER_MIN * (dt / 60);
      this.value = Math.max(0, this.value - penalty);
    }
    return this.sync();
  }

  /** 恢复一个存档值（启动时用）。非法值静默忽略，保持基准值。 */
  restore(value: unknown): void {
    if (!this.enabled) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    this.value = Math.max(0, Math.min(100, value));
    this.key = moodOf(this.value, this.cfg.thresholds);
  }

  /** 导出当前值（持久化用）。关闭时返回 null（不写盘）。 */
  snapshot(): number | null {
    return this.enabled ? this.value : null;
  }

  /** 重算档位；与上一次不同则记录并返回它（= 切换信号） */
  private sync(): MoodKey | null {
    const next = moodOf(this.value, this.cfg.thresholds);
    if (next === this.key) return null;
    this.key = next;
    return next;
  }
}
