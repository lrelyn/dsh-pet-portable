// 心情徽标（.pet-mood）DOM 层验证
//
// 背景（2026-10-27 用户反馈）：原先头顶有 .pet-status-bar 状态栏、右上 .pet-mood 心情 emoji，
// 两处并存「太乱」。改成只剩一处徽标后，这个文件替代旧的 status-bar-dom.js：
//   1. status-icons.js 的 pickIcons 是纯函数 → tests/status-icons.js 已经覆盖逻辑；
//   2. 真正决定用户看到什么的是 sprite.js 的 renderMood —— 它负责选 emoji、选数值、
//      拼 class、写 title、按签名短路。这一层出过错（逻辑对、DOM 不更新），所以真跑一遍。
//
// 抽取方式：sprite.js 要 Electron 环境，不能 require。用正则摘出 `renderMood() { ... }`
// 方法体，包进壳对象调用。注意 sprite.js 是 CRLF，正则前必须先归一化换行。
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'app', 'runtime', 'electron-helper');

let pass = 0, fail = 0;
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${e}`); } };

// ---------- 最小 DOM 桩 ----------
// 只实现 renderMood / moodBadgeHit 用到的 API。
// getBoundingClientRect 由各用例自己塞，用来验证徽标热区判定。
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    className: '',
    title: '',
    _text: '',
    style: { setProperty() {}, removeProperty() {} },
    rect: null,
    get firstChild() { return this.children.length ? this.children[0] : null; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i < 0) throw new Error('removeChild: not a child');
      this.children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); this.children.length = 0; },
  });
  return el;
}

const sandbox = { console, document: { createElement: (t) => makeEl(t) } };
sandbox.window = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(HELPER, 'status-icons.js'), 'utf8'), sandbox);
ok(!!sandbox.PET_STATUS_ICONS, 'status-icons.js 挂上 window.PET_STATUS_ICONS');

// ---------- 从 sprite.js 抽方法体 ----------
const spriteSrc = fs.readFileSync(path.join(HELPER, 'sprite.js'), 'utf8');

function extract(name, params = '\\(\\)') {
  // CRLF 归一化是必须的：sprite.js 用 \r\n，正则里写 \n 匹配不到（历史上漏过两次）
  // params 默认只匹配无参方法；moodBadgeHit(wx, wy) / onMouseMove(e) 要显式传
  const norm = spriteSrc.replace(/\r\n/g, '\n');
  const re = new RegExp('\\n  ' + name + params + ' \\{[\\s\\S]*?\\n  \\}\\n');
  const m = norm.match(re);
  return m ? m[0].trim() : null;
}

const moodBody = extract('renderMood');
ok(!!moodBody, '在 sprite.js 里找到 renderMood 方法体');
const badgeHitBody = extract('moodBadgeHit', '\\(wx, wy\\)');
if (!moodBody) { console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`); process.exit(1); }

// 文案表与常量都抄自 sprite.js（用正则取，避免测试里写死一份漂移的副本）
const labelBlock = (spriteSrc.replace(/\r\n/g, '\n').match(/\n  static MOOD_LABEL = \{[\s\S]*?\n  \};/) || [''])[0];
// 去掉 `static MOOD_LABEL = ` 前缀和结尾的 `;`，剩下的对象字面量才能被括号包住求值
const labelExpr = labelBlock.replace(/^[\s\S]*?= /, '').replace(/;\s*$/, '');
const MOOD_LABEL = new Function('return (' + labelExpr + ');')();
ok(Object.keys(MOOD_LABEL).length === 4, '解析出 4 个心情档', Object.keys(MOOD_LABEL).join(','));
for (const k of ['happy', 'normal', 'tired', 'grumpy']) {
  ok(!!(MOOD_LABEL[k] && MOOD_LABEL[k].emoji), `MOOD_LABEL.${k} 有 emoji`, MOOD_LABEL[k] && MOOD_LABEL[k].emoji);
}

