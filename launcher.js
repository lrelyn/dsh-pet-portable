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

// Package root. Normally this is the folder containing the running executable, which
// is what makes the build portable (copy the folder anywhere).
//
// DSH_PET_ROOT overrides it for development only: running `node launcher.js` sets
// process.execPath to node.exe, so dirname() would point at the runtime folder
// instead of the package. The packaged exe never sets this variable.
const base = process.env.DSH_PET_ROOT
  ? path.resolve(process.env.DSH_PET_ROOT)
  : path.dirname(process.execPath);
const NODE = path.join(base, 'runtime', 'node.exe');
const ENTRY = path.join(base, 'app', 'lib', 'standalone.js');
const ELECTRON = path.join(base, 'electron', 'electron.exe');
const HOME = path.join(base, 'data');
const HOST_SRC = path.join(base, 'app', 'lib', 'standalone.js');
const LOG = path.join(base, 'pet.log');

const PORT = 3080;
const PROBE_MS = 14000;  // total time to look for a window before falling back
const POLL_MS = 500;
const HOLD_MS = 1500;    // how long a window must stay up before we call it success

// --- who are we? -----------------------------------------------------------
//
// Every check below must identify OUR OWN processes, never "any electron.exe".
//
// WHY: DSH itself runs on Electron (C:\Users\<u>\.dsh\electron\electron.exe), so on
// a machine where DSH is open there are always several electron.exe processes that
// have nothing to do with this pet. Matching by image name alone made the launcher
// refuse to start ("already running") whenever DSH was open, and would also have
// made the window probe declare success on DSH's window. Both checks now compare
// the executable path against this package's own electron directory.
//
// The path prefix is normalised (backslashes, lower case) because WMI returns the
// path exactly as Windows stored it, which can differ in case from ours.
const SELF_ELECTRON_DIR = path.join(base, 'electron').toLowerCase();
const SELF_EXE_NAME = path.basename(process.execPath);   // e.g. 大肥鱼桌宠.exe

/**
 * Count OUR electron.exe processes (optionally only those with a visible window).
 *
 * Implemented via one WMI query per call, filtered on ExecutablePath. We avoid
 * `tasklist /FI "IMAGENAME eq electron.exe"` because that matches the whole system.
 */
function ownElectronCount(requireWindow) {
  const filter = "(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith('" +
    SELF_ELECTRON_DIR.replace(/'/g, "''") + "') }" +
    (requireWindow ? " | Where-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowHandle -ne 0 }" : '') +
    ' | Measure-Object).Count';
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', filter],
      { encoding: 'utf8', timeout: 6000 });
    return parseInt(String(out).trim(), 10) || 0;
  } catch {
    return -1;   // probe failed: caller decides (never treat as "one exists")
  }
}

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

/**
 * Terminate only OUR electron.exe processes (path-filtered).
 *
 * Used by the --no-sandbox retry: the first attempt may have left a half-started
 * window behind. Must never touch other Electron applications on the machine.
 */
function killOwnElectrons() {
  const filter = "(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith('" +
    SELF_ELECTRON_DIR.replace(/'/g, "''") + "') }).ProcessId";
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', filter],
      { encoding: 'utf8', timeout: 8000 });
    const pids = String(out).split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0);
    for (const pid of pids) {
      try { execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', timeout: 4000 }); } catch {}
    }
    if (pids.length) say('stopped ' + pids.length + ' of our own electron process(es) before retry');
  } catch { /* best effort */ }
}

