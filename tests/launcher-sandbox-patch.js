// 验证 launcher 的 --no-sandbox 补丁可以就地还原，不会把 standalone.js 回退成旧构建
//
// 背景：launcher 原来在首次打补丁时把 standalone.js 存成 standalone.js.pristine，
// 关闭补丁时整文件拷回去。那份快照会冻结在「第一次需要回退的那次构建」上：
// 2026-10-07 的快照比当前构建少 298 行，于是任何后续重新构建都会被它静默回滚。
// 现在改成「补丁是固定的一行插入，还原就是把这行删掉」，不需要任何备份。
//
// 本测试从 launcher.js 源码里取出真实的 setNoSandbox / PATCH_MARK / ANCHOR / PATCHED
// 来跑（不是抄一份副本），所以常量改了这里会跟着变。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const LAUNCHER = path.join(ROOT, 'launcher.js');

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n + ' ' + e); } };

const src = fs.readFileSync(LAUNCHER, 'utf8');

// --- 从源码取常量 -----------------------------------------------------------
function constOf(name) {
  // const NAME = '...'; 或 const NAME = '...' + PATCH_MARK;
  const line = src.split('\n').find((l) => l.trim().startsWith('const ' + name + ' ='));
  if (!line) return null;
  if (name === 'PATCHED') {
    const tail = line.match(/\+\s*PATCH_MARK/);
    const lit = line.match(/=\s*'((?:[^'\\]|\\.)*)'/);
    return { literal: lit ? lit[1] : null, concatenatesMark: !!tail };
  }
  const m = line.match(/=\s*'((?:[^'\\]|\\.)*)'\s*;/);
  return m ? JSON.parse('"' + m[1].replace(/"/g, '\\"').replace(/\\t/g, '\\t') + '"') : null;
}

const RAW_MARK = constOf('PATCH_MARK');
const ANCHOR = constOf('ANCHOR');
const PATCHED_LITERAL = constOf('PATCHED');

// --- 从源码取函数体 ---------------------------------------------------------
function extractFunction(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

const FN_BODY = extractFunction('setNoSandbox');

console.log('=== 0. 从 launcher.js 取到的运行时事实 ===');
console.log('  PATCH_MARK   =', JSON.stringify(RAW_MARK));
console.log('  ANCHOR       =', JSON.stringify(ANCHOR));
console.log('  PATCHED 字面 =', JSON.stringify(PATCHED_LITERAL && PATCHED_LITERAL.literal));
ok(typeof RAW_MARK === 'string' && RAW_MARK.length > 0, 'PATCH_MARK 解析成非空字符串');
ok(typeof ANCHOR === 'string' && ANCHOR.length > 0, 'ANCHOR 解析成非空字符串');
ok(!!PATCHED_LITERAL && PATCHED_LITERAL.concatenatesMark === true,
  'PATCHED 由字面量 + PATCH_MARK 拼成（所以还原时能精确删掉这一行）');
ok(FN_BODY !== null && FN_BODY.length > 200, 'setNoSandbox 函数体抽取成功（未截断）');

const PATCH_MARK = RAW_MARK;
const PATCHED = PATCHED_LITERAL && PATCHED_LITERAL.literal !== null
  ? PATCHED_LITERAL.literal + PATCH_MARK
  : null;

// --- 用临时目录 + 真实的函数体跑 ---------------------------------------------
const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pet-sandbox-'));
const HOST_SRC = path.join(sandboxDir, 'standalone.js');

const said = [];
function say(msg) { said.push(String(msg)); }

function makeSetNoSandbox(fnBody) {
  // 依赖注入：真实函数体 + 测试的 fs/say/HOST_SRC/常量
  const factory = new Function(
    'fs', 'say', 'HOST_SRC', 'PATCH_MARK', 'ANCHOR', 'PATCHED',
    fnBody + '\nreturn setNoSandbox;'
  );
  return factory(fs, say, HOST_SRC, PATCH_MARK, ANCHOR, PATCHED);
}

const setNoSandbox = makeSetNoSandbox(FN_BODY);

// 一份"当前构建"：含锚点一次，且与任何历史快照都不同（多一行独有标记）
const BUILD = [
  '// fake standalone build',
  'const x = 1;',
  '\t\targs: [helperPath]',
  'const FEATURE_MARKER_THIS_BUILD_ONLY = true;',
  'module.exports = {};',
  '',
].join('\n');

console.log('\n=== 1. 打补丁 ===');
fs.writeFileSync(HOST_SRC, BUILD, 'utf8');
const patchOk = setNoSandbox(true);
const afterPatch = fs.readFileSync(HOST_SRC, 'utf8');
ok(patchOk === true, 'setNoSandbox(true) 返回 true');
ok(afterPatch.includes(PATCH_MARK), '打完补丁文件里出现标记');
ok(afterPatch.includes(BUILD.split('\n')[3]), '构建独有的那行仍在（没有被换成别的构建）');
ok(!fs.existsSync(HOST_SRC + '.pristine'), '没有生成 .pristine 备份文件');

console.log('\n=== 2. 重复打补丁是幂等的 ===');
const patchAgain = setNoSandbox(true);
const afterPatch2 = fs.readFileSync(HOST_SRC, 'utf8');
ok(patchAgain === true, '第二次返回 true');
ok(afterPatch2 === afterPatch, '第二次打补丁文件内容不变（幂等）');

console.log('\n=== 3. 还原成字节级一致 ===');
const stripOk = setNoSandbox(false);
const afterStrip = fs.readFileSync(HOST_SRC, 'utf8');
ok(stripOk === true, 'setNoSandbox(false) 返回 true');
ok(afterStrip === BUILD, '还原后与原始构建字节级完全一致（没有回退成旧快照）');
ok(!afterStrip.includes(PATCH_MARK), '还原后标记已消失');
ok(afterStrip.includes('FEATURE_MARKER_THIS_BUILD_ONLY'), '本构建独有的功能行还在（这是旧 pristine 方案会丢掉的东西）');

console.log('\n=== 4. 无标记时关闭是空操作 ===');
fs.writeFileSync(HOST_SRC, BUILD, 'utf8');
const noopOk = setNoSandbox(false);
ok(noopOk === true, '没有补丁时 setNoSandbox(false) 返回 true');
ok(fs.readFileSync(HOST_SRC, 'utf8') === BUILD, '文件保持不变');

console.log('\n=== 5. 锚点不唯一时拒绝打补丁（不破坏构建）===');
const TWO_ANCHORS = BUILD + '\t\targs: [helperPath]\n';
fs.writeFileSync(HOST_SRC, TWO_ANCHORS, 'utf8');
said.length = 0;
const refuse = setNoSandbox(true);
ok(refuse === false, '锚点出现两次时返回 false（拒绝打补丁）');
ok(fs.readFileSync(HOST_SRC, 'utf8') === TWO_ANCHORS, '文件未被改动');
ok(said.join(' ').includes('host code changed'), '给出了可读的拒绝原因');

console.log('\n=== 6. 有标记但没有我们那一行 → 拒绝猜测 ===');
const ALIEN = BUILD.replace('\t\targs: [helperPath]', '\t\targs: ["--no-sandbox", helperPath] // ' + PATCH_MARK + '_EDITED');
fs.writeFileSync(HOST_SRC, ALIEN, 'utf8');
said.length = 0;
const alien = setNoSandbox(false);
ok(alien === false, '标记存在但 PATCHED 行不匹配时返回 false');
ok(fs.readFileSync(HOST_SRC, 'utf8') === ALIEN, '文件未被改动（不猜、不覆盖）');
ok(said.join(' ').includes('leaving it alone'), '给出了可读的说明');

console.log('\n=== 7. 源码级回归守卫：不许再出现 pristine 还原路径 ===');
// 注释里可以讲这段历史（now-removed 的写法），只禁止真正的代码引用。
// 注意：文件是 CRLF，逐行处理后行尾仍带 \r，而 /\/\/.*$/ 里的 . 不吃 \r，
// 所以这里用不带 $ 的 /\/\/.*/ 去掉注释。
const codeOnly = src
  .split('\n')
  .map((l) => l.replace(/\/\/.*/, ''))
  .join('\n');
ok(!/HOST_PRISTINE/.test(codeOnly), 'launcher.js 代码里没有 HOST_PRISTINE');
ok(!/\.pristine/.test(codeOnly), 'launcher.js 代码里没有 .pristine 引用（注释里提到历史写法不算）');
ok(!/copyFileSync\(\s*HOST_PRISTINE/.test(codeOnly), 'launcher.js 里没有把备份整文件拷回去');
ok(FN_BODY.includes("src.replace(PATCHED, ANCHOR)"), '还原走的是 replace(PATCHED, ANCHOR) 就地删除');

// --- 清理 -------------------------------------------------------------------
try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch { /* 临时目录，失败无妨 */ }
ok(!fs.existsSync(sandboxDir), '临时目录已清理');

console.log('\n=== ' + pass + ' 通过 / ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
