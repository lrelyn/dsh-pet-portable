/**
 * mood（心情状态机）单元测试 —— 钉住四档语义、深夜漂移与「向后兼容」三条命脉：
 *   · value → 档位 的阈值判定（grumpy 线最低，先判它，防 24 线以下被判成 tired）；
 *   · 事件偏移的夹取、未知事件不抛；
 *   · decay 的指数收缩（不越过目标、decayPerSec=0 / dt<=0 原值不变、目标可切）；
 *   · 深夜把回归目标压到 30（夜里越待越困，白天自然回暖）；
 *   · applyMoodFactors 的倍率应用（不改入参、空池/空 factors 原样返回、倍率<0 当 0）；
 *   · MoodState 关闭时全透传（categories 引用相等、event/tick 恒 null）；
 *   · **向后兼容源码守卫**：enabled=false 时两端必须走原路。
 *
 * 跑法：node --experimental-strip-types --test src/shared/mood.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DAY_REST,
  DEFAULT_MOOD_CONFIG,
  MOOD_BASE,
  MOOD_EVENTS,
  MoodState,
  NIGHT_REST,
  applyEvent,
  applyMoodFactors,
  decayValue,
  isNightHour,
  moodAnims,
  moodOf,
  moodWeightFactors,
  restValue,
  type MoodConfig,
  type MoodKey,
} from './mood.ts';

/**
 * 与内置 config.jsonc 同形的默认配置。
 * **必须深拷贝 specs**：若干用例会改写单档（删键 / 换 weights / 塞非法倍率），
 * 而 `specs: DEFAULT_MOOD_CONFIG.specs` 是**共享引用**——直接抄会把内置默认改坏，
 * 之后所有用例拿到被污染的配置（表现为"单独跑过、整跑就挂"的诡异顺序依赖）。
 */
const cfg = (): MoodConfig => ({
  enabled: true,
  decayPerSec: 0.05,
  thresholds: { happy: 62, tired: 38, grumpy: 24 },
  specs: structuredClone(DEFAULT_MOOD_CONFIG.specs),
});

describe('moodOf —— value → 档位（阈值顺序）', () => {
  const t = { happy: 62, tired: 38, grumpy: 24 };

  test('边界值', () => {
    assert.equal(moodOf(100, t), 'happy');
    assert.equal(moodOf(62, t), 'happy');
    assert.equal(moodOf(61.999, t), 'normal');
    assert.equal(moodOf(38, t), 'tired');
    assert.equal(moodOf(37.999, t), 'tired');
    assert.equal(moodOf(24, t), 'grumpy');
    assert.equal(moodOf(23.999, t), 'grumpy');
    assert.equal(moodOf(0, t), 'grumpy');
  });

  test('正常区间（tired 线 38 ~ happy 线 62 之间）', () => {
    assert.equal(moodOf(50, t), 'normal');
    assert.equal(moodOf(39, t), 'normal');
    assert.equal(moodOf(61, t), 'normal');
  });

  test('grumpy 线最低：低值先判 grumpy 而不是 tired', () => {
    assert.equal(moodOf(10, t), 'grumpy');
    assert.equal(moodOf(20, t), 'grumpy');
  });
});

describe('applyEvent —— 事件偏移', () => {
  test('普通事件：累加偏移', () => {
    assert.equal(applyEvent(50, 'click'), 56);
    assert.equal(applyEvent(50, 'workSuccess'), 62);
    assert.equal(applyEvent(50, 'workError'), 35);
    assert.equal(applyEvent(50, 'balanceLow'), 38);
    assert.equal(applyEvent(50, 'throwDrag'), 46);
  });

  test('夹取到 [0,100]', () => {
    assert.equal(applyEvent(95, 'workSuccess'), 100);
    assert.equal(applyEvent(5, 'workError'), 0);
  });

  test('未知事件：原值不变（不抛、不写 0）', () => {
    assert.equal(applyEvent(50, '不存在的key'), 50);
    assert.equal(applyEvent(3, ''), 3);
  });

  test('MOOD_EVENTS 键集合即业务契约（改它等于改"什么算开心"）', () => {
    assert.deepEqual(Object.keys(MOOD_EVENTS).sort(), [
      'balanceLow',
      'balanceRich',
      'click',
      'throwDrag',
      'workError',
      'workSuccess',
    ]);
    // 语义方向：开心向全正、低落向全负
    for (const k of ['click', 'workSuccess', 'balanceRich']) assert.ok(MOOD_EVENTS[k] > 0, `${k} 应为正`);
    for (const k of ['workError', 'balanceLow', 'throwDrag']) assert.ok(MOOD_EVENTS[k] < 0, `${k} 应为负`);
  });
});

