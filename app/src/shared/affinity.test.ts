// affinity.test.ts —— 好感度单测
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AffinityState,
  DAILY_RULES,
  LEVELS,
  dateKey,
  levelOf,
  offlineDecay,
  toNextLevel,
  type AffinityConfig,
} from './affinity';

const cfg = (): AffinityConfig => ({ enabled: true });
const make = (value?: number, cfgOverride?: AffinityConfig) =>
  new AffinityState(cfgOverride ?? cfg(), { value });

describe('LEVELS —— 六级定义', () => {
  it('正好 6 级，阈值递增', () => {
    assert.equal(LEVELS.length, 6);
    for (let i = 1; i < LEVELS.length; i++) {
      assert.ok(LEVELS[i].min > LEVELS[i - 1].min, `第 ${i + 1} 级阈值应大于上一级`);
    }
  });
  it('每级都有名字与描述', () => {
    for (const L of LEVELS) {
      assert.ok(L.name && L.desc, `Lv.${L.lv} 缺名字或描述`);
    }
  });
});

describe('levelOf / toNextLevel', () => {
  it('边界值落在正确的级', () => {
    assert.equal(levelOf(0).lv, 1);
    assert.equal(levelOf(19).lv, 1);
    assert.equal(levelOf(20).lv, 2);
    assert.equal(levelOf(40).lv, 3);
    assert.equal(levelOf(60).lv, 4);
    assert.equal(levelOf(80).lv, 5);
    assert.equal(levelOf(94).lv, 5);
    assert.equal(levelOf(95).lv, 6);
    assert.equal(levelOf(100).lv, 6);
  });

  it('越界值被夹取', () => {
    assert.equal(levelOf(-50).lv, 1);
    assert.equal(levelOf(999).lv, 6);
  });

  it('到下一级的差距', () => {
    assert.equal(toNextLevel(0), 20);
    assert.equal(toNextLevel(10), 10);
    assert.equal(toNextLevel(94), 1);
    assert.equal(toNextLevel(100), 0, '满级应为 0');
  });
});

describe('DAILY_RULES —— 每日上限', () => {
  it('六条规则都在', () => {
    assert.deepEqual(Object.keys(DAILY_RULES).sort(), [
      'accompany',
      'care',
      'feed',
      'firstMeet',
      'milestone',
      'play',
    ]);
  });
  it('首次互动/喂食/陪玩有上限，里程碑/照顾不限', () => {
    assert.equal(DAILY_RULES.firstMeet.limit, 1);
    assert.equal(DAILY_RULES.feed.limit, 3);
    assert.equal(DAILY_RULES.play.limit, 10);
    assert.equal(DAILY_RULES.milestone.limit, Infinity);
    assert.equal(DAILY_RULES.care.limit, Infinity);
  });
});

describe('offlineDecay —— 逐日累加', () => {
  it('1 天内不降', () => {
    assert.equal(offlineDecay(0), 0);
    assert.equal(offlineDecay(1), 0);
  });
  it('第 2 天起 -1', () => {
    assert.equal(offlineDecay(2), -1);
  });
  it('第 3 天起 -3/天（累计）', () => {
    assert.equal(offlineDecay(3), -5, '-1 再 -3');
    assert.equal(offlineDecay(4), -8);
    assert.equal(offlineDecay(6), -14);
  });
  it('第 7 天起 -5/天（累计）', () => {
    assert.equal(offlineDecay(7), -22);
    assert.equal(offlineDecay(10), -37);
  });
  it('单调递减', () => {
    for (let d = 2; d < 20; d++) {
      assert.ok(offlineDecay(d) < offlineDecay(d - 1), `第 ${d} 天应比第 ${d - 1} 天更负`);
    }
  });
});

describe('dateKey —— 本地日期键', () => {
  it('补零', () => {
    assert.equal(dateKey(new Date(2026, 0, 1)), '2026-01-01');
    assert.equal(dateKey(new Date(2026, 11, 31)), '2026-12-31');
  });
  it('接受时间戳', () => {
    const t = new Date(2026, 9, 27, 12, 0).getTime();
    assert.equal(dateKey(t), '2026-10-27');
  });
});

