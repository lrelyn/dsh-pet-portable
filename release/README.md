# release/ — 发布资产说明

> 本目录不放二进制，只放**发布流程说明**和**重建脚本**。
> 真正的安装包是 GitHub Release 上的 zip（约 800 MB），因为体积太大不能进 git。

## 为什么 Release 而不是 git

运行这个桌宠需要四样东西：

| 依赖 | 体积 | 在 git 里？ |
|---|---|---|
| 代码（`app/src` `app/lib` `app/runtime`） | 2.6 MB | ✅ 有 |
| 用户配置（`config/`） | 8 KB | ✅ 有 |
| **Electron 运行时** | 563 MB | ❌ 排除（可下载） |
| **Node 运行时** | 89 MB | ❌ 排除（可下载） |
| **136 段动画素材** | 67 MB | ❌ 排除（上游可拉） |
| **启动器 exe** | 90 MB | ❌ 排除（源码在 launcher.js） |

git 只存"能体现改动"的部分。**要让用户下载即用，必须打一个完整包传 Release。**

## 打包（一条命令）

在项目根目录（有 `pack.ps1` 的那个）跑：

```powershell
& powershell -ExecutionPolicy Bypass -File .\pack.ps1
```

产物：`Desktop\大肥鱼桌宠-v<版本>-<时间戳>.zip`，约 800 MB 未压缩 / 372 MB 压缩。

`pack.ps1` 会自动：
- 纳入全部 578 个文件（含 electron/、runtime/、素材、exe）
- 排除：`.git/`、`node_modules/`、`electron/resources/app/`、日志、配置备份、`*.pristine`、`.tools/`（ffmpeg）
- 预检 20 个必需文件，缺一个就中止

## 传到 Release

**必须手动做**（需要 GitHub token，本机没有 gh CLI）：

1. 打开 https://github.com/lrelyn/dsh-pet-portable/releases/new
2. **Choose a tag**：填 `v0.4.0`（或当前 `app/package.json` 的 version），点 "Create new tag"
3. **Release title**：`大肥鱼桌宠 v0.4.0`
4. **Describe this release**：写更新内容（见下方模板）
5. **Attach binaries**：把 pack.ps1 打出来的 zip 拖进去
6. 勾选 **Set as the latest release**
7. 点 **Publish release**

> ⚠️ zip 文件名里的中文在某些浏览器上传时会被改编码，建议先重命名成
> `dsh-pet-portable-0.4.0-win64.zip` 再传。

## Release 描述模板

```markdown
## 大肥鱼桌宠 v0.4.0

一只住在 Windows 桌面上的蓝发小女仆。免安装，自带 Node + Electron。

### 使用方法

1. 下载 `dsh-pet-portable-0.4.0-win64.zip`
2. 解压到**任意位置**（桌面、D 盘、U 盘都行）
3. 双击 `大肥鱼桌宠.exe`

**必须整个文件夹一起拷**，只拷 exe 没用。

### 系统要求

- Windows 10/11 64 位（Win7/8 不支持）
- 约 1.6 GB 磁盘空间（解压后）
- 未签名程序，杀毒软件可能误报，需放行

### 本版新增

- 心情系统：她会因为你逗她而开心，活儿没干好会烦躁，夜深了自己犯困
- 分部位触摸：点脑袋 / 撸身子 / 点脚有不同反应，连点会递进
- 使用说明网页版（右键 → 设置 → 使用说明）

### 已知限制

- 不说话、不聊天（那些需要 DSH 宿主提供模型）
- 首次启动若沙箱起不来，会自动降级重试（见 pet.log）

### 上游与许可

基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT）
动画素材：允许开源使用，**禁止商用**
```

## 从零重建（没有 Release 包时）

如果 Release 上的包丢了或要出新版本，从 git 仓库重建：

```powershell
# 1. 克隆
git clone https://github.com/lrelyn/dsh-pet-portable.git
cd dsh-pet-portable

# 2. 补 Electron（563 MB）
#   方式 A：从别处拷贝整个 electron/ 目录
#   方式 B：从上游拉
git clone https://github.com/PC2005-cloud/dsh-pet.git upstream
cd upstream && npm install && npm run ensure:electron
#   Electron 会下到 .dsh/electron/，拷回来

# 3. 补 Node 运行时（89 MB）
#   https://nodejs.org/dist/v22.22.2/node-v22.22.2-win-x64.zip
#   解压后取 node.exe 放到 runtime/

# 4. 补素材（67 MB）
Copy-Item "upstream\assets\webm\*" -Destination .\app\assets\webm\ -Recurse

# 5. 还原配置
Copy-Item config\main-config.jsonc "$env:USERPROFILE\.dsh\dsh-pet\main-config.jsonc" -Force

# 6. 直接跑（不需要 exe）
.\runtime\node.exe .\app\lib\standalone.js --port 3080

# 7. 或打正式包
& powershell -ExecutionPolicy Bypass -File .\pack.ps1
```

完整步骤见 [my-life-archive 的恢复清单](https://github.com/lrelyn/my-life-archive/blob/main/notes/dsh-pet-restore.md)。

## 版本号

改 `app/package.json` 的 `version` 字段，`pack.ps1` 会自动读它。
