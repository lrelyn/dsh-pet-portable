// affinity.ts —— 好感度（长期关系值，天~周尺度）
//
// runtime 版：app/runtime/electron-helper/affinity.js
// 双份维护约定同 vitals.ts：改逻辑先改这份，再同步 runtime。
//
// 与 mood 的区别：
//   mood      短期情绪，分钟~小时，频繁波动，decay 回归
//   affinity  长期关系，天~周，缓慢累积，只随长期缺席下降
//
// 每日上限是关键设计：没有它，连点 100 下就刷满了，失去"长期"的意义。

const clampAffinity = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v);

/** 六级定义 */
export interface AffinityLevel {
  lv: number;
  min: number;
  name: string;
  desc: string;
}

export const LEVELS: readonly AffinityLevel[] = [
  { lv: 1, min: 0, name: '陌生', desc: '话少、拘谨' },
  { lv: 2, min: 20, name: '认识', desc: '正常互动' },
  { lv: 3, min: 40, name: '熟悉', desc: '会主动打招呼' },
  { lv: 4, min: 60, name: '亲密', desc: '会撒娇、吃醋' },
  { lv: 5, min: 80, name: '羁绊', desc: '深度依赖' },
  { lv: 6, min: 95, name: '心灵相通', desc: '全解锁' },
] as const;

/** 每日互动规则：gain = 单次增益，limit = 每天可用次数 */
export interface DailyRule {
  gain: number;
  limit: number;
}

export const DAILY_RULES: Record<string, DailyRule> = {
  firstMeet: { gain: 2, limit: 1 },
  feed: { gain: 1, limit: 3 },
  play: { gain: 0.5, limit: 10 },
  milestone: { gain: 2, limit: Infinity },
  accompany: { gain: 1, limit: 1 },
  care: { gain: 1.5, limit: Infinity },
};

/** 值 → 等级对象 */
export function levelOf(value: number): AffinityLevel {
  const v = clampAffinity(Number(value) || 0);
  let cur = LEVELS[0];
  for (const L of LEVELS) if (v >= L.min) cur = L;
  return cur;
}

/** 到下一级还差多少（已满级返回 0） */
export function toNextLevel(value: number): number {
  const v = clampAffinity(Number(value) || 0);
  const next = LEVELS.find((L) => L.min > v);
  return next ? Math.ceil(next.min - v) : 0;
}

/**
 * 缺席惩罚（**逐日累加**）。
 *   1 天不降 / 第 2 天起 -1/天 / 第 3 天起 -3/天 / 第 7 天起 -5/天
 * 注意是"累计"不是"单日"：文档写 "-3/天"指从第 3 天起每天扣 3，所以要累加。
 */
export function offlineDecay(days: number): number {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  if (d <= 1) return 0;
  if (d < 3) return -(d - 1);
  if (d < 7) return -(2 + (d - 2) * 3);
  return -(2 + 15 + (d - 6) * 5);
}

/** 本地日期键（YYYY-MM-DD） */
export function dateKey(d: Date | number): string {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export interface AffinityConfig {
  enabled: boolean;
  decayAfterDays?: number;
  levelThresholds?: number[];
}

export interface AffinityInit {
  value?: number;
  lastSeen?: string;
  counters?: Record<string, number>;
}

export interface InteractResult {
  /** 实际增加量（0 表示被上限拦住或未启用） */
  applied: number;
  /** 是否发生升级 */
  levelUp: boolean;
  /** 是否因当日上限被拦 */
  capped: boolean;
}

/**
 * 好感度状态机。
 * 每日计数存在 counters 里（键 = "规则名@日期"），跨日自动作废。
 */
export class AffinityState {
  private readonly cfg: AffinityConfig;
  private _value: number;
  private _lastSeen: string;
  private _counters: Record<string, number>;

  constructor(cfg?: AffinityConfig, init?: AffinityInit) {
    this.cfg = cfg ?? { enabled: false };
    this._value = clampAffinity(Number(init?.value) || 10);
    this._lastSeen = init?.lastSeen ?? dateKey(new Date());
    this._counters = init?.counters ?? {};
  }

  get enabled(): boolean {
    return this.cfg.enabled === true;
  }
  get value(): number {
    return this._value;
  }
  get level(): AffinityLevel {
    return levelOf(this._value);
  }
  get toNext(): number {
    return toNextLevel(this._value);
  }
  get lastSeen(): string {
    return this._lastSeen;
  }
  get cfgRef(): AffinityConfig {
    return this.cfg;
  }

  /** 当天该规则已用次数 */
  private _used(rule: string, today: string): number {
    return Number(this._counters[rule + '@' + today]) || 0;
  }

  /** 记一次使用，并清理旧日期的计数（避免 counters 无限膨胀） */
  private _bump(rule: string, today: string): void {
    const k = rule + '@' + today;
    this._counters[k] = (Number(this._counters[k]) || 0) + 1;
    for (const key of Object.keys(this._counters)) {
      const day = key.split('@')[1];
      if (day && day !== today) delete this._counters[key];
    }
  }

  /** 记一次互动（带每日上限） */
  interact(rule: string, now?: Date): InteractResult {
    const out: InteractResult = { applied: 0, levelUp: false, capped: false };
    if (!this.enabled) return out;
    const r = DAILY_RULES[rule];
    if (!r) return out;

    const today = dateKey(now ?? new Date());
    this._lastSeen = today;

    if (this._used(rule, today) >= r.limit) {
      out.capped = true;
      return out;
    }
    this._bump(rule, today);

    const beforeLevel = this.level.lv;
    // 满级后收益减半（否则 +2 就浪费了）
    const scale = this._value >= 95 ? 0.5 : 1;
    this._value = clampAffinity(this._value + r.gain * scale);
    out.applied = r.gain * scale;
    out.levelUp = this.level.lv > beforeLevel;
    return out;
  }

  /** 离线回归时按缺席天数扣（返回实际变化量） */
  applyOffline(days: number): number {
    if (!this.enabled) return 0;
    const d = offlineDecay(days);
    if (d === 0) return 0;
    const before = this._value;
    this._value = clampAffinity(this._value + d);
    return this._value - before;
  }

  /** 正向加成系数（1.0~1.5）：Lv1=1.0，Lv6=1.5 */
  positiveBonus(): number {
    if (!this.enabled) return 1;
    return 1 + (this.level.lv - 1) * 0.1;
  }

  /** 读档 */
  restore(value?: number, lastSeen?: string, counters?: Record<string, number>): void {
    const n = Number(value);
    if (Number.isFinite(n)) this._value = clampAffinity(n);
    if (typeof lastSeen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lastSeen)) {
      this._lastSeen = lastSeen;
    }
    if (counters && typeof counters === 'object') this._counters = { ...counters };
  }

  /** 存盘 */
  snapshot(): { value: number; lastSeen: string; counters: Record<string, number> } {
    return {
      value: Math.round(this._value * 10) / 10,
      lastSeen: this._lastSeen,
      counters: { ...this._counters },
    };
  }
}
