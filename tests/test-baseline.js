// 记录测试基线：哪些能跑、哪些因缺 DSH 私有包而无法跑
//
// 为什么需要这个：npm test 有 14 个失败，但**不是代码 bug**，而是
// 5 个测试文件依赖 DSH 宿主的私有包（@deepseek-ai/dsh-*）。
// 这些包在 npm 上只有 0.0.1-rc.x，而项目要求 ^0.2.0-rc.1，版本不匹配。
// 没有它们，这 5 个文件在 import 阶段就 ERR_MODULE_NOT_FOUND。
//
// 本脚本把"可跑的"和"跑不了的"分开统计，避免把环境缺依赖误判成代码回归。
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const APP = process.argv[2] || path.join(__dirname, '..', 'app');
const NODE = process.argv[3] || process.execPath;

// 已知需要 DSH 私有包、当前环境无法跑的测试文件
const NEEDS_DSH = [
  'src/host/model-fallback.test.ts',
  'src/host/routes.test.ts',
  'src/host/work-status-lifecycle.test.ts',
  'src/standalone/context.test.ts',
  'src/standalone/integration.test.ts',
];

// 递归找所有 .test.ts
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
console.log(`=== 测试文件清单：共 ${all.length} 个 ===\n`);

let runnable = 0, skipped = 0;
for (const f of all) {
  const needs = NEEDS_DSH.includes(f);
  if (needs) skipped++;
  else runnable++;
  console.log(`  ${needs ? '[需 DSH 私有包]' : '[可跑]        '} ${f}`);
}

console.log(`\n=== 汇总 ===`);
console.log(`  可跑:        ${runnable}`);
console.log(`  缺依赖跳过:  ${skipped}`);
console.log(`  合计:        ${all.length}`);

console.log(`\n=== 缺依赖的 5 个文件实际报什么 ===`);
for (const f of NEEDS_DSH) {
  const abs = path.join(APP, f);
  if (!fs.existsSync(abs)) { console.log(`  ${f}: 文件不存在`); continue; }
  try {
    const r = execFileSync(NODE, [
      '--experimental-strip-types',
      '--import', './scripts/test-register.mjs',
      '--test', f,
    ], { cwd: APP, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`  ${f}: 意外通过（应重新评估）`);
  } catch (e) {
    const txt = String(e.stdout || '') + String(e.stderr || '');
    const m = txt.match(/Cannot find package '([^']+)'/);
    console.log(`  ${f}: ${m ? '缺包 ' + m[1] : '其它错误（非缺包）'}`);
  }
}

console.log(`\n结论：这 ${skipped} 个文件的失败是**环境缺 DSH 私有包**，不是代码回归。`);
console.log(`      别把它们当成"测试挂了"去改代码。`);
