// 直接测试主进程的 mood 读写 handler（不依赖窗口交互）
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const MEM = path.join(ROOT, 'data', 'dsh-pet', 'memory.json');

// 模拟主进程的两个 handler 逻辑（从 main.js 抄同一套），验证读-改-写不会破坏 messages
const moodMemoryPath = MEM;

function loadMood() {
  try {
    if (!fs.existsSync(moodMemoryPath)) return { ok: true, mood: null };
    const obj = JSON.parse(fs.readFileSync(moodMemoryPath, 'utf8'));
    return {
      ok: true,
      mood: typeof obj.mood === 'number' ? obj.mood : null,
      updatedAt: obj.moodUpdatedAt || null,
    };
  } catch (e) {
    return { ok: false, mood: null, error: String(e && e.message ? e.message : e) };
  }
}

function saveMood(v) {
  let obj = {};
  if (fs.existsSync(moodMemoryPath)) {
    try { obj = JSON.parse(fs.readFileSync(moodMemoryPath, 'utf8')) || {}; } catch { obj = {}; }
  }
  obj.mood = Math.max(0, Math.min(100, v));
  obj.moodUpdatedAt = Date.now();
  fs.mkdirSync(path.dirname(moodMemoryPath), { recursive: true });
  fs.writeFileSync(moodMemoryPath, JSON.stringify(obj, null, 2), 'utf8');
  return { ok: true };
}

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// 备份
const bak = moodMemoryPath + '.ipctest';
fs.copyFileSync(moodMemoryPath, bak);
const original = JSON.parse(fs.readFileSync(moodMemoryPath, 'utf8'));
const origHasMessages = !!(original[''] && original['']['']);

console.log('=== 1. 读（还没有 mood 键）===');
const r0 = loadMood();
ok(r0.ok === true, 'loadMood 返回 ok');
ok(r0.mood === null || typeof r0.mood === 'number', 'loadMood 返回 null 或数字', String(r0.mood));

console.log('\n=== 2. 写 ===');
ok(saveMood(73.5).ok === true, 'saveMood 成功');

console.log('\n=== 3. 再读 ===');
const r1 = loadMood();
ok(r1.mood === 73.5, '读回 73.5', String(r1.mood));
ok(typeof r1.updatedAt === 'number', 'updatedAt 是数字');

console.log('\n=== 4. 关键：宿主的 messages 是否完好 ===');
const after = JSON.parse(fs.readFileSync(moodMemoryPath, 'utf8'));
const hasMessages = !!after[''] && Array.isArray(after['']['']?.messages);
ok(hasMessages, 'messages 结构保留');
if (hasMessages) {
  ok(after[''][''].messages.length === 2, 'messages 条数 = 2', String(after[''][''].messages.length));
  ok(after[''][''].messages[1].content.includes('MOCK-OK'), 'messages 内容保留');
}
ok(after.mood === 73.5, 'mood 与 messages 共存');
ok(typeof after.moodUpdatedAt === 'number', 'moodUpdatedAt 已写');

console.log('\n=== 5. 边界值 ===');
saveMood(999);
ok(loadMood().mood === 100, '999 夹取到 100');
saveMood(-50);
ok(loadMood().mood === 0, '-50 夹取到 0');

console.log('\n=== 6. 文件损坏时降级 ===');
fs.writeFileSync(moodMemoryPath, 'not json{{{', 'utf8');
const r2 = loadMood();
ok(r2.ok === false || r2.mood === null, '损坏时 loadMood 不抛异常');
const saveRes = saveMood(42);
ok(saveRes.ok === true, '损坏时 saveMood 仍可用（重建）');
ok(loadMood().mood === 42, '重建后能读回');

// 恢复
fs.copyFileSync(bak, moodMemoryPath);
fs.unlinkSync(bak);
console.log('\n(已恢复原始 memory.json)');

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
