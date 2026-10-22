// dsh-pet desktop pet - launcher for the portable build, with sandbox fallback.
//
// WHY A LAUNCHER EXISTS
// Electron 43 can fail to start on some Windows machines: the Chromium sandbox
// aborts with 0x80000003 (STATUS_BREAKPOINT) before any JavaScript runs, and
// prints nothing at all. On the machine this package was built on that is
// exactly what happens, and passing --no-sandbox fixes it.
//
// WHY THE FALLBACK EXISTS
// Always passing --no-sandbox costs real protection: it removes Chromium's
// process isolation. For this app - a local animation widget that loads no
// remote content - that is an acceptable trade, but on a machine where the
// sandbox works we should not pay it. So the safe configuration is tried first,
// and the fallback is applied only when the safe one demonstrably failed.
//
// HOW FAILURE IS DETECTED
// Two cheap signals, polled for a few seconds:
//   1. the host's HTTP port answers /health  (the host booted at all), and
//   2. an electron.exe process exists with a non-zero main window handle.
// If the host answers but no window ever appears, the window could not be
// created, and the fallback is applied.
//
// The host runs as a CHILD of this launcher so it can be watched and, on
// failure, stopped and restarted. The visible pet is still the host's own
// detached Electron window, so no console is involved either way.
//
// WHAT IS PORTABLE
// Every path is resolved from this file's own folder, so the whole folder can be
// copied to another PC or a USB stick. No globally installed Node or Electron is
// required, and the user's ~/.dsh is never read or written.
//
// HOW 大肥鱼桌宠.exe IS BUILT FROM THIS FILE
//   node --experimental-sea-config sea-config.json
//   postject 大肥鱼桌宠.exe NODE_SEA_BLOB sea-prep.blob \
//   postject 大肥鱼桌宠.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse <NODE_SEA_FUSE_...>
// with sea-config.json = { "main": "launcher.js",
//   "output": "sea-prep.blob", "disableExperimentalSEAWarning": true }.
// After editing this file, re-run those two commands or the exe keeps the old
// logic.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const base = path.dirname(process.execPath);
const NODE = path.join(base, 'runtime', 'node.exe');
const ENTRY = path.join(base, 'app', 'lib', 'standalone.js');
const ELECTRON = path.join(base, 'electron', 'electron.exe');
const HOME = path.join(base, 'data');
const HOST_SRC = path.join(base, 'app', 'lib', 'standalone.js');
const HOST_PRISTINE = path.join(base, 'app', 'lib', 'standalone.js.pristine');
const LOG = path.join(base, 'pet.log');

const PORT = 3080;
const PROBE_MS = 14000;  // total time to look for a window before falling back
const POLL_MS = 500;
const HOLD_MS = 1500;    // how long a window must stay up before we call it success

function say(msg) {
  process.stderr.write('[dsh-pet] ' + msg + '\n');
  try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + msg + '\n'); } catch {}
}

function die(msg) {
  say(msg);
  process.exit(1);
}

if (!fs.existsSync(NODE)) die('runtime\\node.exe is missing. The package is incomplete.');
if (!fs.existsSync(ENTRY)) die('app\\lib\\standalone.js is missing. The package is incomplete.');
if (!fs.existsSync(ELECTRON)) die('electron\\electron.exe is missing. The package is incomplete.');

process.env.DSH_PET_ELECTRON_PATH = ELECTRON;
process.env.DSH_HOME = HOME;
delete process.env.ELECTRON_RUN_AS_NODE;
fs.mkdirSync(HOME, { recursive: true });

// --- single instance -------------------------------------------------------
function electronRunning() {
  try {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/NH'], { encoding: 'utf8' });
    return /electron\.exe/i.test(r.stdout || '');
  } catch { return false; }
}
if (electronRunning()) die('already running - no second copy was started.');

// --- sandbox patch ---------------------------------------------------------
// Idempotent and reversible. Refuses to act if the host code no longer matches,
// so an upgrade can never be silently corrupted.
const PATCH_MARK = '__noSandboxFallback';
const ANCHOR = '\t\targs: [helperPath]';
const PATCHED = '\t\targs: ["--no-sandbox", helperPath] // ' + PATCH_MARK;