describe('AffinityState —— 互动与上限', () => {
  it('firstMeet 每天 1 次', () => {
    const now = new Date(2026, 9, 27, 10, 0);
    const a = make(10);
    const r1 = a.interact('firstMeet', now);
    assert.equal(r1.applied, 2);
    assert.equal(r1.capped, false);

    const r2 = a.interact('firstMeet', now);
    assert.equal(r2.capped, true);
    assert.equal(r2.applied, 0);
  });

  it('feed 每天 3 次', () => {
    const now = new Date(2026, 9, 27, 10, 0);
    const a = make(10);
    let counted = 0;
    for (let i = 0; i < 6; i++) if (a.interact('feed', now).applied > 0) counted++;
    assert.equal(counted, 3);
  });

  it('play 每天 10 次', () => {
    const now = new Date(2026, 9, 27, 10, 0);
    const a = make(10);
    let counted = 0;
    for (let i = 0; i < 15; i++) if (a.interact('play', now).applied > 0) counted++;
    assert.equal(counted, 10);
  });

  it('milestone 不限次数', () => {
    const now = new Date(2026, 9, 27, 10, 0);
    const a = make(10);
    let counted = 0;
    for (let i = 0; i < 20; i++) if (a.interact('milestone', now).applied > 0) counted++;
    assert.equal(counted, 20);
  });

  it('跨日重置上限', () => {
    const d1 = new Date(2026, 9, 27, 10, 0);
    const d2 = new Date(2026, 9, 28, 10, 0);
    const a = make(10);
    assert.equal(a.interact('firstMeet', d1).applied, 2);
    assert.equal(a.interact('firstMeet', d1).capped, true);
    assert.equal(a.interact('firstMeet', d2).applied, 2, '跨日后恢复可用');
  });

  it('未知规则不生效', () => {
    const a = make(10);
    const r = a.interact('不存在的规则', new Date());
    assert.equal(r.applied, 0);
  });
});

describe('AffinityState —— 升级检测', () => {
  it('跨级时 levelUp = true', () => {
    const now = new Date(2026, 9, 27, 10, 0);
    const a = make(19);
    assert.equal(a.level.lv, 1);
    const r = a.interact('firstMeet', now); // 19 + 2 = 21
    assert.equal(r.levelUp, true);
    assert.equal(a.level.lv, 2);
  });

  it('未跨级时 levelUp = false', () => {
    const now = new Date(2026, 9, 27, 10, 0);
    const a = make(10);
    const r = a.interact('firstMeet', now); // 10 + 2 = 12，仍 Lv1
    assert.equal(r.levelUp, false);
  });
});

describe('AffinityState —— 满级后收益减半', () => {
  it('value >= 95 时 gain × 0.5', () => {
    const now = new Date(2026, 9, 27, 10, 0);
    const a = make(96);
    const r = a.interact('firstMeet', now); // +2 × 0.5 = +1
    assert.equal(r.applied, 1);
    assert.equal(a.value, 97);
  });
});

describe('AffinityState —— positiveBonus', () => {
  it('Lv1 = 1.0，Lv6 = 1.5，每级 +0.1', () => {
    assert.equal(make(10).positiveBonus(), 1);
    assert.ok(Math.abs(make(25).positiveBonus() - 1.1) < 1e-9);
    assert.ok(Math.abs(make(100).positiveBonus() - 1.5) < 1e-9);
  });
});

describe('AffinityState —— applyOffline', () => {
  it('按缺席天数扣分并返回变化量', () => {
    const a = make(50);
    const delta = a.applyOffline(3);
    assert.equal(delta, -5);
    assert.equal(a.value, 45);
  });

  it('1 天内不扣', () => {
    const a = make(50);
    assert.equal(a.applyOffline(1), 0);
    assert.equal(a.value, 50);
  });
});

describe('AffinityState —— 关闭时透传', () => {
  const off = () => make(50, { enabled: false });

  it('interact 不生效', () => {
    const a = off();
    assert.equal(a.interact('firstMeet', new Date()).applied, 0);
    assert.equal(a.value, 50);
  });
  it('applyOffline 不扣', () => {
    assert.equal(off().applyOffline(10), 0);
  });
  it('positiveBonus 恒为 1', () => {
    assert.equal(off().positiveBonus(), 1);
  });
});

describe('AffinityState —— snapshot / restore 往返', () => {
  it('往返一致', () => {
    const a = make(42.5);
    const snap = a.snapshot();
    const b = make();
    b.restore(snap.value, snap.lastSeen, snap.counters);
    assert.equal(b.value, 42.5);
    assert.equal(b.lastSeen, snap.lastSeen);
  });

  it('restore 忽略非法 lastSeen', () => {
    const a = make(50);
    const before = a.lastSeen;
    a.restore(60, '2026/10/27');
    assert.equal(a.value, 60);
    assert.equal(a.lastSeen, before, '非法日期格式应被忽略');
  });

  it('restore 越界值被夹取', () => {
    const a = make();
    a.restore(999);
    assert.equal(a.value, 100);
    a.restore(-50);
    assert.equal(a.value, 0);
  });
});
