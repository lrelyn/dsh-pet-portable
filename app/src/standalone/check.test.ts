/**
 * `findStrayConfig` / `describeStrayConfig` 的单测 —— 多配置不一致告警。
 *
 * 为什么值得单独测：这套逻辑的价值全在"判断当前是便携版还是插件模式"。
 * 它的输入是三个路径字符串，判定错一个字符就会走错分支，而走错分支的表现是
 * **静默不告警**（用户看不到任何异常）——这种缺陷只能靠断言钉住。
 *
 * 真实踩过的坑（本测试的第 2 条就是它的回归）：
 *   root 传进来是 `<包根>/app`，便携版 home 是 `<包根>/data` —— 两者是**兄弟目录**，
 *   用 `home.startsWith(root)` 判断永远 false，从此便携版全部误判成插件模式。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { describeStrayConfig, findStrayConfig } from './check';

// 用一个假的包根 + 假的用户目录，完全不碰真实配置
const sandbox = mkdtempSync(join(tmpdir(), 'dsh-pet-stray-'));
const fakeProfile = join(sandbox, 'profile');
const fakePkgRoot = join(sandbox, 'pkg');
const fakeAppRoot = join(fakePkgRoot, 'app');
const fakePkgData = join(fakePkgRoot, 'data', 'dsh-pet');
const fakeDshHome = join(fakeProfile, '.dsh', 'dsh-pet');

const activePortable = join(fakePkgData, 'main-config.jsonc');
const strayDsh = join(fakeDshHome, 'main-config.jsonc');

const savedProfile = process.env.USERPROFILE;
const savedHome = process.env.HOME;

before(() => {
  for (const dir of [fakePkgData, fakeDshHome]) mkdirSync(dir, { recursive: true });
  // 两份内容故意不等长，用来验证 sameSize
  writeFileSync(activePortable, '{"a":1}\n'.repeat(20), 'utf8');
  writeFileSync(strayDsh, '{"a":1}\n'.repeat(5), 'utf8');
  // 探测靠 USERPROFILE 找 ~/.dsh，测试期间指到沙箱，避免读到真实用户配置
  process.env.USERPROFILE = fakeProfile;
  delete process.env.HOME;
});

after(() => {
  if (savedProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedProfile;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* Windows 上偶发占用，清理失败不影响断言结果 */
  }
});

describe('便携版：DSH_HOME 在包内 → 报 ~/.dsh 那份', () => {
  test('DSH_HOME = <包根>/data（与 <包根>/app 是兄弟）也判为便携版', () => {
    // 这条是回归测试：曾经用 home.startsWith(root) 判断，兄弟目录永远 false
    const stray = findStrayConfig(activePortable, fakePkgData.slice(0, -'dsh-pet'.length - 1), fakeAppRoot);
    assert.ok(stray, '便携版应探测到 ~/.dsh 那份');
    assert.equal(stray.file.toLowerCase(), strayDsh.toLowerCase());
  });

  test('DSH_HOME 恰好等于包根 → 仍判为便携版', () => {
    const stray = findStrayConfig(activePortable, fakePkgRoot, fakeAppRoot);
    assert.ok(stray);
    assert.equal(stray.file.toLowerCase(), strayDsh.toLowerCase());
  });

  test('reason 必须点明「便携版不读 ~/.dsh」，别让用户猜', () => {
    const stray = findStrayConfig(activePortable, fakePkgRoot, fakeAppRoot);
    assert.ok(stray);
    assert.match(stray.reason, /便携版/);
    assert.match(stray.reason, /~\/\.dsh/);
  });

  test('报告生效路径与双方大小，且大小不同要标 sameSize=false', () => {
    const stray = findStrayConfig(activePortable, fakePkgRoot, fakeAppRoot);
    assert.ok(stray);
    assert.equal(stray.activeFile, activePortable);
    assert.equal(stray.activeSize > 0, true);
    assert.equal(stray.size > 0, true);
    assert.notEqual(stray.size, stray.activeSize);
    assert.equal(stray.sameSize, false);
  });
});

describe('插件模式：DSH_HOME 在包外 → 报包内那份', () => {
  test('home 在用户目录下 → 探测包内 data/dsh-pet', () => {
    const stray = findStrayConfig(strayDsh, join(fakeProfile, '.dsh'), fakeAppRoot);
    assert.ok(stray, '插件模式应探测到包内那份');
    assert.equal(stray.file.toLowerCase(), activePortable.toLowerCase());
  });

  test('reason 必须点明「插件模式读 ~/.dsh」', () => {
    const stray = findStrayConfig(strayDsh, join(fakeProfile, '.dsh'), fakeAppRoot);
    assert.ok(stray);
    assert.match(stray.reason, /插件模式/);
  });
});

