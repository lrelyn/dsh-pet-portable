# pack.ps1 —— 大肥鱼桌宠便携版打包脚本
# 用法：powershell -ExecutionPolicy Bypass -File pack.ps1
#   （默认）打出 大肥鱼桌宠-<版本>.zip 到桌面
#   -Version 0.4.0   指定版本号（默认读 app/package.json 的 version）
#   -Out D:\somewhere 指定输出目录（默认桌面）
#
# 打包原则：
#   · 整目录打包（便携版的全部价值在"整个文件夹拷贝即用"）
#   · 排除：日志、调试残留、备份配置、node_modules（构建依赖，运行不需要）、
#     参考快照（*.pristine / *.pre-nobalance）、我的调参脚本
#   · _还原点/_exe 是作者留的原始副本，**排除**（打包给用户用不到，还占几百 MB）

param(
  [string]$Version = '',
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = (Resolve-Path $root).Path

# --- 版本号 ---
# 注意：不能用 Get-Content -Raw | ConvertFrom-Json —— PS 5.1 按 ANSI 读 UTF-8 文件，
# package.json 里的中文 description 会变乱码导致解析失败。用正则抠 version 字段即可。
if (-not $Version) {
  $pkgRaw = [IO.File]::ReadAllText((Join-Path $root 'app\package.json'), [Text.Encoding]::UTF8)
  $vm = [regex]::Match($pkgRaw, '"version"\s*:\s*"([^"]+)"')
  if (-not $vm.Success) { throw "读不到 app\package.json 的 version 字段" }
  $Version = $vm.Groups[1].Value
}

if (-not $Out) { $Out = [Environment]::GetFolderPath('Desktop') }
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
# 两个产物：
#   带中文和时间戳的（本地留档）
#   纯 ASCII 固定名的（上传 GitHub Release 用 —— 中文名在某些浏览器上传时会被改编码）
$zipName = "大肥鱼桌宠-v$Version-$stamp.zip"
$zipPath = Join-Path $Out $zipName
$releaseName = "dsh-pet-portable-$Version-win64.zip"
$releasePath = Join-Path $Out $releaseName

Write-Host "=== 大肥鱼桌宠打包 ===" -ForegroundColor Cyan
Write-Host "  源目录  $root"
Write-Host "  版本    $Version"
Write-Host "  输出    $zipPath"
Write-Host ""

# --- 排除规则（相对于 $root 的路径片段）---
$excludeDirs = @(
  'node_modules',      # 构建依赖，运行不需要
  '_还原点',            # 作者留的原始副本
  '_exe',               # 同上
  '.git',
  '.tools'             # ffmpeg（109 MB zip + 300 MB 解压），只在生成预览 GIF 时用
)
# 特殊排除：electron/resources/app 是 Electron 的"默认应用"目录，我们显式传
# `electron.exe <app/runtime/electron-helper/main.js>` 启动（renderer 进程的
# --app-path 可证），从来不用它。里面躺着一套**陈旧的历史副本**（sprite.js 等），
# 打进去只会让包变大、并让人误以为改那里有效——排除。
# 注意 default_app.asar 要保留（Electron 自身需要）。
$excludePathPatterns = @(
  'electron/resources/app'
)
$excludeFilePatterns = @(
  '*.log',             # pet.log / 运行日志
  '*.pristine',        # 参考快照
  '*.pre-nobalance',   # 参考快照
  '*.bak',             # 配置备份
  '*.bak-*',
  '*.before-*',
  'mood-tune.ps1',     # 我的调参辅助脚本（非产品功能）
  'pack.ps1',          # 打包脚本本身（构建工具，不进包）
  'make-preview-gifs.ps1', # 预览 GIF 生成脚本（构建工具，不进包）
  'make-preview-gifs.py',
  'read_docx.py',
  '__pycache__',
  'release-list.txt',  # 打包校验用的临时清单
  'sea-prep.blob',     # SEA 打包中间产物
  '*.exe.old',
  'dbg-*',             # 调试残留
  '*.tmp'
)

# --- 预检：必需文件是否在位 ---
Write-Host "--- 预检必需文件 ---"
$required = @(
  '大肥鱼桌宠.exe', 'launcher.js', '创建桌面快捷方式.ps1',
  '使用说明.html', '使用说明.txt', '赞助码.jpg', 'logo.png',
  'app\assets\config.jsonc', 'app\assets\logo.png', 'app\assets\webm',
  'app\assets\fonts', 'app\assets\memes', 'app\assets\pic',
  'app\lib', 'app\src', 'app\runtime\electron-helper',
  'app\package.json', 'app\README.md',
  'runtime\node.exe', 'electron\electron.exe'
)
$missing = @()
foreach ($f in $required) {
  if (Test-Path (Join-Path $root $f)) { Write-Host "  OK   $f" -ForegroundColor Green }
  else { Write-Host "  缺失 $f" -ForegroundColor Red; $missing += $f }
}
if ($missing.Count) {
  Write-Host ""
  Write-Host "有 $($missing.Count) 个必需文件缺失，中止打包。" -ForegroundColor Red
  exit 1
}

# --- 统计打包内容 ---
Write-Host ""
Write-Host "--- 收集文件 ---"
$files = New-Object System.Collections.Generic.List[string]
foreach ($f in (Get-ChildItem -Path $root -Recurse -File -Force)) {
  $rel = $f.FullName.Substring($root.Length + 1)

  # 目录排除
  $skip = $false
  foreach ($d in $excludeDirs) {
    if ($rel -split '[\\/]' -contains $d) { $skip = $true; break }
  }
  if ($skip) { continue }

  # 文件名排除
  $name = Split-Path $rel -Leaf
  foreach ($p in $excludeFilePatterns) {
    if ($name -like $p) { $skip = $true; break }
  }
  if ($skip) { continue }

  # 路径片段排除（如 electron/resources/app 整套）
  $relSlash = $rel.Replace('\', '/')
  foreach ($p in $excludePathPatterns) {
    if ($relSlash.Contains($p)) { $skip = $true; break }
  }
  if ($skip) { continue }

  $files.Add($f.FullName)
}

$totalMB = [math]::Round((($files | ForEach-Object { (Get-Item $_).Length } | Measure-Object -Sum).Sum / 1MB), 1)
Write-Host "  打包 $($files.Count) 个文件，共 $totalMB MB"

# --- 压缩 ---
Write-Host ""
Write-Host "--- 压缩（约 800 MB，需要几分钟）---"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    $rel = $f.Substring($root.Length + 1)
    $entryName = "大肥鱼桌宠\$($rel.Replace('\','/'))"
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f, $entryName, 'Optimal') | Out-Null
  }
} finally {
  $zip.Dispose()
}

# --- 额外复制一份 ASCII 固定名的（上传 GitHub Release 用）---
Copy-Item $zipPath $releasePath -Force

$zipMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "=== 打包完成 ===" -ForegroundColor Green
Write-Host "  本地留档  $zipPath"
Write-Host "  上传用    $releasePath"
Write-Host "  $($files.Count) 个文件 / 原始 $totalMB MB → 压缩后 $zipMB MB"
Write-Host ""
Write-Host "下一步：把「上传用」那个 zip 拖到 GitHub Release" -ForegroundColor Yellow
Write-Host "  https://github.com/lrelyn/dsh-pet-portable/releases/new?tag=v$Version"
Write-Host ""
Write-Host "用法：解压后双击 大肥鱼桌宠.exe（整个文件夹一起拷，只拷 exe 无效）"
