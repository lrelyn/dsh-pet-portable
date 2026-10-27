// vitals.test.ts —— 精力/饱食状态机单测
//
// 这份测试跑的是 **src/shared/vitals.ts**（TypeScript 源），
// 与 runtime 的 vitals.js 是同一套逻辑的双份实现。
// 双份的一致性由这里保护：改逻辑先改 .ts，跑通再同步 runtime。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_VITALS_CONFIG,
  VitalsState,
  energyBand,
  hungerBand,
  isNightHour,
  type VitalsConfig,
} from './vitals';

const cfg = (): VitalsConfig => ({ ...DEFAULT_VITALS_CONFIG, enabled: true });
const make = (init?: { energy?: number; hunger?: number }) => new VitalsState(cfg(), init);

describe('energyBand / hungerBand —— 档位划分', () => {
  it('精力四档边界', () => {
    assert.equal(energyBand(100), 'energetic');
    assert.equal(energyBand(80), 'energetic');
    assert.equal(energyBand(79), 'normal');
    assert.equal(energyBand(40), 'normal');
    assert.equal(energyBand(39), 'tired');
    assert.equal(energyBand(20), 'tired');
    assert.equal(energyBand(19), 'exhausted');
    assert.equal(energyBand(0), 'exhausted');
  });

  it('饱食四档边界', () => {
    assert.equal(hungerBand(100), 'full');
    assert.equal(hungerBand(80), 'full');
    assert.equal(hungerBand(79), 'normal');
    assert.equal(hungerBand(40), 'normal');
    assert.equal(hungerBand(39), 'hungry');
    assert.equal(hungerBand(20), 'hungry');
    assert.equal(hungerBand(19), 'starving');
  });
});

describe('isNightHour —— 深夜时段', () => {
  it('22-23 与 0-5 是深夜', () => {
    for (const h of [22, 23, 0, 1, 2, 3, 4, 5]) assert.ok(isNightHour(h), `${h} 应为深夜`);
  });
  it('6-21 不是深夜', () => {
    for (const h of [6, 12, 18, 21]) assert.ok(!isNightHour(h), `${h} 不应是深夜`);
  });
});

describe('VitalsState —— 初始值', () => {
  it('缺省按配置的 initial', () => {
    const v = new VitalsState(cfg());
    assert.equal(v.energy, 80);
    assert.equal(v.hunger, 70);
  });
  it('显式 init 覆盖', () => {
    const v = new VitalsState(cfg(), { energy: 33, hunger: 44 });
    assert.equal(v.energy, 33);
    assert.equal(v.hunger, 44);
  });
  it('越界 init 被夹取', () => {
    const v = new VitalsState(cfg(), { energy: 999, hunger: -50 });
    assert.equal(v.energy, 100);
    assert.equal(v.hunger, 0);
  });
});

describe('VitalsState.tick —— 精力消耗/恢复', () => {
  it('工作 10 分钟：精力 -15、饱食 -6', () => {
    const v = make();
    v.tick(600, 'working', 14, 50);
    assert.equal(v.energy, 65);
    assert.equal(v.hunger, 64);
  });

  it('睡眠 10 分钟：精力 +40、饱食 -1', () => {
    const v = make({ energy: 10, hunger: 50 });
    v.tick(600, 'sleep', 2, 50);
    assert.equal(v.energy, 50);
    assert.equal(v.hunger, 49);
  });

  it('待机 10 分钟：精力 -2', () => {
    const v = make();
    v.tick(600, 'idle', 14, 50);
    assert.equal(v.energy, 78);
  });

  it('夜里待机反而缓慢恢复（夜间 +1/分 覆盖 -0.2/分）', () => {
    const v = make({ energy: 50 });
    v.tick(600, 'idle', 2, 50); // 深夜 2 点，10 分钟
    assert.ok(v.energy > 50, `深夜待机应回升，实际 ${v.energy}`);
    assert.equal(v.energy, 58);
  });

  it('dt <= 0 不改任何值', () => {
    const v = make({ energy: 50, hunger: 50 });
    v.tick(0, 'working', 14, 50);
    assert.equal(v.energy, 50);
    v.tick(-5, 'working', 14, 50);
    assert.equal(v.energy, 50);
  });
});

describe('VitalsState.tick —— 四维联动', () => {
  it('吃饱 + 心情好 → 睡眠恢复更快', () => {
    const plain = make({ energy: 0, hunger: 50 });
    plain.tick(60, 'sleep', 2, 50);

    const boosted = make({ energy: 0, hunger: 90 });
    boosted.tick(60, 'sleep', 2, 80);

    assert.ok(boosted.energy > plain.energy, `${boosted.energy} 应 > ${plain.energy}`);
  });

  it('饿肚子 → 睡眠恢复减半', () => {
    const plain = make({ energy: 0, hunger: 50 });
    plain.tick(60, 'sleep', 2, 50);

    const hungry = make({ energy: 0, hunger: 10 });
    hungry.tick(60, 'sleep', 2, 50);

    assert.ok(hungry.energy < plain.energy, `${hungry.energy} 应 < ${plain.energy}`);
  });
});

