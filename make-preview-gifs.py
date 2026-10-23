"""预览 GIF 生成：ffmpeg 抽帧 PNG（保留 alpha）→ PIL 合成白底 → GIF

为什么走 PNG 中转：
  直接让 ffmpeg 输出 GIF 时，透明区在 GitHub 上显示为页面底色（深色主题下是黑的）。
  试过 6 种 ffmpeg 内联铺白底方案（drawbox / color 源 / 静态图 overlay / geq /
  colorchannelmixer / blend）全部失败 —— VP9-alpha 解码后的 alpha 在这些滤镜里
  读不到正确值。改成两步：ffmpeg 只负责「抽帧成 PNG」（PNG 的 alpha 是可靠的），
  PIL 负责「alpha 合成到白底」（PIL 的 alpha_composite 是像素级精确的）。
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
FFMPEG = next((ROOT / '.tools').rglob('ffmpeg.exe'))
FFPROBE = FFMPEG.with_name('ffprobe.exe')

SRC = ROOT / 'app' / 'assets' / 'webm'
OUT = ROOT / 'app' / 'assets' / 'preview'
TMP = ROOT / '.tools' / '_pngframes'

TARGET_W, TARGET_H = 320, 180
FPS = 12
BG = (255, 255, 255)  # 白底


def probe_size(path: Path):
    r = subprocess.run(
        [str(FFPROBE), '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(path)],
        capture_output=True, text=True, check=True)
    w, h = r.stdout.strip().split(',')
    return int(w), int(h)


def build_vf(src_w: int, src_h: int) -> str:
    """按源尺寸归一化人物占比（与之前的 ffmpeg 版一致），输出到 TARGET 尺寸。"""
    if src_w > src_h:
        # 横屏源：直接缩到目标宽
        pre = f'scale={TARGET_W}:-1:flags=lanczos'
    else:
        # 方形源：先缩到 160 宽内，再 pad 到目标（用透明 pad，后面 PIL 铺白底）
        pre = (f'scale=160:{TARGET_H}:force_original_aspect_ratio=decrease:flags=lanczos,'
               f'pad={TARGET_W}:{TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black@0')
    # 关键：输出 rgba PNG 序列，保留 alpha
    return f'fps={FPS},{pre},format=rgba'


def convert_one(name: str, out_name: str) -> str:
    src = SRC / f'{name}.webm'
    if not src.exists():
        return f'SKIP {name}（源不存在）'

    dst = OUT / f'{out_name}.gif'
    frame_dir = TMP / out_name
    frame_dir.mkdir(parents=True, exist_ok=True)

    # 1) 抽帧成 PNG（保留 alpha）
    #
    # 关键：必须写 `-c:v libvpx-vp9` 和 `-pix_fmt rgba`。
    # 实测四种抽帧方式，只有这一种能拿到真实 alpha：
    #   默认            → RGB，alpha 全 255（透明区变黑）
    #   -pix_fmt rgba   → RGBA，但 alpha 仍全 255
    #   -vf format=rgba → RGBA，alpha 仍全 255
    #   -c:v libvpx-vp9 -pix_fmt rgba → RGBA，alpha 0~255 ✓
    #
    # 这也解释了之前的矛盾：去掉 -c:v libvpx-vp9 后白边消失了，
    # 但那是**因为 alpha 一起丢了**（透明区直接变黑，自然没有白边）。
    # 正确做法是保留 alpha，再用 PIL 精确合成白底。
    for old in frame_dir.glob('*.png'):
        old.unlink()
    w, h = probe_size(src)
    vf = build_vf(w, h)
    r = subprocess.run(
        [str(FFMPEG), '-y', '-hide_banner', '-loglevel', 'error',
         '-c:v', 'libvpx-vp9',          # 保留 VP9 alpha（缺了就拿不到透明）
         '-i', str(src),
         '-vf', vf,
         '-pix_fmt', 'rgba',            # PNG 输出带 alpha 通道
         str(frame_dir / 'f_%04d.png')],
        capture_output=True, text=True)
    if r.returncode != 0:
        return f'FAIL {name}: ffmpeg {r.stderr.strip()[:120]}'

    frames = sorted(frame_dir.glob('f_*.png'))
    if not frames:
        return f'FAIL {name}: 没有抽到帧'

    # 2) PIL 合成白底 + 存 GIF
    imgs = []
    for fp in frames:
        fg = Image.open(fp).convert('RGBA')
        # 统一尺寸（pad 后的应该是目标尺寸，保险起见再 resize）
        if fg.size != (TARGET_W, TARGET_H):
            fg = fg.resize((TARGET_W, TARGET_H), Image.LANCZOS)
        bg = Image.new('RGBA', (TARGET_W, TARGET_H), BG + (255,))
        bg.alpha_composite(fg)
        imgs.append(bg.convert('RGB'))  # GIF 用 RGB，无透明

    imgs[0].save(
        dst,
        save_all=True,
        append_images=imgs[1:],
        duration=int(1000 / FPS),
        loop=0,
        optimize=True,
        disposal=2,
    )

    kb = dst.stat().st_size / 1024
    return f'OK   {out_name:38s} {kb:6.0f} KB  ({len(imgs)} 帧)'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)

    # 动作清单（中文名 → 输出拼音名），与 make-preview-gifs.ps1 保持一致
    jobs = [
        ('待机呼吸休闲', 'daiji-huxi-xiuxian'),
        ('原地小憩沉眠', 'yuandi-xiaoqi-chenmian'),
        ('哈欠连天', 'haqian-liantian'),
        ('东张西望', 'dongzhang-xiwang'),
        ('点击回应-害羞惊讶', 'dianji-huiying-haixiu-jingya'),
        ('点击回应-开心跃动', 'dianji-huiying-kaixin-yuedong'),
        ('点击回应-挠痒咯咯笑', 'dianji-huiying-naoyang-gegexiao'),
        ('点击回应-元气挥手', 'dianji-huiying-yuanqi-huishou'),
        ('点击回应-傲娇生气', 'dianji-huiying-aojiao-shengqi'),
        ('被吓一跳（炸毛）', 'beixiayitiao-zhamao'),
        ('被鼠标拖拽悬空反馈', 'beishubiao-tuozhuai-xuankong-fankui'),
        ('螃蟹走路', 'pangxie-zoulu'),
        ('原地漂浮踏步', 'yuandi-piaofu-tabu'),
        ('睡觉第一段', 'shuijue-diyiduan'),
        ('睡觉第二段', 'shuijue-dierduan'),
        ('睡觉第三段', 'shuijue-disanduan'),
        ('开始工作', 'kaishi-gongzuo'),
        ('工作思考', 'gongzuo-sikao'),
        ('工作结束', 'gongzuo-jieshu'),
        ('可爱宅舞', 'keai-zhaivu'),
        ('原地专心玩魔方', 'yuandi-zhuanxin-wan-mofang'),
        ('荡秋千', 'dang-qiuqian'),
        ('撸猫', 'lu-mao'),
        ('吃西瓜', 'chi-xigua'),
        ('放烟花', 'fang-yanhua'),
        ('堆雪人', 'dui-xueren'),
    ]

    # 允许命令行指定只处理某几个（调试用）
    only = set(sys.argv[1:]) if len(sys.argv) > 1 else None

    ok = fail = skip = 0
    for cn, out in jobs:
        if only and out not in only:
            continue
        msg = convert_one(cn, out)
        print('  ' + msg, flush=True)
        if msg.startswith('OK'):
            ok += 1
        elif msg.startswith('SKIP'):
            skip += 1
        else:
            fail += 1

    print(f'\n成功 {ok} / 跳过 {skip} / 失败 {fail}')
    total = sum(f.stat().st_size for f in OUT.glob('*.gif'))
    print(f'preview/ 总大小: {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()
