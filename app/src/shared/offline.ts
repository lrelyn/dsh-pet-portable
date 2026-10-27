// offline.ts —— 离线演化（桌宠关闭期间状态继续走）
//
// runtime 版：app/runtime/electron-helper/offline.js
// 双份维护约定同 vitals.ts。
//
// 核心：启动时读快照算离线时长，**一次性推演**（不是跑 N 次 tick ——
// 关闭 7 天不需要 2520 次循环），再匹配回归剧情。
//
// 推演规则（文档 §5.1）：
//   精力：离线前 30 分钟按睡眠恢复到满，之后保持满（假设她自己睡了一觉）
//   饱食：持续按睡眠速率消耗（-0.1/分钟），扣到 0
//   心情：前 2 小时不变，之后每小时 -1（孤独）
//   好感：按缺席天数（见 affinity.offlineDecay）
import { offlineDecay } from './affinity';

const clampOffline = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v);

/** 回归剧情档位键 */
export type ReunionKey = 'brief' | 'short' | 'medium' | 'long' | 'veryLong' | 'runaway';

export interface ReunionScene {
  anim: string;
  lines: string[];
  level: 'happy' | 'normal' | 'sad' | 'angry';
}

/** 六档回归剧情（文档 §5.2） */
export const REUNION: Record<ReunionKey, ReunionScene> = {
  brief: {
    anim: '点击回应-开心跃动',
    lines: ['你回来啦～', '刚刚还在想你会不会来'],
    level: 'happy',
  },
  short: {
    anim: '点击回应-元气挥手',
    lines: ['你去哪了呀，等你好久', '我还以为你今天不来了'],
    level: 'happy',
  },
  medium: {
    anim: '点击回应-元气挥手',
    lines: ['你终于回来了！我好饿', '好久没见到你了…'],
    level: 'normal',
  },
  long: {
    anim: '点击回应-害羞惊讶',
    lines: ['你是不是不要我了……', '我一直在等你'],
    level: 'sad',
  },
  veryLong: {
    anim: '点击回应-傲娇生气',
    lines: ['哼，不理你了', '（扭头）……才不是想你'],
    level: 'angry',
  },
  runaway: {
    anim: '点击回应-傲娇生气',
    lines: ['我出去散心了，哼', '（纸条：我走了，别找我）'],
    level: 'angry',
  },
};

/** 离线秒数 → 回归档位键 */
export function reunionOf(offlineSec: number): ReunionKey {
  const h = offlineSec / 3600;
  if (h < 1) return 'brief';
  if (h < 8) return 'short';
  if (h < 24) return 'medium';
  const d = h / 24;
  if (d < 3) return 'long';
  if (d < 7) return 'veryLong';
  return 'runaway';
}

/** 存档快照（与 pet-state.json 同构） */
export interface PetSnapshot {
  savedAt: string;
  mood: number;
  energy: number;
  hunger: number;
  affinity: number;
}

export interface OfflineConfig {
  vitals?: {
    energy?: { sleepRecoverPerMin?: number };
    hunger?: { sleepDrainPerMin?: number };
  };
}

export interface OfflineResult {
  offlineSec: number;
  offlineHours: number;
  offlineDays: number;
  reunion: ReunionKey;
  reunionData: ReunionScene;
  mood: number;
  energy: number;
  hunger: number;
  affinity: number;
  changed: boolean;
}

/**
 * 推演离线期间的变化。
 *
 * 边界保护：
 *   - 时间戳非法 → 不推演（不惩罚用户）
 *   - 时钟倒拨（savedAt 在未来）→ 不推演
 *   - 离线超 365 天 → 按 365 天算（避免荒谬数值）
 */
export function simulateOffline(
  snap: PetSnapshot | null | undefined,
  now?: Date,
  cfg?: OfflineConfig,
): OfflineResult {
  const c = cfg ?? {};
  const t = now instanceof Date ? now : new Date();
  const savedMs = snap?.savedAt ? Date.parse(snap.savedAt) : NaN;

  const out: OfflineResult = {
    offlineSec: 0,
    offlineHours: 0,
    offlineDays: 0,
    reunion: 'brief',
    reunionData: REUNION.brief,
    mood: clampOffline(Number(snap?.mood) || 50),
    energy: clampOffline(Number(snap?.energy) || 80),
    hunger: clampOffline(Number(snap?.hunger) || 70),
    affinity: clampOffline(Number(snap?.affinity) || 10),
    changed: false,
  };

  if (!Number.isFinite(savedMs)) return out;
  let offlineSec = (t.getTime() - savedMs) / 1000;
  if (!(offlineSec > 0)) return out;
  offlineSec = Math.min(offlineSec, 365 * 86400);

  out.offlineSec = offlineSec;
  out.offlineHours = offlineSec / 3600;
  out.offlineDays = offlineSec / 86400;
  out.reunion = reunionOf(offlineSec);
  out.reunionData = REUNION[out.reunion];

  const mins = offlineSec / 60;
  const sleepRecover = Number(c.vitals?.energy?.sleepRecoverPerMin ?? 4);
  const sleepDrain = Number(c.vitals?.hunger?.sleepDrainPerMin ?? 0.1);

  // 精力：前 30 分钟按睡眠恢复，之后保持满
  out.energy = clampOffline(out.energy + sleepRecover * Math.min(mins, 30));
  // 饱食：持续消耗
  out.hunger = clampOffline(out.hunger - sleepDrain * mins);
  // 心情：前 2 小时免费，之后每小时 -1
  out.mood = clampOffline(out.mood - Math.max(0, out.offlineHours - 2));
  // 好感：按缺席天数（逐日累加）
  out.affinity = clampOffline(out.affinity + offlineDecay(out.offlineDays));

  out.changed = true;
  return out;
}