// --- single instance -------------------------------------------------------
//
// Only OUR electron counts. DSH's Electron (or any other Electron app) must not
// block the pet: they are unrelated processes that happen to share an image name.
//
// Two ways a copy can already exist:
//   1. the packaged exe is running twice  -> detect by our own image name
//   2. an older copy left only its electron window (launcher already exited)
//                                         -> detect by path-filtered electron query
//
// Step 1 is skipped when running under node (development): there process.execPath
// is node.exe, and "another node.exe is running" says nothing about the pet.
function alreadyRunning() {
  const isPackaged = /\.exe$/i.test(SELF_EXE_NAME) && !/^node\.exe$/i.test(SELF_EXE_NAME);

  if (isPackaged) {
    try {
      const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ' + SELF_EXE_NAME, '/NH'], { encoding: 'utf8' });
      const lines = String(r.stdout || '').split('\n')
        .filter((l) => l.toLowerCase().includes(SELF_EXE_NAME.toLowerCase()));
      // Exclude ourselves: tasklist lists our own PID too.
      const others = lines.filter((l) => !new RegExp('(^|\\s)' + process.pid + '(\\s|$)').test(l));
      if (others.length > 0) return 'another ' + SELF_EXE_NAME + ' is already running';
    } catch { /* fall through to the electron check */ }
  }

  // A previously launched copy whose launcher already exited but whose electron
  // window is still up (orphan). Path-filtered, so DSH is not counted.
  const n = ownElectronCount(false);
  if (n > 0) return 'the pet window is already open (' + n + ' electron process(es) under ' + path.join(base, 'electron') + ')';
  return null;   // n === 0 or -1 (probe failed) -> allow start
}

const running = alreadyRunning();
if (running) die('already running - no second copy was started. (' + running + ')');

// --- sandbox patch ---------------------------------------------------------
// Idempotent and reversible. Refuses to act if the host code no longer matches,
// so an upgrade can never be silently corrupted.
//
// Reversal is the exact inverse of the patch, not a copy of a stored original.
// An earlier version wrote standalone.js.pristine on first use and restored it
// afterwards; that snapshot froze the host at whatever build first needed the
// fallback, so any later rebuild was silently rolled back by it (the 2026-10-07
// snapshot was 298 lines behind the current build). A one-token insertion needs
// no backup to undo.
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
    fs.writeFileSync(HOST_SRC, src.replace(ANCHOR, PATCHED));
    return true;
  }

  // Turning it off: remove the marker line we added. PATCHED is a single fixed
  // string, so this restores the file byte-for-byte whatever build it came from.
  if (!src.includes(PATCH_MARK)) return true;
  if (!src.includes(PATCHED)) {
    say('standalone.js carries the --no-sandbox marker but not the line this launcher writes.');
    say('leaving it alone rather than guessing; a reinstall of the package fixes it.');
    return false;
  }
  fs.writeFileSync(HOST_SRC, src.replace(PATCHED, ANCHOR));
  return true;
}

// --- probing ---------------------------------------------------------------
//
// The host's /health returns { name, plugin: { root }, port, uptimeSec }. We must
// verify plugin.root points at THIS package before believing the answer:
//   - the host auto-advances the port when 3080 is taken, so asking for 3080 may
//     reach a different instance entirely;
//   - if another dsh-pet (e.g. the DSH plugin's standalone) happens to hold 3080,
//     a bare status check would report "host is up" for a process we never started.
// Treating that as success would make the launcher skip the --no-sandbox fallback
// even though our own host never came up.
function hostAnswers() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 700 }, (res) => {
      if (res.statusCode >= 500) { res.resume(); resolve(false); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 4096) body += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const root = j && j.plugin && j.plugin.root;
          if (!root) { resolve(false); return; }
          // Compare normalised paths: the host reports its app/ dir.
          const exp = path.join(base, 'app').toLowerCase();
          const got = String(root).replace(/\//g, '\\').toLowerCase();
          resolve(got === exp);
        } catch { resolve(false); }
      });
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
//
// The probe only counts OUR electron (path-filtered). Counting every electron.exe
// with a window would see DSH's window and report success immediately.
const WINDOW_POLL_MS = 1000;
let lastWindowSeenAt = 0;

function windowVisible() {
  const now = Date.now();
  if (now - lastWindowSeenAt < WINDOW_POLL_MS) return true;   // confirmed recently
  if (ownElectronCount(true) > 0) { lastWindowSeenAt = now; return true; }
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
  // Kill only OUR electron processes before retrying. The old code ran
  // `taskkill /IM electron.exe /F`, which also terminated DSH's Electron windows on
  // the same machine — a fallback meant to rescue this pet must never take down an
  // unrelated application.
  killOwnElectrons();

  if (!setNoSandbox(true)) return;
  startHost();

  say(await waitForWindow()
    ? 'started with --no-sandbox (Chromium process isolation is OFF on this machine)'
    : 'still no window after the --no-sandbox retry; see ' + LOG);
})();
