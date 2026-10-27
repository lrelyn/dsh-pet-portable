// mood / pet-state 的读写逻辑测试
//
// 【重要】本测试**绝不触碰真实的用户数据文件**。
// 早期版本直接操作 data/dsh-pet/memory.json，还在测试里写入 MOCK 数据、
// 故意把它写成非法 JSON —— 一旦中途崩溃就会永久污染用户存档
//（实际发生过一次：memory.json 里留下了空 key + "MOCK-OK" + 乱码，见修改方案 §4.4）。
// 现在全部在系统临时目录下的沙箱里跑，跑完整个目录删掉。
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = process.argv[2] || path.join(__dirname, '..');

// 沙箱：系统 temp 下，与真实数据完全隔离
const SANDBOX = path.join(os.tmpdir(), 'dsh-pet-test-' + process.pid + '-' + Date.now());
fs.mkdirSync(SANDBOX, { recursive: true });
const MEM = path.join(SANDBOX, 'memory.json');
const STATE = path.join(SANDBOX, 'pet-state-main.json');

// 复刻 main.js 的读写语义（读-改-写，保留其它字段）
function loadMood(file) {
  try {
    if (!fs.existsSync(file)) return { ok: true, mood: null };
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ok: true,
      mood: typeof obj.mood === 'number' ? obj.mood : null,
      updatedAt: obj.moodUpdatedAt || null,
    };
  } catch (e) {
    return { ok: false, mood: null, error: String(e && e.message ? e.message : e) };
  }
}

function saveMood(file, v) {
  try {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: 'mood 必须是数字' };
    let obj = {};
    if (fs.existsSync(file)) {
      try { obj = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { obj = {}; }
    }
    obj.mood = Math.max(0, Math.min(100, v));
    obj.moodUpdatedAt = Date.now();
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

const PS = require(path.join(ROOT, 'app', 'runtime', 'electron-helper', 'pet-state.js'));

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

try {
  console.log('=== 0. 沙箱隔离确认（关键：不能碰真实数据）===');
  ok(!MEM.includes(path.join('dsh-pet', 'data')), '测试文件不在真实 data 目录', MEM);
  ok(MEM.startsWith(os.tmpdir()), '测试文件在系统临时目录', MEM);
  ok(path.basename(SANDBOX).startsWith('dsh-pet-test-'), '沙箱目录名可识别');

  console.log('\n=== 1. mood 读写 ===');
  ok(loadMood(MEM).mood === null, '文件不存在 → mood=null');
  ok(saveMood(MEM, 73.5).ok === true, 'saveMood 成功');
  ok(loadMood(MEM).mood === 73.5, '读回 73.5', String(loadMood(MEM).mood));

  console.log('\n=== 2. 读-改-写：宿主其它字段必须保留 ===');
  fs.writeFileSync(MEM, JSON.stringify({
    host: { messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }] },
    mood: 50,
  }, null, 2), 'utf8');
  saveMood(MEM, 88);
  const after = JSON.parse(fs.readFileSync(MEM, 'utf8'));
  ok(after.mood === 88, 'mood 更新为 88');
  ok(after.host && Array.isArray(after.host.messages), '宿主的 messages 保留');
  ok(after.host.messages.length === 2, 'messages 条数不变', String(after.host.messages.length));
  ok(after.host.messages[0].content === 'hello', 'messages 内容不变');

  console.log('\n=== 3. 边界值 ===');
  saveMood(MEM, 999);
  ok(loadMood(MEM).mood === 100, '999 夹到 100');
  saveMood(MEM, -50);
  ok(loadMood(MEM).mood === 0, '-50 夹到 0');
  saveMood(MEM, NaN);
  ok(loadMood(MEM).mood === 0, 'NaN 被拒（保持原值）', String(loadMood(MEM).mood));

  console.log('\n=== 4. 文件损坏时降级（在沙箱里故意写坏）===');
  fs.writeFileSync(MEM, 'not json{{{', 'utf8');
  const r2 = loadMood(MEM);
  ok(r2.ok === false && r2.mood === null, '损坏时 loadMood 返回失败而不抛');
  ok(saveMood(MEM, 42).ok === true, '损坏时 saveMood 仍可用（重建）');
  ok(loadMood(MEM).mood === 42, '重建后能读回');

  console.log('\n=== 5. pet-state 快照读写 ===');
  const { state, repaired } = PS.sanitize({
    savedAt: new Date().toISOString(), mood: 60, energy: 40, hunger: 80, affinity: 50,
    lastSeen: PS.dateKey(new Date()), counters: {},
  }, new Date());
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2), 'utf8');
  ok(fs.existsSync(STATE), 'pet-state 写入成功');
  const readBack = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  ok(readBack.energy === 40 && readBack.hunger === 80, '读回数值正确', `${readBack.energy}/${readBack.hunger}`);
  ok(repaired.length === 0, '合法快照无需修复');

  console.log('\n=== 6. 损坏快照的修复 ===');
  const bad = PS.sanitize({ energy: 'abc', savedAt: 'not-a-date' }, new Date());
  ok(bad.repaired.includes('energy'), '标记 energy 非法');
  ok(bad.repaired.includes('savedAt'), '标记 savedAt 非法');
  ok(bad.state.energy === 80, '修复为默认 80', String(bad.state.energy));
} finally {
  // 无论成败都清掉沙箱
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch {}
  console.log('\n(沙箱已清理)');
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
