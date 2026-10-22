/**
 * 分部位触摸（touch zones）—— 双端接线契约（源码级守卫）。
 *
 * 背景：此前整个命中区只有一个 clicks 池，点脑袋、点肚子、点尾巴同一组动画，逗不起来。
 * 现在按点击处在命中区内的**纵向比例**分流：摸头(<42%) / 撸身子(42%~82%) / 点脚(>=82%)，
 * 且连点同一部位会递进（第 1 次随机、第 2 次中段、第 3 次起末段）。
 *
 * 钉住的不变式：
 *   ① 纯逻辑只在 shared/touch.ts 一份，两端都 import 它（不得各写一套）；
 *   ② 两端都必须把**归一化到命中区内部**的比例喂给 zoneOf（不是整个宠物盒子，
 *      否则外扩 margin 会把头部比例算歪）；
 *   ③ 两端都要维护连点计数，且换部位/超时要归零；
 *   ④ 配置里三个分池全可不写 —— 回落 clicks，老配置逐位不变（这条有单测钉，
 *      这里只守"回落代码路径存在"）。
 *
 * 跑法：node --experimental-strip-types --test src/host/touch-zones-guard.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const browser = read('../client/pet.ts');
const desktop = read('../../runtime/electron-helper/sprite.js');
const core = read('../../runtime/electron-helper/shared-core.js');
const shared = read('../shared/touch.ts');

describe('① 纯逻辑只有一份', () => {
  test('shared/touch.ts 是唯一定义处（zoneOf / decideTouch / poolForZone）', () => {
    assert.ok(/export const zoneOf/.test(shared), 'zoneOf 必须定义在 shared/touch.ts');
    assert.ok(/export const decideTouch/.test(shared), 'decideTouch 必须定义在 shared/touch.ts');
    assert.ok(/export const poolForZone/.test(shared), 'poolForZone 必须定义在 shared/touch.ts');
  });

  test('shared-core.js（桌面构建产物）里有一份镜像，且导出', () => {
    assert.ok(/const zoneOf =/.test(core), 'shared-core.js 必须有 zoneOf');
    assert.ok(/const decideTouch =/.test(core), 'shared-core.js 必须有 decideTouch');
    assert.ok(/exports\.zoneOf = zoneOf/.test(core), '必须导出 zoneOf');
    assert.ok(/exports\.decideTouch = decideTouch/.test(core), '必须导出 decideTouch');
    assert.ok(/exports\.ZONE_LABEL = ZONE_LABEL/.test(core), '必须导出 ZONE_LABEL');
  });

  test('两端都从 shared 取，不自己实现判定', () => {
    assert.ok(/import \{[^}]*zoneOf[^}]*\} from '\.\.\/shared\/touch'/.test(browser), '浏览器端必须 import zoneOf');
    assert.ok(/import \{[^}]*decideTouch[^}]*\} from '\.\.\/shared\/touch'/.test(browser), '浏览器端必须 import decideTouch');
    assert.ok(/S\.zoneOf/.test(desktop), '桌面端必须走 S.zoneOf');
    assert.ok(/S\.decideTouch/.test(desktop), '桌面端必须走 S.decideTouch');
    // 不允许两端各自出现"手写的比例比较"（那必然走样）
    assert.ok(!/headRatio/.test(browser), '浏览器端不得自己比分界（用 zoneOf）');
    assert.ok(!/headRatio/.test(desktop), '桌面端不得自己比分界（用 S.zoneOf）');
  });
});

describe('② 归一化到命中区内部', () => {
  test('浏览器端：ry 由 .dsh-pet-hit 的 rect 算，不是整个宠物盒子', () => {
    assert.ok(/querySelector\('\.dsh-pet-hit'\)/.test(browser), '必须取命中区元素');
    assert.ok(/getBoundingClientRect/.test(browser), '必须量它的实际矩形');
    // 除法要判 height>0，否则除以 0 得 Infinity
    assert.ok(/r\.height > 0/.test(browser), '必须防 height=0（否则 ry=Infinity）');
  });

  test('桌面端：ry 由 this.hit 的 rect 算', () => {
    assert.ok(/this\.hit\.getBoundingClientRect/.test(desktop), '必须量命中区 this.hit');
    assert.ok(/r\.height > 0/.test(desktop), '必须防 height=0');
  });
});

describe('③ 连点计数：同部位递进、换部位/超时归零', () => {
  test('浏览器端有 streak ref，且带 3 秒超时', () => {
    assert.ok(/touchStreakRef/.test(browser), '必须有连点计数 ref');
    assert.ok(/3000/.test(browser), '必须有超时（3 秒）');
    assert.ok(/st\.zone === zone/.test(browser), '换部位必须归零');
  });

  test('桌面端有 streak 字段，且带 3 秒超时', () => {
    assert.ok(/this\.touchStreak/.test(desktop), '必须有连点计数字段');
    assert.ok(/3000/.test(desktop), '必须有超时（3 秒）');
    assert.ok(/st\.zone === zone/.test(desktop), '换部位必须归零');
  });
});

describe('④ 回落链存在（老配置 clicks-only 仍可用）', () => {
  test('shared 的 poolForZone 回落 clicks', () => {
    assert.ok(/anims\.clicks \?\? \[\]/.test(shared), '没配该部位必须回落 clicks');
  });

  test('shared-core 镜像同样回落', () => {
    assert.ok(/anims\.clicks \?\? \[\]/.test(core), '桌面侧同样回落 clicks');
  });

  test('两端都不再出现"clicks 为空就直接 return"的旧守卫（那会漏掉分池）', () => {
    // 旧写法：if (!petAnims.clicks.length) return;  —— 分池配了但 clicks 空时会误判
    assert.ok(
      !/if \(!petAnims\.clicks\.length\) return/.test(browser),
      '浏览器端不得再用 clicks 非空作总守卫（应看 decideTouch 的返回值）',
    );
    assert.ok(
      !/if \(!this\.animations\.clicks\.length\) return/.test(desktop),
      '桌面端不得再用 clicks 非空作总守卫',
    );
  });
});

describe('⑤ 菜单 / 日志可辨识', () => {
  test('两端日志都带部位标签（排查时能看出点的是哪）', () => {
    assert.ok(/ZONE_LABEL\[zone\]/.test(browser), '浏览器端日志要带部位');
    assert.ok(/S\.ZONE_LABEL\[zone\]/.test(desktop), '桌面端日志要带部位');
  });
});

describe('⑦ 事件形参必须声明（严格模式下漏了 = 点击全死）', () => {
  // 根因：sprite.js 第 8 行是 'use strict'，onClick() 若不带形参却在函数体里用 e，
  // 会抛 ReferenceError: e is not defined，整个点击处理被干掉 —— 症状就是"点击没反应"，
  // 而且没有任何日志（异常发生在事件回调里，被浏览器吞掉只报 console）。
  // 两端都钉住：签名必须带形参，且调用处必须把事件传进去。
  test('桌面端 onClick(e) 带形参，且监听处把事件传进去', () => {
    assert.ok(/\n  onClick\(e\) \{/.test(desktop), 'sprite.js 的 onClick 必须声明形参 e');
    assert.ok(
      /addEventListener\('click', \(e\) => this\.onClick\(e\)/.test(desktop),
      'click 监听必须把事件对象传给 onClick',
    );
  });

  test('浏览器端 handleClick 带形参（React onClick 会给 SyntheticEvent）', () => {
    assert.ok(/const handleClick = \(e\?/.test(browser), 'pet.ts 的 handleClick 必须声明形参');
  });

  test('两端函数体里都真的用到了 e.clientY（说明形参不是白写）', () => {
    const onClickBody = /\n  onClick\(e\) \{([\s\S]*?)\n  \}/.exec(desktop);
    assert.ok(onClickBody, '取不到 onClick 方法体');
    assert.ok(/e\.clientY/.test(onClickBody[1]), '桌面端 onClick 必须读 e.clientY');
    const clickBody = /const handleClick = \(e\?:[^)]*\) => \{([\s\S]*?)\n    \};/.exec(browser);
    assert.ok(clickBody, '取不到 handleClick 方法体');
    assert.ok(/e\.clientY/.test(clickBody[1]), '浏览器端 handleClick 必须读 e.clientY');
  });
});

describe('⑧ 配置里的池（内置默认）', () => {
  test('config.jsonc 配了三个分池，且都是配置里存在的动画名', () => {
    const raw = read('../../assets/config.jsonc');
    for (const key of ['clicksHead', 'clicksBody', 'clicksFeet']) {
      assert.ok(new RegExp(`"${key}"`).test(raw), `config.jsonc 应配 ${key}`);
    }
    // 池里的每个名字都必须在 animations 段出现过（防 404）
    for (const [key, names] of [
      ['clicksHead', ['点击回应-害羞惊讶', '点击回应-开心跃动', '点击回应-挠痒咯咯笑']],
      ['clicksBody', ['点击回应-元气挥手', '点击回应-开心跃动', '点击回应-傲娇生气']],
      ['clicksFeet', ['被吓一跳', '被吓一跳（炸毛）']],
    ] as const) {
      const block = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`).exec(raw);
      assert.ok(block, `${key} 段应存在`);
      for (const n of names) assert.ok(block[1].includes(n), `${key} 应含 ${n}`);
      for (const n of names) {
        assert.ok(raw.includes(`"${n}"`), `${n} 必须在配置里出现过（否则 404）`);
      }
    }
  });
});
