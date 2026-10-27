// social.test.ts —— 多宠社交单测
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERACTIONS,
  RelationMap,
  SocialScheduler,
  pickInteraction,
  relationBand,
  type InteractionKey,
} from './social';

/** 可复现的伪随机（LCG），便于统计概率分布 */
const seeded = (seed: number): (() => number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

describe('relationBand —— 三档关系', () => {
  it('边界值', () => {
    assert.equal(relationBand(100), 'friend');
    assert.equal(relationBand(70), 'friend');
    assert.equal(relationBand(69), 'normal');
    assert.equal(relationBand(30), 'normal');
    assert.equal(relationBand(29), 'rival');
    assert.equal(relationBand(0), 'rival');
  });
});

describe('INTERACTIONS —— 互动定义', () => {
  it('五类互动都在且字段完整', () => {
    const keys = Object.keys(INTERACTIONS).sort();
    // 注意排序：'chase' < 'chat'（'s' < 't'），别按中文语序猜\n    assert.deepEqual(keys, ['chase', 'chat', 'fight', 'play', 'snuggle']);
    for (const [k, v] of Object.entries(INTERACTIONS)) {
      assert.ok(v.anim, `${k} 缺动画`);
      assert.ok(v.desc, `${k} 缺描述`);
      assert.ok(Number.isFinite(v.mood), `${k} 的 mood 非法`);
      assert.ok(Number.isFinite(v.relation), `${k} 的 relation 非法`);
    }
  });

  it('打架降关系，贴贴升关系', () => {
    assert.ok(INTERACTIONS.fight.relation < 0);
    assert.ok(INTERACTIONS.snuggle.relation > 0);
  });
});

describe('pickInteraction —— 关系值影响行为', () => {
  const sample = (relation: number, n = 2000): Record<string, number> => {
    const counts: Record<string, number> = {};
    const rnd = seeded(12345);
    for (let i = 0; i < n; i++) {
      const t = pickInteraction(relation, { myMood: 60, otherMood: 60, myEnergy: 80, otherEnergy: 80 }, rnd);
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  };

  it('好朋友从不打架，贴贴多于冤家', () => {
    const friend = sample(85);
    const rival = sample(10);
    assert.equal(friend.fight, undefined, '好朋友不应出现打架');
    assert.ok((friend.snuggle ?? 0) > (rival.snuggle ?? 0), '好朋友贴贴应更多');
  });

  it('冤家会打架且很少贴贴', () => {
    const rival = sample(10);
    assert.ok((rival.fight ?? 0) > 0, '冤家应有打架');
    assert.equal(rival.snuggle, undefined, '冤家不应贴贴');
  });

  it('双方心情都差 → 可能打架', () => {
    const fight = pickInteraction(50, { myMood: 20, otherMood: 20 }, () => 0.1);
    assert.equal(fight, 'fight');
    const none = pickInteraction(50, { myMood: 20, otherMood: 20 }, () => 0.9);
    assert.equal(none, 'none');
  });

  it('冤家心情都差时打架概率更高', () => {
    const count = (rel: number) => {
      let n = 0;
      const rnd = seeded(999);
      for (let i = 0; i < 1000; i++) {
        if (pickInteraction(rel, { myMood: 20, otherMood: 20 }, rnd) === 'fight') n++;
      }
      return n;
    };
    assert.ok(count(10) > count(80), '冤家打架次数应多于好朋友');
  });

  it('夜里都累 → 不打架（只可能聊天）', () => {
    const t = pickInteraction(50, { night: true, myEnergy: 20, otherEnergy: 20 }, () => 0.1);
    assert.equal(t, 'chat');
  });
});

describe('RelationMap —— 关系值表', () => {
  it('未记录默认 50', () => {
    assert.equal(new RelationMap().get('unknown'), 50);
  });

  it('set / apply / 夹取', () => {
    const m = new RelationMap();
    m.set('a', 80);
    assert.equal(m.get('a'), 80);
    assert.equal(m.apply('a', -5), 75);

    m.set('b', 999);
    assert.equal(m.get('b'), 100, '上界夹取');
    m.apply('c', -200);
    assert.equal(m.get('c'), 0, '下界夹取');
  });

  it('构造时洗掉非法值', () => {
    const m = new RelationMap({ ok: 60, bad: NaN as unknown as number });
    assert.equal(m.get('ok'), 60);
    assert.equal(m.get('bad'), 50, '非法值应被丢弃 → 默认 50');
  });

  it('toObject 保留一位小数', () => {
    const m = new RelationMap();
    m.set('x', 33.333);
    assert.equal(m.toObject().x, 33.3);
  });
});

describe('SocialScheduler —— 距离与冷却', () => {
  const me = { id: 'me', x: 0, y: 0, mood: 60, energy: 80 };

  it('太远不触发', () => {
    const s = new SocialScheduler({ radius: 130 });
    assert.equal(s.scan(me, [{ id: 'far', x: 5000, y: 5000 }], 1000, () => 0.01), null);
  });

  it('半径内触发', () => {
    const s = new SocialScheduler({ radius: 130, cooldownMs: 0 });
    const hit = s.scan(me, [{ id: 'near', x: 100, y: 0 }], 1000, () => 0.01);
    assert.ok(hit);
    assert.equal(hit!.target, 'near');
  });

  it('冷却期内不重复触发', () => {
    const s = new SocialScheduler({ radius: 130, cooldownMs: 20000 });
    const others = [{ id: 'o', x: 50, y: 0 }];
    assert.ok(s.scan(me, others, 100000, () => 0.01), '首次应触发');
    assert.equal(s.scan(me, others, 105000, () => 0.01), null, '冷却内不应触发');
    assert.ok(s.scan(me, others, 121000, () => 0.01), '冷却后应重新可触发');
  });

  it('不跟自己互动', () => {
    const s = new SocialScheduler({ radius: 500, cooldownMs: 0 });
    assert.equal(s.scan(me, [{ id: 'me', x: 0, y: 0 }], 1000, () => 0.01), null);
  });

  it('空列表 / null 不崩', () => {
    const s = new SocialScheduler();
    assert.equal(s.scan(me, [], 1000), null);
    assert.equal(s.scan(null, [{ id: 'a', x: 0, y: 0 }], 1000), null);
    assert.equal(s.scan(me, null, 1000), null);
  });

  it('record 按互动类型更新关系并返回新值', () => {
    const s = new SocialScheduler();
    const before = s.relations.get('t');
    const after = s.record('t', 'snuggle' as InteractionKey);
    assert.equal(after, before + INTERACTIONS.snuggle.relation);
    assert.equal(s.snapshot().t, after);
  });

  it('dist2 不用开根号也能正确比较', () => {
    assert.equal(SocialScheduler.dist2({ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3, y: 4 }), 25);
  });
});
