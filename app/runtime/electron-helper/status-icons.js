// 头顶状态图标（P2 §5.1）—— 纯 emoji，不需要新素材
//
// 为什么要它：目前头顶只有 renderMood 的心情徽标，用户看不出"她饿不饿/困不困"。
// 状态面板要点开菜单才看得到，而头顶图标是**抬眼就能看到**的即时反馈。
//
// 设计原则：
//   1. 只显示**最紧急的一个**图标（饿坏 > 困 > 想玩 > 好感升级），
//      同时显示多个会变成信息噪音，反而失去"一眼看懂"的价值
//   2. 状态恢复后自动淡出，不常驻干扰
//   3. 优先级用数字，越大越紧急
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
 * 按当前四维状态决定要显示哪个图标。
 *
 * @param {object} s
 *   energy   0~100
 *   hunger   0~100
 *   affinityLv  1~6（可选，用于判断"刚升级"）
 *   sleeping boolean
 *   bored    boolean（长时间没玩）
 *   affectionJustUp boolean（好感度刚升级）
 * @returns {{key:string, emoji:string, text:string}|null}
 */
function pickIcon(s) {
  if (!s || typeof s !== 'object') return null;
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

  if (!cands.length) return null;

  // 取优先级最高的
  let best = null;
  for (const k of cands) {
    const def = ICONS[k];
    if (!def) continue;
    if (!best || def.priority > ICONS[best].priority) best = k;
  }
  if (!best) return null;
  return { key: best, emoji: ICONS[best].emoji, text: ICONS[best].text };
}

/** 状态签名：用于"变了才更新 DOM"的短路判断（避免每次 tick 都重设 DOM） */
function iconSignature(icon) {
  return icon ? icon.key : '';
}

const __iconsApi = { ICONS, pickIcon, iconSignature };
if (typeof module !== 'undefined' && module.exports) module.exports = __iconsApi;
if (typeof window !== 'undefined') window.PET_STATUS_ICONS = __iconsApi;