describe('VitalsState.feed —— 喂食', () => {
  it('正常喂食累加饱食', () => {
    const v = make({ hunger: 40 });
    const r = v.feed(25);
    assert.equal(r.applied, 25);
    assert.equal(r.refused, false);
    assert.equal(v.hunger, 65);
  });

  it('饱食 >90 拒绝喂食', () => {
    const v = make({ hunger: 91 });
    const r = v.feed(15);
    assert.equal(r.refused, true);
    assert.equal(r.applied, 0);
    assert.equal(v.hunger, 91);
  });

  it('恰好 90 不拒绝', () => {
    const v = make({ hunger: 90 });
    assert.equal(v.feed(5).refused, false);
  });

  it('夹取上限 100', () => {
    const v = make({ hunger: 85 });
    const r = v.feed(100);
    assert.equal(r.applied, 15);
    assert.equal(v.hunger, 100);
  });

  it('非法 amount 不生效', () => {
    const v = make({ hunger: 50 });
    assert.equal(v.feed(NaN).applied, 0);
    assert.equal(v.feed(-10).applied, 0);
    assert.equal(v.hunger, 50);
  });
});

describe('VitalsState.moodDrainPerMin —— 联动心情', () => {
  it('状态都好 → 不掉心情', () => {
    assert.equal(make({ energy: 80, hunger: 70 }).moodDrainPerMin(), 0);
  });
  it('饿 → 0.5/分', () => {
    assert.equal(make({ energy: 80, hunger: 20 }).moodDrainPerMin(), 0.5);
  });
  it('累 → 0.3/分', () => {
    assert.equal(make({ energy: 10, hunger: 70 }).moodDrainPerMin(), 0.3);
  });
  it('又饿又累 → 0.8/分', () => {
    const v = make({ energy: 10, hunger: 20 });
    assert.ok(Math.abs(v.moodDrainPerMin() - 0.8) < 1e-9);
  });
});

describe('VitalsState.tick —— 跨阈值事件', () => {
  it('精力跌破 autoSleepThreshold → energyLow', () => {
    const v = make({ energy: 20, hunger: 70 });
    const ev = v.tick(300, 'working', 14, 50); // -7.5 → 12.5
    assert.ok(ev.includes('energyLow'), JSON.stringify(ev));
  });

  it('睡眠恢复过 wakeThreshold → wakeUp', () => {
    const v = make({ energy: 88, hunger: 50 });
    const ev = v.tick(60, 'sleep', 2, 50);
    assert.ok(ev.includes('wakeUp'), JSON.stringify(ev));
  });

  it('饱食跌破 hungryThreshold → hungry', () => {
    const v = make({ hunger: 32 });
    const ev = v.tick(300, 'working', 14, 50); // -3 → 29
    assert.ok(ev.includes('hungry'), JSON.stringify(ev));
  });

  it('饱食跌破 starvingThreshold → starving', () => {
    const v = make({ hunger: 17 });
    const ev = v.tick(300, 'working', 14, 50); // -3 → 14
    assert.ok(ev.includes('starving'), JSON.stringify(ev));
  });

  it('喂食把饱食推回阈值以上 → feed 就地发 noLongerHungry', () => {
    // 这个事件本来放在 tick 里判是死代码：喂食是直接跳变（25→45），
    // tick 里的 prevHunger 已经是 45，prev<30 && new>=30 永远不成立。
    // 所以改由 feed() 就地发出，这里锁住该行为。
    const v = make({ hunger: 25 }); // 已在 hungry 线下（<30）
    const r = v.feed(20); // → 45
    assert.ok(r.events.includes('noLongerHungry'), JSON.stringify(r.events));
    assert.equal(v.hunger, 45);
  });

  it('喂食未跨阈值 → 不发 noLongerHungry', () => {
    const v = make({ hunger: 20 });
    const r = v.feed(5); // → 25，仍在 30 以下
    assert.ok(!r.events.includes('noLongerHungry'), JSON.stringify(r.events));
  });
});

describe('VitalsState —— 关闭时完全透传', () => {
  const off = () => new VitalsState({ ...DEFAULT_VITALS_CONFIG, enabled: false }, { energy: 50, hunger: 50 });

  it('tick 不改值、不产事件', () => {
    const v = off();
    const ev = v.tick(600, 'working', 14, 50);
    assert.equal(ev.length, 0);
    assert.equal(v.energy, 50);
    assert.equal(v.hunger, 50);
  });

  it('不联动心情', () => {
    assert.equal(off().moodDrainPerMin(), 0);
  });
});

describe('VitalsState —— snapshot / restore 往返', () => {
  it('保留一位小数', () => {
    const v = make({ energy: 43.7, hunger: 61.2 });
    assert.deepEqual(v.snapshot(), { energy: 43.7, hunger: 61.2 });
  });

  it('restore 往返一致', () => {
    const v = make();
    v.restore(43.7, 61.2);
    assert.equal(v.energy, 43.7);
    assert.equal(v.hunger, 61.2);
  });

  it('restore 忽略非法输入（保持原值）', () => {
    const v = make({ energy: 50, hunger: 50 });
    v.restore(NaN, 'abc' as unknown as number);
    assert.equal(v.energy, 50);
    assert.equal(v.hunger, 50);
  });
});
