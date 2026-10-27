/**
 * 独立模式体检（`--check`）：不 `apply`、不起窗口、不联网，只回答"为什么能/不能跑起来"。
 *
 * 为什么单独一份而不是复用路由：体检的价值恰恰在于**不启动宿主**（否则一跑就把桌宠窗口拉起来，
 * 排查"没出现"时反而多一个变量）。因此这里直接读插件自己的纯模块
 * （`host/config.ts` 的 readAllConfig/flattenPetList、`host/helper-process.ts` 的 Electron 解析），
 * 与插件内运行时读的是同一份配置与同一套解析规则。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { flattenPetList, readAllConfig } from '../host/config';
import {
  dshHomeDir,
  electronLandingDir,
  hasGraphicalDisplay,
  packageRoot,
  resolveElectronPath,
} from '../host/helper-process';
import type { StandaloneLogger } from './context';
import { configPathsFor, describePets, isDesktopVisible } from './options';

/** 包版本（读不到就 unknown）—— 体检报告与启动横幅共用 */
export function packageVersion(root: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 另一处「看起来像生效配置」的文件 */
export interface StrayConfig {
  /** 另一份配置的绝对路径 */
  file: string;
  /** 一句话说明"为什么它不生效" */
  reason: string;
  /** 字节数 */
  size: number;
  /** 当前生效那份的绝对路径 */
  activeFile: string;
  /** 当前生效那份的字节数（-1 = 不存在） */
  activeSize: number;
  /** 两份大小相同 → 大概率内容一致，不必提示 */
  sameSize: boolean;
}

/** stat 大小；不存在/失败返回 -1（探测绝不能影响启动） */
function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return -1;
  }
}

/**
 * 找出「另一处也有 main-config.jsonc」的情况，只读探测，**绝不自动同步**。
 *
 * 为什么需要：`~/.dsh/dsh-pet/main-config.jsonc`（DSH 插件模式）与
 * `<包根>/data/dsh-pet/main-config.jsonc`（便携版）文件名、格式、内容结构完全一样，
 * 但只有一份生效。用户按旧文档改了不生效那份，界面上毫无变化，极难自查——
 * 本项目就真踩过（见 config/README.md 的「历史坑」）。
 *
 * 自动同步被刻意排除：两份都可能是用户手工调过的，覆盖哪份都可能丢参数。
 * 这里只回报事实 + 一句"改这个没用"，让用户自己决定。
 *
 * @param activeFile 当前实际生效的用户配置路径
 * @param home 当前 DSH_HOME
 * @param root 包根
 */
export function findStrayConfig(activeFile: string, home: string, root: string): StrayConfig | undefined {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase();
  // 判定"当前是便携版还是插件模式"：看 DSH_HOME 是否落在**包根之内**。
  // 注意 root 传进来是 <包根>/app，而便携版的 home 是 <包根>/data —— 两者是**兄弟目录**，
  // 所以必须上溯一层再比，直接 startsWith(root) 会永远 false（亲身踩过）。
  const pkgRoot = norm(join(root, '..'));
  const homeInsidePackage = norm(home) === pkgRoot || norm(home).startsWith(pkgRoot + '\\');

  // 便携版（home 在包内）→ 另一处是 ~/.dsh；插件模式 → 另一处是包内 data/
  let candidate: string;
  let reason: string;
  if (homeInsidePackage) {
    const profile = process.env.USERPROFILE || process.env.HOME || '';
    if (!profile) return undefined;
    candidate = join(profile, '.dsh', 'dsh-pet', 'main-config.jsonc');
    reason = '便携版不读 ~/.dsh（launcher 把 DSH_HOME 指到了包内 data/），改它不会有任何效果';
  } else {
    candidate = join(pkgRoot, 'data', 'dsh-pet', 'main-config.jsonc');
    reason = 'DSH 插件模式读 ~/.dsh，包内这份不参与，改它不会有任何效果';
  }
  if (norm(candidate) === norm(activeFile)) return undefined;

  const size = fileSize(candidate);
  if (size < 0) return undefined;
  const activeSize = fileSize(activeFile);
  return { file: candidate, reason, size, activeFile, activeSize, sameSize: size === activeSize };
}