describe('不该告警的情形', () => {
  test('另一处文件不存在 → 返回 undefined（不要凭空报警）', () => {
    // 把 USERPROFILE 指到没有任何 .dsh 的空目录
    const emptyProfile = join(sandbox, 'empty-profile');
    mkdirSync(emptyProfile, { recursive: true });
    process.env.USERPROFILE = emptyProfile;
    delete process.env.HOME;
    try {
      assert.equal(findStrayConfig(activePortable, fakePkgRoot, fakeAppRoot), undefined);
    } finally {
      process.env.USERPROFILE = fakeProfile;
    }
  });

  test('候选路径与生效路径相同 → 返回 undefined（同一份不算 stray）', () => {
    // 让 USERPROFILE 指向 fakePkgRoot/.. 使得 ~/.dsh 恰好等于... 直接构造更简单：
    // 插件模式下 home 在包外，候选是包内；把 activeFile 也设成包内那份 → 应判为同一份
    const stray = findStrayConfig(activePortable, join(fakeProfile, '.dsh'), fakeAppRoot);
    assert.equal(stray, undefined);
  });

  test('路径大小写不同也应视为同一份（Windows）', () => {
    const upper = activePortable.toUpperCase();
    assert.equal(findStrayConfig(upper, join(fakeProfile, '.dsh'), fakeAppRoot), undefined);
  });

  test('尾随反斜杠不应影响判定', () => {
    const stray = findStrayConfig(activePortable, fakePkgRoot + '\\', fakeAppRoot + '\\');
    assert.ok(stray, '尾部多一个分隔符仍应判为便携版');
    assert.equal(stray.file.toLowerCase(), strayDsh.toLowerCase());
  });
});

describe('describeStrayConfig 渲染', () => {
  test('无 stray → 空数组（调用方可以不判断就直接展开）', () => {
    assert.deepEqual(describeStrayConfig(undefined), []);
  });

  test('有 stray → 至少 3 行，且第一行带 ⚠ 与「另有」', () => {
    const lines = describeStrayConfig(findStrayConfig(activePortable, fakePkgRoot, fakeAppRoot));
    assert.ok(lines.length >= 3);
    assert.match(lines[0] ?? '', /⚠/);
    assert.match(lines[0] ?? '', /另有一份配置/);
    assert.match(lines[0] ?? '', /不生效/);
  });

  test('大小不同 → 额外给一行「只改生效那份」的可操作提示', () => {
    const lines = describeStrayConfig(findStrayConfig(activePortable, fakePkgRoot, fakeAppRoot));
    assert.ok(lines.some((l) => /大小不同/.test(l)));
    assert.ok(lines.some((l) => /只改生效那份/.test(l)));
  });

  test('大小相同 → 不啰嗦（省略那条提示）', () => {
    // 造一对等长文件
    const sameDir = join(sandbox, 'same-size', 'data', 'dsh-pet');
    mkdirSync(sameDir, { recursive: true });
    const sameActive = join(sameDir, 'main-config.jsonc');
    writeFileSync(sameActive, 'x'.repeat(100), 'utf8');
    const profile2 = join(sandbox, 'profile2');
    const sameStrayDir = join(profile2, '.dsh', 'dsh-pet');
    mkdirSync(sameStrayDir, { recursive: true });
    writeFileSync(join(sameStrayDir, 'main-config.jsonc'), 'y'.repeat(100), 'utf8');
    process.env.USERPROFILE = profile2;
    delete process.env.HOME;
    try {
      const stray = findStrayConfig(sameActive, fakePkgRoot, fakeAppRoot);
      assert.ok(stray);
      assert.equal(stray.sameSize, true);
      const lines = describeStrayConfig(stray);
      assert.equal(lines.some((l) => /大小不同/.test(l)), false);
    } finally {
      process.env.USERPROFILE = fakeProfile;
    }
  });

  test('kb 渲染：1024 字节显示 1 KB，缺文件显示「不存在」', () => {
    const lines = describeStrayConfig({
      file: 'C:\\x\\main-config.jsonc',
      reason: '测试',
      size: 1024,
      activeFile: 'C:\\y\\main-config.jsonc',
      activeSize: -1,
      sameSize: false,
    });
    assert.match(lines[0] ?? '', /1 KB/);
    assert.match(lines[1] ?? '', /不存在/);
  });
});
