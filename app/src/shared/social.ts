// social.ts —— 多宠社交（关系值 + 互动调度）
//
// runtime 版：app/runtime/electron-helper/social.js
// 双份维护约定同 vitals.ts。
//
// 复用 physics 的跨窗口位置广播（preload 的 reportFlight / onFlightStates），
// 在物理碰撞之外加「关系值 + 社交互动」。
//
// 不做双角色动画（没素材），改成单角色动画 + 位置对齐 —— 文档 §6.4 的方案 B。

const clampSocial = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v);

/** 互动类型键 */
export type InteractionKey = 'snuggle' | 'chase' | 'play' | 'chat' | 'fight';

export interface InteractionDef {
  /** 播放的动画名（单角色，由程序负责把两只摆到一起） */
  anim: string;
  /** 心情偏移 */
  mood: number;
  /** 好感度偏移 */
  affinity: number;
  /** 关系值偏移 */
  relation: number;
  /** 中文描述（日志/调试用） */
  desc: string;
}

export const INTERACTIONS: Record<InteractionKey, InteractionDef> = {
  snuggle: { anim: '点击回应-挠痒咯咯笑', mood: 5, affinity: 1, relation: 2, desc: '贴贴' },
  chase: { anim: '原地左转奔跑', mood: 0, affinity: 0, relation: 1, desc: '追逐' },
  play: { anim: '三球抛接', mood: 8, affinity: 0, relation: 2, desc: '一起玩' },
  chat: { anim: '碎碎念-发呆碎碎念', mood: 3, affinity: 0, relation: 1, desc: '聊天' },
  fight: { anim: '点击回应-傲娇生气', mood: -5, affinity: 0, relation: -5, desc: '推搡' },
};

/** 关系档位 */
export type RelationBand = 'friend' | 'normal' | 'rival';

export function relationBand(v: number): RelationBand {
  const n = clampSocial(Number(v) || 0);
  if (n >= 70) return 'friend';
  if (n >= 30) return 'normal';
  return 'rival';
}

/** 互动决策上下文 */
export interface InteractionContext {
  myMood?: number;
  myEnergy?: number;
  otherMood?: number;
  otherEnergy?: number;
  distance?: number;
  night?: boolean;
}

/**
 * 按关系值和双方状态挑互动类型。
 * @param rnd 0~1 随机数（注入便于单测）
 */
export function pickInteraction(
  relation: number,
  ctx?: InteractionContext,
  rnd?: () => number,
): InteractionKey | 'none' {
  const r = typeof rnd === 'function' ? rnd : Math.random;
  const band = relationBand(relation);
  const c = ctx ?? {};
  const myEnergy = Number(c.myEnergy) || 50;
  const otherEnergy = Number(c.otherEnergy) || 50;
  const myMood = Number(c.myMood) || 50;
  const otherMood = Number(c.otherMood) || 50;

  // 双方心情都差 → 可能打架（冤家概率更高）
  if (myMood < 30 && otherMood < 30) {
    return r() < (band === 'rival' ? 0.45 : 0.25) ? 'fight' : 'none';
  }
  // 夜里且都累 → 不互动（没有"并排睡"素材，用 chat 占位会显得突兀）
  if (c.night && myEnergy < 40 && otherEnergy < 40) {
    return r() < 0.4 ? 'chat' : 'none';
  }

  const roll = r();
  if (band === 'friend') {
    if (roll < 0.35) return 'snuggle';
    if (roll < 0.55) return 'play';
    if (roll < 0.7) return 'chat';
    return 'none';
  }
  if (band === 'rival') {
    if (roll < 0.3) return 'fight';
    if (roll < 0.45) return 'chase';
    return 'none';
  }
  // normal
  if (roll < 0.2) return 'snuggle';
  if (roll < 0.35) return 'play';
  if (roll < 0.5) return 'chat';
  if (roll < 0.6) return 'chase';
  return 'none';
}

/** 关系值表（按对方 id 存，每只宠物一份） */
export class RelationMap {
  private map: Map<string, number>;

  constructor(init?: Record<string, number>) {
    this.map = new Map();
    if (init && typeof init === 'object') {
      for (const [k, v] of Object.entries(init)) {
        const n = Number(v);
        if (Number.isFinite(n)) this.map.set(String(k), clampSocial(n));
      }
    }
  }
  get(id: string): number {
    const v = this.map.get(String(id));
    return typeof v === 'number' ? v : 50;
  }
  set(id: string, v: number): void {
    this.map.set(String(id), clampSocial(v));
  }
  /** 按互动类型调整关系值，返回新值 */
  apply(id: string, delta: number): number {
    this.set(id, this.get(id) + Number(delta || 0));
    return this.get(id);
  }
  toObject(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const [k, v] of this.map) o[k] = Math.round(v * 10) / 10;
    return o;
  }
}

/** 参与社交扫描的宠物位置信息 */
export interface PetPos {
  id: string;
  x: number;
  y: number;
  mood?: number;
  energy?: number;
}

export interface SocialHit {
  type: InteractionKey;
  target: string;
  relation: number;
}

export interface SocialSchedulerOpts {
  radius?: number;
  cooldownMs?: number;
  relations?: Record<string, number>;
}

/**
 * 社交调度器：管理冷却、距离判定、触发互动。
 * 不直接操作 DOM / 动画 —— 由调用方传入回调，保持本模块可单测。
 */
export class SocialScheduler {
  readonly radius: number;
  readonly cooldownMs: number;
  readonly relations: RelationMap;
  private lastAt: Map<string, number>;

  constructor(opts?: SocialSchedulerOpts) {
    const o = opts ?? {};
    this.radius = Number(o.radius) > 0 ? Number(o.radius) : 130;
    this.cooldownMs = Number(o.cooldownMs) > 0 ? Number(o.cooldownMs) : 20000;
    this.relations = new RelationMap(o.relations);
    this.lastAt = new Map();
  }

  /** 距离平方（避免开根号） */
  static dist2(a: PetPos, b: PetPos): number {
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    return dx * dx + dy * dy;
  }

  /**
   * 扫描周围宠物，返回本拍该触发的互动。
   * 同一对宠物在 cooldownMs 内不会重复触发。
   */
  scan(me: PetPos | null, others: PetPos[] | null, now: number, rnd?: () => number): SocialHit | null {
    if (!me || !Array.isArray(others) || !others.length) return null;
    const r2 = this.radius * this.radius;
    for (const o of others) {
      if (!o || o.id === me.id) continue;
      if (SocialScheduler.dist2(me, o) > r2) continue;
      const last = this.lastAt.get(o.id);
      if (last && now - last < this.cooldownMs) continue;

      const rel = this.relations.get(o.id);
      const type = pickInteraction(
        rel,
        {
          myMood: me.mood,
          myEnergy: me.energy,
          otherMood: o.mood,
          otherEnergy: o.energy,
        },
        rnd,
      );
      if (type === 'none') continue;

      this.lastAt.set(o.id, now);
      return { type, target: o.id, relation: rel };
    }
    return null;
  }

  /** 互动发生后更新关系值，返回新值 */
  record(targetId: string, type: InteractionKey): number {
    const def = INTERACTIONS[type];
    if (!def) return this.relations.get(targetId);
    return this.relations.apply(targetId, def.relation);
  }

  snapshot(): Record<string, number> {
    return this.relations.toObject();
  }
}
