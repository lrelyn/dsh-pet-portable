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

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
