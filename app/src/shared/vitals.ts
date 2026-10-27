// vitals.ts —— 精力与饱食状态机（纯逻辑，两端共用）
//
// 这是 runtime 版 app/runtime/electron-helper/vitals.js 的 TypeScript 源。
// 两边必须保持一致：runtime 的是实际运行的（浏览器 <script> 直接加载），
// 这份是类型来源与回归测试目标。
//
// 为什么要两份：本项目发布时带的是构建产物（app/lib/*.js）+ runtime 的 .js，
// 上游用 tsdown 打包，仓库里没有 P2 模块的 TS 源。补上后：
//   1. 有类型检查，改错字段名能立刻发现
//   2. 重新 bundle 时不会丢掉这些逻辑
//   3. 有单测保护（vitals.test.ts）
//
// 双份的维护约定：改逻辑时**先改这份 .ts**，再同步到 runtime 的 .js
// （runtime 那份是 UMD 风格的纯 JS，含双环境导出）。

/** 活动类型：决定精力消耗/恢复速率 */
export type Activity = 'working' | 'playing' | 'idle' | 'sleep';

/** 精力档位 */
export type EnergyBand = 'energetic' | 'normal' | 'tired' | 'exhausted';
/** 饱食档位 */
export type HungerBand = 'full' | 'normal' | 'hungry' | 'starving';

/** tick 可能触发的事件 */
export type VitalsEvent = 'energyLow' | 'wakeUp' | 'hungry' | 'starving' | 'noLongerHungry';

export interface VitalsConfig {
  enabled: boolean;
  energy: {
    initial: number;
    workDrainPerMin: number;
    playDrainPerMin: number;
    idleDrainPerMin: number;
    sleepRecoverPerMin: number;
    autoSleepThreshold: number;
    wakeThreshold: number;
  };
  hunger: {
    initial: number;
    drainPerMin: number;
    workDrainPerMin: number;
    sleepDrainPerMin: number;
    hungryThreshold: number;
    starvingThreshold: number;
  };
  /** 四维联动系数（饿/累拖低心情；心情好/吃饱加快恢复） */
  coupling: {
    hungryMoodDrainPerMin: number;
    tiredMoodDrainPerMin: number;
    happyEnergyBonus: number;
    fullEnergyBonus: number;
  };
}

const clampVitals = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v);

/** 夜间小时集合（22,23,0..5） */
const NIGHT_HOURS: ReadonlySet<number> = new Set([22, 23, 0, 1, 2, 3, 4, 5]);
export const isNightHour = (hour: number): boolean => NIGHT_HOURS.has(hour);

/** 夜间待机的额外恢复（不睡也慢慢缓过来，/分钟） */
const NIGHT_IDLE_RECOVER_PER_MIN = 1;

/** 内置默认配置（与 main-config 的 vitals 段保持一致） */
export const DEFAULT_VITALS_CONFIG: VitalsConfig = {
  enabled: false,
  energy: {
    initial: 80,
    workDrainPerMin: 1.5,
    playDrainPerMin: 0.5,
    idleDrainPerMin: 0.2,
    sleepRecoverPerMin: 4,
    autoSleepThreshold: 15,
    wakeThreshold: 90,
  },
  hunger: {
    initial: 70,
    drainPerMin: 0.4,
    workDrainPerMin: 0.6,
    sleepDrainPerMin: 0.1,
    hungryThreshold: 30,
    starvingThreshold: 15,
  },
  coupling: {
    hungryMoodDrainPerMin: 0.5,
    tiredMoodDrainPerMin: 0.3,
    happyEnergyBonus: 1.2,
    fullEnergyBonus: 1.3,
  },
};

/** 精力档位（供 UI / 行为分流用） */
export const energyBand = (energy: number): EnergyBand => {
  if (energy >= 80) return 'energetic';
  if (energy >= 40) return 'normal';
  if (energy >= 20) return 'tired';
  return 'exhausted';
};

/** 饱食档位 */
export const hungerBand = (hunger: number): HungerBand => {
  if (hunger >= 80) return 'full';
  if (hunger >= 40) return 'normal';
  if (hunger >= 20) return 'hungry';
  return 'starving';
};

/**
 * 精力与饱食状态机。
 *
 * 用法：
 *   const v = new VitalsState(cfg.vitals, { energy: 80, hunger: 70 });
 *   const ev = v.tick(dtSec, 'working', hour, moodValue);
 *   v.feed(25);
 *   v.snapshot();
 */
export class VitalsState {
  private readonly cfg: VitalsConfig;
  private _energy: number;
  private _hunger: number;
  /** 最近一次 tick 产生的事件（调用方读它决定要不要播动画） */
  lastEvents: VitalsEvent[] = [];

  constructor(cfg?: VitalsConfig, init?: { energy?: number; hunger?: number }) {
    this.cfg = cfg ?? DEFAULT_VITALS_CONFIG;
    const ec = this.cfg.energy;
    const hc = this.cfg.hunger;
    this._energy = clampVitals(Number(init?.energy) || Number(ec.initial) || 80);
    this._hunger = clampVitals(Number(init?.hunger) || Number(hc.initial) || 70);
  }

