"""
把参考图做成前端吉祥物素材。

参考图是 1254x1254 方图，背景是一整块带暗角渐变的深靛蓝（中心 ≈#424971，四角更暗）。
直接贴到页面会出现深蓝方块，所以要抠掉背景。

为什么用「切比雪夫距离 + 纯色距」而不是 floodfill：
floodfill 靠连通性，不会啃到主体，但主体轮廓会把一些背景围成死角
（实测 11 张里有 3 张死角占画布 5~11%），floodfill 够不到，贴到浅色页面上是一坨深蓝。
而纯色距能清死角，但早期用 L1 近似度量时背景色域(0~119)和主体色域(0~)完全重叠，
实测切比雪夫距离上背景稳定收敛在 77 以内、主体从 96 起，分界干净，所以改用切比雪夫距离。

「切比雪夫」= 三通道差值取最大值，而不是欧氏距离：
- 欧氏/L1 会把黑色描边(#010000，和背景只差 R65 G73 B113)算成「接近背景」而误删
- 切比雪夫下描边距离 113、背景最远 77，中间留出干净的过渡带
- 取最大值还能直接用 ImageChops.lighter 实现，不会像 L1 求和那样 8bit 溢出

阈值 LOW=85 / HIGH=97 来自实测：11 张图背景距离上界一致为 77，
主体落在 96~128 桶（黑色描边、银灰物件）完全不受影响。
"""

import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC_DIR = Path(r"D:\wallpaper\gpt")
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "mascot"

MAX_DIM = 400
# 背景主色（暗角渐变的中心值）
BG = (0x42, 0x49, 0x71)
# 距离 <= LOW 判为背景（alpha 0），>= HIGH 判为主体（alpha 255），中间线性过渡
LOW, HIGH = 85, 97
# 过渡带再做一次极轻的模糊，消掉 WebP 有损压缩在 alpha 上产生的台阶
BLUR = 0.5
SENTINEL = (255, 0, 255)


def chebyshev(im: Image.Image) -> Image.Image:
    """三通道与背景色差取最大值"""
    size = im.size
    r, g, b = im.split()
    return ImageChops.lighter(
        ImageChops.lighter(
            ImageChops.difference(r, Image.new("L", size, BG[0])),
            ImageChops.difference(g, Image.new("L", size, BG[1])),
        ),
        ImageChops.difference(b, Image.new("L", size, BG[2])),
    )


def build_alpha(d: Image.Image) -> Image.Image:
    span = HIGH - LOW
    return d.point(lambda v: 0 if v <= LOW else 255 if v >= HIGH else int((v - LOW) / span * 255))


def outer_background(im: Image.Image) -> Image.Image:
    """floodfill 只为自检服务：它能可靠地找出「与画布边缘连通的背景」，
    拿它当基准，检查纯色距方案有没有漏抠（残留鬼影）"""
    w, h = im.size
    fill = im.copy()
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
                 (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
        ImageDraw.floodfill(fill, seed, SENTINEL, thresh=120)
    diff = ImageChops.difference(fill, Image.new("RGB", im.size, SENTINEL)).convert("L")
    return diff.point(lambda v: 255 if v == 0 else 0)


def cutout(src: Path, dst: Path) -> dict:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    n = w * h

    d = chebyshev(im)
    alpha = build_alpha(d).filter(ImageFilter.GaussianBlur(BLUR))

    # 自检 1：floodfill 认定为背景的像素里，有多少还留着一丁点不透明度（漏抠）
    bg_ref = outer_background(im)
    bg_n = max(bg_ref.histogram()[255], 1)
    ghost = ImageChops.multiply(bg_ref, alpha.point(lambda v: 255 if v > 8 else 0))
    ghost_pct = 100 * ghost.histogram()[255] / bg_n

    # 自检 2：明确是主体的像素（距离 >= HIGH）内部有没有被削掉（误删描边/物件）。
    # 先腐蚀 2px 再判定：主体边缘 1~2px 本来就是抗锯齿过渡带，被软化是正常的，
    # 真正要抓的是主体内部被啃掉。
    art_ref = d.point(lambda v: 255 if v >= HIGH else 0).filter(ImageFilter.MinFilter(5))
    art_n = max(art_ref.histogram()[255], 1)
    hurt = ImageChops.multiply(art_ref, alpha.point(lambda v: 255 if v < 247 else 0))
    hurt_pct = 100 * hurt.histogram()[255] / art_n

    out = im.convert("RGBA")
    out.putalpha(alpha)

    # 裁掉四周透明区域，避免素材带着大片空白进 bundle
    bbox = alpha.getbbox()
    if bbox:
        pad = 4
        out = out.crop((
            max(0, bbox[0] - pad), max(0, bbox[1] - pad),
            min(w, bbox[2] + pad), min(h, bbox[3] + pad),
        ))

    if max(out.size) > MAX_DIM:
        ratio = MAX_DIM / max(out.size)
        out = out.resize(
            (max(1, round(out.width * ratio)), max(1, round(out.height * ratio))),
            Image.LANCZOS,
        )

    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, "WEBP", quality=92, method=6)

    return {
        "out": dst.name,
        "size": f"{out.width}x{out.height}",
        "ghost%": round(ghost_pct, 3),
        "artErased%": round(hurt_pct, 3),
        "kb": round(dst.stat().st_size / 1024, 1),
    }


def main() -> None:
    sources = sorted(SRC_DIR.glob("*.png"))
    if not sources:
        raise SystemExit(f"{SRC_DIR} 下没找到 png")

    report = [cutout(s, OUT_DIR / f"m{i:02d}.webp") for i, s in enumerate(sources, start=1)]
    print(json.dumps(report, ensure_ascii=False, indent=2))
    total = sum(r["kb"] for r in report)
    print(f"\n共 {len(report)} 张，合计 {total:.1f} KB，最大单张 {max(r['kb'] for r in report):.1f} KB")

    bad = [r["out"] for r in report if r["ghost%"] > 0.5 or r["artErased%"] > 0.5]
    if bad:
        raise SystemExit(f"抠图质量不合格：{bad}")


if __name__ == "__main__":
    main()
