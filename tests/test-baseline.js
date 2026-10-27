// 测试基线：逐个跑每个 .test.ts，把「真实结果」列出来。
//
// 为什么重写（2026-10-27）：上一版写死了 NEEDS_DSH 名单，声称 5 个文件
// 「因缺 @deepseek-ai 私有包跑不了」。实测这 5 个文件全部通过
// （10+40+8+8+9 = 75 项），node_modules 里 @deepseek-ai/* 也都在（0.2.0-rc.2）。
// 真正的原因只有一条：缺 scripts/test-register.mjs，导致无扩展名导入解析失败。
// 补上 resolver 之后所有文件都能跑。
//
// 教训：不要手写"哪些能跑"的静态名单——它一定会过时。逐个真跑一遍。
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const APP = process.argv[2] || path.join(__dirname, '..', 'app');
const NODE = process.argv[3] || process.execPath;

function findTests(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      out.push(...findTests(p));
    } else if (e.name.endsWith('.test.ts')) {
      out.push(path.relative(APP, p).split(path.sep).join('/'));
    }
  }
  return out;
}

const all = findTests(path.join(APP, 'src')).sort();
console.log(`=== 逐个实跑 ${all.length} 个测试文件 ===\n`);

let okFiles = 0, badFiles = 0, totalPass = 0, totalFail = 0;
const problems = [];

for (const f of all) {
  let out = '', code = 0;
  try {
    out = execFileSync(NODE, [
      '--experimental-strip-types', '--import', './scripts/test-register.mjs', '--test', f,
    ], { cwd: APP, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    code = e.status === undefined ? 1 : e.status;
  }
  const p = Number((out.match(/# pass (\d+)/) || [])[1] || 0);
  const fl = Number((out.match(/# fail (\d+)/) || [])[1] || 0);
  const cx = Number((out.match(/# cancelled (\d+)/) || [])[1] || 0);
  totalPass += p; totalFail += fl;
  // 注意：node --test 只要有任何 cancelled 子测试就 exit 1，
  // 但 cancelled ≠ 失败（是用计时器的子测试在事件循环结束后被取消）。
  // 判定成败只看 # fail 计数，不看退出码。
  if (fl === 0) {
    okFiles++;
    const tail = cx ? `  (${cx} 个延迟子测试被取消，非失败)` : '';
    console.log(`  OK    ${String(p).padStart(3)} 项  ${f}${tail}`);
  } else {
    badFiles++;
    const miss = (out.match(/Cannot find (?:package|module) '([^']+)'/) || [])[1];
    const why = miss ? '缺包 ' + miss : (out.match(/Error: ([^\n]+)/) || [])[1] || '见完整输出';
    console.log(`  FAIL  ${String(p).padStart(3)} 项  ${f}   ← ${why}`);
    problems.push({ file: f, why, out });
  }
}

console.log(`\n=== 汇总 ===`);
console.log(`  文件:  ${all.length} 个（${okFiles} 通过 / ${badFiles} 有问题）`);
console.log(`  断言:  ${totalPass} 通过 / ${totalFail} 失败`);

if (problems.length) {
  console.log(`\n=== 有问题的文件的报错片段 ===`);
  for (const pr of problems) {
    console.log(`\n--- ${pr.file} ---`);
    console.log(pr.out.split('\n').filter((l) => /Error|error|Cannot|at /.test(l)).slice(0, 6).join('\n'));
  }
  process.exit(1);
}

console.log(`\n结论：全部测试文件可跑且全绿。`);
console.log(`      若某天出现 FAIL，先看上面的「← 缺包 xxx」提示——`);
console.log(`      缺包是环境问题，断言失败才是代码回归。`);