/** 把 stray 探测结果渲染成给人看的几行（无 stray 时返回空数组） */
export function describeStrayConfig(stray: StrayConfig | undefined): string[] {
  if (!stray) return [];
  const kb = (n: number): string => (n < 0 ? '不存在' : `${Math.round(n / 1024)} KB`);
  const lines = [
    `⚠ 另有一份配置：${stray.file}（${kb(stray.size)}）—— 不生效`,
    `  当前生效：${stray.activeFile}（${kb(stray.activeSize)}）`,
    `  ${stray.reason}`,
  ];
  if (!stray.sameSize) {
    lines.push('  两份大小不同 → 内容不一致，容易改错文件。只改生效那份。');
  }
  return lines;
}

/**
 * 打印体检报告。
 * @param logger 输出目标
 * @returns 进程退出码：0 = 就绪；1 = 缺包内默认配置或配置读不出来
 */
export function runCheck(logger: StandaloneLogger): number {
  const home = dshHomeDir();
  const paths = configPathsFor(packageRoot, home);
  const electron = resolveElectronPath();
  const lines: string[] = [
    `Node            ${process.version}（${process.platform}-${process.arch}）`,
    `插件            dsh-pet@${packageVersion(packageRoot)}  ${packageRoot}`,
    `DSH_HOME        ${home}`,
    `用户配置        ${paths.userFile}${existsSync(paths.userFile) ? '' : '（不存在 → 用包内默认）'}`,
    `文件宠物目录    ${paths.petDir}${existsSync(paths.petDir) ? '' : '（不存在）'}`,
    `内置默认配置    ${paths.defaultFile}${existsSync(paths.defaultFile) ? '' : '  ✗ 缺失'}`,
    ...describeStrayConfig(findStrayConfig(paths.userFile, home, packageRoot)),
    `Electron        ${electron ?? `未发现（首次运行会下载到 ${electronLandingDir()}）`}`,
    `图形显示环境    ${hasGraphicalDisplay() ? '有' : '无（桌面小窗会跳过；远程桌面/Xvfb 可设 DSH_PET_DESKTOP_FORCE=1）'}`,
  ];

  const fail = (message: string): number => {
    for (const line of lines) logger.info(line);
    logger.error(message);
    return 1;
  };

  if (!existsSync(paths.defaultFile)) {
    return fail(
      '包内默认配置读不到：很可能是在**直接跑源码**（包根被解析成了 src/）。' +
        '独立模式请用构建产物：npm run bundle 后 node lib/standalone.js，或 npm run standalone。',
    );
  }

  try {
    const merged = readAllConfig(paths);
    const entries = Object.keys(merged);
    lines.push(`配置条目        ${entries.length} 个：${entries.join(', ') || '（空）'}`);
    for (const entry of entries) {
      const conf = merged[entry] ?? {};
      const pets = Array.isArray(conf.pets) ? (conf.pets as Record<string, unknown>[]) : [];
      const animations = conf.animations as { idle?: unknown[] } | undefined;
      const idle = Array.isArray(animations?.idle) ? animations.idle.length : 0;
      lines.push(`  条目 ${entry}：宠物 ${pets.length} 只  ${describePets(pets)}｜idle 动画 ${idle} 个`);
    }
    const desktopVisible = flattenPetList(merged).filter(isDesktopVisible);
    lines.push(
      `桌面小窗        ${desktopVisible.length} 只${
        desktopVisible.length === 0 ? '（display 需要 desktop 或 both，否则独立模式没有可显示的宠物）' : ''
      }`,
    );
    for (const line of lines) logger.info(line);
    logger.info('结论：配置与 Electron 就绪，可以直接启动（npm run standalone）。');
    return 0;
  } catch (error) {
    return fail(`读配置失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
