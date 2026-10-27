# make-anim-variants.ps1 —— 用现有素材「改造」出新动画（不需要 AI / 不需要 API）
#
# 用途：把现有 136 个 webm 通过 ffmpeg 变换（降速/褪色/压低/倒放/提速…）
#       做出"新动作"的近似版。适合"状态类"动画（虚弱/疲惫/精神）——
#       这类靠氛围而非具体手势，改造效果真的像。
#
# 局限（必须说明）：做不到素材里没有的**具体手势**。
#   例：「饿趴」能从「睡觉第一段」倒放+降速得到，很像；
#       但「双手捂肚子」素材里没有那个姿势，只能做出"虚弱感"，不是真捂肚子。
#
# 关键坑（实测确认）：
#   源 webm 的 ffprobe 报 yuv420p，但**实际带 alpha**（VP9 旁路 alpha 通道）。
#   变换时必须在 -vf 末尾加 format=yuva420p，输出也必须 -pix_fmt yuva420p，
#   否则 alpha 会丢失（变成黑底），这是最容易踩的坑。
#
# 用法：
#   .\make-anim-variants.ps1              # 生成全部样片到 out 目录
#   .\make-anim-variants.ps1 -Only n2     # 只生成某几个

param(
  [string[]]$Only = @(),
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = (Resolve-Path $root).Path

if (-not $OutDir) { $OutDir = Join-Path $root 'out\anim-variants' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 找 ffmpeg
$ff = Get-ChildItem (Join-Path $root '.tools') -Recurse -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ff) { throw '找不到 ffmpeg.exe（应在 .tools/ 下）' }
$FFMPEG = $ff.FullName
$FFPROBE = Join-Path (Split-Path $FFMPEG -Parent) 'ffprobe.exe'

$webmDir = Join-Path $root 'app\assets\webm'

# ---------------------------------------------------------------------------
# 变体定义：src = 源素材名，vf = 变换链（**不要**自己加 format=yuva420p，脚本会补）
# ---------------------------------------------------------------------------
$variants = @(
  @{
    id = 'n2'; name = '饿趴（正向+降速+褪色）'; src = '睡觉第一段'
    # 源方向本来就是"站立→倒下"（首帧站立、末帧躺），**不需要 reverse**
    # 降速表现无力，褪色表现虚弱；末尾定格让"趴着"停留更久
    vf = 'setpts=1.4*PTS,eq=saturation=0.45:brightness=-0.12:contrast=0.85,fps=24'
    note = '站立→倒下 ×2.2 慢放 + 强褪色 + 末帧定格 1 秒'
  },
  @{
    id = 'n6'; name = '累到摇晃（降速+轻微抖动）'; src = '迷糊犯困'
    # 降速 + 水平微抖（用 crop 的 x 偏移模拟摇晃，幅度 3px）
    vf = 'setpts=1.5*PTS,eq=saturation=0.7:brightness=-0.05,crop=iw-6:ih:3+2*sin(n/8):0,fps=24'
    note = '降速 1.8 倍 + 画面左右微抖'
  },
  @{
    id = 'n5'; name = '精力抖擞（提速+提亮）'; src = '超大伸懒腰'
    vf = 'setpts=0.75*PTS,eq=saturation=1.15:brightness=0.06:contrast=1.05,fps=24'
    note = '提速 1.33 倍 + 提亮提饱和 → 精神饱满'
  },
  @{
    id = 'n3'; name = '吃饱打嗝（微提速+暖色）'; src = '悠闲哼歌'
    vf = 'setpts=0.9*PTS,eq=saturation=1.1:gamma_r=1.06:gamma_b=0.96,fps=24'
    note = '略提速 + 偏暖色调（红↑蓝↓）→ 满足感'
  },
  @{
    id = 'n1'; name = '虚弱（降速+强褪色）'; src = '工作状态-垂头叹气冒汗'
    vf = 'setpts=1.6*PTS,eq=saturation=0.55:brightness=-0.08,fps=24'
    note = '注意：素材里没有"捂肚子"姿势，这只是"虚弱感"'
  },
  @{
    id = 'n7'; name = '扑过来迎接（提速+跳跃强调）'; src = '点击回应-开心跃动'
    vf = 'setpts=0.8*PTS,eq=saturation=1.2:brightness=0.04,fps=24'
    note = '提速 + 提饱和 → 更雀跃'
  },
  @{
    id = 'n9'; name = '生气扭头（侧身慢放）'; src = '点击回应-傲娇生气'
    vf = 'setpts=1.1*PTS,eq=saturation=0.85:brightness=-0.04,fps=24'
    note = '慢放 → 扭头动作更明显'
  }
)

if ($Only.Count -gt 0) {
  $variants = $variants | Where-Object { $Only -contains $_.id }
}

Write-Host '=== 生成动画变体（ffmpeg 改造，无需 AI）===' -ForegroundColor Cyan
Write-Host "  源: $webmDir"
Write-Host "  出: $OutDir"
Write-Host ''

$ok = 0; $fail = 0
foreach ($v in $variants) {
  $src = Join-Path $webmDir ($v.src + '.webm')
  $dst = Join-Path $OutDir ($v.id + '-' + ($v.src -replace '[^\w]', '_') + '.webm')

  if (-not (Test-Path $src)) {
    Write-Host ("  跳过 {0}（源 {1} 不存在）" -f $v.id, $v.src) -ForegroundColor Yellow
    $fail++
    continue
  }

  # 关键 1：末尾补 format=yuva420p 保住 alpha（源是 VP9 旁路 alpha，ffprobe 报 yuv420p）
  # 关键 2：统一画幅回 640x360。实测 reverse 会把 640x360 变 360x360、
  #         动态 crop 会变 354x360 —— 素材库里画幅必须统一，否则桌宠播放时尺寸跳变。
  # 时长上限：桌宠动画统一控制在 ~10 秒内。降速会把源放大到 14~23 秒，
  # 那样会让随机链卡在一段动画上太久（实测会让"平常动作消失"）。
  $vf = $v.vf + ',scale=640:360:force_original_aspect_ratio=decrease' +
         ',pad=640:360:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1,format=yuva420p' +
         ',trim=duration=10.5,setpts=PTS-STARTPTS'

  & $FFMPEG -y -hide_banner -loglevel error -c:v libvpx-vp9 -i $src `
    -vf $vf -c:v libvpx-vp9 -pix_fmt yuva420p -crf 40 -b:v 0 -an $dst 2>&1 | Out-Null

  if ($LASTEXITCODE -eq 0 -and (Test-Path $dst)) {
    $kb = [math]::Round((Get-Item $dst).Length / 1KB, 0)
    # 验证 alpha 保留
    $probe = Join-Path $env:TEMP ("chk-" + $v.id + ".png")
    & $FFMPEG -y -hide_banner -loglevel error -c:v libvpx-vp9 -i $dst -frames:v 1 -vf 'alphaextract' $probe 2>&1 | Out-Null
    $alphaInfo = ''
    if (Test-Path $probe) {
      $py = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
      $code = "from PIL import Image; import numpy as np; a=np.array(Image.open(r'$probe')); print('%.0f' % (100.0*(a<10).sum()/a.size))"
      $alphaInfo = (& $py -c $code 2>&1) -join ''
      Remove-Item $probe -Force -ErrorAction SilentlyContinue
    }
    Write-Host ("  OK   {0,-4} {1,-32} {2,5} KB  透明 {3}%" -f $v.id, $v.name, $kb, $alphaInfo) -ForegroundColor Green
    Write-Host ("       {0}" -f $v.note) -ForegroundColor DarkGray
    $ok++
  } else {
    Write-Host ("  失败 {0} ({1})" -f $v.id, $v.name) -ForegroundColor Red
    $fail++
  }
}

Write-Host ''
Write-Host '=== 汇总 ===' -ForegroundColor Cyan
Write-Host ("  成功 {0} / 失败 {1}" -f $ok, $fail)
if ($ok -gt 0) {
  $total = (Get-ChildItem $OutDir -Filter *.webm | Measure-Object Length -Sum).Sum
  Write-Host ("  输出目录: {0}" -f $OutDir)
  Write-Host ("  总体积: {0} KB" -f [math]::Round($total / 1KB, 0))
}
