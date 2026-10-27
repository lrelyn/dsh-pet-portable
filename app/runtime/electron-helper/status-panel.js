// 状态面板（P2 第四批）—— 图形化展示四维状态 + 好感度等级
//
// 为什么做成 DOM 而不是新窗口：
//   新开 Electron 窗口要改 main.js 的窗口管理、加 IPC、处理层级与穿透，成本高且
//   容易和「宠物窗口」的单实例逻辑打架。做成窗口内的浮层最省事，也符合现有
//   菜单/气泡/聊天弹窗的既有做法（都是窗口内 DOM + 穿透守卫）。
//
// 布局：
//   三条状态条（心情/精力/饱食）+ 好感度等级条 + 统计区
//   配色按文档 §8.1：正常/警告/危险三档
//
// 数据来源：sprite 实例的 mood / vitals / affinity，每次打开时现算（不做实时刷新，
// 省得后台一直跑定时器；用户想看时打开看一眼就够）。
'use strict';

const clampPanel = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);

/** 状态条配色档位（文档 §8.1） */
function bandOf(kind, value) {
  const v = clampPanel(value);
  if (kind === 'mood') {
    if (v > 60) return 'ok';
    if (v >= 40) return 'warn';
    return 'danger';
  }
  if (kind === 'energy') {
    if (v > 40) return 'ok';
    if (v >= 20) return 'warn';
    return 'danger';
  }
  // hunger
  if (v > 40) return 'ok';
  if (v >= 20) return 'warn';
  return 'danger';
}

/** 中文label */
const LABELS = { mood: '心情', energy: '精力', hunger: '饱食', affinity: '好感度' };

/** 档位对应的文字描述 */
function descOf(kind, value) {
  const v = clampPanel(value);
  if (kind === 'mood') return v > 60 ? '开心' : v >= 40 ? '平静' : v >= 25 ? '疲倦' : '烦躁';
  if (kind === 'energy') return v >= 80 ? '精力充沛' : v >= 40 ? '正常' : v >= 20 ? '疲惫' : '精疲力竭';
  return v >= 80 ? '吃饱' : v >= 40 ? '正常' : v >= 20 ? '饥饿' : '饿坏了';
}

const CSS = `
.pet-panel{position:fixed;left:0;top:0;z-index:2147483003;width:260px;
  background:rgba(255,255,255,.97);border-radius:14px;padding:14px 16px;
  box-shadow:0 8px 28px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.08);
  font-family:'Microsoft YaHei UI','Segoe UI',sans-serif;font-size:12px;color:#2b2b2b;
  user-select:none;}
.pet-panel-title{font-size:13px;font-weight:700;margin:0 0 10px;display:flex;
  justify-content:space-between;align-items:center;}
.pet-panel-close{cursor:pointer;color:#999;font-size:15px;line-height:1;padding:0 2px;}
.pet-panel-close:hover{color:#333;}
.pet-panel-row{margin-bottom:9px;}
.pet-panel-head{display:flex;justify-content:space-between;margin-bottom:3px;
  font-size:11px;color:rgba(43,43,43,.7);}
.pet-panel-bar{height:7px;border-radius:4px;background:rgba(0,0,0,.08);overflow:hidden;}
.pet-panel-fill{height:100%;border-radius:4px;transition:width .3s ease;}
.pet-panel-fill.ok{background:linear-gradient(90deg,#4caf50,#66bb6a);}
.pet-panel-fill.warn{background:linear-gradient(90deg,#ff9800,#ffb74d);}
.pet-panel-fill.danger{background:linear-gradient(90deg,#e53935,#ef5350);}
.pet-panel-fill.aff{background:linear-gradient(90deg,#ec407a,#f06292);}
.pet-panel-aff{margin-top:12px;padding-top:10px;border-top:1px solid rgba(0,0,0,.07);}
.pet-panel-lv{font-size:12px;font-weight:700;color:#c2185b;}
.pet-panel-stat{margin-top:10px;padding-top:8px;border-top:1px solid rgba(0,0,0,.07);
  font-size:10.5px;color:rgba(43,43,43,.55);line-height:1.7;}
`;

/**
 * 组装状态面板的 HTML（纯函数，便于单测）。
 * @param {object} d {mood, energy, hunger, affinity:{value,lv,name,toNext,bonus}, stats}
 * @returns {string} innerHTML
 */
function buildPanelHtml(d) {
  const rows = [];
  for (const k of ['mood', 'energy', 'hunger']) {
    const v = clampPanel(Number(d && d[k]) || 0);
    const band = bandOf(k, v);
    rows.push(
      '<div class="pet-panel-row">' +
        '<div class="pet-panel-head"><span>' + LABELS[k] + ' · ' + descOf(k, v) + '</span>' +
        '<span>' + Math.round(v) + '</span></div>' +
        '<div class="pet-panel-bar"><div class="pet-panel-fill ' + band +
        '" style="width:' + v + '%"></div></div>' +
      '</div>'
    );
  }
  let aff = '';
  if (d && d.affinity) {
    const a = d.affinity;
    aff =
      '<div class="pet-panel-aff">' +
        '<div class="pet-panel-head"><span class="pet-panel-lv">Lv.' + a.lv + ' ' + a.name + '</span>' +
        '<span>' + Math.round(a.value) + '</span></div>' +
        '<div class="pet-panel-bar"><div class="pet-panel-fill aff" style="width:' +
        clampPanel(a.value) + '%"></div></div>' +
        '<div style="margin-top:4px;font-size:10.5px;color:rgba(43,43,43,.55)">' +
        (a.toNext > 0 ? '距下一级还差 ' + a.toNext + ' · 互动加成 ×' + a.bonus.toFixed(1)
                      : '已满级 · 互动加成 ×' + a.bonus.toFixed(1)) +
        '</div>' +
      '</div>';
  }
  const st = (d && d.stats) || {};
  const stat =
    '<div class="pet-panel-stat">' +
      '陪伴 ' + (st.days || 0) + ' 天 · 喂食 ' + (st.feeds || 0) + ' 次' +
    '</div>';
  return rows.join('') + aff + stat;
}

// 双环境导出（clamp 用私有名避免与其它模块的全局声明冲突）
const __panelApi = { buildPanelHtml, bandOf, descOf, LABELS, CSS, clamp: clampPanel };
if (typeof module !== 'undefined' && module.exports) module.exports = __panelApi;
if (typeof window !== 'undefined') window.PET_STATUS_PANEL = __panelApi;