describe('decayValue —— 向目标指数回归', () => {
  test('高于目标往下走、低于目标往上走', () => {
    assert.ok(decayValue(80, 0.05, 1, 50) < 80);
    assert.ok(decayValue(20, 0.05, 1, 50) > 20);
  });

  test('绝不越过目标（单调收敛，不震荡）', () => {
    let v = 90;
    for (let i = 0; i < 200; i++) {
      const next = decayValue(v, 0.05, 1, 50);
      assert.ok(next < v || v <= 50, `应单调下降：${v} -> ${next}`);
      v = next;
    }
    assert.ok(v > 49.99 && v < 50.01, `应收敛到 50 附近，实际 ${v}`);
  });

  test('目标可切（深夜 30）：从 50 往下漂但不停在 50', () => {
    const night = decayValue(50, 0.05, 1, NIGHT_REST);
    assert.ok(night < 50, `深夜目标应把 50 往下拉，实际 ${night}`);
    assert.ok(night > 29, `一次 tick 不应越过目标，实际 ${night}`);
  });

  test('decayPerSec = 0 / dt <= 0 → 原值不变', () => {
    assert.equal(decayValue(80, 0, 1, 50), 80);
    assert.equal(decayValue(80, 0.05, 0, 50), 80);
    assert.equal(decayValue(80, 0.05, -1, 50), 80);
  });

  test('收敛速度与 decayPerSec 成正比', () => {
    const slow = decayValue(80, 0.025, 1, 50);
    const fast = decayValue(80, 0.05, 1, 50);
    assert.ok(fast < slow, `倍率大应回落更快：slow=${slow} fast=${fast}`);
  });

  test('默认目标 = 白天（不传 target 等价 DAY_REST）', () => {
    assert.equal(decayValue(80, 0.05, 1), decayValue(80, 0.05, 1, DAY_REST));
  });
});

describe('深夜目标 —— 夜里越待越困，白天回暖', () => {
  test('isNightHour / restValue 判据', () => {
    for (const h of [22, 23, 0, 1, 2, 3, 4, 5]) {
      assert.equal(isNightHour(h), true, `hour=${h}`);
      assert.equal(restValue(h), NIGHT_REST, `hour=${h} 目标应为 ${NIGHT_REST}`);
    }
    for (const h of [6, 12, 18, 21]) {
      assert.equal(isNightHour(h), false, `hour=${h}`);
      assert.equal(restValue(h), DAY_REST, `hour=${h} 目标应为 ${DAY_REST}`);
    }
  });

  test('整夜待机：从平静一路漂到疲倦', () => {
    const m = new MoodState(cfg());
    // 23 点起，每 5 分钟一次 tick，共 8 小时
    for (let i = 0; i < 96; i++) m.tick(300, 23);
    assert.equal(m.current, 'tired', `整夜后应为疲倦，实际 ${m.current}（value=${m.value0}）`);
  });

  test('白天整日待机：停在平静', () => {
    const m = new MoodState(cfg());
    for (let i = 0; i < 96; i++) m.tick(300, 14);
    assert.equal(m.current, 'normal', `白天应回到平静，实际 ${m.current}（value=${m.value0}）`);
  });
});

