// test-resolver.mjs —— 实际的解析钩子实现
//
// 做的事：把无扩展名的相对导入补成带扩展名的实际文件。
//
// 为什么需要（背景）：项目源码用 TS 风格无扩展名导入（`from './balance'`），
// 共 120 处。打包器（tsdown）能解析，但 Node ESM loader 要求完整扩展名，
// 直接跑 .test.ts 会 ERR_MODULE_NOT_FOUND。本钩子补上这一层。
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** 候选扩展名，按优先级：TS 源码在前（测试跑的是 .ts） */
const CANDIDATES = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'];
/** 目录入口候选 */
const INDEX_CANDIDATES = CANDIDATES.map((e) => '/index' + e);

/**
 * 解析钩子。只处理**相对路径且无扩展名**的 specifier，
 * 其它一律返回 undefined（交回 Node 默认解析），避免干扰 bare import。
 */
export async function resolve(specifier, context, nextResolve) {
  // 只接管 './xxx' 和 '../xxx'，且不带扩展名
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return nextResolve(specifier, context);
  }
  // 已带已知扩展名 → 不接管
  const ext = path.extname(specifier);
  if (ext && CANDIDATES.includes(ext)) {
    return nextResolve(specifier, context);
  }

  const parentURL = context.parentURL;
  if (!parentURL || !parentURL.startsWith('file:')) {
    return nextResolve(specifier, context);
  }
  const parentDir = path.dirname(fileURLToPath(parentURL));
  const base = path.resolve(parentDir, specifier);

  // 1) 直接补扩展名
  for (const e of CANDIDATES) {
    if (existsSync(base + e)) {
      return nextResolve(pathToFileURL(base + e).href, context);
    }
  }
  // 2) 当作目录，找 index.*
  for (const idx of INDEX_CANDIDATES) {
    if (existsSync(base + idx)) {
      return nextResolve(pathToFileURL(base + idx).href, context);
    }
  }

  // 3) 原文件名就是个没扩展名的文件（少见，但兜底）
  if (existsSync(base)) {
    return nextResolve(pathToFileURL(base).href, context);
  }

  // 找不到 → 交回 Node（让它报原本的错，便于定位）
  return nextResolve(specifier, context);
}
