// 头顶状态栏（P2 §5.1）—— 纯 emoji，不需要新素材
//
// 为什么要它：心情徽标只反映心情，用户看不出"她饿不饿/困不困"。
// 状态面板要点开菜单才看得到，而头顶状态栏是**抬眼就能看到**的即时反馈。
//
// 形态演进（2026-10-27）：最初是「宠物正上方悬浮一个大 emoji」（0.075 × 宠物宽度，
// 约 35px），在实际桌面上太抢眼、和右下心情药丸视觉不统一。现在改成**一排小药丸**：
// 每个状态是一个「emoji + 数值」小片，整体套白底圆角胶囊，字号只有原来的三分之一，
// 与右侧心情徽标同一套视觉语言（白底 + 轻投影 + 淡入淡出）。
//
// 设计原则：
//   1. 同一族只显示一个（饿坏 > 有点饿；力竭 > 有点困），避免同类噪音
//   2. 不同族可以同时出现（饿 + 累 是两件不同的事，都该看见），最多 3 个
//   3. 状态恢复后自动淡出，不常驻干扰
//   4. 优先级用数字，越大越紧急
'use strict';

/**
 * 图标定义表。
 *   key      状态键
 *   emoji    显示字符（纯 emoji，零素材成本）
 *   text     悬停提示文字
 *   priority 优先级（越大越优先显示）
 */
const ICONS = {
  starving:  { emoji: '🍚', text: '饿坏了，快喂我', priority: 60 },
  hungry:    { emoji: '🍘', text: '有点饿', priority: 40 },
  exhausted: { emoji: '💤', text: '精疲力竭', priority: 55 },
  tired:     { emoji: '🥱', text: '有点困', priority: 35 },
  sleeping:  { emoji: '😴', text: '睡着了', priority: 50 },
  lonely:    { emoji: '🎈', text: '无聊，陪我玩', priority: 20 },
  affection: { emoji: '💗', text: '好感度提升', priority: 30 },
};

/**
 * 同族归并表：同一族里只保留优先级最高的那个。
 *
 * 为什么需要：饱食 10 不会同时命中 starving 和 hungry（代码是 else if），
 * 但「饿 + 累」会同时命中两族——那是两件不同的事，都该看见，所以**不**归到一族。
 * 真正需要归并的是 sleeping 与 exhausted/tired：睡着了还显示「💤 力竭」纯属噪音，
 * 睡着本身就是对力竭的回应。见下面的 SUPPRESS 表。
 */
const FAMILY = {
  starving: 'hunger',
  hungry: 'hunger',
  exhausted: 'energy',
  tired: 'energy',
  sleeping: 'sleep',
  lonely: 'social',
  affection: 'social',
};

/**
 * 抑制表：出现 key 时，把 value 里的状态全部丢掉。
 *
 * 目前只有一条规则：睡着（sleeping）时不再显示力竭/有点困。
 * 理由：它们表达的是同一件事的两个阶段，睡着已经说明了一切；
 * 并且睡眠动画期间精力本来就在快速回复，「💤」那个数字会一直跳，反而干扰。
 * 饱食/无聊/好感不受影响——饿了睡了也得吃饭，那是有用信息。
 */
const SUPPRESS = {
  sleeping: ['exhausted', 'tired'],
};

/** 哪些状态适合在状态栏里带数值（睡眠/无聊/好感是事件，没有可看的数字） */
const VALUED = { starving: 'hunger', hungry: 'hunger', exhausted: 'energy', tired: 'energy' };

/**
 * 收集候选状态键（与历史实现同一套阈值）。
 * @param {object} s 见 pickIcons
 * @returns {string[]} 未排序的候选 key
 */
function collect(s) {
  const cands = [];
  const hunger = Number(s.hunger);
  const energy = Number(s.energy);

  if (Number.isFinite(hunger)) {
    if (hunger < 15) cands.push('starving');
    else if (hunger < 30) cands.push('hungry');
  }
  if (s.sleeping === true) cands.push('sleeping');
  if (Number.isFinite(energy)) {
    if (energy < 20) cands.push('exhausted');
    else if (energy < 40) cands.push('tired');
  }
  if (s.affectionJustUp === true) cands.push('affection');
  if (s.bored === true) cands.push('lonely');
  return cands;
}

/**
 * 按当前四维状态决定状态栏要显示哪几个小片（按优先级降序，同族去重）。
 *
 * @param {object} s
 *   energy   0~100
 *   hunger   0~100
 *   affinityLv  1~6（可选，用于判断"刚升级"）
 *   sleeping boolean
 *   bored    boolean（长时间没玩）
 *   affectionJustUp boolean（好感度刚升级）
 * @param {number} [limit] 最多返回几个（不传 = 全部）
 * @returns {Array<{key:string, emoji:string, text:string, priority:number, value:number|null}>}
 *   value 只有饿/累两类有值（用于显示「🍘 25」这种带数字的小片）；其余为 null
 */
function pickIcons(s, limit) {
  if (!s || typeof s !== 'object') return [];
  let cands = collect(s);
  if (!cands.length) return [];

  // 先应用抑制规则（睡着 → 不再报困），再排序去重
  const suppressed = new Set();
  for (const [trigger, victims] of Object.entries(SUPPRESS)) {
    if (cands.includes(trigger)) for (const v of victims) suppressed.add(v);
  }
  cands = cands.filter((k) => !suppressed.has(k));
  if (!cands.length) return [];

  // 优先级降序（稳定：同优先级按 collect 顺序）
  const sorted = cands
    .filter((k) => ICONS[k])
    .sort((a, b) => ICONS[b].priority - ICONS[a].priority);

  const out = [];
  const seenFamily = new Set();
  for (const k of sorted) {
    const fam = FAMILY[k] || k;
    if (seenFamily.has(fam)) continue;   // 同族只留最紧急的那个
    seenFamily.add(fam);
    const def = ICONS[k];
    const valuedKey = VALUED[k];
    const raw = valuedKey ? Number(s[valuedKey]) : NaN;
    out.push({
      key: k,
      emoji: def.emoji,
      text: def.text,
      priority: def.priority,
      value: Number.isFinite(raw) ? Math.round(raw) : null,
    });
    if (limit && out.length >= limit) break;
  }
  return out;
}

/**
 * 单个状态（历史 API，保持不变）。
 * 多个状态同时存在时只返回最紧急的一个。
 * @returns {{key:string, emoji:string, text:string}|null}
 */
function pickIcon(s) {
  const list = pickIcons(s, 1);
  return list.length ? list[0] : null;
}

/** 单图标签名：用于"变了才更新 DOM"的短路判断（避免每次 tick 都重设 DOM） */
function iconSignature(icon) {
  return icon ? icon.key : '';
}

/** 状态栏签名：多个小片时把 key 和数值拼起来，任一变化才重绘 */
function iconsSignature(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.map((c) => c.key + (c.value === null || c.value === undefined ? '' : ':' + c.value)).join(',');
}

const __iconsApi = { ICONS, FAMILY, pickIcon, pickIcons, iconSignature, iconsSignature };
if (typeof module !== 'undefined' && module.exports) module.exports = __iconsApi;
if (typeof window !== 'undefined') window.PET_STATUS_ICONS = __iconsApi;
