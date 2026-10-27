// 好感度（affinity）—— 长期关系值，P2 第三批
//
// 与 mood 的区别（文档 §4.1）：
//   mood      短期情绪，分钟~小时，频繁波动，decay 回归
//   affinity  长期关系，天~周，缓慢累积，只随长期缺席下降
//
// 六级设计（文档 §4.2）：
//   Lv.1 0~19 陌生 / Lv.2 20~39 认识 / Lv.3 40~59 熟悉
//   Lv.4 60~79 亲密 / Lv.5 80~94 羁绊 / Lv.6 95~100 心灵相通
//
// 关键设计取舍：
//   1. 每日上限必须存在 —— 否则连点 100 下就把好感度刷满了，失去"长期"的意义
//   2. 好感度**不 decay 回归**（与 mood 相反），只在连续缺席时下降
//   3. 下降要温和且可恢复 —— 文档 §5.2 的"离家出走"是彩蛋不是惩罚
'use strict';

const clampAffinity = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);

/** 六级定义（含行为特征与解锁内容，供 UI 显示） */
const LEVELS = [
  { lv: 1, min: 0, name: '陌生', desc: '话少、拘谨' },
  { lv: 2, min: 20, name: '认识', desc: '正常互动' },
  { lv: 3, min: 40, name: '熟悉', desc: '会主动打招呼' },
  { lv: 4, min: 60, name: '亲密', desc: '会撒娇、吃醋' },
  { lv: 5, min: 80, name: '羁绊', desc: '深度依赖' },
  { lv: 6, min: 95, name: '心灵相通', desc: '全解锁' },
];

/** 值 → 等级对象 */
function levelOf(value) {
  const v = clampAffinity(Number(value) || 0);
  let cur = LEVELS[0];
  for (const L of LEVELS) if (v >= L.min) cur = L;
  return cur;
}

/** 到下一级还差多少（已满级返回 0） */
function toNextLevel(value) {
  const v = clampAffinity(Number(value) || 0);
  const next = LEVELS.find((L) => L.min > v);
  return next ? Math.ceil(next.min - v) : 0;
}

/**
 * 每日互动上限。文档 §4.3 的规则表：
 *   firstMeet  每天首次互动      +2  每天 1 次
 *   feed       喂食              +1  每天前 3 次
 *   play       陪玩（点击/玩耍）  +0.5 每天前 10 次
 *   milestone  工作里程碑        +2  每次（不限）
 *   accompany  全天陪伴 >4h      +1  每天 1 次
 *   care       她饿/累时照顾     +1.5 每次（不限）
 */
const DAILY_RULES = {
  firstMeet: { gain: 2, limit: 1 },
  feed: { gain: 1, limit: 3 },
  play: { gain: 0.5, limit: 10 },
  milestone: { gain: 2, limit: Infinity },
  accompany: { gain: 1, limit: 1 },
  care: { gain: 1.5, limit: Infinity },
};

/** 缺席惩罚（文档 §4.3 后半段） */
function offlineDecay(days) {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  if (d <= 1) return 0;        // 1 天内不降
  if (d < 3) return -(d - 1);  // 第 2 天起 -1/天
  if (d < 7) return -(2 + (d - 2) * 3); // 第 3 天起 -3/天
  return -(2 + 15 + (d - 6) * 5);       // 第 7 天起 -5/天
}

/** 本地日期键 */
function dateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * 好感度状态机。
 *
 * 每日计数存在 counters 里（键 = "规则名@日期"），跨日自动作废（不需要手动清）。
 */
class AffinityState {
  constructor(cfg, init) {
    this.cfg = cfg || { enabled: false, levelThresholds: LEVELS.map((L) => L.min) };
    this._value = clampAffinity(Number(init && init.value) || 10);
    this._lastSeen = (init && init.lastSeen) || dateKey(new Date());
    this._counters = (init && init.counters) || {};
  }

  get enabled() { return this.cfg.enabled === true; }
  get value() { return this._value; }
  get level() { return levelOf(this._value); }
  get toNext() { return toNextLevel(this._value); }
  get lastSeen() { return this._lastSeen; }

  /** 当天该规则已用次数 */
  _used(rule, today) {
    const k = rule + '@' + today;
    return Number(this._counters[k]) || 0;
  }

  _bump(rule, today) {
    const k = rule + '@' + today;
    this._counters[k] = (Number(this._counters[k]) || 0) + 1;
    // 顺手清理旧日期的计数（避免 counters 无限膨胀）
    for (const key of Object.keys(this._counters)) {
      const day = key.split('@')[1];
      if (day && day !== today) delete this._counters[key];
    }
  }

  /**
   * 记一次互动。
   * @returns {{applied:number, levelUp:boolean, capped:boolean}}
   *          applied=实际增加量，capped=因当日上限被拦
   */
  interact(rule, now) {
    const out = { applied: 0, levelUp: false, capped: false };
    if (!this.enabled) return out;
    const r = DAILY_RULES[rule];
    if (!r) return out;

    const today = dateKey(now || new Date());
    this._lastSeen = today;

    const used = this._used(rule, today);
    if (used >= r.limit) { out.capped = true; return out; }
    this._bump(rule, today);

    const beforeLevel = this.level.lv;
    // 高等级时正收益打折（避免满级后仍然飞快）—— 文档没要求，但满级后 +2 就浪费了
    const scale = this._value >= 95 ? 0.5 : 1;
    this._value = clampAffinity(this._value + r.gain * scale);
    out.applied = r.gain * scale;
    out.levelUp = this.level.lv > beforeLevel;
    return out;
  }

  /** 离线回归时按缺席天数扣（返回实际变化量） */
  applyOffline(days) {
    if (!this.enabled) return 0;
    const d = offlineDecay(days);
    if (d === 0) return 0;
    const before = this._value;
    this._value = clampAffinity(this._value + d);
    return this._value - before;
  }

  /** 最高好感加成系数（文档 §4.4：1.0~1.5）。Lv1=1.0，Lv6=1.5 */
  positiveBonus() {
    if (!this.enabled) return 1;
    const lv = this.level.lv;
    return 1 + (lv - 1) * 0.1;
  }

  /** 读档 */
  restore(v, lastSeen, counters) {
    const n = Number(v);
    if (Number.isFinite(n)) this._value = clampAffinity(n);
    if (typeof lastSeen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lastSeen)) this._lastSeen = lastSeen;
    if (counters && typeof counters === 'object') this._counters = { ...counters };
  }

  /** 存盘 */
  snapshot() {
    return {
      value: Math.round(this._value * 10) / 10,
      lastSeen: this._lastSeen,
      counters: { ...this._counters },
    };
  }
}

const __affinityApi = {
  LEVELS,
  DAILY_RULES,
  levelOf,
  toNextLevel,
  offlineDecay,
  dateKey,
  AffinityState,
  clamp: clampAffinity,
};
if (typeof module !== 'undefined' && module.exports) module.exports = __affinityApi;
if (typeof window !== 'undefined') window.PET_AFFINITY = __affinityApi;
