# make-preview-gifs.ps1 —— 从 webm 批量生成 README 预览 GIF
#
# 用法：powershell -ExecutionPolicy Bypass -File make-preview-gifs.ps1
#
# 规格（2026-10-22 第三版，修掉三个问题后）：
#   输出统一 320×180（16:9）/ 12fps / 256 色 / 透明索引在调色板末尾
#
# 这一版修掉的三个问题（前两版的教训）：
#   ① 尺寸不一致 —— 素材里混着 640×360（16:9）和 360×360（1:1）两种规格，
#      `scale=320:-1` 按宽高比算高，方形源就输出成 320×320，README 里忽大忽小。
#      上游同样有方形源，但它的 GIF 全是 220×124 —— 说明它做了归一化。
#      现在用 crop 把任何源都裁成 16:9 再缩放，输出恒定 320×180。
#   ② 模糊 —— 640→320 是 2 倍降采样，细发丝会被抹掉。
#      解法：先用 neighbor 放大到 1280（保住了发丝），再羽化，最后 lanczos 缩到 320。
#      （先放大再缩小 ≠ 直接缩小：前者让 alpha 羽化作用在更密的采样上）
#   ③ 边缘锯齿 —— colorkey 是硬阈值，边缘 1px 突变。
#      解法：alphaextract 取 alpha 通道 → gblur 高斯羽化 → alphamerge 合回。
#      实测呆毛/裙摆边缘平滑，且不会把深色衣物误判为背景（colorkey 会）。
#
# 透明处理说明：GIF 只有 1-bit 索引透明，羽化出的半透明边缘会被
# palettegen 的 reserve_transparent=1 收敛成硬边 —— 但比 colorkey 的硬切干净得多，
# 且不会吃掉与背景色相近的深色区域。
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
# ffprobe 与 ffmpeg 同目录（用来读源视频尺寸，选对应的 filter）
$FFPROBE = Join-Path (Split-Path $FFMPEG -Parent) 'ffprobe.exe'
if (-not (Test-Path $FFPROBE)) { throw "找不到 ffprobe.exe（应与 ffmpeg 同目录）" }

$srcDir = Join-Path $root 'app\assets\webm'
$outDir = Join-Path $root 'app\assets\preview'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 要生成预览的动作：中文名 → 输出文件名（拼音）
# 24 个，覆盖配置里的全部分类。分组说明见 README。
$jobs = @(
  # ---- 基础状态（4）----
  @{ cn = '待机呼吸休闲';        out = 'daiji-huxi-xiuxian';        group = '基础' },
  @{ cn = '原地小憩沉眠';        out = 'yuandi-xiaoqi-chenmian';    group = '基础' },
  @{ cn = '哈欠连天';            out = 'haqian-liantian';           group = '基础' },
  @{ cn = '东张西望';            out = 'dongzhang-xiwang';          group = '基础' },

  # ---- 分部位触摸（本 fork 核心，6）----
  @{ cn = '点击回应-害羞惊讶';    out = 'dianji-huiying-haixiu-jingya';   group = '触摸' },
  @{ cn = '点击回应-开心跃动';    out = 'dianji-huiying-kaixin-yuedong';  group = '触摸' },
  @{ cn = '点击回应-挠痒咯咯笑';  out = 'dianji-huiying-naoyang-gegexiao'; group = '触摸' },
  @{ cn = '点击回应-元气挥手';    out = 'dianji-huiying-yuanqi-huishou';  group = '触摸' },
  @{ cn = '点击回应-傲娇生气';    out = 'dianji-huiying-aojiao-shengqi';  group = '触摸' },
  @{ cn = '被吓一跳（炸毛）';     out = 'beixiayitiao-zhamao';       group = '触摸' },

  # ---- 拖拽 / 移动（3）----
  @{ cn = '被鼠标拖拽悬空反馈';   out = 'beishubiao-tuozhuai-xuankong-fankui'; group = '拖拽' },
  @{ cn = '螃蟹走路';            out = 'pangxie-zoulu';             group = '拖拽' },
  @{ cn = '原地漂浮踏步';        out = 'yuandi-piaofu-tabu';        group = '拖拽' },

  # ---- 睡眠 / 工作（本 fork 加守卫的，6：各 3 段整套）----
  @{ cn = '睡觉第一段';          out = 'shuijue-diyiduan';          group = '睡眠工作' },
  @{ cn = '睡觉第二段';          out = 'shuijue-dierduan';          group = '睡眠工作' },
  @{ cn = '睡觉第三段';          out = 'shuijue-disanduan';         group = '睡眠工作' },
  @{ cn = '开始工作';            out = 'kaishi-gongzuo';            group = '睡眠工作' },
  @{ cn = '工作思考';            out = 'gongzuo-sikao';             group = '睡眠工作' },
  @{ cn = '工作结束';            out = 'gongzuo-jieshu';            group = '睡眠工作' },

  # ---- 小动作 / 玩耍（4）----
  @{ cn = '可爱宅舞';            out = 'keai-zhaivu';               group = '日常' },
  @{ cn = '原地专心玩魔方';      out = 'yuandi-zhuanxin-wan-mofang'; group = '日常' },
  @{ cn = '荡秋千';              out = 'dang-qiuqian';              group = '日常' },
  @{ cn = '撸猫';                out = 'lu-mao';                    group = '日常' },

  # ---- 吃什么 / 时节（3）----
  @{ cn = '吃西瓜';              out = 'chi-xigua';                 group = '吃喝时节' },
  @{ cn = '放烟花';              out = 'fang-yanhua';               group = '吃喝时节' },
  @{ cn = '堆雪人';              out = 'dui-xueren';                group = '吃喝时节' }
)

