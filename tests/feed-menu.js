// 验证投喂子菜单：模拟菜单树构建，确认 7 种食物都出现
// 这是 P0 的验收测试 —— 不看代码，看实际产出
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'app', 'runtime', 'electron-helper');

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// 加载 foods.js（浏览器环境）
const src = fs.readFileSync(path.join(HELPER, 'foods.js'), 'utf8');
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const F = sandbox.PET_FOODS;

console.log('=== 1. foods 模块加载 ===');
ok(!!F, 'window.PET_FOODS 存在');
ok(typeof F.sanitizeFoods === 'function', 'sanitizeFoods 可用');
ok(Array.isArray(F.DEFAULT_FOODS) && F.DEFAULT_FOODS.length === 7, '内置 7 种食物', String(F.DEFAULT_FOODS.length));

console.log('\n=== 2. 复刻菜单构建逻辑，看实际产出 ===');
// 完全照抄 sprite.js 里的 children IIFE
function buildFeedChildren(vitalsCfg) {
  const list = F.sanitizeFoods((vitalsCfg && vitalsCfg.foods) || undefined);
  return list.map((f) => ({ label: f.name, action: 'feed:' + f.id }));
}

const children = buildFeedChildren(undefined);
console.log('  产出:', children.map((c) => c.label + '(' + c.action + ')').join(' | '));

ok(children.length === 7, '生成 7 个子项', String(children.length));
ok(children.every((c) => c.action.startsWith('feed:')), '每一项 action 都带 food: 前缀');
const ids = children.map((c) => c.action.slice(5));
ok(ids.includes('fish'), '含 fish（小鱼干）');
ok(ids.includes('bento'), '含 bento（盒饭）');
ok(ids.includes('milktea'), '含 milktea（奶茶）');
ok(ids.includes('token'), '含 token（Token）');
ok(new Set(ids).size === 7, '7 个 id 互不重复', String(new Set(ids).size));

console.log('\n=== 3. 自定义食物表（用户覆盖配置）===');
const custom = buildFeedChildren({ foods: [
  { id: 'a', name: '苹果', anim: '吃西瓜', hunger: 20 },
  { id: 'b', name: '香蕉', anim: '吃西瓜', hunger: 15 },
] });
ok(custom.length === 2, '自定义 2 种 → 菜单 2 项', String(custom.length));
ok(custom[0].label === '苹果' && custom[1].label === '香蕉', '名称来自配置');
ok(custom[0].action === 'feed:a', 'action 用自定义 id');

console.log('\n=== 4. action 分发解析（复刻 sprite.js 的 slice(5)）===');
function parseFoodId(action) {
  if (action === 'feed') return undefined;
  if (action.startsWith('feed:')) return action.slice(5);
  return null;
}
ok(parseFoodId('feed') === undefined, "'feed' → undefined（旧菜单兼容）");
ok(parseFoodId('feed:fish') === 'fish', "'feed:fish' → fish");
ok(parseFoodId('feed:bento') === 'bento', "'feed:bento' → bento");
ok(parseFoodId('status-panel') === null, '其它 action → null（不误命中）');
ok(parseFoodId('feedx') === null, "'feedx' 不被误判为 feed:", "实际 " + parseFoodId('feedx'));

console.log('\n=== 5. 与 PET_FEED 的接口契约 ===');
// PET_FEED(foodId) 里会调 findFood(foodId || 'fish', sanitizeFoods(...))
for (const id of ids) {
  const food = F.findFood(id, F.DEFAULT_FOODS);
  ok(!!food, `findFood('${id}') 能命中`, food ? food.name : 'null');
}
ok(F.findFood(undefined, F.DEFAULT_FOODS) === null, 'findFood(undefined) 返回 null（PET_FEED 内部有兜底）');

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
