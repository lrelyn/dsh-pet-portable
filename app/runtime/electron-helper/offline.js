// 离线演化（offline）—— P2 第三批
//
// 桌宠关闭期间状态继续演化。关闭时保存快照，下次启动算离线时长，
// 一次性推演这段时间的变化，并匹配回归剧情。
//
// 文档 §5.1 的推演规则：
//   精力    离线前 30 分钟按睡眠恢复到满，之后保持满（假设她自己睡了一觉）
//   饱食    持续按睡眠速率消耗（-0.1/分钟），扣到 0 为止
//   心情    前 2 小时不变，之后每小时 -1（孤独）
//   好感度  按缺席天数（见 affinity.offlineDecay）
//
// 关键设计取舍：
//   1. 推演是**一次性**的，不模拟中间过程 —— 关闭 7 天时不需要跑 7×24×60 次 tick
//   2. 回归剧情按离线时长分档（文档 §5.2 六档）
//   3. 好感度扣减温和：7 天不回也只扣到能哄回的程度，不是永久惩罚
'use strict';

const clampOffline = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);

/** 回归剧情档位（文档 §5.2） */
const REUNION = {
  /** <1 小时：几乎无变化 */
  brief: { anim: '点击回应-开心跃动', lines: ['你回来啦～', '刚刚还在想你会不会来'], level: 'happy' },
  /** 1~8 小时：略饿 */
  short: { anim: '点击回应-元气挥手', lines: ['你去哪了呀，等你好久', '我还以为你今天不来了'], level: 'happy' },
  /** 8~24 小时：饥饿，心情略降 */
  medium: { anim: '点击回应-元气挥手', lines: ['你终于回来了！我好饿', '好久没见到你了…'], level: 'normal' },
  /** 1~3 天：饿坏，好感度降 */
  long: { anim: '点击回应-害羞惊讶', lines: ['你是不是不要我了……', '我一直在等你'], level: 'sad' },
  /** 3~7 天：饿趴，好感度大降 */
  veryLong: { anim: '点击回应-傲娇生气', lines: ['哼，不理你了', '（扭头）……才不是想你'], level: 'angry' },
  /** >7 天：离家出走彩蛋 */
  runaway: { anim: '点击回应-傲娇生气', lines: ['我出去散心了，哼', '（纸条：我走了，别找我）'], level: 'angry' },
};

/** 离线秒数 → 回归档位键 */
function reunionOf(offlineSec) {
  const h = offlineSec / 3600;
  if (h < 1) return 'brief';
  if (h < 8) return 'short';
  if (h < 24) return 'medium';
  const d = h / 24;
  if (d < 3) return 'long';
  if (d < 7) return 'veryLong';
  return 'runaway';
}

/**
 * 推演离线期间的变化。
 *
 * @param {object} snap  存档快照 {savedAt, mood, energy, hunger, affinity}
 * @param {Date}   now   当前时间
 * @param {object} cfg   配置（offline / vitals / affinity）
 * @returns {{offlineSec, offlineHours, offlineDays, reunion, reunionData,
 *            mood, energy, hunger, affinity, changed}}
 */
function simulateOffline(snap, now, cfg) {
  const c = cfg || {};
  const t = now instanceof Date ? now : new Date();
  const savedMs = snap && snap.savedAt ? Date.parse(snap.savedAt) : NaN;
  const out = {
    offlineSec: 0, offlineHours: 0, offlineDays: 0,
    reunion: 'brief', reunionData: REUNION.brief,
    mood: clampOffline(Number(snap && snap.mood) || 50),
    energy: clampOffline(Number(snap && snap.energy) || 80),
    hunger: clampOffline(Number(snap && snap.hunger) || 70),
    affinity: clampOffline(Number(snap && snap.affinity) || 10),
    changed: false,
  };

  // 时间戳非法 / 时钟倒拨 → 当作没有离线（不惩罚用户）
  if (!Number.isFinite(savedMs)) return out;
  let offlineSec = (t.getTime() - savedMs) / 1000;
  if (!(offlineSec > 0)) return out;
  // 上限保护：超过 365 天按 365 天算（避免荒谬的数值）
  offlineSec = Math.min(offlineSec, 365 * 86400);

  out.offlineSec = offlineSec;
  out.offlineHours = offlineSec / 3600;
  out.offlineDays = offlineSec / 86400;
  out.reunion = reunionOf(offlineSec);
  out.reunionData = REUNION[out.reunion];

  const mins = offlineSec / 60;
  const hc = (c.vitals && c.vitals.hunger) || {};
  const ec = (c.vitals && c.vitals.energy) || {};

  // ---- 精力：前 30 分钟按睡眠恢复，之后保持满 ----
  const sleepRecover = Number(ec.sleepRecoverPerMin ?? 4);
  const recoverMins = Math.min(mins, 30);
  out.energy = clampOffline(out.energy + sleepRecover * recoverMins);
  // 超过 30 分钟的剩余时间：假设一直睡，保持满（不再加）

  // ---- 饱食：持续按睡眠速率消耗（扣到 0）----
  const sleepDrain = Number(hc.sleepDrainPerMin ?? 0.1);
  out.hunger = clampOffline(out.hunger - sleepDrain * mins);

  // ---- 心情：前 2 小时不变，之后每小时 -1 ----
  const moodHours = Math.max(0, out.offlineHours - 2);
  out.mood = clampOffline(out.mood - moodHours * 1);

  // ---- 好感度：按缺席天数 ----
  // 双环境取 offlineDecay：浏览器用 window.PET_AFFINITY，Node 用 require。
  // 不能直接写 require —— 浏览器里没有 require 会抛。
  let decayFn = null;
  if (typeof window !== 'undefined' && window.PET_AFFINITY && typeof window.PET_AFFINITY.offlineDecay === 'function') {
    decayFn = window.PET_AFFINITY.offlineDecay;
  } else if (typeof require === 'function') {
    try { decayFn = require('./affinity.js').offlineDecay; } catch { decayFn = null; }
  }
  if (decayFn) {
    out.affinity = clampOffline(out.affinity + decayFn(out.offlineDays));
  } else {
    // 两处都拿不到（极端裁剪）：自己算一份简化版，保证不会静默不扣
    const d = out.offlineDays <= 1 ? 0
      : out.offlineDays < 3 ? -(Math.floor(out.offlineDays) - 1)
      : out.offlineDays < 7 ? -(2 + (Math.floor(out.offlineDays) - 2) * 3)
      : -(17 + (Math.floor(out.offlineDays) - 6) * 5);
    out.affinity = clampOffline(out.affinity + d);
  }

  out.changed = true;
  return out;
}

const __offlineApi = { REUNION, reunionOf, simulateOffline, clamp: clampOffline };
if (typeof module !== 'undefined' && module.exports) module.exports = __offlineApi;
if (typeof window !== 'undefined') window.PET_OFFLINE = __offlineApi;