const numConst = (name) => {
  const m = spriteSrc.replace(/\r\n/g, '\n').match(new RegExp('const ' + name + ' = ([0-9*\\s]+);'));
  return m ? new Function('return ' + m[1] + ';')() : NaN;
};
const TRANSIENT_MS = numConst('PET_BADGE_TRANSIENT_MS');
const BORED_MS = numConst('PET_BORED_AFTER_MS');
ok(Number.isFinite(TRANSIENT_MS) && TRANSIENT_MS > 0, 'PET_BADGE_TRANSIENT_MS 可解析', String(TRANSIENT_MS));
ok(Number.isFinite(BORED_MS) && BORED_MS > TRANSIENT_MS, 'PET_BORED_AFTER_MS 比一次性标记长得多', String(BORED_MS));

// 壳：只提供 renderMood 依赖的字段
function makeSprite(state = {}) {
  const moodEl = makeEl('div');
  moodEl.className = 'pet-mood';
  const sp = {
    moodEl,
    moodEmoji: makeEl('span'),
    moodText: makeEl('span'),
    moodVal: makeEl('span'),
    _moodSig: '',
    vitals: state.vitals,
    mood: state.mood || { enabled: true, current: 'normal', value0: 50 },
    PET_SLEEP_On: state.sleeping === true,
    _affectionJustUpAt: state.affectionJustUp ? Date.now() : 0,
    lastInteractionAt: state.bored ? Date.now() - BORED_MS - 1000 : Date.now(),
  };
  const fn = new Function(
    'window', 'document', 'PetSprite', 'PET_BADGE_TRANSIENT_MS', 'PET_BORED_AFTER_MS',
    'return ({ ' + moodBody + ' }).renderMood;',
  );
  sp.renderMood = fn.call(null, sandbox, sandbox.document, { MOOD_LABEL }, TRANSIENT_MS, BORED_MS);
  return sp;
}

const VITALS_OK = { enabled: true, energy: 90, hunger: 90 };

// ---------- 1. 平静 + 健康：只显示心情 emoji，不挂族类名 ----------
console.log('\n=== 1. 平静且健康 ===');
const calm = makeSprite({ vitals: VITALS_OK });
calm.renderMood();
ok(calm.moodEl.className === 'pet-mood is-on pet-mood-normal', 'class 只带心情档', calm.moodEl.className);
ok(calm.moodEmoji.textContent === '🙂', 'emoji 是 🙂（平静）', calm.moodEmoji.textContent);
ok(calm.moodText.textContent === '', '平静不显示档名（减少常驻干扰）', `"${calm.moodText.textContent}"`);
ok(calm.moodVal.textContent === '50', '数值是心情值 50', calm.moodVal.textContent);
ok(calm.moodEl.title.includes('点击查看她的状态'), 'title 提示可点击', calm.moodEl.title);

// ---------- 2. 开心档：emoji 跟着心情档走 ----------
console.log('\n=== 2. 心情档映射 ===');
for (const [key, want] of [['happy', '😄'], ['tired', '🥱'], ['grumpy', '😾']]) {
  const s = makeSprite({ vitals: VITALS_OK, mood: { enabled: true, current: key, value0: 70 } });
  s.renderMood();
  ok(s.moodEmoji.textContent === want, `${key} → ${want}`, s.moodEmoji.textContent);
  ok(s.moodEl.className.includes('pet-mood-' + key), `${key} 的档位类名在`, s.moodEl.className);
  ok(s.moodText.textContent === MOOD_LABEL[key].text, `${key} 显示档名「${MOOD_LABEL[key].text}」`, s.moodText.textContent);
}

// ---------- 3. 需求型状态盖过心情档（这就是「图二要多样性」）----------
console.log('\n=== 3. 需求状态优先于心情档 ===');
const hungry = makeSprite({ vitals: { enabled: true, energy: 90, hunger: 22 }, mood: { enabled: true, current: 'happy', value0: 80 } });
hungry.renderMood();
ok(hungry.moodEmoji.textContent === '🍘', '饿了 → 🍘 盖过开心 😄', hungry.moodEmoji.textContent);
ok(hungry.moodVal.textContent === '22', '数值换成饱食度 22（不是心情 80）', hungry.moodVal.textContent);
ok(hungry.moodEl.className.includes('is-hunger'), '挂上 is-hunger 族类名', hungry.moodEl.className);
ok(hungry.moodEl.className.includes('pet-mood-happy'), '心情档类名仍在（着色可叠加）', hungry.moodEl.className);
ok(hungry.moodText.textContent === '有点饿', '说明文字换成「有点饿」', hungry.moodText.textContent);
ok(hungry.moodEl.title.includes('心情 80'), 'title 仍报心情值', hungry.moodEl.title);

