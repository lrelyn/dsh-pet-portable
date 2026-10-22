// 分部位触摸 —— src/shared 纯逻辑，浏览器 bundle 与桌面 shared-core 共用一份。
//
// 背景：此前整个命中区只有一个 `clicks` 池，点脑袋、点肚子、点尾巴都是同一组动画，
// 逗不起来。参照 VPet 的 touchhead / touchbody / pinch 分框思路，按**点击位置在命中区内的
// 纵向比例**分流到不同动画池。
//
// 设计约束（为什么这样做）：
//   ① **零配置改动向后兼容**：配置里没写 clicksHead/clicksBody 时，zone 判定照做但取池
//      回落单一 `clicks` —— 老配置逐位不变；
//   ② 判据只用**一个比例值**（0=命中区顶 1=底），不引入第二个坐标。横向在 16:9 的
//      画布里几乎没有区分度（人物左右对称），纵向才是"头/身/腿"的自然分界；
//   ③ 三档而不是两档：head / body / feet。脚部给一个独立档是因为"点地板"和"点她"在
//      语义上不同（VPet 的 pinch 也类似），且素材池里恰好有被吓一跳这类反应；
//   ④ 连点**同部位**会渐进升级（见 tick 计数）：连摸头会从害羞到咯咯笑，连点肚子会炸毛。
//      这是"逗"的关键——单次点击给随机，重复点击给递进。
//
// 分界：`headRatio` 以下算头，`feetRatio` 以上算脚，中间是身子。
// 默认 0.42 / 0.82：人物 1000×1000 画布里头部约占上 40%，脚底在 82% 以下。

/** 部位名（与配置的 clicksHead / clicksBody / clicksFeet 对应） */
export type TouchZone = 'head' | 'body' | 'feet';

/** 部位分界配置（config.jsonc 顶层 touchZones 段，可省） */
export interface ZoneBounds {
  /** 头部上界比例：ry < 此值算「头」 */
  headRatio: number;
  /** 脚部下界比例：ry >= 此值算「脚」 */
  feetRatio: number;
}

/** 内置默认分界（与 assets/config.jsonc 的 touchZones 段保持一致） */
export const DEFAULT_ZONE_BOUNDS: ZoneBounds = { headRatio: 0.42, feetRatio: 0.82 };

/**
 * 归一化点击位置 → 部位。
 * `ry` 是点击处在命中区内的纵向比例（0=顶，1=底），调用方负责把 clientY 换成它。
 * 越界值照旧夹取判定（不抛）：ry<=0 算头、ry>=1 算脚。
 */
export const zoneOf = (ry: number, b: ZoneBounds = DEFAULT_ZONE_BOUNDS): TouchZone => {
  if (!Number.isFinite(ry)) return 'body'; // NaN/Infinity → 身子（最常见的档，最安全）
  if (ry < b.headRatio) return 'head';
  if (ry >= b.feetRatio) return 'feet';
  return 'body';
};

/** 部位 → 配置里的池字段名（没配的池 = 该部位回落单一 clicks） */
export const ZONE_POOL_KEY: Record<TouchZone, 'clicksHead' | 'clicksBody' | 'clicksFeet'> = {
  head: 'clicksHead',
  body: 'clicksBody',
  feet: 'clicksFeet',
};

/**
 * 按部位取动画池：**返回非空数组**（没配该部位时回落单一 clicks，再空则空数组）。
 * 调用方拿到空数组表示"这个宠物没有任何点击动画"，直接 return 即可。
 */
export const poolForZone = (
  zone: TouchZone,
  anims: { clicks: string[]; clicksHead?: string[]; clicksBody?: string[]; clicksFeet?: string[] },
): string[] => {
  const own = anims[ZONE_POOL_KEY[zone]];
  if (Array.isArray(own) && own.length > 0) return own;
  return anims.clicks ?? [];
};

/** 同一部位连续点击的「升级档」上限：递进池最多几段（防无休止升级刷屏） */
export const ZONE_ESCALATE_MAX = 3;

/**
 * 连点同部位的升级选择：第 n 次点同一部位（n 从 1 起）时，
 * 从池子里取「越递进越靠后」的那一段。
 *
 * 为什么用索引而不是随机：随机的结果是"连点十次可能一直在第一段循环"，
 * 完全没有递进感。按次数取索引，第 1 次随机、第 2 次取中段、第 3 次起取末段
 * （池子按"温和 → 强烈"排序，见 config.jsonc 注释）。
 *
 * 池长度不足时自然退化：单元素池永远返回它自己（与 pick 的哲学一致——
 * 宁可重复，也不要返回 undefined）。
 */
export const escalatedPick = (pool: string[], streak: number, exclude?: string): string => {
  if (pool.length === 0) return '';
  // 档位映射：1→0（随机段）、2→中、>=3→末
  const idx =
    streak <= 1 ? Math.floor(Math.random() * pool.length) : streak >= ZONE_ESCALATE_MAX ? pool.length - 1 : 1;
  let name = pool[Math.min(idx, pool.length - 1)];
  // 末段与当前正播相同且池里还有别的 → 换一个（避免"点了却没换动画"的错觉）
  if (name === exclude && pool.length > 1) {
    name = pool[(pool.indexOf(name) + 1) % pool.length];
  }
  return name;
};

/**
 * 部位点击的完整决策（纯函数，可单测；两端共用）。
 *
 * 输入：部位、该部位的池、连续次数、当前正播动画名（避免连重复）。
 * 输出：要播的动画名（空串 = 无可用动画，调用方应直接 return）。
 */
export const decideTouch = (o: {
  zone: TouchZone;
  anims: { clicks: string[]; clicksHead?: string[]; clicksBody?: string[]; clicksFeet?: string[] };
  streak: number;
  current?: string;
}): string => {
  const pool = poolForZone(o.zone, o.anims);
  if (pool.length === 0) return '';
  return escalatedPick(pool, o.streak, o.current);
};

/**
 * 部位标签（日志 / 调试用）。
 */
export const ZONE_LABEL: Record<TouchZone, string> = { head: '摸头', body: '撸身子', feet: '点脚' };
