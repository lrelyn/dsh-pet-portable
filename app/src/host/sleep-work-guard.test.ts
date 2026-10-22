/**
 * 睡眠 / 工作链的「素材缺失不许假死」契约（源码级守卫）。
 *
 * 背景（本次故障）：`.dsh` 配置把动画池精简到 5 类，把睡眠三段与工作 7 段的名字删了，
 * 而这两个功能的名字在 sprite.js 里是**写死常量**。结果：
 *   · 工作链有 `if (!mid.length) return` 保护 → 只是永远进不去；
 *   · 睡眠链**没有**保护 → PET_SLEEP_On 置 true 后 switchTo 一个不存在的名字，
 *     video 404 → loadGuard 释放 pending → 没有任何动画在播，而 On 把随机链挡住
 *     （handleEnded 里 `if (On) { Loop(); return; }`）→ 宠物永久静止的「假睡」。
 *
 * 这两条不变式必须钉住：
 *   ① 任何进入睡眠态的入口（空闲到期 / 菜单点播）都必须先 hasAnim 校验；
 *      循环段 / 唤醒段同样要校验（半边配置：有第一段没第二段）；
 *   ② 两个轮询定时器（睡眠探测 / 工作探测）的 handle 必须存字段，
 *      否则 dispose 清不掉，重载配置会越攒越多（泄漏）。
 *
 * 跑法：node --experimental-strip-types --test src/host/sleep-work-guard.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sprite = readFileSync(fileURLToPath(new URL('../../runtime/electron-helper/sprite.js', import.meta.url)), 'utf8');

/** 取某个方法体（从 `  方法名(...) {` 到配对的 `}`） */
function body(name: string): string {
  const re = new RegExp('\\n  ' + name + '\\([^)]*\\) \\{');
  const m = re.exec(sprite);
  assert.ok(m, `sprite.js 里找不到方法 ${name}(...)`);
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (depth > 0 && i < sprite.length) {
    if (sprite[i] === '{') depth++;
    else if (sprite[i] === '}') depth--;
    i++;
  }
  return sprite.slice(start, i - 1);
}

describe('睡眠链：素材缺失不许假死', () => {
  test('PET_SLEEP_Start 先校验再置 On（曾经的假睡根因）', () => {
    const b = body('PET_SLEEP_Start');
    assert.ok(/hasAnim/.test(b), 'PET_SLEEP_Start 必须校验素材存在');
    // 守卫必须出现在 `this.PET_SLEEP_On = true` 之前：置了 On 再发现没素材，
    // 随机链已经被挡住，等于已经进了假睡。
    const guard = b.indexOf('hasAnim');
    const on = b.indexOf('this.PET_SLEEP_On = true');
    assert.ok(guard !== -1 && on !== -1, '两处都必须存在');
    assert.ok(guard < on, 'hasAnim 守卫必须在 PET_SLEEP_On = true 之前');
  });

  test('PET_SLEEP_Start 校验的是第一段与循环段两段', () => {
    const b = body('PET_SLEEP_Start');
    assert.ok(/PET_SLEEP_IN/.test(b) && /PET_SLEEP_LOOP/.test(b), '两段都要查（有第一段没第二段 = 半边配置）');
  });

  test('PET_SLEEP_Loop 也校验（半边配置：第一段有、循环段没有）', () => {
    const b = body('PET_SLEEP_Loop');
    assert.ok(/hasAnim\(PET_SLEEP_LOOP\)/.test(b), '循环段缺失必须被发现');
    assert.ok(
      /PET_SLEEP_On = false/.test(b),
      '循环段缺失要脱离睡眠态回随机链，不能空转着把随机链继续挡住',
    );
  });

  test('PET_SLEEP_Wake 也校验（缺失时走 Skip，不 switchTo 不存在的名字）', () => {
    const b = body('PET_SLEEP_Wake');
    assert.ok(/hasAnim\(PET_SLEEP_WAKE\)/.test(b), '唤醒段缺失必须被发现');
    assert.ok(/PET_SLEEP_Skip\(\)/.test(b), '缺失时直接 Skip（脱离睡眠态），不能照旧 switchTo');
  });

  test('PET_SLEEP_FromMenu 也校验（菜单点播同样不能假睡）', () => {
    const b = body('PET_SLEEP_FromMenu');
    assert.ok(/hasAnim/.test(b), '菜单点播入口必须校验');
    const guard = b.indexOf('hasAnim');
    const on = b.indexOf('this.PET_SLEEP_On = true');
    assert.ok(guard < on, '守卫必须早于置 On');
  });
});

describe('工作链：素材缺失不许刷屏', () => {
  test('WORK_Tick 对空池加冷却（否则每 5 秒一条 warn 刷满日志）', () => {
    const b = body('WORK_Tick');
    assert.ok(/hasAnim/.test(b), 'WORK_Tick 应预判空池');
    assert.ok(
      /PET_WORK_RECHARGE_MS/.test(b),
      '空池时必须按 PET_WORK_RECHARGE_MS 冷却再 warn，不能每 tick 都打',
    );
  });

  test('WORK_Start 保留原有 mid.length 守卫', () => {
    const b = body('WORK_Start');
    assert.ok(/if \(!mid\.length\)/.test(b), 'WORK_Start 的空池守卫不能丢');
  });
});

describe('轮询定时器：handle 必须可清理', () => {
  test('两个 setInterval 的返回值都存进 this 字段', () => {
    assert.ok(/this\._sleepTimer\s*=\s*setInterval/.test(sprite), '睡眠探测定时器必须存 this._sleepTimer');
    assert.ok(/this\._workTimer\s*=\s*setInterval/.test(sprite), '工作探测定时器必须存 this._workTimer');
    // 不允许再有裸 setInterval（不存 handle 的那种）
    const bare = sprite.match(/(?<!=)\bsetInterval\(/g) ?? [];
    assert.equal(bare.length, 2, `sprite.js 应恰好 2 个 setInterval（都已存 handle），实际 ${bare.length}`);
  });

  test('dispose 清掉两个轮询定时器 + 睡眠兜底定时器', () => {
    const b = body('dispose');
    assert.ok(/clearInterval\(this\._sleepTimer\)/.test(b), 'dispose 必须 clearInterval(this._sleepTimer)');
    assert.ok(/clearInterval\(this\._workTimer\)/.test(b), 'dispose 必须 clearInterval(this._workTimer)');
    assert.ok(/clearTimeout\(this\.PET_SLEEP_Timer\)/.test(b), 'dispose 必须清睡眠兜底定时器');
  });
});