const starving = makeSprite({ vitals: { enabled: true, energy: 90, hunger: 8 } });
starving.renderMood();
ok(starving.moodEmoji.textContent === '🍚', '饱食 8 → 🍚 饿坏', starving.moodEmoji.textContent);

const exhausted = makeSprite({ vitals: { enabled: true, energy: 12, hunger: 90 } });
exhausted.renderMood();
ok(exhausted.moodEmoji.textContent === '💤', '精力 12 → 💤 精疲力竭', exhausted.moodEmoji.textContent);
ok(exhausted.moodVal.textContent === '12', '数值是精力 12', exhausted.moodVal.textContent);
ok(exhausted.moodEl.className.includes('is-energy'), '挂上 is-energy', exhausted.moodEl.className);

// ---------- 4. 睡着：😴 且不报困、不带数值（回落到心情值）----------
console.log('\n=== 4. 睡着 ===');
const asleep = makeSprite({ vitals: { enabled: true, energy: 8, hunger: 90 }, sleeping: true });
asleep.renderMood();
ok(asleep.moodEmoji.textContent === '😴', '精力 8 但睡着 → 😴 而不是 💤', asleep.moodEmoji.textContent);
ok(asleep.moodVal.textContent === '50', '睡着不带需求数值 → 回落心情值 50', asleep.moodVal.textContent);
ok(asleep.moodEl.className.includes('is-sleep'), '挂上 is-sleep', asleep.moodEl.className);

// ---------- 5. 一次性标记按时间过期（之前 _boredFlag 永远不清）----------
console.log('\n=== 5. 一次性标记会过期 ===');
const loveBurst = makeSprite({ vitals: VITALS_OK, affectionJustUp: true });
loveBurst.renderMood();
ok(loveBurst.moodEmoji.textContent === '💗', '刚升级 → 💗', loveBurst.moodEmoji.textContent);
ok(loveBurst.moodEl.className.includes('is-social'), '挂上 is-social', loveBurst.moodEl.className);
loveBurst._affectionJustUpAt = Date.now() - TRANSIENT_MS - 1000;   // 手动把它变老
loveBurst.renderMood();
ok(loveBurst.moodEmoji.textContent !== '💗', '过了存活时间 → 不再显示 💗', loveBurst.moodEmoji.textContent);
ok(!loveBurst.moodEl.className.includes('is-social'), '族类名也一起掉', loveBurst.moodEl.className);

const lonely = makeSprite({ vitals: VITALS_OK, bored: true });
lonely.renderMood();
ok(lonely.moodEmoji.textContent === '🎈', '长时间没理 → 🎈 无聊', lonely.moodEmoji.textContent);
const notBored = makeSprite({ vitals: VITALS_OK });
notBored.renderMood();
ok(notBored.moodEmoji.textContent !== '🎈', '刚互动过 → 不显示 🎈', notBored.moodEmoji.textContent);

// ---------- 6. vitals 关闭时不报饿/累 ----------
console.log('\n=== 6. vitals 关闭 ===');
const nov = makeSprite({ vitals: { enabled: false, energy: 5, hunger: 5 } });
nov.renderMood();
ok(!['🍚', '🍘', '💤', '🥱'].includes(nov.moodEmoji.textContent), 'vitals 关闭 → 不显示饿/累', nov.moodEmoji.textContent);

// ---------- 7. 心情系统关闭：徽标不出现，但 title 仍可点 ----------
console.log('\n=== 7. 心情关闭 ===');
const off = makeSprite({ vitals: VITALS_OK, mood: { enabled: false, current: 'happy', value0: 90 } });
off.renderMood();
ok(off.moodEl.className === 'pet-mood', '不加 is-on（完全不可见）', off.moodEl.className);
ok(off.moodEl.title === '点击查看她的状态', 'title 不报心情（不可见时别误导）', off.moodEl.title);