describe('applyMoodFactors —— 分类权重倍率', () => {
  const cats = [
    { id: '小动作', weight: 20 },
    { id: '玩耍', weight: 20 },
    { id: '文字', weight: 10 },
  ];

  test('happy：玩耍/小动作被放大、文字被压小；未配的"吃什么"保持原样', () => {
    const out = applyMoodFactors(cats, 'happy', cfg());
    assert.equal(out[0].weight, 26); // 小动作 ×1.3
    assert.equal(out[1].weight, 32); // 玩耍 ×1.6
    assert.equal(out[2].weight, 6); // 文字 ×0.6
  });

  test('没写倍率的分类 id → 原 weight（不配即 1）', () => {
    // happy spec 配的是内置五个分类；这里用一个配置里不存在的 id 验证"不配就原样"
    const out = applyMoodFactors([{ id: '不存在的分类', weight: 16 }], 'happy', cfg());
    assert.equal(out[0].weight, 16);
  });

  test('grumpy：玩耍几乎消失、文字变主角', () => {
    const out = applyMoodFactors(cats, 'grumpy', cfg());
    assert.equal(out[1].weight, 6); // 玩耍 ×0.3
    assert.equal(out[2].weight, 10); // 文字 ×1.0
  });

  test('normal：全 1，返回的数组与入参逐位相等', () => {
    const out = applyMoodFactors(cats, 'normal', cfg());
    assert.deepEqual(out, cats);
  });

  test('不改入参（返回新数组 + 新成员对象）', () => {
    const snapshot = JSON.parse(JSON.stringify(cats));
    const out = applyMoodFactors(cats, 'grumpy', cfg());
    assert.deepEqual(cats, snapshot, '入参必须保持原样');
    assert.notEqual(out, cats);
    assert.notEqual(out[0], cats[0]);
  });

  test('空池 → 空数组；空 factors / normal → 原样返回**入参数组**（引用相等）', () => {
    assert.deepEqual(applyMoodFactors([], 'happy', cfg()), []);
    assert.equal(applyMoodFactors(cats, 'normal', cfg()), cats);
    const emptyFactors = cfg();
    emptyFactors.specs.happy = { weights: {} };
    assert.equal(applyMoodFactors(cats, 'happy', emptyFactors), cats);
  });

  test('specs 缺键 → 原样返回', () => {
    const partial = { enabled: true, decayPerSec: 0, thresholds: { happy: 62, tired: 38, grumpy: 24 }, specs: {} } as MoodConfig;
    assert.equal(applyMoodFactors(cats, 'happy', partial), cats);
  });

  test('倍率为 0：该分类权重归零（合法 = 该档不出现）', () => {
    const c = cfg();
    c.specs.happy = { weights: { 玩耍: 0 } };
    const out = applyMoodFactors(cats, 'happy', c);
    assert.equal(out[1].weight, 0);
  });

  test('倍率非法（NaN/Infinity/字符串）→ 原 weight', () => {
    const c = cfg();
    // 只测运行时宽容度：配置层 moodsValid 会先拦掉这些
    (c.specs.happy.weights as Record<string, unknown>).玩耍 = 'abc';
    (c.specs.happy.weights as Record<string, unknown>).文字 = Infinity;
    const out = applyMoodFactors(cats, 'happy', c);
    assert.equal(out[1].weight, 20);
    assert.equal(out[2].weight, 10);
  });
});

describe('moodWeightFactors / moodAnims —— 档位查询', () => {
  test('normal 永远空（无倍率、无引导动画）', () => {
    assert.deepEqual(moodWeightFactors('normal', cfg()), {});
    assert.deepEqual(moodAnims('normal', cfg()), []);
  });

  test('happy 有倍率与引导动画', () => {
    assert.ok(Object.keys(moodWeightFactors('happy', cfg())).length > 0);
    assert.ok(moodAnims('happy', cfg()).length > 0);
  });

  test('specs 缺该档 → 空（不抛）', () => {
    const c = cfg();
    delete (c.specs as Record<string, unknown>).tired;
    assert.deepEqual(moodWeightFactors('tired', c), {});
    assert.deepEqual(moodAnims('tired', c), []);
  });
});

