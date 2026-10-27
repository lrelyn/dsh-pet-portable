// pet-state.json —— 桌宠完整状态快照（心情/精力/饱食/好感度 + 时间戳）
//
// 与 memory.json 的区别（为什么不用同一个文件）：
//   memory.json  宿主管的，装对话记忆 messages（结构由宿主决定，读写有约定）
//   pet-state.json 桌宠自己的，装会随时间演化的数值 + 存档时间
// 分两个文件是有意的：宿主随时可能改写 memory.json，混在一起容易互相踩。
//
// 多宠隔离：每个宠物一个独立的 state 文件（pet-state-<id>.json），
//   因为每只宠物有自己的精力/饱食，不能共用一份。
//
// 存什么：
//   savedAt     ISO 时间戳（离线演化靠它算离线时长）
//   mood        0~100 短期情绪
//   energy      0~100 精力
//   hunger      0~100 饱食
//   affinity    0~100 长期好感度
//   lastSeen    上次"有人在"的日期（YYYY-MM-DD，好感度按天衰减用）
//   counters    每日计数（好感度的"每天前 N 次"限制）
//
// 为什么 savedAt 用 ISO 而不是 epoch ms：配置文件里人能看懂，
//   出问题时用记事本打开就能判断"她上次是什么时候见到我的"。
'use strict';

const STATE_VERSION = 1;

/** 一日的日期键（本地时区，YYYY-MM-DD）——好感度/每日计数都按本地日算 */
function dateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 默认快照（首次运行没有存档时用） */
function defaultState(now) {
  const t = now instanceof Date ? now : new Date();
  return {
    version: STATE_VERSION,
    savedAt: t.toISOString(),
    mood: 50,
    energy: 80, // 文档给的初始值
    hunger: 70,
    affinity: 10, // Lv.1 陌生
    lastSeen: dateKey(t),
    counters: {},
  };
}

/** 数值夹取到 [0,100] */
const clamp100 = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);

/**
 * 把任意输入洗成一个合法快照。
 * 原则：**缺字段静默补默认，非法值也补默认** —— 存档损坏不应该让桌宠起不来。
 * @returns {{state:object, repaired:string[]}} repaired = 修正过的字段名（调用方可以打日志）
 */
function sanitize(raw, now) {
  const t = now instanceof Date ? now : new Date();
  const base = defaultState(t);
  const repaired = [];
  if (!raw || typeof raw !== 'object') {
    return { state: base, repaired: ['(整个文件)'] };
  }
  const out = { ...base };

  // savedAt：非法时间戳会让离线推演算出负数或 NaN，必须严格校验
  if (typeof raw.savedAt === 'string') {
    const ts = Date.parse(raw.savedAt);
    if (Number.isFinite(ts)) out.savedAt = raw.savedAt;
    else repaired.push('savedAt');
  } else if (raw.savedAt !== undefined) {
    repaired.push('savedAt');
  }

  // 四个数值维度
  for (const k of ['mood', 'energy', 'hunger', 'affinity']) {
    const v = Number(raw[k]);
    if (raw[k] !== undefined && Number.isFinite(v)) out[k] = clamp100(v);
    else if (raw[k] !== undefined) repaired.push(k);
  }

  // lastSeen：只接受 YYYY-MM-DD
  if (typeof raw.lastSeen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastSeen)) {
    out.lastSeen = raw.lastSeen;
  } else if (raw.lastSeen !== undefined) {
    repaired.push('lastSeen');
  }

  // counters：每日计数表，只保留有限数字
  if (raw.counters && typeof raw.counters === 'object' && !Array.isArray(raw.counters)) {
    const c = {};
    for (const [k, v] of Object.entries(raw.counters)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) c[String(k)] = n;
    }
    out.counters = c;
  } else if (raw.counters !== undefined) {
    repaired.push('counters');
  }

  out.version = STATE_VERSION;
  return { state: out, repaired };
}

/**
 * 存档路径（文件名按宠物 id 隔离）。
 * 文件名里的非法字符替换成 _ —— id 由配置决定，可能含空格等。
 */
function stateFileName(petId) {
  const safe = String(petId || 'main').replace(/[\\/:*?"<>|\s]/g, '_');
  return `pet-state-${safe}.json`;
}

module.exports = {
  STATE_VERSION,
  dateKey,
  defaultState,
  sanitize,
  clamp100,
  stateFileName,
};
