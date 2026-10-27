// vitals.ts 的桌面端运行版本（纯逻辑，无 DOM / 无 IO）
//
// 精力（energy）与饱食（hunger）——两个按小时级演化的维度，与 mood 的分钟级互补：
//   mood      短期情绪，事件驱动，会快速回归
//   energy    精力，工作消耗 / 睡眠恢复
//   hunger    饱食，随时间下降 / 喂食恢复
//
// 为什么单独一个文件而不是塞进 shared-core.js：
//   shared-core 是 src/shared 的构建产物（自动生成，改它会被下次构建覆盖）；
//   vitals 是新模块，先在这里独立实现，将来并入源码树时直接搬。
//
// 设计要点：
//   1. **纯函数 + 显式时间注入**（now 由调用方传），便于单测，不依赖真实时钟。
//   2. 速率全部用「每分钟」表达（配置好写），内部换算成秒。
//   3. 四维联动按文档 §2 实现，但系数保守 —— 桌宠是陪玩用的，不是养成压力工具。
'use strict';

const clampVitals = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);

/** 活动类型 → 精力消耗/恢复速率（/分钟） */
const ACTIVITY = {
  working: -1.5, // 干活累得快
  playing: -0.5, // 玩也累，但慢
  idle: -0.2,    // 基本不动
  sleep: 4,      // 睡得快（约 25 分钟从 0 到满）
};

/** 夜间待机的额外恢复（不睡也慢慢缓过来） */
const NIGHT_IDLE_RECOVER_PER_MIN = 1;

const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4, 5]);
const isNightHour = (h) => NIGHT_HOURS.has(h);

/** 内置默认配置（与 main-config 的 vitals 段保持一致） */
const DEFAULT_VITALS_CONFIG = {
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
    drainPerMin: 0.4,      // 约 4 小时从饱到饿
    workDrainPerMin: 0.6,  // 干活饿得快
    sleepDrainPerMin: 0.1, // 睡觉消耗慢
    hungryThreshold: 30,
    starvingThreshold: 15,
  },
  // 四维联动系数（文档 §2，但幅度收窄）
  coupling: {
    hungryMoodDrainPerMin: 0.5,   // 饱食<30 时心情 -0.5/分钟
    tiredMoodDrainPerMin: 0.3,    // 精力<20 时心情 -0.3/分钟
    happyEnergyBonus: 1.2,        // 心情>70 时精力恢复 ×1.2
    fullEnergyBonus: 1.3,         // 饱食>80 时精力恢复 ×1.3
  },
};

/** 精力档位（供 UI / 行为分流用） */
function energyBand(energy) {
  if (energy >= 80) return 'energetic';  // 精力充沛
  if (energy >= 40) return 'normal';
  if (energy >= 20) return 'tired';      // 疲惫
  return 'exhausted';                    // 精疲力竭
}

/** 饱食档位 */
function hungerBand(hunger) {
  if (hunger >= 80) return 'full';       // 吃饱
  if (hunger >= 40) return 'normal';
  if (hunger >= 20) return 'hungry';     // 饥饿
  return 'starving';                     // 饿坏
}

/**
 * 精力与饱食状态机。
 *
 * 用法：
 *   const v = new VitalsState(cfg.vitals, { energy: 80, hunger: 70 });
 *   const ev = v.tick(dtSec, 'working', hour, moodValue);  // 推进
 *   v.feed(25);                                            // 喂食
 *   v.snapshot();                                          // 存盘
 */
class VitalsState {
  constructor(cfg, init) {
    this.cfg = cfg || DEFAULT_VITALS_CONFIG;
    const ec = this.cfg.energy || {};
    const hc = this.cfg.hunger || {};
    this._energy = clampVitals(Number(init && init.energy) || Number(ec.initial) || 80);
    this._hunger = clampVitals(Number(init && init.hunger) || Number(hc.initial) || 70);
    // 最近一次产生的事件（调用方可以读它决定要不要播动画）
    this.lastEvents = [];
  }

  get enabled() {
    return this.cfg.enabled === true;
  }

  get energy() { return this._energy; }
  get hunger() { return this._hunger; }
  get energyBand() { return energyBand(this._energy); }
  get hungerBand() { return hungerBand(this._hunger); }

