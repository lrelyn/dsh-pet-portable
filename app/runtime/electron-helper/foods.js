// 食物体系（P2 第二批）
//
// 现状：PET_FEED 写死「吃小鱼干 + 饱食 15」。这里改成可配置的菜单。
//
// 设计：
//   1. 食物表 = 配置驱动（config.vitals.foods），缺省用内置 DEFAULT_FOODS
//   2. 每种食物绑定一个已有动画（不要求新素材）
//   3. 每条食物有独立的冷却（避免连点刷饱食）
//   4. 好感度字段先占位（第三批接 affinity 时用）
//
// 为什么不给每种食物都做新动画：136 个现有动画里吃类有 26 个，够用。
// 文档 §3.2 食物表里的「小鱼干/零食/白饭/盒饭/Token/节日食物/奶茶」
// 全部能映射到现有动画。
'use strict';

const clampFoods = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);

/**
 * 内置食物表。
 *
 * 字段：
 *   id       唯一标识（也用作冷却键）
 *   name     菜单显示名
 *   anim     播放的动画名（必须存在于素材目录，否则自动跳过）
 *   hunger   恢复饱食
 *   energy   对精力的影响（负数 = 吃了更累，如奶茶/冰淇淋）
 *   mood     心情偏移（可选，覆盖默认的 feed +8）
 *   affinity 好感度偏移（第三批用）
 *   cooldownMs 冷却
 *   lines    台词（随机取一句；留空则用默认）
 */
const DEFAULT_FOODS = [
  {
    id: 'fish', name: '小鱼干', anim: '吃小鱼干',
    hunger: 15, energy: 0, mood: 8, affinity: 2, cooldownMs: 8000,
    lines: ['（啊呜）小鱼干真好吃～', '谢谢款待！', '再来一根？真的可以吗！'],
  },
  {
    id: 'snack', name: '零食', anim: '大口吃零食',
    hunger: 10, energy: 2, mood: 8, affinity: 1, cooldownMs: 8000,
    lines: ['咔嚓咔嚓～', '这个零食有点咸', '你也吃一点吗？'],
  },
  {
    id: 'rice', name: '白饭', anim: '吃白饭',
    hunger: 25, energy: 5, mood: 8, affinity: 1, cooldownMs: 15000,
    lines: ['白饭也很香的', '干吃白饭也不错呢', '吃饱了才有力气'],
  },
  {
    id: 'bento', name: '盒饭', anim: '吃盒饭',
    hunger: 35, energy: 8, mood: 10, affinity: 2, cooldownMs: 20000,
    lines: ['哇，有盒饭！', '这个菜好好吃', '多谢款待，我开动了～'],
  },
  {
    id: 'token', name: 'Token', anim: '吃Token',
    hunger: 5, energy: 3, mood: 12, affinity: 0, cooldownMs: 5000,
    lines: ['这个……能吃吗？', '（嚼）好像是数据？', '吃 Token 会不会变强'],
  },
  {
    id: 'milktea', name: '奶茶', anim: '喝奶茶',
    hunger: 8, energy: -5, mood: 10, affinity: 2, cooldownMs: 10000,
    lines: ['咕噜咕噜～好甜！', '奶茶使人快乐', '（喝完有点困）'],
  },
  {
    id: 'icecream', name: '冰淇淋', anim: '吃冰淇淋融化',
    hunger: 8, energy: -5, mood: 12, affinity: 2, cooldownMs: 10000,
    lines: ['凉凉的，好舒服', '冰淇淋会融化啦', '（冻得发抖）'],
  },
];

/** 按 id 找食物 */
function findFood(id, foods) {
  const list = Array.isArray(foods) && foods.length ? foods : DEFAULT_FOODS;
  return list.find((f) => f && f.id === id) || null;
}

/** 把配置里的食物表洗干净（缺字段补默认、非法丢弃） */
function sanitizeFoods(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_FOODS.slice();
  const out = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const id = String(f.id || '').trim();
    const name = String(f.name || '').trim();
    const anim = String(f.anim || '').trim();
    if (!id || !name || !anim) continue;
    out.push({
      id,
      name,
      anim,
      hunger: Number.isFinite(Number(f.hunger)) ? Number(f.hunger) : 10,
      energy: Number.isFinite(Number(f.energy)) ? Number(f.energy) : 0,
      mood: Number.isFinite(Number(f.mood)) ? Number(f.mood) : 8,
      affinity: Number.isFinite(Number(f.affinity)) ? Number(f.affinity) : 1,
      cooldownMs: Number.isFinite(Number(f.cooldownMs)) && Number(f.cooldownMs) > 0
        ? Number(f.cooldownMs) : 8000,
      lines: Array.isArray(f.lines) ? f.lines.filter((l) => typeof l === 'string' && l) : [],
    });
  }
  return out.length ? out : DEFAULT_FOODS.slice();
}

/**
 * 食物冷却表。
 * 每条食物独立冷却（不同食物互不影响），这样"喂个盒饭再喂根鱼干"是允许的。
 */
class FoodCooldowns {
  constructor() {
    this.map = new Map();
  }
  /** 还剩多少毫秒（0 = 可以喂） */
  remaining(foodId, now) {
    const last = this.map.get(foodId);
    if (!last) return 0;
    return Math.max(0, last.until - now);
  }
  /** 记一次投喂 */
  mark(foodId, now, cooldownMs) {
    this.map.set(foodId, { at: now, until: now + Math.max(0, cooldownMs) });
  }
  clear() { this.map.clear(); }
}

// 双环境导出：浏览器挂 window.PET_FOODS，Node 走 module.exports
const __foodsApi = {
  DEFAULT_FOODS,
  findFood,
  sanitizeFoods,
  FoodCooldowns,
  clamp: clampFoods,
};
if (typeof module !== 'undefined' && module.exports) module.exports = __foodsApi;
if (typeof window !== 'undefined') window.PET_FOODS = __foodsApi;