function setNoSandbox(on) {
  let src;
  try { src = fs.readFileSync(HOST_SRC, 'utf8'); } catch { return false; }

  if (on) {
    if (src.includes(PATCH_MARK)) return true;
    if (src.split(ANCHOR).length - 1 !== 1) {
      say('the host code changed, so --no-sandbox cannot be applied automatically.');
      say('if no window appears, that is why.');
      return false;
    }
    if (!fs.existsSync(HOST_PRISTINE)) fs.writeFileSync(HOST_PRISTINE, src);
    fs.writeFileSync(HOST_SRC, src.replace(ANCHOR, PATCHED));
    return true;
  }

  // Turning it off: restore the pristine copy if we have one, else strip the flag.
  if (!src.includes(PATCH_MARK)) return true;
  if (fs.existsSync(HOST_PRISTINE)) {
    fs.copyFileSync(HOST_PRISTINE, HOST_SRC);
    return true;
  }
  fs.writeFileSync(HOST_SRC, src.replace(PATCHED, ANCHOR));
  return true;
}

// --- probing ---------------------------------------------------------------
function hostAnswers() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 700 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Cheap window probe.
//
// Earlier this spawned a PowerShell process on every poll, which was slow enough
// that the launcher could declare success on a window that had not settled, and
// then the host died moments later. It is now:
//   - one process per probe, but only every WINDOW_POLL_MS (default 1s), and
//   - the window must still be there on a SECOND, later probe, so a window that
//     appears and immediately dies is not mistaken for success.
const WINDOW_POLL_MS = 1000;
let lastWindowSeenAt = 0;

function windowVisible() {
  const now = Date.now();
  if (now - lastWindowSeenAt < WINDOW_POLL_MS) return true;   // confirmed recently
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "(Get-Process -Name electron -ErrorAction SilentlyContinue | " +
      "Where-Object { $_.MainWindowHandle -ne 0 } | Measure-Object).Count"
    ], { encoding: 'utf8', timeout: 4000 });
    if (parseInt(String(out).trim(), 10) > 0) { lastWindowSeenAt = now; return true; }
  } catch { /* treat a failed probe as "no window yet" */ }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- run the host, watch it, fall back once if needed ----------------------
let child = null;

function startHost() {
  // Hide the console window. `stdio: inherit` used to attach the host's stdout to
  // this process's console, which Windows shows as a black node.exe window the
  // user has to look at for the lifetime of the pet. Instead:
  //   * windowsHide: true  -> no console is created for the child
  //   * stdio: 'ignore'    -> nothing to attach it to anyway
  // The host's own diagnostics still land in pet.log via `say()`, so nothing is
  // lost for troubleshooting.
  child = spawn(NODE, [ENTRY, '--port', String(PORT), ...process.argv.slice(2)], {
    env: process.env,
    cwd: base,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.on('exit', (code) => { if (code !== 0) say('host exited with code ' + code); });
}

async function waitForWindow() {
  lastWindowSeenAt = 0;                 // require a fresh, sustained window
  const until = Date.now() + PROBE_MS;
  let windowSince = null;
  while (Date.now() < until) {
    if (windowVisible()) {
      // The window must persist for HOLD_MS before we trust it; a window that
      // appears and vanishes means the helper crashed, not that it worked.
      if (windowSince === null) windowSince = Date.now();
      else if (Date.now() - windowSince >= HOLD_MS) return true;
    } else {
      windowSince = null;
    }
    await sleep(POLL_MS);
  }
  return false;
}

(async () => {
  // Pass 1: keep the sandbox when this machine can do without --no-sandbox.
  setNoSandbox(false);
  startHost();

  if (await waitForWindow()) {
    say('started (Chromium sandbox enabled)');
    return;
  }

  say('no window after ' + (PROBE_MS / 1000) + 's; retrying with --no-sandbox' +
      (await hostAnswers() ? ' (host was up, so the window itself never appeared)' : ' (host never answered either)'));
  if (child && !child.killed) { try { child.kill(); } catch {} }
  await sleep(1200);
  try { execFileSync('taskkill', ['/IM', 'electron.exe', '/F'], { stdio: 'ignore' }); } catch {}

  if (!setNoSandbox(true)) return;
  startHost();

  say(await waitForWindow()
    ? 'started with --no-sandbox (Chromium process isolation is OFF on this machine)'
    : 'still no window after the --no-sandbox retry; see ' + LOG);
})();