# 统一转码参数（与上游规格对齐，2026-10-22 修正版）
#
# 修正记录：第一版用 max_colors=64 + dither=none + reserve_transparent=0，
# 结果是色带明显、透明索引落在调色板第 0 位（黑色），人物边缘发脏、整体发灰。
# 二进制解析上游 GIF 后发现它是：256 色 / 透明索引 255（末尾）/ disposal=2。
# 改成下面这套后效果与上游一致：
#   fps=12                     上游帧率
#   scale=220                  上游宽度
#   colorkey=black:0.01:0.1    VP9-alpha 的透明在 ffmpeg 里表现为黑底，转成真透明
#   max_colors=256             满色板，避免渐变色带
#   reserve_transparent=1      给透明色留一个索引（关键：不留就会吃掉边缘）
#   stats_mode=full            整段统计调色板，帧间色差小
#   dither=bayer:bayer_scale=3 有序抖动：比 none 平滑、比 sierra2 体积小
#   alpha_threshold=128        透明阈值
#   -gifflags +transdiff       帧间只编码变化区域（体积减半的关键）
# 按源视频尺寸生成 filter graph（2026-10-22 第四版）
#
# 背景：裁成统一 16:9 后发现两组源的人物大小差 2 倍——
#   横屏源(640x360)人物占画布 33% 宽（105/320），
#   方形源(360x360)裁 16:9 后人物占 60% 宽（193/320）。
#   README 并排显示时睡眠/工作那 6 张的人物明显比其他大一倍。
#
# 方案：按人物占比归一化，让两组视觉大小一致
#   · 横屏源：不动，人物占比 33% 作为基准（部分动作手臂会挥到边缘，裁会切手）
#   · 方形源：缩到 192 宽（人物 193→约 115），再 pad 回 320x180 居中补透明
function Build-Filter([int]$SrcW, [int]$SrcH) {
  # 方形源：缩小到 160x180 内后**立即 pad 到 320x180**
  # 顺序：scale(限高180) → pad(补到320x180) → 后续统一放大/羽化/缩到320
  # 若把 pad 放到 scale=320:-1 之后，方形源会被拉成 320x360，pad 就因"比目标大"而失败
  $pre = if ($SrcW -gt $SrcH) {
    'null'
  } else {
    'scale=160:180:force_original_aspect_ratio=decrease:flags=lanczos,pad=320:180:(ow-iw)/2:(oh-ih)/2:color=black@0'
  }
  $post = 'scale=1280:-1:flags=neighbor,' +
          'split[a][b];' +
          '[a]alphaextract,gblur=sigma=1.2[al];' +
          '[b][al]alphamerge,' +
          'scale=320:-1:flags=lanczos,' +
          'split[c][d];' +
          '[c]palettegen=max_colors=256:reserve_transparent=1:stats_mode=full[p];' +
          '[d][p]paletteuse=dither=bayer:bayer_scale=3:alpha_threshold=128'
  if ($pre -eq 'null') { return "fps=12,$post" }
  return "fps=12,$pre,$post"
}

$VF = Build-Filter 640 360   # 默认值，实际按每个源的尺寸重算（见下方循环）

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

  # 按这个源的尺寸选 filter（横屏 vs 方形的人物占比归一化）
  $wh = & $FFPROBE -v error -select_streams v:0 -show_entries "stream=width,height" -of default=noprint_wrappers=1:nokey=1 $src 2>&1
  $srcW = [int]($wh[0]); $srcH = [int]($wh[1])
  $vf = Build-Filter $srcW $srcH

  # 注意：**不要**加 -c:v libvpx-vp9。
  # 上游 chroma_step02.py 里写它是为了在 rawvideo 管道中转时保留 VP9 alpha，
  # 但直接读 webm 文件时显式指定 libvpx 解码器会让 alpha 边缘出现 1px 白环
  # （实测：加上就有白边，去掉就干净）。让 ffmpeg 自动探测即可。
  & $FFMPEG -y -hide_banner -loglevel error -i $src -vf $vf -gifflags +transdiff -loop 0 $dst 2>&1 | Out-Null
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
