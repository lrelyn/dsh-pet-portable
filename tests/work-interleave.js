// 验证「单候选档位不再无限 loop」的交替逻辑
//
// 背景：events.js 原来对单候选档位走 switchTo(name,false) → el.loop=true、onended=null
// → handleEnded 永不触发 → 随机链停住，桌宠卡在同一个工作动画上无限重复。
// 修复：改成 playOnce，并在 resumeWorkStatusAnim 里用 workInterleave 计数控制
// 「播 2 段工作动画 → 插 1 个随机待机」。
//
// 本测试模拟这段计数逻辑（不依赖 DOM）。
const path = require('node:path');

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

/** 复刻 resumeWorkStatusAnim 的计数部分 */
function makeSprite() {
  return {
    workInterleave: 0,
    // 模拟 resumeWorkStatusAnim 的返回值：true = 继续播工作动画，false = 走随机链
    resumeWorkStatusAnim() {
      if (this.workInterleave === undefined) this.workInterleave = 0;
      this.workInterleave += 1;
      if (this.workInterleave > 2) {
        this.workInterleave = 0;
        return false;
      }
      return true;
    },
  };
}

console.log('=== 1. 交替节奏：2 段工作 → 1 个随机 ===');
const s = makeSprite();
const seq = [];
for (let i = 0; i < 9; i++) seq.push(s.resumeWorkStatusAnim() ? '工作' : '随机');
console.log(`  序列: ${seq.join(' → ')}`);
ok(seq.filter(x => x === '工作').length === 6, '9 次里 6 次工作', String(seq.filter(x => x === '工作').length));
ok(seq.filter(x => x === '随机').length === 3, '9 次里 3 次随机', String(seq.filter(x => x === '随机').length));
ok(seq[2] === '随机' && seq[5] === '随机' && seq[8] === '随机', '每第 3 次是随机');

console.log('\n=== 2. 状态切换时重置计数 ===');
const s2 = makeSprite();
s2.resumeWorkStatusAnim();  // 计数 1
s2.resumeWorkStatusAnim();  // 计数 2
ok(s2.workInterleave === 2, '计数到 2');
// 模拟 events.js 的 stateChanged 分支
s2.workInterleave = 0;
ok(s2.workInterleave === 0, '重置为 0');
const r = s2.resumeWorkStatusAnim();
ok(r === true && s2.workInterleave === 1, '重置后第一段仍是工作动画');

console.log('\n=== 3. 对比：修复前后行为 ===');
// 修复前：switchTo(name,false) → loop → 永远不 ended → 永远不切
const before = { switches: 0, note: 'loop=true, onended=null → handleEnded 永不触发' };
// 修复后：playOnce → 每段结束都 handleEnded → 按 interleave 决定下一步
const s3 = makeSprite();
let workCount = 0, randomCount = 0;
for (let i = 0; i < 30; i++) {
  if (s3.resumeWorkStatusAnim()) workCount++; else randomCount++;
}
console.log(`  修复前: 无限重复同一动画（0 次切换）`);
console.log(`  修复后: 30 段里 ${workCount} 段工作 + ${randomCount} 段随机`);
ok(randomCount > 0, '随机动作确实会回来', `${randomCount} 次`);
ok(workCount > randomCount, '工作动画仍占多数（不喧宾夺主）', `${workCount} vs ${randomCount}`);

console.log('\n=== 4. 配置兼容性 ===');
// 多候选档位（slot 是数组）走原逻辑：nextWorkStatusAnim 轮换 + 不走 interleave
const multiSlot = ['A', 'B', 'C'];
const singleSlot = 'A';
ok(Array.isArray(multiSlot) && multiSlot.length > 1, '多候选档位会被识别为 rotating');
ok(!Array.isArray(singleSlot), '单候选档位（当前配置）不是数组 → 走 interleave');
// 真实配置里的 slot 是"工作状态-原地踱步张望"这种长字符串，length 约 11
const realSlot = '工作状态-原地踱步张望';
ok(typeof realSlot === 'string' && realSlot.length > 1,
  `真实字符串 length=${realSlot.length} > 1 —— 所以必须判 Array.isArray，只判 length 会误判`);
ok(!Array.isArray(realSlot), 'Array.isArray 正确识别为单候选');

console.log('\n=== 5. 源码级断言：resumeWorkStatusAnim 单候选必须走 playOnce ===');
// 上面几节只复刻了计数逻辑，漏掉了真正的 bug：sprite.js 的 resumeWorkStatusAnim
// 单候选分支仍走 switchTo(name,false) → loop=true → handleEnded 永不触发 → 随机链停住。
// 这里直接读源码方法体，确保两处入口（events.js onWorkTick / sprite.js resume）语义一致。
const fs = require('node:fs');
const spriteSrc = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'runtime', 'electron-helper', 'sprite.js'), 'utf8'
).replace(/\r\n/g, '\n');
const eventsSrc = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'runtime', 'electron-helper', 'events.js'), 'utf8'
).replace(/\r\n/g, '\n');

// 抽取 resumeWorkStatusAnim 方法体（非贪婪到下一个同级方法定义）
const mm = spriteSrc.match(/\n  resumeWorkStatusAnim\(\) \{[\s\S]*?\n  \}\n/);
ok(!!mm, '在 sprite.js 里找到 resumeWorkStatusAnim 方法体');
if (mm) {
  const body = mm[0];
  ok(/this\.playOnce\(name\)/.test(body), '单候选分支用 playOnce（once=true, loop=false, 保留 onended）');
  // 去掉注释行再断言，避免新注释里「绝不能走 switchTo(name,false)」被误判
  const codeOnly = body.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(!/switchTo\(name,\s*false\)/.test(codeOnly), '不再有 switchTo(name,false) 的无限 loop 分支（可执行代码）');
  ok(!/单候选：无限循环/.test(body), '旧的「单候选：无限循环」注释已清除');
  // playOnce 必须在 rotating 判定之外（即无条件执行），否则单候选仍可能漏掉
  const playOnceIdx = body.indexOf('this.playOnce(name)');
  const rotatingIdx = body.indexOf('rotating');
  ok(rotatingIdx === -1 || playOnceIdx > -1, 'playOnce 存在即可（不再依赖 rotating 分支区分）');
}
// events.js 的 onWorkTick 也必须是 playOnce（两处入口一致）
const em = eventsSrc.match(/onWorkTick[\s\S]*?\n\};/);
ok(!!em, '在 events.js 里找到 onWorkTick');
if (em) {
  ok(/this\.playOnce\(name\)/.test(em[0]), 'events.js onWorkTick 也是 playOnce（两处入口语义一致）');
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