describe('MoodState —— 运行时状态机', () => {
  test('初始 = 平静', () => {
    const m = new MoodState(cfg());
    assert.equal(m.current, 'normal');
    assert.equal(m.value0, MOOD_BASE);
  });

  test('cfg 缺省（老配置没有 moods 段）→ 关闭，不抛', () => {
    const m = new MoodState(undefined);
    assert.equal(m.enabled, false);
    assert.equal(m.current, 'normal');
  });

  test('关闭时全透传：categories 引用相等、event/tick 恒 null、cue 恒 null', () => {
    const off: MoodConfig = { ...cfg(), enabled: false };
    const m = new MoodState(off);
    const cats = [{ id: '玩耍', weight: 20 }];
    assert.equal(m.categories(cats), cats, '关闭时 categories 必须原样返回入参');
    assert.equal(m.event('workSuccess'), null);
    assert.equal(m.tick(60, 23), null);
    assert.equal(m.cue(), null);
    assert.equal(m.current, 'normal');
  });

  test('开启时事件切换档位并返回新档位', () => {
    const m = new MoodState(cfg());
    assert.equal(m.event('click'), null); // 56 仍是 normal
    const next = m.event('workSuccess'); // 68 → happy
    assert.equal(next, 'happy');
    assert.equal(m.current, 'happy');
  });

  test('切换后 cue 从引导池里抽（不为空）', () => {
    const m = new MoodState(cfg());
    m.event('workSuccess');
    assert.ok(m.cue() !== null, '切进 happy 后应能抽出引导动画');
  });

  test('categories 按当前档位改写权重', () => {
    const m = new MoodState(cfg());
    m.event('workSuccess'); // → happy
    const out = m.categories([
      { id: '玩耍', weight: 20 },
      { id: '文字', weight: 10 },
    ]);
    assert.equal(out[0].weight, 32); // 玩耍 ×1.6
    assert.equal(out[1].weight, 6); // 文字 ×0.6
  });

  test('事件不跨档 → 返回 null（不刷屏、不重播引导动画）', () => {
    const m = new MoodState(cfg());
    assert.equal(m.event('click'), null); // 56 仍 normal
    assert.equal(m.event('throwDrag'), null); // 52 仍 normal
    assert.equal(m.event('balanceRich'), null); // 60 仍 normal（差 2 到 happy 线）
    // 连续点击把心情推过 62 线 → 这一刻才报一次切换
    assert.equal(m.event('click'), 'happy'); // 66 → happy
  });

  test('深夜里工作失败：先被夜色拖下去，再被失败一脚踩到烦躁', () => {
    const m = new MoodState(cfg());
    // 夜里待 30 分钟：50 → 30 方向漂移约 1.4（1-e^(-0.05*1800)≈1）→ 约 30.1
    m.tick(1800, 23);
    assert.equal(m.current, 'tired', `夜里久待应先疲倦，实际 ${m.current}（${m.value0}）`);
    const before = m.value0;
    m.event('workError'); // -15 → 越过 grumpy 线 24
    assert.ok(m.value0 < before, 'workError 必须降心情');
    assert.equal(m.current, 'grumpy');
  });

  test('一次只报一次切换（同一档位重复 event 不重复返回）', () => {
    const m = new MoodState(cfg());
    m.event('workSuccess'); // happy
    assert.equal(m.event('workSuccess'), null); // 62+12=74 仍 happy
    assert.equal(m.event('workError'), 'normal'); // 74-15=59 回 normal
  });
});

describe('向后兼容源码守卫 —— 心情关闭时两端必须走原路', () => {
  // 背景：moods.enabled=false（默认）时，随机链必须**逐位等价**于旧版本。
  // 两端各自有一层薄壳（浏览器 client/pet.ts / 桌面 runtime/electron-helper/sprite.js），
  // 任一端在关闭时仍应用倍率，就会出现"关掉了心情却被改权重"的隐性回归。
  // 这里把两侧钉住：都必须出现 `moods` 与 enabled 判断。
  const browserShell = readFileSync(fileURLToPath(new URL('../client/pet.ts', import.meta.url)), 'utf8');
  const desktopShell = readFileSync(
    fileURLToPath(new URL('../../runtime/electron-helper/sprite.js', import.meta.url)),
    'utf8',
  );

  test('两端都接心情（出现 moods / MoodState）', () => {
    assert.ok(/moods|MoodState/i.test(browserShell), 'client/pet.ts 必须接入心情');
    assert.ok(/moods|MoodState/i.test(desktopShell), 'runtime/electron-helper/sprite.js 必须接入心情');
  });

  test('两端都判 enabled 才应用倍率', () => {
    assert.ok(
      /enabled/.test(browserShell) && /mood/i.test(browserShell),
      'client/pet.ts 必须先判 enabled 再应用心情倍率',
    );
    assert.ok(
      /enabled/.test(desktopShell) && /mood/i.test(desktopShell),
      'runtime/electron-helper/sprite.js 必须先判 enabled 再应用心情倍率',
    );
  });

  test('倍率函数本体在 shared 层（两端共用，不各写一套）', () => {
    const shared = readFileSync(fileURLToPath(new URL('./mood.ts', import.meta.url)), 'utf8');
    assert.ok(/export const applyMoodFactors/.test(shared), 'applyMoodFactors 必须定义在 src/shared/mood.ts');
  });
});
