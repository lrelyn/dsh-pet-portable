// 多宠社交（P2 第四批）
//
// 现有基础：physics 已有跨窗口位置广播（preload 的 reportFlight / onFlightStates），
// 但只用于"飞行中碰撞弹开"。本模块复用同一套广播做**社交互动**。
//
// 设计要点：
//   1. 每只宠物维护与其它宠物的**关系值**（0~100，按对方 id 存）
//   2. 靠近时按关系值决定互动类型（好朋友多贴贴、冤家多打架）
//   3. 互动有冷却，避免相遇瞬间疯狂触发
//   4. 双角色动画用不了（没素材），改成**单角色动画 + 位置对齐**
//      —— 文档 §6.4 的"方案 B（推荐）"
//
// 关系值：
//   70~100 好朋友：贴贴/一起玩概率高，从不打架
//   30~69  普通
//   0~29   冤家：打架/追逐概率高，很少贴贴
'use strict';

const clampSocial = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);

/** 互动类型定义（文档 §6.2） */
const INTERACTIONS = {
  snuggle: { anim: '点击回应-挠痒咯咯笑', mood: 5, affinity: 1, relation: 2, desc: '贴贴' },
  chase: { anim: '原地左转奔跑', mood: 0, affinity: 0, relation: 1, desc: '追逐' },
  play: { anim: '三球抛接', mood: 8, affinity: 0, relation: 2, desc: '一起玩' },
  chat: { anim: '碎碎念-发呆碎碎念', mood: 3, affinity: 0, relation: 1, desc: '聊天' },
  fight: { anim: '点击回应-傲娇生气', mood: -5, affinity: 0, relation: -5, desc: '推搡' },
};

/** 关系档位 */
function relationBand(v) {
  const n = clampSocial(Number(v) || 0);
  if (n >= 70) return 'friend';
  if (n >= 30) return 'normal';
  return 'rival';
}

/**
 * 按关系值和双方状态挑互动类型。
 *
 * @param {number} relation 关系值 0~100
 * @param {object} ctx { myMood, myEnergy, otherMood, otherEnergy, distance, night }
 * @param {function} rnd 0~1 随机数（注入便于单测）
 * @returns {string} INTERACTIONS 的键，或 'none'
 */
function pickInteraction(relation, ctx, rnd) {
  const r = typeof rnd === 'function' ? rnd : Math.random;
  const band = relationBand(relation);
  const c = ctx || {};
  const myEnergy = Number(c.myEnergy) || 50;
  const otherEnergy = Number(c.otherEnergy) || 50;
  const myMood = Number(c.myMood) || 50;
  const otherMood = Number(c.otherMood) || 50;

  // 双方心情都差 → 可能打架（冤家概率更高）
  if (myMood < 30 && otherMood < 30) {
    return r() < (band === 'rival' ? 0.45 : 0.25) ? 'fight' : 'none';
  }

  // 夜里且都累 → 一起睡（这里用 chat 占位，没有"并排睡"素材）
  if (c.night && myEnergy < 40 && otherEnergy < 40) {
    return r() < 0.4 ? 'chat' : 'none';
  }

  const roll = r();
  if (band === 'friend') {
    if (roll < 0.35) return 'snuggle';
    if (roll < 0.55) return 'play';
    if (roll < 0.70) return 'chat';
    return 'none';
  }
  if (band === 'rival') {
    if (roll < 0.30) return 'fight';
    if (roll < 0.45) return 'chase';
    return 'none';
  }
  // normal
  if (roll < 0.20) return 'snuggle';
  if (roll < 0.35) return 'play';
  if (roll < 0.50) return 'chat';
  if (roll < 0.60) return 'chase';
  return 'none';
}

/**
 * 关系值表（按对方 id 存）。
 * 每只宠物一份，互相之间独立。
 */
class RelationMap {
  constructor(init) {
    this.map = new Map();
    if (init && typeof init === 'object') {
      for (const [k, v] of Object.entries(init)) {
        const n = Number(v);
        if (Number.isFinite(n)) this.map.set(String(k), clampSocial(n));
      }
    }
  }
  get(id) {
    const v = this.map.get(String(id));
    return typeof v === 'number' ? v : 50;   // 默认普通关系
  }
  set(id, v) { this.map.set(String(id), clampSocial(v)); }
  /** 按互动类型调整关系值 */
  apply(id, delta) {
    this.set(id, this.get(id) + Number(delta || 0));
    return this.get(id);
  }
  toObject() {
    const o = {};
    for (const [k, v] of this.map) o[k] = Math.round(v * 10) / 10;
    return o;
  }
}

/**
 * 社交调度器：管理冷却、距离判定、触发互动。
 *
 * 不直接操作 DOM / 动画 —— 由 sprite 传入回调，保持本模块可单测。
 */
class SocialScheduler {
  /**
   * @param {object} opts
   * @param {number} [opts.radius=130]     互动触发半径
   * @param {number} [opts.cooldownMs=20000] 同一次互动的冷却
   */
  constructor(opts = {}) {
    this.radius = Number(opts.radius) > 0 ? Number(opts.radius) : 130;
    this.cooldownMs = Number(opts.cooldownMs) > 0 ? Number(opts.cooldownMs) : 20000;
    this.relations = new RelationMap(opts.relations);
    this.lastAt = new Map();   // 对方 id → 上次互动时间
  }

  /** 距离平方（避免开根号） */
  static dist2(a, b) {
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    return dx * dx + dy * dy;
  }

  /**
   * 扫描周围宠物，返回本拍该触发的互动。
   * @param {object} me { id, x, y, mood, energy }
   * @param {Array} others [{ id, x, y, mood, energy }]
   * @param {number} now 时间戳
   * @param {function} rnd 随机数注入
   * @returns {{type:string, target:string, relation:number}|null}
   */
  scan(me, others, now, rnd) {
    if (!me || !Array.isArray(others) || !others.length) return null;
    const r2 = this.radius * this.radius;
    for (const o of others) {
      if (!o || o.id === me.id) continue;
      if (SocialScheduler.dist2(me, o) > r2) continue;
      // 冷却：这一对刚互动过就跳过
      const last = this.lastAt.get(o.id);
      if (last && now - last < this.cooldownMs) continue;

      const rel = this.relations.get(o.id);
      const type = pickInteraction(rel, {
        myMood: me.mood, myEnergy: me.energy,
        otherMood: o.mood, otherEnergy: o.energy,
      }, rnd);
      if (type === 'none') continue;

      this.lastAt.set(o.id, now);
      return { type, target: o.id, relation: rel };
    }
    return null;
  }

  /** 互动发生后更新关系值，返回新值 */
  record(targetId, type) {
    const def = INTERACTIONS[type];
    if (!def) return this.relations.get(targetId);
    return this.relations.apply(targetId, def.relation);
  }

  snapshot() { return this.relations.toObject(); }
}

const __socialApi = {
  INTERACTIONS, relationBand, pickInteraction,
  RelationMap, SocialScheduler, clamp: clampSocial,
};
if (typeof module !== 'undefined' && module.exports) module.exports = __socialApi;
if (typeof window !== 'undefined') window.PET_SOCIAL = __socialApi;