// ---------- 8. 签名短路：同一状态不重复写 DOM ----------
console.log('\n=== 8. 签名短路 ===');
const rep = makeSprite({ vitals: { enabled: true, energy: 90, hunger: 20 } });
rep.renderMood();
const sig1 = rep._moodSig;
rep.renderMood();
rep.renderMood();
ok(rep._moodSig === sig1, '同状态重复调用签名不变', sig1);
rep.vitals.hunger = 25;   // 数值变化必须重绘（旧版只比 key 会漏）
rep.renderMood();
ok(rep._moodSig !== sig1, '数值变化 → 签名变', sig1 + ' → ' + rep._moodSig);
ok(rep.moodVal.textContent === '25', '数值同步更新', rep.moodVal.textContent);
rep.vitals.hunger = 45;   // 需求消失 → 回落心情
rep.renderMood();
ok(!rep.moodEl.className.includes('is-hunger'), '需求消失 → 族类名被摘掉', rep.moodEl.className);
ok(rep.moodVal.textContent === '50', '数值回落到心情值', rep.moodVal.textContent);

// ---------- 9. 销毁后不崩 ----------
console.log('\n=== 9. 销毁后安全 ===');
const dead = makeSprite({ vitals: { enabled: true, energy: 10, hunger: 10 } });
dead.moodEl = null;    // dispose() 里就是这么做的
let threw = null;
try { dead.renderMood(); } catch (e) { threw = e; }
ok(threw === null, 'moodEl=null 时直接 return，不抛', threw ? String(threw.message) : '');

// ---------- 10. 热区判定（点徽标必须先能收到点击）----------
console.log('\n=== 10. 徽标热区 moodBadgeHit ===');
ok(!!badgeHitBody, '在 sprite.js 里找到 moodBadgeHit 方法体');
if (badgeHitBody) {
  const fnHit = new Function('return ({ ' + badgeHitBody + ' }).moodBadgeHit;')();
  const mk = (rect, opts = {}) => {
    const el = makeEl('div');
    el.rect = rect;
    return {
      moodEl: opts.moodEl === null ? null : el,
      mood: opts.mood === undefined ? { enabled: true } : opts.mood,
      moodBadgeHit: fnHit,
    };
  };
  const R = { left: 100, top: 20, right: 160, bottom: 44, width: 60, height: 24 };
  ok(mk(R).moodBadgeHit(130, 32) === true, '落在徽标内 → true');
  ok(mk(R).moodBadgeHit(101, 21) === true, '2px 容差内也算中', '左上有 pad');
  ok(mk(R).moodBadgeHit(60, 32) === false, '左侧远处 → false');
  ok(mk(R).moodBadgeHit(130, 80) === false, '下方远处 → false');
  ok(mk(R, { mood: { enabled: false } }).moodBadgeHit(130, 32) === false, '心情关闭（徽标不可见）→ false，不抢点击');
  ok(mk(R, { moodEl: null }).moodBadgeHit(130, 32) === false, 'moodEl=null → false，不抛');
  ok(mk({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }).moodBadgeHit(0, 0) === false, '零尺寸 → false');
}

// ---------- 11. onMouseMove 必须把徽标算进可交互 ----------
console.log('\n=== 11. 穿透判定接上徽标 ===');
const normSrc = spriteSrc.replace(/\r\n/g, '\n');
const moveBody = extract('onMouseMove', '\\(e\\)') || '';
ok(/moodBadgeHit\(wx, wy\)/.test(moveBody), 'onMouseMove 的 setInteractive 里调了 moodBadgeHit');
ok(/this\._panelOpen === true/.test(moveBody), 'onMouseMove 也认状态面板（面板不在 hitRect 里）');
const busyBody = extract('inputBusy') || '';
ok(/_panelOpen/.test(busyBody), 'inputBusy 把面板计入（否则面板会点不动）');

// ---------- 12. 旧状态栏必须彻底清除 ----------
console.log('\n=== 12. 旧状态栏已彻底移除 ===');
const html = fs.readFileSync(path.join(HELPER, 'index.html'), 'utf8');
ok(!/renderStatusBar/.test(spriteSrc), 'sprite.js 里没有 renderStatusBar');
ok(!/statusBarEl/.test(spriteSrc), 'sprite.js 里没有 statusBarEl');
ok(!/_statusBarSig/.test(spriteSrc), 'sprite.js 里没有 _statusBarSig');
ok(!/pet-status-bar/.test(html), 'index.html 里没有 .pet-status-bar 样式（只允许注释提及）');
ok(!/petStatusFloat/.test(html), 'index.html 里没有 petStatusFloat 动画');
ok(!/pet-status-chip/.test(html), 'index.html 里没有 .pet-status-chip');
ok(!/_boredFlag/.test(spriteSrc), 'sprite.js 里没有 _boredFlag（改成按时间戳算）');

