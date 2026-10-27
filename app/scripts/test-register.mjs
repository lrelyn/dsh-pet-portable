// test-register.mjs —— 给 `node --test` 注册「无扩展名导入」的解析钩子
//
// 为什么需要它：
//   项目源码用的是 TS 风格的**无扩展名相对导入**（`from './balance'`），
//   全项目共 120 处。这在 tsdown 打包时由打包器解析，但 Node 的 ESM loader
//   要求导入路径带完整扩展名，直接跑 .test.ts 会 ERR_MODULE_NOT_FOUND。
//
//   本模块注册一个 resolve 钩子：把 `./balance` 依次尝试
//   `./balance.ts` / `./balance.js` / `./balance/index.ts` /
//   `./balance/index.js`，命中就用完整路径。
//
// 用法（package.json 的 test 脚本已配好）：
//   node --experimental-strip-types --import ./scripts/test-register.mjs --test src/**/*.test.ts
//
// 注意：本文件是**本地构建补充**，上游仓库没有（上游用 tsdown 打包，不直接跑 .test.ts）。
// 若将来上游提供了官方版本，优先替换成它。
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// 把钩子实现放在独立模块里，register() 需要一个 URL
register('./test-resolver.mjs', pathToFileURL(import.meta.filename));
