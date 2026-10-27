#!/usr/bin/env node
// prepack-check.js —— 发布前检查：确保 main.js 依赖的运行时文件都在包里
//
// 为什么需要它：helper 是**随包发行的手写 JS**（不是构建产物），
// 而 main.js 在启动时 require 一批同目录文件。漏掉任何一个，
// 用户双击 exe 会直接崩（甚至看不到错误，因为窗口还没建）。
// 这个脚本在 npm publish / 打 zip 之前跑一遍，把这类问题挡在发布前。
//
// 用法：node scripts/prepack-check.js
//   全部在位 → 退出码 0
//   有缺失   → 打印清单 + 退出码 1
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/**
 * main.js 会 require 的运行时文件（相对包根）。
 * 新增 require 时必须同步这里 —— 漏了就等于"发布包里少一个必需模块"。
 */
const required = [
  'runtime/electron-helper/main.js',
  'runtime/electron-helper/preload.js',
  // main.js 顶层 require 的两个纯模块
  'runtime/electron-helper/pointer-target.js',
  'runtime/electron-helper/host-liveness.js',
  // 以下由 index.html 加载（缺了宠物品不出来 / 菜单点不动）
  'runtime/electron-helper/index.html',
  'runtime/electron-helper/sprite.js',
  'runtime/electron-helper/events.js',
  'runtime/electron-helper/renderer.js',
  'runtime/electron-helper/shared-core.js',
  'runtime/electron-helper/constants.js',
  // P2 模块（sprite.js 运行时读 window.PET_*）
  'runtime/electron-helper/vitals.js',
  'runtime/electron-helper/affinity.js',
  'runtime/electron-helper/offline.js',
  'runtime/electron-helper/foods.js',
  'runtime/electron-helper/social.js',
  'runtime/electron-helper/status-icons.js',
  'runtime/electron-helper/status-panel.js',
  'runtime/electron-helper/work-state-map.js',
  'runtime/electron-helper/foreground-watcher.js',
  'runtime/electron-helper/pet-state.js',
  // 内置默认配置
  'assets/config.jsonc',
];

const missing = [];
for (const rel of required) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) missing.push(rel);
}

console.log(`[prepack-check] 检查 ${required.length} 个必需文件`);
if (missing.length === 0) {
  console.log('[prepack-check] 全部在位 ✓');
  process.exit(0);
}
console.error(`[prepack-check] 缺失 ${missing.length} 个：`);
for (const m of missing) console.error('  - ' + m);
console.error('\n这些文件 main.js / index.html 启动时就要用，缺了会直接崩。');
process.exit(1);
