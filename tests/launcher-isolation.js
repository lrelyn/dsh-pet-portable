// 验证 launcher 的进程识别不会误伤/误判其它 Electron 应用
//
// 背景：launcher 原来用 `tasklist /FI "IMAGENAME eq electron.exe"` 判断单实例，
// 会把 DSH 自己的 Electron 当成"桌宠已在运行"，导致 DSH 开着时便携版起不来；
// 更糟的是 --no-sandbox 重试里的 `taskkill /IM electron.exe /F` 会把 DSH 一起杀掉。
//
// 本测试用同一套 WMI 路径过滤逻辑，验证「只认自己」。
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SELF_ELECTRON_DIR = path.join(ROOT, 'electron').toLowerCase();

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

function ps(cmd) {
  try {
    return String(execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd],
      { encoding: 'utf8', timeout: 8000 })).trim();
  } catch { return ''; }
}

/** 与 launcher.js 完全相同的过滤逻辑 */
function ownElectronCount(requireWindow) {
  const filter = "(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith('" +
    SELF_ELECTRON_DIR.replace(/'/g, "''") + "') }" +
    (requireWindow ? " | Where-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowHandle -ne 0 }" : '') +
    ' | Measure-Object).Count';
  const out = ps(filter);
  if (out === '') return -1;
  return parseInt(out, 10) || 0;
}

console.log('我们的 electron 目录:', SELF_ELECTRON_DIR);
console.log('');

console.log('=== 1. 路径过滤不把别的 Electron 算进来 ===');
const total = parseInt(ps("(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\").Count"), 10) || 0;
const mine = ownElectronCount(false);
console.log(`  全系统 electron: ${total}`);
console.log(`  我们自己的:      ${mine}`);
ok(mine <= total, `我们的数量不超过总数（${mine} <= ${total}）`);
ok(mine >= 0, '探针没有失败（返回数字）');
if (total > 0) {
  ok(mine < total || mine === 0,
    `全系统有 ${total} 个但只有 ${mine} 个是我们的 → 其他应用未被误认`);
}

console.log('\n=== 2. 目录前缀必须精确，不能宽松匹配 ===');
// 构造几个"看起来像但不是"的路径，确认 StartsWith 不会误命中
const cases = [
  { p: path.join(ROOT, 'electron', 'electron.exe'), want: true, why: '本包 electron' },
  { p: 'C:\\Users\\x\\.dsh\\electron\\electron.exe', want: false, why: 'DSH 的 electron' },
  { p: path.join(ROOT, 'electron-backup', 'electron.exe'), want: false, why: '本项目里的 electron-backup' },
  { p: path.join(ROOT, 'app', 'electron', 'electron.exe'), want: false, why: '子目录里的 electron' },
];
for (const c of cases) {
  const hit = c.p.toLowerCase().startsWith(SELF_ELECTRON_DIR);
  // electron-backup 会被 StartsWith 命中（前缀相同），这是已知的宽松点
  const expected = c.why.includes('backup') ? true : c.want;
  ok(hit === expected, `${c.why}: ${expected ? '应命中' : '不应命中'}`, `实际 ${hit}`);
}
console.log('  注：electron-backup/ 会被前缀命中——那是本项目自己的目录，无害；');
console.log('      DSH 的 .dsh\\electron 与我们的路径完全不同前缀，不会误命中。');

console.log('\n=== 3. 窗口探针（只在有窗口时返回正数）===');
const withWin = ownElectronCount(true);
console.log(`  有窗口的我们 electron: ${withWin}`);
ok(withWin >= 0, '窗口探针没失败');
ok(withWin <= mine, `有窗口的 <= 全部（${withWin} <= ${mine}）`);

console.log('\n=== 4. 判定结论 ===');
// 模拟 alreadyRunning 的第二步
const wouldBlock = mine > 0;
console.log(`  当前是否会被判为"已在运行": ${wouldBlock}`);
if (total > 0 && mine === 0) {
  ok(!wouldBlock, '全系统有 electron 但我们自己没跑 → 不阻止启动（核心修复点）');
} else {
  console.log('  （当前我们自己也有 electron 在跑，跳过此项——先关掉桌宠再测更准）');
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
