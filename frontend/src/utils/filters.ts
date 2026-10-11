/**
 * 图片滤镜（P26）
 *
 * <p>⚠️ **预览与导出必须用同一套公式**，否则会出「预览一个样、发出去另一个样」
 * 这种最伤信任的 bug。这里刻意**不**用 `ctx.filter`（CSS 滤镜字符串）来做导出：
 * Safari 对 `ctx.filter` 的支持来得很晚（16.4 才有），而预览可以用 CSS `filter`
 * 属性直接贴在 `<img>` 上 —— 两者数学等价，所以：
 *
 * <ul>
 *   <li><b>预览</b>：{@link cssFilter} 生成的 CSS 字符串，贴在 img 上（GPU 加速，实时）</li>
 *   <li><b>导出</b>：{@link applyFilterToPixels} 按**同一组参数**走逐像素数学</li>
 * </ul>
 *
 * <p>两者的一致性由契约测试钉住：同一张图，CSS 预览后取像素与导出后的像素
 * 逐点比较（允许 ±2 的舍入误差）。
 */

/** 单个滤镜的强度（0..1 区间里的比例值，与 CSS filter 的单位一致） */
export interface FilterSpec {
  id: string
  label: string
  /** CSS filter 字符串，用于实时预览 */
  css: string
  /**
   * 逐像素变换。输入输出都是 0..255。
   *
   * <p>刻意**拆成三段**（饱和度 → 色相 → 明度/对比）而不是一把矩阵：
   * 矩阵在饱和度与色相同时非 1 时不可逆，调参时会得到「说不清哪里怪」的结果。
   */
  px: (r: number, g: number, b: number) => [number, number, number]
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** 饱和度：Rec.709 亮度权重 */
function saturate(r: number, g: number, b: number, s: number): [number, number, number] {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return [l + (r - l) * s, l + (g - l) * s, l + (b - l) * s]
}

/** 对比度：围绕 128（0..255 的中点）拉伸 */
function contrast(r: number, g: number, b: number, c: number): [number, number, number] {
  const f = (v: number) => (v - 128) * c + 128
  return [f(r), f(g), f(b)]
}

/** 明度 */
function brightness(r: number, g: number, b: number, k: number): [number, number, number] {
  return [r * k, g * k, b * k]
}

/**
 * 灰度。
 *
 * <p>⚠️ **必须带强度**：CSS 的 {@code grayscale(0.3)} 是「30% 灰 + 70% 原图」，
 * 不是完全变灰。早期版本这里直接全灰再叠 sepia，于��「胶片」那套
 * （grayscale(0.3) sepia(0.22)）与 CSS 差 122 —— 而且**单独测 grayscale
 * 是测不出来的**，必须测组合。
 */
function gray(r: number, g: number, b: number, k = 1): [number, number, number] {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return [r * (1 - k) + l * k, g * (1 - k) + l * k, b * (1 - k) + l * k]
}

/**
 * 色相旋转。
 *
 * <p>⚠️ **用 SVG 规范给的那个 3×3 矩阵，而不是精确的 HSV 往返**。
 * 两者数学上都是「旋转色相」，但 CSS `hue-rotate()` 按规范走的是矩阵近似；
 * 精确 HSV 往返与它会有最多 ~18/255 的偏差（实测冷调 maxDiff=18）。
 * 而「预览与导出一致」是滤镜功能的**硬要求** —— 所以这里刻意采用
 * 近似的那一套，宁可数学上不精确，也要与浏览器逐像素对齐。
 *
 * <p>（上一版混了尺度：入参 0..255，中间量也在 0..255，返回时又多乘了一次
 * 255，导致整张图的颜色量级翻倍 —— maxDiff 一度到 254。）
 */
function hueRotate(r: number, g: number, b: number, deg: number): [number, number, number] {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [
    r * (0.213 + c * 0.787 - s * 0.213) + g * (0.715 - c * 0.715 - s * 0.715) + b * (0.072 - c * 0.072 + s * 0.928),
    r * (0.213 - c * 0.213 + s * 0.143) + g * (0.715 + c * 0.285 + s * 0.140) + b * (0.072 - c * 0.072 - s * 0.283),
    r * (0.213 - c * 0.213 - s * 0.787) + g * (0.715 - c * 0.715 + s * 0.715) + b * (0.072 + c * 0.928 + s * 0.072),
  ]
}

function sepia(r: number, g: number, b: number, k: number): [number, number, number] {
  return [
    r * (1 - k) + (0.393 * r + 0.769 * g + 0.189 * b) * k,
    g * (1 - k) + (0.349 * r + 0.686 * g + 0.168 * b) * k,
    b * (1 - k) + (0.272 * r + 0.534 * g + 0.131 * b) * k,
  ]
}

/**
 * 六套预设。
 *
 * <p>强度都是**保守**的（最大的饱和度也只有 1.25）：滤镜是修饰不是重绘，
 * 调过头会让用户发出去的图与他脑子里的不一样 —— 那时他不会怀疑滤镜，
 * 只会觉得「这个平台把图弄坏了」。
 */
export const FILTERS: FilterSpec[] = [
  {
    id: 'none',
    label: '原图',
    css: 'none',
    px: (r, g, b) => [r, g, b],
  },
  {
    id: 'bright',
    label: '清晰',
    css: 'brightness(1.06) contrast(1.1)',
    px: (r, g, b) => {
      const [rr, gg, bb] = contrast(r, g, b, 1.1)
      return brightness(rr, gg, bb, 1.06)
    },
  },
  {
    id: 'warm',
    label: '暖阳',
    css: 'sepia(0.18) saturate(1.25) brightness(1.04)',
    px: (r, g, b) => {
      const [rr, gg, bb] = sepia(r, g, b, 0.18)
      const [sr, sg, sb] = saturate(rr, gg, bb, 1.25)
      return brightness(sr, sg, sb, 1.04)
    },
  },
  {
    id: 'cool',
    label: '冷调',
    css: 'hue-rotate(-12deg) saturate(1.12) brightness(1.02)',
    px: (r, g, b) => {
      const [hr, hg, hb] = hueRotate(r, g, b, -12)
      const [sr, sg, sb] = saturate(hr, hg, hb, 1.12)
      return brightness(sr, sg, sb, 1.02)
    },
  },
  {
    id: 'film',
    label: '胶片',
    css: 'grayscale(0.3) sepia(0.22) contrast(1.12)',
    px: (r, g, b) => {
      const [gr, gg, gb] = gray(r, g, b, 0.3)
      const [sr, sg, sb] = sepia(gr, gg, gb, 0.22)
      return contrast(sr, sg, sb, 1.12)
    },
  },
  {
    id: 'mono',
    label: '黑白',
    css: 'grayscale(1)',
    px: (r, g, b) => gray(r, g, b, 1),
  },
]

export const FILTER_BY_ID: Record<string, FilterSpec> = Object.fromEntries(
  FILTERS.map((f) => [f.id, f]),
)

export function getFilter(id: string): FilterSpec {
  return FILTER_BY_ID[id] ?? FILTERS[0]
}

/** 预览用：贴到 <img> 上的 CSS filter 字符串 */
export function cssFilter(id: string): string {
  return getFilter(id).css
}

/**
 * 导出用：把滤镜就地应用到 ImageData。
 *
 * <p>逐像素走一遍 —— 一次 1600×1600 的图是 250 万像素，JS 循环约 20~40ms，
 * 可接受；换来的是**跨浏览器一致**（`ctx.filter` 在老 Safari 上不存在）。
 */
export function applyFilterToPixels(data: ImageData, id: string): void {
  const f = getFilter(id)
  if (f.id === 'none') return
  const d = data.data
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = f.px(d[i], d[i + 1], d[i + 2])
    d[i] = clamp255(Math.round(r))
    d[i + 1] = clamp255(Math.round(g))
    d[i + 2] = clamp255(Math.round(b))
    // alpha 不动
  }
}