// ---------- 13. CSS 与 JS 类名一致性 ----------
console.log('\n=== 13. CSS / JS 类名一致性 ===');
for (const cls of ['.pet-mood {', '.pet-mood.is-on', '.pet-mood-emoji', '.pet-mood-val', '.pet-mood-text']) {
  ok(html.includes(cls), `index.html 有 ${cls}`, cls);
}
for (const fam of ['hunger', 'energy', 'sleep', 'social']) {
  ok(html.includes('.pet-mood.is-' + fam), `index.html 有 is-${fam} 族着色`, 'is-' + fam);
}
for (const key of ['happy', 'tired', 'grumpy']) {
  ok(html.includes('.pet-mood-' + key), `index.html 有 pet-mood-${key} 档位着色`, 'pet-mood-' + key);
}
// JS 里拼的是 'pet-mood' + ' is-on pet-mood-' + key + ' is-' + fam，CSS 选择器必须对得上
ok(/pet-mood' \+ \(enabled \? ' is-on pet-mood-' \+ key/.test(normSrc), 'JS 拼的 class 前缀与 CSS 一致');
ok(/\(fam \? ' is-' \+ fam : ''\)/.test(normSrc), 'JS 拼的族类名带 is- 前缀');

// ---------- 14. 可点击的 CSS 前提 ----------
console.log('\n=== 14. 可点击样式 ===');
ok(/\.pet-mood \{[^}]*pointer-events: none/.test(html), '默认 .pet-mood 不抢命中区');
ok(/\.pet-mood\.is-on \{[^}]*pointer-events: auto/.test(html), 'is-on 时才 pointer-events:auto');
ok(/\.pet-mood\.is-on \{[^}]*cursor: pointer/.test(html), 'is-on 时是手型光标');
ok(/\.pet-mood\.is-on \{[\s\S]*?:active/.test(html) || html.includes('.pet-mood.is-on:active'), '有按下反馈（:active）');
// 说明文字不进药丸：实测「精疲力竭」「饿坏了，快喂我」会把药丸撑成横幅，
// 与「太乱」的诉求相反。文字只在 title 里（悬浮可见）。
ok(/\.pet-mood-text \{[^}]*display: none/.test(html), '说明文字默认不显示（避免药丸被撑成横幅）');
ok(html.includes('.pet-mood.show-text .pet-mood-text'), '留了 .show-text 开关，需要时可显示');
// 文字仍要写进 DOM（面板/调试要读），只是 CSS 不显示——别把数据一起砍掉
{
  const stillWrites = makeSprite({ vitals: { enabled: true, energy: 10, hunger: 90 } });
  stillWrites.renderMood();
  ok(stillWrites.moodText.textContent === '精疲力竭', 'moodText 仍被写入（CSS 隐藏，数据保留）', stillWrites.moodText.textContent);
}

// ---------- 15. 尺寸：徽标必须是小药丸 ----------
console.log('\n=== 15. 尺寸回归 ===');
const mFont = html.match(/\.pet-mood \{[^}]*?font-size:\s*calc\(var\(--pet-size, 462px\) \* ([\d.]+)\)/);
ok(!!mFont, '能解析出 .pet-mood 的 font-size 比例');
if (mFont) {
  const fs0 = parseFloat(mFont[1]);
  ok(fs0 <= 0.034, `.pet-mood 字号 ${fs0} 不超过 0.034（保持小药丸）`, String(fs0));
}
const mEmoji = html.match(/\.pet-mood-emoji \{[^}]*?font-size:\s*calc\(var\(--pet-size, 462px\) \* ([\d.]+)\)/);
ok(!!mEmoji, '能解析出 emoji 字号比例');
if (mEmoji) ok(parseFloat(mEmoji[1]) < 0.05, `emoji 字号 ${parseFloat(mEmoji[1])} < 0.05`, mEmoji[1]);

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
