/**
 * 「打开网站」→「使用说明（网页版）」契约测试（源码级守卫）。
 *
 * 背景（#69）：独立打包版没有 DSH webServer，菜单里「打开网站」从 configUrl 推出的是
 * `http://127.0.0.1:3080` —— 一个打不开任何有用内容的死入口。改为打开包根的
 * `使用说明.html`（赞助码.jpg 嵌在页面里「制作不易」那行下方，无需单独入口）。
 *
 * 三条不变式：
 *   ① 桌面菜单里不得再出现 action:'open-site'（死入口，见一个删一个）；
 *   「使用说明」必须在，且**置顶**（新用户最先要找的东西）；
 *   ② 打开方式用 shell.openExternal(file://) 而不是 openPath ——
 *      .html 的"默认程序"在某些机器上是编辑器，openPath 会让用户看到源码；
 *   ③ 路径由主进程拼（渲染端不知道包根），且 html 缺失时回退 txt、再没有只记日志。
 *
 * 跑法：node --experimental-strip-types --test src/host/help-menu.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const sprite = read('../../runtime/electron-helper/sprite.js');
const main = read('../../runtime/electron-helper/main.js');
const preload = read('../../runtime/electron-helper/preload.js');

/** 取 sprite.js 里 onMenuAction 方法体 */
function onMenuActionBody(): string {
  const m = /\n  onMenuAction\(leaf\) \{/.exec(sprite);
  assert.ok(m, 'sprite.js 里找不到 onMenuAction');
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (depth > 0 && i < sprite.length) {
    if (sprite[i] === '{') depth++;
    else if (sprite[i] === '}') depth--;
    i++;
  }
  return sprite.slice(start, i - 1);
}

describe('菜单：死入口「打开网站」必须让位', () => {
  test('桌面菜单树里不得再有 action: \'open-site\'', () => {
    assert.ok(
      !/label:\s*'打开网站'/.test(sprite),
      '菜单里不得再出现「打开网站」项（独立模式下是死入口）',
    );
    assert.ok(!/action:\s*'open-site'/.test(sprite), '不得再有 open-site 动作绑定');
  });

  test('「使用说明」在菜单里，且落在 handler 上', () => {
    assert.ok(/label:\s*'使用说明'/.test(sprite), '菜单必须有「使用说明」项');
    assert.ok(/action:\s*'open-help'/.test(sprite), '使用说明必须绑 open-help 动作');
    const body = onMenuActionBody();
    assert.ok(/leaf\.action === 'open-help'/.test(body), 'onMenuAction 必须有 open-help 分支');
  });

  test('「使用说明」在「设置」子菜单里置顶（不是菜单顶层）', () => {
    // 抓到 `label: '设置', children: [ ... ]` 的第一项
    const m = /label:\s*'设置',\s*children:\s*\[\s*([\s\S]*?)\{\s*label:\s*'多开数量'/.exec(sprite);
    assert.ok(m, '找不到「设置」子菜单的起始段');
    assert.ok(
      /label:\s*'使用说明'/.test(m[1]),
      '「设置」的第一项必须是「使用说明」（在设置内置顶），实际是: ' + m[1].replace(/\s+/g, ' ').slice(0, 80),
    );
    // 顶层 tools 里不得有它
    const top = /tools\.push\(([\s\S]*?)\{ label: '投喂'/.exec(sprite);
    assert.ok(top, '找不到 tools.push 段');
    assert.ok(!/label:\s*'使用说明'/.test(top[1]), '顶层菜单不得有「使用说明」（它属于设置/维护类）');
  });

  test('「使用说明」只出现一次（不得同时挂在顶层和设置里）', () => {
    const n = (sprite.match(/label:\s*'使用说明'/g) ?? []).length;
    assert.equal(n, 1, `「使用说明」应只出现 1 次，实际 ${n} 次（顶层已置顶，设置里不该再有）`);
  });

  test('赞助码不再做独立菜单项（已嵌入说明页面）', () => {
    assert.ok(!/label:\s*'赞助码'/.test(sprite), '不得再有独立的「赞助码」菜单项');
    assert.ok(!/action:\s*'open-sponsor'/.test(sprite), '不得再有 open-sponsor 动作绑定');
  });
});

describe('打开方式：网页版必须落到浏览器', () => {
  test('不得用 shell.openExternal 开 file://（Electron 不支持，实测 0x2 失败）', () => {
    const m = /ipcMain\.on\('pet:open-help'[\s\S]*?\n  \}\);/.exec(main);
    assert.ok(m, 'main.js 必须注册 pet:open-help');
    const body = m[0];
    // 根因（#70）：openExternal 只处理 http/https/mailto，file:// 会被 ShellExecute
    // 当成"要启动的程序名"，报「系统找不到指定的文件 (0x2)」。
    assert.ok(
      !/shell\.openExternal/.test(body),
      '不得再用 openExternal 开本地 file://（Electron 不支持，必然失败）',
    );
  });

  test('用 cmd /c start 走文件关联（.html 稳定落到默认浏览器）', () => {
    const m = /ipcMain\.on\('pet:open-help'[\s\S]*?\n  \}\);/.exec(main);
    assert.ok(m);
    assert.ok(/spawn\('cmd'/.test(m[0]), '必须用 cmd /c start 打开（走 Windows 文件关联）');
    assert.ok(/start/.test(m[0]), '必须是 start 命令');
    // start 的空标题占位：不加 `""`，带空格的路径会被当成窗口标题解析（经典坑）
    assert.ok(/\[[^\]]*''[^\]]*\]/.test(m[0]) || /''/.test(m[0]), 'start 必须带空标题占位 `""`');
  });

  test('cmd 失败时兜底 shell.openPath（至少能打开，不静默失败）', () => {
    const m = /ipcMain\.on\('pet:open-help'[\s\S]*?\n  \}\);/.exec(main);
    assert.ok(m);
    assert.ok(/shell\.openPath/.test(m[0]), '必须保留 openPath 兜底');
    assert.ok(/child\.on\('error'/.test(m[0]), '兜底要挂在 cmd 的 error 事件上');
  });

  test('html 缺失时回退 txt，再没有只记日志（不抛不弹）', () => {
    const m = /ipcMain\.on\('pet:open-help'[\s\S]*?\n  \}\);/.exec(main);
    assert.ok(m);
    assert.ok(/使用说明\.txt/.test(m[0]), 'html 不在时要回退到 使用说明.txt');
    assert.ok(/existsSync/.test(m[0]), '必须先确认文件存在');
    assert.ok(/console\.error/.test(m[0]), '全缺失时只记日志（桌宠不该为缺个说明打扰用户）');
  });

  test('诊断写文件而非 console（独立/桥接模式下 console 未必被转发）', () => {
    // diagLog 定义在 ipcMain.on 之前，所以从 console.error 的注释往后抓更大范围
    const m = /const diagLog = [\s\S]*?ipcMain\.on\('pet:open-help'[\s\S]*?\n  \}\);/.exec(main);
    assert.ok(m, '找不到 diagLog + handler');
    assert.ok(/pet\.log/.test(m[0]), '诊断必须直接写 pet.log（不依赖 stdout/stderr 管道）');
    assert.ok(/appendFile/.test(m[0]), '用 appendFile 追加，不覆盖别人写的内容');
  });

  test('路径由主进程拼，渲染端只发语义动作', () => {
    const body = onMenuActionBody();
    const helpBranch = body.slice(body.indexOf("'open-help'"));
    assert.ok(/openHelpPage\(\)/.test(helpBranch), '渲染端必须调 openHelpPage()（不带路径参数）');
    assert.ok(!/openLocalFile/.test(helpBranch), '不得再走 openLocalFile（那条通道给不了 file:// 语义）');
    // 渲染端只发语义动作：剥掉注释后，代码里不得出现路径
    const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/file:\/\//.test(codeOnly), '渲染端不得拼 file:// 地址');
    assert.ok(!/使用说明\.html/.test(codeOnly), '渲染端代码里不得出现 html 文件名（那是主进程的事）');
  });
});

describe('preload：桥必须暴露', () => {
  test('openHelpPage 已暴露', () => {
    assert.ok(/openHelpPage\(\)/.test(preload), 'preload 必须暴露 openHelpPage');
    assert.ok(/pet:open-help/.test(preload), '必须走 pet:open-help 通道');
  });

  test('openLocalFile 保留为通用能力，但标注无菜单调用方', () => {
    assert.ok(/openLocalFile\(rel\)/.test(preload), 'openLocalFile 保留（打开包内任意文件）');
    assert.ok(/无调用方/.test(preload), '必须注明当前无菜单调用方，避免后人以为还在用');
  });

  test('openDshSite 通道保留但标注无调用方', () => {
    assert.ok(/openDshSite\(url\)/.test(preload), 'openDshSite 通道保留（宿主模式可能仍有入口）');
    assert.ok(/无调用方/.test(preload), '必须注明当前无调用方，避免后人以为还在用');
  });
});
