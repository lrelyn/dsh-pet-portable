# 大肥鱼桌宠 · dsh-pet 便携版

> 一只住在 Windows 桌面上的蓝发小女仆。免安装，自带 Node + Electron，整个文件夹拷走就能跑。

这是基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的**便携版二次开发**，在原版基础上加了心情系统、分部位触摸等功能。

## 效果预览

> 动画为透明背景；GIF 预览中透明部分显示为页面底色，实际播放为透明。

<p>
  <img src="app/assets/preview/daiji-huxi-xiuxian.gif" width="220" alt="待机呼吸休闲" title="待机呼吸休闲">
  <img src="app/assets/preview/dianji-huiying-kaixin-yuedong.gif" width="220" alt="点击回应-开心跃动" title="点击回应-开心跃动">
  <img src="app/assets/preview/dianji-huiying-haixiu-jingya.gif" width="220" alt="点击回应-害羞惊讶" title="点击回应-害羞惊讶">
  <img src="app/assets/preview/dianji-huiying-naoyang-gegexiao.gif" width="220" alt="点击回应-挠痒咯咯笑" title="点击回应-挠痒咯咯笑">
  <img src="app/assets/preview/beixiayitiao-zhamao.gif" width="220" alt="被吓一跳（炸毛）" title="被吓一跳（炸毛）">
  <img src="app/assets/preview/beishubiao-tuozhuai-xuankong-fankui.gif" width="220" alt="被鼠标拖拽悬空反馈" title="被鼠标拖拽悬空反馈">
  <img src="app/assets/preview/shuijue-diyiduan.gif" width="220" alt="睡觉第一段" title="睡觉第一段">
  <img src="app/assets/preview/kaishi-gongzuo.gif" width="220" alt="开始工作" title="开始工作">
</p>

**上面 8 个动作对应本 fork 的核心改动**：

| 预览 | 对应功能 |
|---|---|
| 待机呼吸 / 开心跃动 / 害羞惊讶 / 挠痒咯咯笑 | **分部位触摸**：点脑袋三次会从「害羞」递进到「咯咯笑」 |
| 被吓一跳（炸毛） | 点脚（命中区下 18%）的反应 |
| 被鼠标拖拽悬空反馈 | 拖拽时的心情事件（−4，她不喜欢被拎） |
| 睡觉第一段 / 开始工作 | 空闲自动触发的睡眠与工作（素材缺失时会被守卫拦下，不会定格） |

预览图由 `make-preview-gifs.ps1` 从 `app/assets/webm/` 转出（220 宽 / 12fps / 64 色，与上游规格一致）。全部 136 段动画见上游仓库。

## 和原版有什么不同

| 功能 | 原版 | 这里 |
|---|---|---|
| 心情系统 | 无 | 连续 0~100 心情值，四档（开心/平静/疲倦/烦躁），影响动作选择 |
| 分部位触摸 | 点哪都一样 | 摸头 / 撸身子 / 点脚 → 不同动画池，同部位连点递进 |
| 睡眠/工作守卫 | 素材缺失会静默失效 | 缺素材时跳过该功能，不会把宠物定格 |
| 使用说明 | 纯文本 | 网页版（含赞助码），菜单里直接打开 |
| 免安装 | 需要 DSH 插件 | 自带运行时，双击即用 |

## 目录结构

```
dsh-pet-portable/
├─ app/                         桌宠本体
│  ├─ src/                      源码（shared / host / client / standalone）
│  ├─ lib/                      构建产物
│  ├─ runtime/electron-helper/  ★ 桌面端实际运行的 JS（改了重启即生效）
│  └─ assets/                   配置 + 小图标（webm 素材不在本仓库，见下）
├─ config/                      真正生效的配置快照 + 说明
├─ .gitignore
├─ launcher.js                  启动器源码（沙箱探测 + 降级重试）
├─ pack.ps1                     打包脚本
└─ mood-tune.ps1                心情调参台
```

## 本仓库不包含什么

为了控制体积，以下**不在** git 里（见 `.gitignore`）：

| 排除项 | 体积 | 怎么补 |
|---|---|---|
| `electron/` | 563 MB | 从上游 `npm run ensure:electron` |
| `runtime/node.exe` | 89 MB | 从 nodejs.org 下载 |
| `app/assets/webm/` | 67 MB | 从上游 `assets/webm` 拷贝 |
| `大肥鱼桌宠.exe` | 90 MB | 用 `launcher.js` 重新打包 |

**所以本仓库 clone 下来不能直接运行**，需要补齐运行时和素材。完整步骤见 [my-life-archive 的恢复清单](https://github.com/lrelyn/my-life-archive/blob/main/notes/dsh-pet-restore.md)。

## 自己造动作

原版有一套完整的素材制作管线（绿幕视频 → 透明 webm）：

```
step01 绿幕源视频
  ↓ crop_step01.py        裁切
  ↓ chroma_step02.py      HSV 色相抠像 → 透明
  ↓ normalize_step03.py   归一化统一站位
  ↓ encode_thumbs.py      转 640×360 VP9-alpha
step04 → assets/webm/
```

关键参数：
- 抠像用 **HSV 色相判定**（`GREEN_HUE_MIN=70, GREEN_HUE_MAX=170, SAT_MIN=0.15`），不用 `chromakey` —— 后者会把蓝色/白色误抠
- 转码必须写 `-c:v libvpx-vp9`（输入端也要）和 `format=yuva420p`，否则丢 alpha 变黑底
- 最终规格 **640×360 / VP9 / CRF 40 / 24fps / 无音轨**

原创动作请放 `app/assets/webm-original/`（该目录**会**进 git），部署时复制到 `assets/webm/`。

详细说明见 [架构笔记](https://github.com/lrelyn/my-life-archive/blob/main/notes/dsh-pet-architecture.md)。

## 许可

- **代码**：MIT（继承上游）
- **动画素材**：上游明确「允许开源使用，**禁止商用**」
- 本仓库不含素材文件，素材请从上游获取并遵守其许可

原作者的 LICENSE 完整保留在 `app/LICENSE` 与 `app/LICENSE-dsh-whale-girl-pet`。

## 致谢

- 原作者：[PC2005-cloud](https://github.com/PC2005-cloud) — [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- 本便携版的打包与功能扩展由本仓库维护者完成