  get enabled(): boolean {
    return this.cfg.enabled === true;
  }
  get energy(): number {
    return this._energy;
  }
  get hunger(): number {
    return this._hunger;
  }
  get energyBand(): EnergyBand {
    return energyBand(this._energy);
  }
  get hungerBand(): HungerBand {
    return hungerBand(this._hunger);
  }

  /**
   * 推进 dt 秒。
   * @param dt 秒
   * @param activity 活动类型
   * @param hour 当前小时（0-23，决定夜间恢复）
   * @param mood 当前心情值（四维联动用，可选）
   * @returns 本次触发的事件名（可能为空）
   */
  tick(dt: number, activity: Activity, hour: number, mood?: number): VitalsEvent[] {
    const events: VitalsEvent[] = [];
    if (!this.enabled || !(dt > 0)) {
      this.lastEvents = events;
      return events;
    }
    const mins = dt / 60;
    const ec = this.cfg.energy;
    const hc = this.cfg.hunger;
    const cc = this.cfg.coupling;

    // ---- 精力 ----
    let dEnergy: number;
    if (activity === 'sleep') {
      let rate = ec.sleepRecoverPerMin;
      // 吃饱了恢复快
      if (this._hunger > 80) rate *= cc.fullEnergyBonus;
      // 心情好恢复快
      if (typeof mood === 'number' && mood > 70) rate *= cc.happyEnergyBonus;
      // 饿肚子恢复慢
      if (this._hunger < 30) rate *= 0.5;
      dEnergy = rate * mins;
    } else {
      const drain =
        activity === 'working'
          ? ec.workDrainPerMin
          : activity === 'playing'
            ? ec.playDrainPerMin
            : ec.idleDrainPerMin;
      dEnergy = -drain * mins;
      // 夜间待机缓慢恢复
      if (activity === 'idle' && isNightHour(hour)) {
        dEnergy += NIGHT_IDLE_RECOVER_PER_MIN * mins;
      }
    }
    const prevEnergy = this._energy;
    this._energy = clampVitals(this._energy + dEnergy);

    // ---- 饱食 ----
    const drainH =
      activity === 'sleep'
        ? hc.sleepDrainPerMin
        : activity === 'working'
          ? hc.workDrainPerMin
          : hc.drainPerMin;
    const prevHunger = this._hunger;
    this._hunger = clampVitals(this._hunger - drainH * mins);

    // ---- 跨阈值事件 ----
    if (prevEnergy >= ec.autoSleepThreshold && this._energy < ec.autoSleepThreshold) {
      events.push('energyLow');
    }
    if (
      activity === 'sleep' &&
      prevEnergy < ec.wakeThreshold &&
      this._energy >= ec.wakeThreshold
    ) {
      events.push('wakeUp');
    }
    if (prevHunger >= hc.hungryThreshold && this._hunger < hc.hungryThreshold) {
      events.push('hungry');
    }
    if (prevHunger >= hc.starvingThreshold && this._hunger < hc.starvingThreshold) {
      events.push('starving');
    }
    if (prevHunger < hc.hungryThreshold && this._hunger >= hc.hungryThreshold) {
      events.push('noLongerHungry');
    }

    this.lastEvents = events;
    return events;
  }

  /**
   * 喂食：恢复饱食。
   *
   * **会在这里就地发出 noLongerHungry 事件**（而不是留给 tick）：
   * 喂食是直接跳变（25 → 45），tick 里的 prevHunger 已经是跳变后的值，
   * 条件 prev < 30 && new >= 30 永远不成立 —— 若只在 tick 里判，
   * 这个事件就是死代码。返回的 events 供调用方播"吃饱了"反馈。
   *
   * @returns applied = 实际恢复量；refused = 太饱了吃不下（>90）；events = 产生的事件
   */
  feed(amount: number): { applied: number; refused: boolean; events: VitalsEvent[] } {
    const events: VitalsEvent[] = [];
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return { applied: 0, refused: false, events };
    if (this._hunger > 90) return { applied: 0, refused: true, events };

    const before = this._hunger;
    const thr = this.cfg.hunger.hungryThreshold;
    this._hunger = clampVitals(this._hunger + a);
    // 跨过"不再饿"的界限 → 就地发事件
    if (before < thr && this._hunger >= thr) events.push('noLongerHungry');

    this.lastEvents = events;
    return { applied: this._hunger - before, refused: false, events };
  }

  /** 心情的联动衰减量（/分钟）：饿/累会让心情慢慢掉 */
  moodDrainPerMin(): number {
    if (!this.enabled) return 0;
    const cc = this.cfg.coupling;
    let drain = 0;
    if (this._hunger < 30) drain += cc.hungryMoodDrainPerMin;
    if (this._energy < 20) drain += cc.tiredMoodDrainPerMin;
    return drain;
  }

  /** 读档 */
  restore(energy: number, hunger: number): void {
    const ne = Number(energy);
    const nh = Number(hunger);
    if (Number.isFinite(ne)) this._energy = clampVitals(ne);
    if (Number.isFinite(nh)) this._hunger = clampVitals(nh);
  }

  /** 存盘 */
  snapshot(): { energy: number; hunger: number } {
    return {
      energy: Math.round(this._energy * 10) / 10,
      hunger: Math.round(this._hunger * 10) / 10,
    };
  }
}
