/**
 * touch（分部位触摸）单元测试 —— 钉住「零配置向后兼容」与「连点递进」两条命脉。
 *
 * 跑法：node --experimental-strip-types --test src/shared/touch.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ZONE_BOUNDS,
  ZONE_ESCALATE_MAX,
  ZONE_LABEL,
  decideTouch,
  escalatedPick,
  poolForZone,
  zoneOf,
  type ZoneBounds,
} from './touch.ts';

const POOLS = {
  clicks: ['通用A', '通用B'],
  clicksHead: ['头1', '头2', '头3'],
  clicksBody: ['身1', '身2'],
  clicksFeet: ['脚1'],
};

describe('zoneOf —— 点击位置 → 部位', () => {
  const b = DEFAULT_ZONE_BOUNDS;

  test('三个部位的边界', () => {
    assert.equal(zoneOf(0, b), 'head');
    assert.equal(zoneOf(0.3, b), 'head');
    assert.equal(zoneOf(0.4199, b), 'head');
    assert.equal(zoneOf(0.42, b), 'body');   // 上界是开的
    assert.equal(zoneOf(0.6, b), 'body');
    assert.equal(zoneOf(0.8199, b), 'body');
    assert.equal(zoneOf(0.82, b), 'feet');   // 下界是闭的
    assert.equal(zoneOf(1, b), 'feet');
  });

  test('越界值夹取（不抛）', () => {
    assert.equal(zoneOf(-5, b), 'head');
    assert.equal(zoneOf(99, b), 'feet');
  });

  test('NaN / Infinity → body（最常见档，最安全）', () => {
    // isFinite 两者都为 false，走同一分支：都给 body，不抛
    assert.equal(zoneOf(NaN, b), 'body');
    assert.equal(zoneOf(Infinity, b), 'body');
    assert.equal(zoneOf(-Infinity, b), 'body');
  });

  test('自定义分界', () => {
    const custom: ZoneBounds = { headRatio: 0.3, feetRatio: 0.7 };
    assert.equal(zoneOf(0.29, custom), 'head');
    assert.equal(zoneOf(0.5, custom), 'body');
    assert.equal(zoneOf(0.7, custom), 'feet');
  });
});

describe('poolForZone —— 部位 → 池（回落链）', () => {
  test('配了就用自己的', () => {
    assert.deepEqual(poolForZone('head', POOLS), ['头1', '头2', '头3']);
    assert.deepEqual(poolForZone('body', POOLS), ['身1', '身2']);
    assert.deepEqual(poolForZone('feet', POOLS), ['脚1']);
  });

  test('该部位没配 → 回落 clicks（向后兼容的关键）', () => {
    const only = { clicks: ['通用A'] };
    assert.deepEqual(poolForZone('head', only), ['通用A']);
    assert.deepEqual(poolForZone('body', only), ['通用A']);
    assert.deepEqual(poolForZone('feet', only), ['通用A']);
  });

  test('配成空数组 = 没配，同样回落', () => {
    const empty = { clicks: ['通用A'], clicksHead: [] };
    assert.deepEqual(poolForZone('head', empty), ['通用A']);
  });

  test('连 clicks 都没有 → 空数组（调用方 return）', () => {
    assert.deepEqual(poolForZone('head', {} as never), []);
  });
});

describe('escalatedPick —— 连点同部位递进', () => {
  test('第 1 次：随机段', () => {
    const pool = ['a', 'b', 'c', 'd'];
    const saved = Math.random;
    try {
      Math.random = () => 0.99;
      assert.equal(escalatedPick(pool, 1), 'd');
      Math.random = () => 0;
      assert.equal(escalatedPick(pool, 1), 'a');
    } finally {
      Math.random = saved;
    }
  });

  test('第 2 次：中段（索引 1）', () => {
    assert.equal(escalatedPick(['a', 'b', 'c', 'd'], 2), 'b');
  });

  test(`第 ${ZONE_ESCALATE_MAX} 次起：末段`, () => {
    const pool = ['a', 'b', 'c', 'd'];
    assert.equal(escalatedPick(pool, ZONE_ESCALATE_MAX), 'd');
    assert.equal(escalatedPick(pool, ZONE_ESCALATE_MAX + 5), 'd');
    assert.equal(escalatedPick(pool, 100), 'd');
  });

  test('池短于档位索引时夹取（不越界、不 undefined）', () => {
    assert.equal(escalatedPick(['only'], 2), 'only');
    assert.equal(escalatedPick(['only'], 3), 'only');
    assert.equal(escalatedPick(['only'], 99), 'only');
  });

  test('空池 → 空串（不抛）', () => {
    assert.equal(escalatedPick([], 1), '');
    assert.equal(escalatedPick([], 99), '');
  });

  test('末段与当前正播相同且还有别的 → 顺延一个', () => {
    // current='d' 时第 3 次本应取 'd'，换成 'a'（避免"点了没换动画"）
    assert.equal(escalatedPick(['a', 'b', 'c', 'd'], 3, 'd'), 'a');
  });

  test('单元素池 + exclude 自己 → 宁可重复（同 pick 哲学）', () => {
    assert.equal(escalatedPick(['only'], 3, 'only'), 'only');
  });
});

describe('decideTouch —— 完整决策', () => {
  test('按部位取池并递进', () => {
    assert.equal(decideTouch({ zone: 'head', anims: POOLS, streak: 2 }), '头2');
    assert.equal(decideTouch({ zone: 'head', anims: POOLS, streak: 3 }), '头3');
    assert.equal(decideTouch({ zone: 'body', anims: POOLS, streak: 3 }), '身2');
    // 脚池只有一段：永远它自己
    assert.equal(decideTouch({ zone: 'feet', anims: POOLS, streak: 3 }), '脚1');
  });

  test('无任何池 → 空串', () => {
    assert.equal(decideTouch({ zone: 'head', anims: {} as never, streak: 1 }), '');
  });

  test('部位没配但 clicks 有 → 用 clicks 并递进', () => {
    const only = { clicks: ['通1', '通2', '通3'] };
    assert.equal(decideTouch({ zone: 'body', anims: only, streak: 3 }), '通3');
  });

  test('exclude 生效（末段撞当前动画时顺延）', () => {
    const name = decideTouch({ zone: 'head', anims: POOLS, streak: 3, current: '头3' });
    assert.notEqual(name, '头3');
    assert.ok(POOLS.clicksHead!.includes(name));
  });
});

describe('ZONE_LABEL —— 日志标签', () => {
  test('三个部位都有中文标签', () => {
    assert.equal(ZONE_LABEL.head, '摸头');
    assert.equal(ZONE_LABEL.body, '撸身子');
    assert.equal(ZONE_LABEL.feet, '点脚');
  });
});

describe('向后兼容：老配置（只有 clicks）逐位不变', () => {
  test('单池配置下，三档都从同一池抽，行为等价老实现', () => {
    const legacy = { clicks: ['通用A', '通用B'] };
    const saved = Math.random;
    try {
      Math.random = () => 0;
      for (const zone of ['head', 'body', 'feet'] as const) {
        assert.equal(decideTouch({ zone, anims: legacy, streak: 1 }), '通用A');
      }
    } finally {
      Math.random = saved;
    }
  });
});
