// 前台窗口 → 工作状态映射（独立版 workStatus 的触发源）
//
// 背景：dsh-pet 的 workStatus 六档（thinking/working/result/waiting/success/error）原本靠
// DSH 会话事件驱动（turn/start、tool/call…）。独立版没有宿主事件，这套系统完全休眠——
// 6 段动画 + 18 句台词躺在配置里没人用。本模块用前台窗口反推状态，把它救活。
//
// 设计原则：
//   1. 纯函数、无副作用：输入 {进程名, 窗口标题}，输出档位。方便单测。
//   2. 规则表可配置（config.workStatusDetector.customRules 优先于内置规则）。
//   3. 识别不到就返回 null（= 空闲），绝不瞎猜。
//   4. 隐私：只做关键词匹配，不存储、不上传任何标题原文。
'use strict';

/** 六档（与 shared/work-status.ts 的 WORK_STATUS_STATES 严格一致） */
const STATES = ['thinking', 'working', 'result', 'waiting', 'success', 'error'];

/**
 * 内置映射规则。顺序即优先级：从上往下第一条命中的胜出。
 *
 * 为什么这么排：
 *   - 桌宠自己/DSH 自己先排除，否则永远判成"在自己身上工作"
 *   - 摸鱼站点排在工作站点前面：浏览器同进程，只能靠标题区分
 *   - 游戏/视频排最后，它们是明确的全屏独占场景
 */
const BUILTIN_RULES = [
  // ---- 自身：保持上一状态（不切换） ----
  { match: { process: ['electron', 'dsh-pet-electron-helper', '大肥鱼桌宠', 'DeepSeek Harness'] }, state: 'hold' },

  // ---- 摸鱼站点（必须先判，否则被下面的"浏览器-工作"吃掉）----
  {
    match: {
      process: ['chrome', 'msedge', 'firefox', 'brave', 'opera', '360se', 'QQBrowser'],
      titleContains: ['抖音', 'B站', '哔哩哔哩', 'bilibili', '微博', '知乎', '淘宝', '京东', '小红书',
        '视频', '直播', '斗鱼', '虎牙', '爱奇艺', '优酷', '腾讯视频', 'Netflix', 'YouTube', 'youtube'],
    },
    state: 'result', // 摸鱼 = 忙完一步在歇着（借用 result 档的"清点归档"动画，语义最接近）
  },

  // ---- 聊天社交：等你回复 ----
  {
    match: { process: ['WeChat', 'Weixin', 'QQ', 'DingTalk', 'Lark', 'Feishu', 'Telegram', 'Discord', 'Slack'] },
    state: 'waiting',
  },

  // ---- 终端：思考中 ----
  {
    match: { process: ['powershell', 'pwsh', 'cmd', 'WindowsTerminal', 'wt', 'conhost', 'tabby', 'alacritty'] },
    state: 'thinking',
  },

  // ---- 编程开发：工作中 ----
  {
    match: {
      process: ['Code', 'Code - Insiders', 'devenv', 'idea64', 'pycharm64', 'webstorm64', 'goland64',
        'clion64', 'rider64', 'sublime_text', 'notepad++', 'vim', 'nvim', 'emacs', 'Cursor', 'Trae'],
    },
    state: 'working',
  },

  // ---- 文档办公：工作中 ----
  {
    match: { process: ['WINWORD', 'EXCEL', 'POWERPNT', 'wps', 'et', 'wpp', 'onenote', 'Acrobat', 'AcroRd32'] },
    state: 'working',
  },

  // ---- 设计创作：工作中 ----
  {
    match: { process: ['Photoshop', 'Illustrator', 'Figma', 'blender', 'AfterFX', 'Premiere Pro'] },
    state: 'working',
  },

  // ---- 浏览器-工作（标题含这些词 → 在干活）----
  {
    match: {
      process: ['chrome', 'msedge', 'firefox', 'brave', 'opera', '360se', 'QQBrowser'],
      titleContains: ['GitHub', 'StackOverflow', 'Stack Overflow', '文档', 'Docs', '邮箱', 'Mail', '后台',
        '管理', '控制台', 'Console', 'Dashboard', 'DeepSeek', 'ChatGPT', 'Claude', 'Kimi', '通义',
        '掘金', 'CSDN', 'MDN', 'npm', 'Jira', 'Notion', 'Confluence'],
    },
    state: 'working',
  },

  // ---- 视频/音乐播放器：休息 ----
  {
    match: { process: ['PotPlayer', 'PotPlayerMini64', 'vlc', 'mpv', 'QQMusic', 'CloudMusic', '网易云音乐', 'Spotify'] },
    state: 'result',
  },

  // ---- 游戏：休息（全屏场景，最后判）----
  {
    match: {
      process: ['League of Legends', 'LeagueClient', 'GenshinImpact', 'YuanShen', 'csgo', 'cs2', 'dota2',
        'steam', 'steamwebhelper', 'EpicGamesLauncher', 'Battle.net'],
    },
    state: 'result',
  },

  // ---- 桌面/资源管理器：发呆 ----
  { match: { process: ['explorer'] }, state: 'thinking' },
];

