# make-preview-gifs.ps1 —— 从 webm 批量生成 README 预览 GIF
#
# 用法：powershell -ExecutionPolicy Bypass -File make-preview-gifs.ps1
#
# 规格对齐上游（PC2005-cloud/dsh-pet 的 assets/preview/）：
#   220 宽 / 12fps / 64 色 / 约 300-600 KB
#
# 关键处理：webm 是 VP9-alpha 透明背景，GIF 不支持真透明（只能 1-bit 索引透明），
# 所以用 colorkey 把黑底变透明 —— 在 GitHub 上透明部分会显示成页面底色，
# 与上游 README 里那句「GIF 预览中透明部分显示为页面底色」一致。
#
# 输入：app/assets/webm/<中文名>.webm
# 输出：app/assets/preview/<拼音名>.gif（文件名用拼音，与上游命名风格一致）

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = (Resolve-Path $root).Path

$toolsDir = Join-Path $root '.tools'
$ff = Get-ChildItem $toolsDir -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ff) { throw "找不到 ffmpeg.exe（应在 .tools/ 下）" }
$FFMPEG = $ff.FullName

$srcDir = Join-Path $root 'app\assets\webm'
$outDir = Join-Path $root 'app\assets\preview'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 要生成预览的动作：中文名 → 输出文件名（拼音）
# 选这 8 个是因为它们覆盖了本 fork 的核心功能
$jobs = @(
  @{ cn = '待机呼吸休闲';        out = 'daiji-huxi-xiuxian' },
  @{ cn = '点击回应-害羞惊讶';    out = 'dianji-huiying-haixiu-jingya' },
  @{ cn = '点击回应-开心跃动';    out = 'dianji-huiying-kaixin-yuedong' },
  @{ cn = '点击回应-挠痒咯咯笑';  out = 'dianji-huiying-naoyang-gegexiao' },
  @{ cn = '被吓一跳（炸毛）';     out = 'beixiayitiao-zhamao' },
  @{ cn = '被鼠标拖拽悬空反馈';   out = 'beishubiao-tuozhuai-xuankong-fankui' },
  @{ cn = '睡觉第一段';          out = 'shuijue-diyiduan' },
  @{ cn = '开始工作';            out = 'kaishi-gongzuo' }
)

# 统一转码参数（与上游规格对齐）
#   fps=12       上游就是 12fps，动作节奏刚好
#   scale=220    上游宽度
#   colorkey     黑底变透明（GIF 只有 1-bit 透明，边缘会有轻微锯齿，可接受）
#   max_colors=64 64 色足够表现 Q 版人物，体积小一半
$VF = 'fps=12,scale=220:-1:flags=lanczos,colorkey=black:0.01:0.1,split[a][b];[a]palettegen=max_colors=64:reserve_transparent=0[p];[b][p]paletteuse=dither=none'

Write-Host "=== 生成预览 GIF ===" -ForegroundColor Cyan
Write-Host "  源: $srcDir"
Write-Host "  出: $outDir"
Write-Host ""

$ok = 0; $skip = 0; $fail = 0
foreach ($j in $jobs) {
  $src = Join-Path $srcDir ($j.cn + '.webm')
  $dst = Join-Path $outDir ($j.out + '.gif')

  if (-not (Test-Path $src)) {
    Write-Host ("  跳过 {0}（源不存在）" -f $j.cn) -ForegroundColor Yellow
    $skip++
    continue
  }

  # 断点续跑：比源新就跳过
  if ((Test-Path $dst) -and ((Get-Item $dst).LastWriteTime -gt (Get-Item $src).LastWriteTime)) {
    Write-Host ("  跳过 {0}（已是最新）" -f $j.out) -ForegroundColor DarkGray
    $skip++
    continue
  }

  & $FFMPEG -y -hide_banner -loglevel error -c:v libvpx-vp9 -i $src -vf $VF -loop 0 $dst 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $dst)) {
    $kb = [math]::Round((Get-Item $dst).Length / 1KB, 0)
    Write-Host ("  OK   {0,-32} {1,5} KB" -f $j.out, $kb) -ForegroundColor Green
    $ok++
  } else {
    Write-Host ("  失败 {0}" -f $j.cn) -ForegroundColor Red
    $fail++
  }
}

Write-Host ""
Write-Host "=== 汇总 ===" -ForegroundColor Cyan
Write-Host ("  成功 {0} / 跳过 {1} / 失败 {2}" -f $ok, $skip, $fail)

if ($ok -gt 0) {
  $total = (Get-ChildItem $outDir -Filter *.gif | Measure-Object Length -Sum).Sum
  Write-Host ("  preview/ 总大小: {0} KB" -f [math]::Round($total / 1KB, 0))
}
