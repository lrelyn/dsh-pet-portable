// offline.test.ts —— 离线演化单测
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { REUNION, reunionOf, simulateOffline, type PetSnapshot } from './offline';

const snapAt = (date: Date, over: Partial<PetSnapshot> = {}): PetSnapshot => ({
  savedAt: date.toISOString(),
  mood: 60,
  energy: 40,
  hunger: 80,
  affinity: 50,
  ...over,
});

describe('REUNION —— 六档剧情', () => {
  it('六档都在，每档有动画与台词', () => {
    const keys = Object.keys(REUNION);
    assert.equal(keys.length, 6);
    for (const [k, v] of Object.entries(REUNION)) {
      assert.ok(v.anim, `${k} 缺动画`);
      assert.ok(Array.isArray(v.lines) && v.lines.length > 0, `${k} 缺台词`);
      assert.ok(['happy', 'normal', 'sad', 'angry'].includes(v.level), `${k} 的 level 非法`);
    }
  });
});

describe('reunionOf —— 离线时长分档', () => {
  it('按小时分档', () => {
    assert.equal(reunionOf(0.5 * 3600), 'brief', '<1h');
    assert.equal(reunionOf(1 * 3600), 'short', '1h');
    assert.equal(reunionOf(4 * 3600), 'short', '4h');
    assert.equal(reunionOf(8 * 3600), 'medium', '8h');
    assert.equal(reunionOf(23 * 3600), 'medium', '23h');
    assert.equal(reunionOf(24 * 3600), 'long', '24h');
    assert.equal(reunionOf(2 * 86400), 'long', '2d');
    assert.equal(reunionOf(3 * 86400), 'veryLong', '3d');
    assert.equal(reunionOf(6 * 86400), 'veryLong', '6d');
    assert.equal(reunionOf(7 * 86400), 'runaway', '7d');
    assert.equal(reunionOf(30 * 86400), 'runaway', '30d');
  });
});

describe('simulateOffline —— 边界保护', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  it('null 快照不崩，changed=false', () => {
    const r = simulateOffline(null, now);
    assert.equal(r.changed, false);
    assert.equal(r.offlineSec, 0);
  });

  it('时间戳非法 → 不推演', () => {
    const r = simulateOffline(snapAt(now, { savedAt: 'not-a-date' }), now);
    assert.equal(r.changed, false);
    assert.equal(r.mood, 60, '数值应原样返回');
  });

  it('时钟倒拨（savedAt 在未来）→ 不推演', () => {
    const future = new Date(now.getTime() + 86400000).toISOString();
    const r = simulateOffline(snapAt(now, { savedAt: future }), now);
    assert.equal(r.changed, false, '时钟倒拨不应惩罚用户');
  });

  it('离线时长夹在 365 天内', () => {
    const ancient = new Date('2020-01-01T00:00:00Z');
    const r = simulateOffline(snapAt(ancient), now);
    assert.ok(r.offlineSec <= 365 * 86400, `实际 ${r.offlineSec}`);
  });
});

describe('simulateOffline —— 推演规则', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  it('离线 3 小时：精力恢复满、饱食 -18、心情 -1', () => {
    const saved = new Date(now.getTime() - 3 * 3600 * 1000);
    const r = simulateOffline(snapAt(saved, { energy: 40, hunger: 80, mood: 60 }), now, {});

    assert.ok(Math.abs(r.offlineHours - 3) < 0.01, `offlineHours=${r.offlineHours}`);
    assert.equal(r.energy, 100, '30 分钟 × 4/分 足够回满');
    assert.ok(Math.abs(r.hunger - 62) < 0.5, `hunger=${r.hunger}`);
    assert.ok(Math.abs(r.mood - 59) < 0.1, `mood=${r.mood}`);
    assert.equal(r.reunion, 'short');
    assert.equal(r.changed, true);
  });

  it('心情前 2 小时免费', () => {
    const saved1 = new Date(now.getTime() - 1 * 3600 * 1000);
    const r1 = simulateOffline(snapAt(saved1, { mood: 60 }), now);
    assert.equal(r1.mood, 60, '1 小时内心情不变');

    const saved3 = new Date(now.getTime() - 3 * 3600 * 1000);
    const r3 = simulateOffline(snapAt(saved3, { mood: 60 }), now);
    assert.equal(r3.mood, 59, '3 小时只扣 1');
  });

  it('离线很久：饱食归零，好感不为负', () => {
    const saved = new Date(now.getTime() - 30 * 86400 * 1000);
    const r = simulateOffline(snapAt(saved, { hunger: 80, affinity: 50 }), now);
    assert.equal(r.hunger, 0);
    assert.ok(r.affinity >= 0, `affinity=${r.affinity}`);
    assert.equal(r.reunion, 'runaway');
  });

  it('数值全部夹在 [0,100]', () => {
    const saved = new Date(now.getTime() - 100 * 86400 * 1000);
    const r = simulateOffline(snapAt(saved, { mood: 5, energy: 5, hunger: 95, affinity: 95 }), now);
    for (const k of ['mood', 'energy', 'hunger', 'affinity'] as const) {
      assert.ok(r[k] >= 0 && r[k] <= 100, `${k}=${r[k]} 越界`);
    }
  });

  it('可配置睡眠恢复/消耗速率', () => {
    const saved = new Date(now.getTime() - 60 * 60 * 1000); // 1 小时
    const slow = simulateOffline(snapAt(saved, { hunger: 80 }), now, {
      vitals: { hunger: { sleepDrainPerMin: 0.05 } },
    });
    const fast = simulateOffline(snapAt(saved, { hunger: 80 }), now, {
      vitals: { hunger: { sleepDrainPerMin: 0.2 } },
    });
    assert.ok(fast.hunger < slow.hunger, `快消耗 ${fast.hunger} 应 < 慢消耗 ${slow.hunger}`);
  });
});