  /**
   * 推进 dt 秒。
   *
   * @param {number} dt     秒
   * @param {string} activity 'working' | 'playing' | 'idle' | 'sleep'
   * @param {number} hour   当前小时（0-23，决定夜间恢复）
   * @param {number} mood   当前心情值（四维联动用，可选）
   * @returns {string[]}    本次触发的事件名（可能为空）
   */
  tick(dt, activity, hour, mood) {
    const events = [];
    if (!this.enabled || !(dt > 0)) { this.lastEvents = events; return events; }
    const mins = dt / 60;
    const ec = this.cfg.energy || {};
    const hc = this.cfg.hunger || {};
    const cc = this.cfg.coupling || {};

    // ---- 精力 ----
    let dEnergy;
    if (activity === 'sleep') {
      let rate = Number(ec.sleepRecoverPerMin ?? ACTIVITY.sleep);
      // 吃饱了恢复快（文档：hunger>80 ×1.3）
      if (this._hunger > 80) rate *= Number(cc.fullEnergyBonus ?? 1.3);
      // 心情好恢复快（文档：mood>70 ×1.2）
      if (typeof mood === 'number' && mood > 70) rate *= Number(cc.happyEnergyBonus ?? 1.2);
      // 饿肚子恢复慢（文档：饱食<30 恢复速度 ×0.5）
      if (this._hunger < 30) rate *= 0.5;
      dEnergy = rate * mins;
    } else {
      const drain = {
        working: Number(ec.workDrainPerMin ?? ACTIVITY.working * -1),
        playing: Number(ec.playDrainPerMin ?? ACTIVITY.playing * -1),
        idle: Number(ec.idleDrainPerMin ?? ACTIVITY.idle * -1),
      }[activity] ?? Number(ec.idleDrainPerMin ?? 0.2);
      dEnergy = -drain * mins;
      // 夜间待机缓慢恢复（不睡也缓过来）
      if (activity === 'idle' && isNightHour(hour)) {
        dEnergy += NIGHT_IDLE_RECOVER_PER_MIN * mins;
      }
    }
    const prevEnergy = this._energy;
    this._energy = clampVitals(this._energy + dEnergy);

    // ---- 饱食 ----
    let drainH;
    if (activity === 'sleep') drainH = Number(hc.sleepDrainPerMin ?? 0.1);
    else if (activity === 'working') drainH = Number(hc.workDrainPerMin ?? 0.6);
    else drainH = Number(hc.drainPerMin ?? 0.4);
    const prevHunger = this._hunger;
    this._hunger = clampVitals(this._hunger - drainH * mins);

    // ---- 跨阈值事件 ----
    const autoSleep = Number(ec.autoSleepThreshold ?? 15);
    const wake = Number(ec.wakeThreshold ?? 90);
    const hungry = Number(hc.hungryThreshold ?? 30);
    const starving = Number(hc.starvingThreshold ?? 15);

    if (prevEnergy >= autoSleep && this._energy < autoSleep) events.push('energyLow');
    if (activity === 'sleep' && prevEnergy < wake && this._energy >= wake) events.push('wakeUp');
    if (prevHunger >= hungry && this._hunger < hungry) events.push('hungry');
    if (prevHunger >= starving && this._hunger < starving) events.push('starving');
    // 越过了"不再饿"的界限（喂食后）
    if (prevHunger < hungry && this._hunger >= hungry) events.push('noLongerHungry');

    this.lastEvents = events;
    return events;
  }

  /**
   * 喂食：恢复饱食。
   * @param {number} amount 恢复量（食物定义里给）
   * @returns {{applied:number, refused:boolean}} refused = 太饱了吃不下（文档：hunger>90 拒绝）
   */
  feed(amount) {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return { applied: 0, refused: false };
    // 太饱了吃不下：文档 §3.2 的"吃饱摆手拒绝"
    if (this._hunger > 90) return { applied: 0, refused: true };
    const before = this._hunger;
    this._hunger = clampVitals(this._hunger + a);
    return { applied: this._hunger - before, refused: false };
  }

  /** 心情的联动衰减量（/分钟）：饿/累会让心情慢慢掉。返回给调用方叠加到 mood.tick 之外 */
  moodDrainPerMin() {
    if (!this.enabled) return 0;
    const cc = this.cfg.coupling || {};
    let drain = 0;
    if (this._hunger < 30) drain += Number(cc.hungryMoodDrainPerMin ?? 0.5);
    if (this._energy < 20) drain += Number(cc.tiredMoodDrainPerMin ?? 0.3);
    return drain;
  }

  /** 读档 */
  restore(e, h) {
    const ne = Number(e), nh = Number(h);
    if (Number.isFinite(ne)) this._energy = clampVitals(ne);
    if (Number.isFinite(nh)) this._hunger = clampVitals(nh);
  }

  /** 存盘 */
  snapshot() {
    return {
      energy: Math.round(this._energy * 10) / 10,
      hunger: Math.round(this._hunger * 10) / 10,
    };
  }
}

// 双环境导出：浏览器挂 window.PET_VITALS，Node 走 module.exports
const __vitalsApi = {
  VitalsState,
  DEFAULT_VITALS_CONFIG,
  ACTIVITY,
  energyBand,
  hungerBand,
  isNightHour,
  clamp: clampVitals,
};
if (typeof module !== 'undefined' && module.exports) module.exports = __vitalsApi;
if (typeof window !== 'undefined') window.PET_VITALS = __vitalsApi;