/** 进程名归一化：去扩展名、转小写、去空格差异，便于和规则比较 */
function normProc(name) {
  return String(name || '').trim().replace(/\.exe$/i, '').toLowerCase();
}

/** 标题关键词匹配（大小写不敏感；中文原样包含） */
function titleHas(title, keywords) {
  if (!title) return false;
  const t = String(title);
  const lower = t.toLowerCase();
  for (const k of keywords) {
    if (!k) continue;
    // 含非 ASCII（中文）的关键词直接用 includes；纯英文用大小写不敏感比较
    if (/[^\x00-\x7F]/.test(k)) {
      if (t.includes(k)) return true;
    } else if (lower.includes(k.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * 把一条规则与一次采样比对。
 * @returns {boolean} 是否命中
 */
function ruleMatches(rule, sample) {
  const m = rule && rule.match;
  if (!m || !sample) return false;

  if (Array.isArray(m.process) && m.process.length) {
    const p = normProc(sample.processName);
    const ok = m.process.some((x) => normProc(x) === p);
    if (!ok) return false;
  }
  if (Array.isArray(m.titleContains) && m.titleContains.length) {
    if (!titleHas(sample.windowTitle, m.titleContains)) return false;
  }
  return true;
}

/**
 * 采样 → 档位。
 *
 * @param {{processName:string, windowTitle:string}|null} sample
 * @param {object} [opts]
 * @param {Array}  [opts.customRules]  用户规则，优先于内置
 * @returns {string|null} 六档之一，或 null（空闲）
 *                         特殊值 'hold' 表示"保持上一状态"，由调用方处理
 */
function mapSample(sample, opts = {}) {
  if (!sample || !sample.processName) return null;

  const custom = Array.isArray(opts.customRules) ? opts.customRules : [];
  for (const r of custom) {
    if (r && r.state && ruleMatches(r, sample)) {
      return STATES.includes(r.state) || r.state === 'hold' ? r.state : null;
    }
  }
  for (const r of BUILTIN_RULES) {
    if (ruleMatches(r, sample)) return r.state;
  }
  return null;
}

/**
 * 状态机：带防抖 + 最小持续 + 久坐计时。
 *
 * 为什么需要它：用户切窗口很频繁（Alt+Tab 两三秒一次），没有防抖的话桌宠会疯狂切动画。
 * 文档 2.3.2 给的参数：确认 2 次、最小持续 10 秒、空闲阈值 3 分钟。
 */
class WorkStateMachine {
  constructor(opts = {}) {
    this.confirmCount = Math.max(1, Number(opts.confirmCount) || 2);
    this.minStateDurationSec = Math.max(0, Number(opts.minStateDurationSec) || 10);
    this.idleThresholdMin = Math.max(1, Number(opts.idleThresholdMin) || 3);
    this.workStretchMin = Math.max(1, Number(opts.workStretchMin) || 25);
    this.longWorkStretchMin = Math.max(1, Number(opts.longWorkStretchMin) || 50);

    this.current = null;        // 已确认的档位
    this.candidate = null;      // 待确认的档位
    this.candidateHits = 0;
    this.stateSince = 0;        // 当前档位进入时间（ms）
    this.lastChangeAt = 0;      // 上次窗口内容变化时间（判空闲用）
    this.lastSampleKey = '';    // 上一拍的 process|title，用于判"有没有换窗口"
    this.workingSince = 0;      // 进入 working 的时间（久坐计时）
    this.milestones = new Set();// 已触发过的里程碑（25min / 50min），防止重复触发
  }

  /**
   * 喂一拍。
   * @param {object} sample 采样
   * @param {number} now    当前时间戳（ms），注入便于单测
   * @returns {{state:string|null, changed:boolean, milestone?:string}}
   */
  feed(sample, now) {
    const mapped = mapSample(sample, this.opts);

    // 记录"窗口有没有变"（空闲判定）
    const key = sample ? `${sample.processName}|${sample.windowTitle}` : '';
    if (key !== this.lastSampleKey) {
      this.lastSampleKey = key;
      this.lastChangeAt = now;
    }

    // 'hold' = 桌宠自己/宿主，保持当前档位不动
    if (mapped === 'hold') {
      return { state: this.current, changed: false };
    }

    // 同理：进程识别不到（null）但窗口在变 → 当作 thinking（在操作但没规则匹配）
    const target = mapped === null ? 'thinking' : mapped;

    // 防抖：连续 confirmCount 次同一目标才切换
    if (target === this.current) {
      this.candidate = null;
      this.candidateHits = 0;
      return { state: this.current, changed: false, milestone: this._milestone(now) };
    }
    if (target !== this.candidate) {
      this.candidate = target;
      this.candidateHits = 1;
    } else {
      this.candidateHits += 1;
    }
    if (this.candidateHits < this.confirmCount) {
      return { state: this.current, changed: false, milestone: this._milestone(now) };
    }
    // 最小持续：刚切换不到 N 秒就不要再切（除非目标档位优先级更高，这里简化为一律等）
    if (this.stateSince && now - this.stateSince < this.minStateDurationSec * 1000) {
      return { state: this.current, changed: false, milestone: this._milestone(now) };
    }

    // 确认切换
    const prev = this.current;
    this.current = target;
    this.candidate = null;
    this.candidateHits = 0;
    this.stateSince = now;

    // 久坐计时：进入 working 才开始；离开 working 清零
    if (target === 'working') {
      if (prev !== 'working') {
        this.workingSince = now;
        this.milestones.clear();
      }
    } else {
      this.workingSince = 0;
      this.milestones.clear();
    }

    return { state: this.current, changed: true, prev, milestone: this._milestone(now) };
  }

  /** 久坐里程碑（返回 'stepDone' / 'longDone' / undefined） */
  _milestone(now) {
    if (this.current !== 'working' || !this.workingSince) return undefined;
    const mins = (now - this.workingSince) / 60000;
    if (mins >= this.longWorkStretchMin && !this.milestones.has('long')) {
      this.milestones.add('long');
      return 'longDone';
    }
    if (mins >= this.workStretchMin && !this.milestones.has('step')) {
      this.milestones.add('step');
      return 'stepDone';
    }
    return undefined;
  }

  /** 空闲判定：窗口内容超过 idleThresholdMin 没变 → 发呆（返回 true 表示应转 thinking） */
  isIdle(now) {
    if (!this.lastChangeAt) return false;
    return now - this.lastChangeAt > this.idleThresholdMin * 60000;
  }
}

// ---- 导出：双环境兼容 ----
// 同一份文件要能被两处使用：
//   1. 浏览器（index.html 的 <script src>）→ 挂到 window.PET_WORK_DETECT
//   2. Node（测试脚本 / 主进程）→ module.exports
// 所以不能只写 module.exports（浏览器没有 module 会直接报错）。
const __api = {
  STATES,
  BUILTIN_RULES,
  mapSample,
  ruleMatches,
  normProc,
  titleHas,
  WorkStateMachine,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __api;
}
if (typeof window !== 'undefined') {
  window.PET_WORK_DETECT = __api;
}
