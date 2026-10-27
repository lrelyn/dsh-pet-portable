#!/usr/bin/env node
// start-desktop.mjs —— 开发流：手动拉起桌面 Helper（不需要打 exe）
//
// 为什么需要它：日常调桌宠 UI 时，`node app/lib/standalone.js` 只起宿主，
// 宿主再去 spawn Electron。但有时想直接拉起 Helper（改完 sprite.js 快速看效果），
// 又不想走完整的 standalone。这个脚本就是那条捷径。
//
// 关键约束（与 helper-process.ts 的生产路径一致）：
//   ① 必须注入 DSH_PET_HOST_PID —— 否则 helper 的宿主存活守卫拿不到 PID，
//      永远判不出"宿主没了"（issue #56 的 B 分支失效）。
//   ② 必须删掉 ELECTRON_RUN_AS_NODE —— 有这个变量时 Electron 会以纯 Node 模式启动，
//      不建窗口（issue #63）。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const ELECTRON = process.env.DSH_PET_ELECTRON_PATH
  || path.join(root, 'electron', 'electron.exe');
const HELPER_MAIN = path.join(root, 'runtime', 'electron-helper', 'main.js');
const CONFIG_URL = process.env.DSH_PET_CONFIG_URL
  || 'http://127.0.0.1:3080/dsh-pet-7340/config';

if (!existsSync(ELECTRON)) {
  console.error(`[start-desktop] 找不到 Electron: ${ELECTRON}`);
  console.error('  设 DSH_PET_ELECTRON_PATH，或先跑 npm run ensure:electron');
  process.exit(1);
}
if (!existsSync(HELPER_MAIN)) {
  console.error(`[start-desktop] 找不到 Helper 入口: ${HELPER_MAIN}`);
  process.exit(1);
}

const env = {
  ...process.env,
  // ① 注入宿主 PID：helper 的存活守卫靠它判断「宿主没了就自己退」
  DSH_PET_HOST_PID: String(process.pid),
  DSH_PET_CONFIG_URL: CONFIG_URL,
  DSH_HOME: process.env.DSH_HOME || path.join(root, 'data'),
};
// ② 防 ELECTRON_RUN_AS_NODE：有这个变量 Electron 会当纯 Node 跑，不建窗口
delete env.ELECTRON_RUN_AS_NODE;

console.log('[start-desktop] 拉起 Helper');
console.log('  electron:', ELECTRON);
console.log('  entry   :', HELPER_MAIN);
console.log('  config  :', CONFIG_URL);
console.log('  hostPid :', process.pid);

const child = spawn(ELECTRON, [HELPER_MAIN], {
  env,
  cwd: root,
  windowsHide: false,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  console.log(`[start-desktop] Helper 退出 code=${code} signal=${signal}`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  try { child.kill(); } catch {}
  process.exit(0);
});
