// 前台窗口检测器（运行在 **Electron 主进程**）
//
// 为什么在主进程：渲染进程 contextIsolation:true + nodeIntegration:false，拿不到
// child_process。主进程 spawn PowerShell、按间隔采样，再用 IPC 推给宠物窗口。
//
// 两个关键坑（都实测踩过）：
//
//   1. **不能用 `-Command -` 从 stdin 喂脚本**。PowerShell 会先把 stdin 读完整才执行，
//      脚本永远等不到后续的 'poll' 行 —— 表现为一直挂起。必须把脚本落成临时文件、
//      用 `-File` 运行，脚本内部的 [Console]::In.ReadLine() 才是真正交互的。
//
//   2. **喂给 PowerShell 的脚本不能带 UTF-8 BOM**。BOM 的 EF BB BF 会被当字符拼到首行
//      `$ErrorActionPreference` 前面（变成 `?$ErrorActionPreference`），整段解析失败。
//      所以写临时文件时必须用无 BOM 的 UTF-8。
//
// 为什么要常驻：每次 spawn 要 500~600ms（进程启动 + Add-Type 编译）。常驻后
// Add-Type 只编译一次，之后每拍～50ms，快 10 倍。
//
// 隐私：进程名 + 窗口标题只在内存里做关键词匹配，不落盘、不上传。
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** 生成 PowerShell 脚本正文（交互式 main loop） */
function buildPs1() {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$OutputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)",
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'public class FGWinHelper {',
    '    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
    '    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    '    public static long GetPid() {',
    '        IntPtr h = GetForegroundWindow();',
    '        if (h == IntPtr.Zero) return 0;',
    '        uint pid = 0;',
    '        GetWindowThreadProcessId(h, out pid);',
    '        return (long)pid;',
    '    }',
    '    public static string GetTitle() {',
    '        IntPtr h = GetForegroundWindow();',
    '        if (h == IntPtr.Zero) return "";',
    '        StringBuilder sb = new StringBuilder(512);',
    '        GetWindowText(h, sb, 512);',
    '        return sb.ToString().Replace("\\r", " ").Replace("\\n", " ").Replace("|", "/");',
    '    }',
    '}',
    '"@',
    "[Console]::Out.WriteLine('READY')",
    "[Console]::Out.Flush()",
    'while ($true) {',
    '    $line = [Console]::In.ReadLine()',
    '    if ($null -eq $line) { break }',
    "    if ($line -eq 'quit') { break }",
    "    if ($line -ne 'poll') { continue }",
    '    $fgPid = [FGWinHelper]::GetPid()',
    '    $title = [FGWinHelper]::GetTitle()',
    "    $pname = ''",
    '    if ($fgPid -gt 0) {',
    '        try { $pname = (Get-Process -Id $fgPid -ErrorAction Stop).ProcessName } catch { $pname = "" }',
    '    }',
    "    [Console]::Out.WriteLine($pname + '|' + $title)",
    '    [Console]::Out.Flush()',
    '}',
  ].join('\r\n');
}

class ForegroundWatcher {
  /**
   * @param {object} opts
   * @param {number} [opts.intervalSec=5]
   * @param {(info:{processName:string,windowTitle:string}) => void} [opts.onSample]
   */
  constructor(opts = {}) {
    this.intervalSec = Number(opts.intervalSec) > 0 ? Number(opts.intervalSec) : 5;
    this.onSample = typeof opts.onSample === 'function' ? opts.onSample : null;
    this.proc = null;
    this.ready = false;
    this.buffer = '';
    this.pending = null;
    this.timer = null;
    this.stopped = true;
    this.scriptPath = null;
    this.samples = 0;
    this.errors = 0;
  }

  start() {
    if (!this.stopped) return this;
    this.stopped = false;
    this._writeScript();
    this._spawnLoop();
    return this;
  }

  /** 把 PS 脚本写到临时目录（**无 BOM**，见文件头坑 2） */
  _writeScript() {
    if (this.scriptPath && fs.existsSync(this.scriptPath)) return;
    const dir = path.join(os.tmpdir(), 'dsh-pet-fg');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const p = path.join(dir, `watcher-${process.pid}.ps1`);
    try {
      fs.writeFileSync(p, buildPs1(), { encoding: 'utf8' });  // Node 默认不写 BOM
      this.scriptPath = p;
    } catch (e) {
      this.scriptPath = null;
    }
  }

  _spawnLoop() {
    if (this.stopped) return;
    if (!this.scriptPath) {
      // 写不了脚本（权限/磁盘）→ 退避重试，但不影响宠物本体
      setTimeout(() => { this._writeScript(); this._spawnLoop(); }, 30000);
      return;
    }
    let proc;
    try {
      proc = spawn('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      setTimeout(() => this._spawnLoop(), 30000);
      return;
    }
    this.proc = proc;
    this.ready = false;
    this.buffer = '';

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).replace(/\r$/, '');
        this.buffer = this.buffer.slice(nl + 1);
        this._onLine(line);
      }
    });
    proc.stderr.on('data', () => {});
    proc.on('exit', () => {
      this.ready = false;
      this.proc = null;
      this._resolvePending(null);
      if (!this.stopped) setTimeout(() => this._spawnLoop(), 5000);
    });
    proc.on('error', () => {});

    // 偶发：stdout 一直没等到 READY（脚本解析失败）→ 60 秒后重拉一次
    const readyGuard = setTimeout(() => {
      if (!this.ready && this.proc === proc && !this.stopped) {
        this.errors += 1;
        try { proc.kill(); } catch {}
      }
    }, 60000);
    if (readyGuard.unref) readyGuard.unref();
  }

  _onLine(line) {
    if (line === 'READY') {
      this.ready = true;
      this._scheduleNext();
      return;
    }
    if (!this.pending) return;
    const idx = line.indexOf('|');
    const info = {
      processName: idx >= 0 ? line.slice(0, idx) : line,
      windowTitle: idx >= 0 ? line.slice(idx + 1) : '',
    };
    this.samples += 1;
    this._resolvePending(info);
  }

  _resolvePending(info) {
    if (!this.pending) return;
    const { resolve, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    resolve(info);
  }

  _scheduleNext() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this._pollOnce(), this.intervalSec * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  async _pollOnce() {
    if (this.stopped) return;
    if (!this.proc || !this.ready) { this._scheduleNext(); return; }
    const info = await this._ask();
    if (info && this.onSample) {
      try { this.onSample(info); } catch { /* 回调异常不中断轮询 */ }
    }
    this._scheduleNext();
  }

  _ask() {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.errors += 1;
        try { if (this.proc) this.proc.kill(); } catch {}
        resolve(null);
      }, 5000);
      this.pending = { resolve, timer };
      try {
        this.proc.stdin.write('poll\n');
      } catch {
        clearTimeout(timer);
        this.pending = null;
        resolve(null);
      }
    });
  }

  stop() {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this._resolvePending(null);
    try { if (this.proc) this.proc.stdin.write('quit\n'); } catch {}
    const proc = this.proc;
    this.proc = null;
    this.ready = false;
    // 给脚本 200ms 自己退，然后强杀
    setTimeout(() => { try { if (proc) proc.kill(); } catch {} }, 200);
    // 临时脚本不删：多个宠物窗口可能共用同一个文件；目录在 tmp 下，系统会清
  }
}

module.exports = { ForegroundWatcher, buildPs1 };
