/**
 * 纯文字笔记的文字卡片生成器。
 *
 * 为什么要前端画图而不是后端生成：
 * - P11 定下「图文必须带图」的硬规则（type=1 空图 → 10001），但小红书
 *   确实允许只发文字 —— 它把文字用模板渲成一张图。这里复刻同一招：
 *   无图发布时在浏览器里用 <canvas> 画一张 3:4 文字卡片，走现有上传链路
 *   (uploadImage) 拿 URL，后端一行不改、契约一行不改。
 *
 * canvas 读不了 CSS 变量，调色板必须在这里自带一份，跟 main.css 的
 * design token 手工对齐（改色先改 main.css，再同步这里）。
 */

export type TextTheme = 'light' | 'dark'

export interface TextCardPalette {
  surface: string
  bgSoft: string
  text: string
  text2: string
  text3: string
  stroke: string
  amber: string
  amberInk: string
}

const PALETTES: Record<TextTheme, TextCardPalette> = {
  // 与 main.css :root 对齐
  light: {
    surface: '#ffffff',
    bgSoft: '#e9edf8',
    text: '#1a1e35',
    text2: '#596080',
    text3: '#8b91ae',
    stroke: '#14172b',
    amber: '#f0c060',
    amberInk: '#1a1e35',
  },
  // 与 main.css :root[data-theme='dark'] 对齐
  dark: {
    surface: '#4e5478',
    bgSoft: '#3c4266',
    text: '#eef2ff',
    text2: '#b6bdda',
    text3: '#8d94b8',
    stroke: '#c9d2f2',
    amber: '#f0c060',
    amberInk: '#1a1e35',
  },
}

/* 画布尺寸：900×1200，3:4 竖版，跟小红书默认文字卡同比例 */
export const CARD_W = 900
export const CARD_H = 1200

const SIDE = 56
const FONT_STACK = "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"

/* 版面预算：首页有标题/落款，内容行数少；续页直接铺正文，行数多 */
const FIRST_PAGE_LINES = 13
const FOLLOW_PAGE_LINES = 17
/** 文字卡最多分多少页（正文上限 2000 字，实际最多也就 5~6 页） */
const MAX_PAGES = 6

const TITLE_FONT = 'bold 46px ' + FONT_STACK
const CONTENT_FONT = '30px ' + FONT_STACK
const BRAND_FONT = '22px ' + FONT_STACK
const FOOT_FONT = '24px ' + FONT_STACK

/** 给 ctx 配一套字体，避免 wrap 用的和 draw 用的字宽不一致 */
function withFont(ctx: CanvasRenderingContext2D, font: string, fn: () => void) {
  const prev = ctx.font
  ctx.font = font
  try {
    fn()
  } finally {
    ctx.font = prev
  }
}

function measureWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  let w = 0
  withFont(ctx, font, () => {
    w = ctx.measureText(text).width
  })
  return w
}

/**
 * 中文逐字符换行。英文单词会被硬切，本项目正文以中文为主，够用；
 * 要兼顾英文得按候选断点回溯，暂不值得。
 */
export function wrapText(ctx: CanvasRenderingContext2D, font: string, text: string, maxWidth: number): string[] {
  const out: string[] = []
  let line = ''
  for (const ch of text) {
    const next = line + ch
    if (line && measureWidth(ctx, font, next) > maxWidth) {
      out.push(line)
      line = ch
    } else {
      line = next
    }
  }
  if (line) out.push(line)
  return out
}

export interface TextPage {
  /** 只有第 1 页带标题 */
  title: string
  contentLines: string[]
  pageIndex: number
  totalPages: number
}

/**
 * 把标题 + 正文切成 N 页。标题只占第 1 页；正文按每页行数预算切块，
 * 超过 MAX_PAGES 的部分丢弃（正文上限 2000 字，理论到不了这个数）。
 */
export function buildTextPages(title: string, content: string): TextPage[] {
  const c = document.createElement('canvas')
  c.width = CARD_W
  c.height = CARD_H
  const ctx = c.getContext('2d')!
  const maxWidth = CARD_W - SIDE * 2

  const titleLines = wrapText(ctx, TITLE_FONT, title, maxWidth).slice(0, 2)
  const contentLines = wrapText(ctx, CONTENT_FONT, content, maxWidth)

  const pages: TextPage[] = []
  const firstBudget = FIRST_PAGE_LINES
  const followBudget = FOLLOW_PAGE_LINES

  if (titleLines.length) {
    pages.push({
      title,
      contentLines: contentLines.slice(0, firstBudget),
      pageIndex: 0,
      totalPages: 0,
    })
  }
  let rest = titleLines.length ? contentLines.slice(firstBudget) : contentLines
  while (rest.length && pages.length < MAX_PAGES) {
    pages.push({
      title: '',
      contentLines: rest.slice(0, followBudget),
      pageIndex: pages.length,
      totalPages: 0,
    })
    rest = rest.slice(followBudget)
  }
  for (const p of pages) p.totalPages = pages.length
  return pages
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * 把某一页画进 canvas（覆盖全部像素）。页码用「count down 计数」逻辑，
 * 续页不重复画标题。
 */
export function drawPage(canvas: HTMLCanvasElement, page: TextPage, theme: TextTheme) {
  const ctx = canvas.getContext('2d')!
  const p = PALETTES[theme]
  canvas.width = CARD_W
  canvas.height = CARD_H
  // 必须校正字体基线，否则 fillText 的字体会比预期高一点
  ctx.textBaseline = 'alphabetic'

  // 底色 + 描边（外框 8px，圆角 48，模拟手绘卡）
  ctx.fillStyle = p.surface
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  ctx.strokeStyle = p.stroke
  ctx.lineWidth = 5
  roundRect(ctx, 8, 8, CARD_W - 16, CARD_H - 16, 48)
  ctx.stroke()

  // 背景装饰：左上、右下各一枚淡色圆，压在手写卡纸后面
  ctx.fillStyle = p.bgSoft
  ctx.beginPath()
  ctx.arc(-90, -90, 180, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(CARD_W + 80, CARD_H + 40, 160, 0, Math.PI * 2)
  ctx.fill()

  // 品牌行：左上品牌字，右上「喵」印章
  ctx.fillStyle = p.text3
  ctx.font = BRAND_FONT
  ctx.textAlign = 'left'
  ctx.fillText('毛球喵社 FUZZBALL-MEOW', SIDE, 96)

  ctx.fillStyle = p.amber
  ctx.beginPath()
  ctx.arc(CARD_W - SIDE - 22, 92, 22, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = p.amberInk
  ctx.font = 'bold 26px ' + FONT_STACK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('喵', CARD_W - SIDE - 22, 92)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  if (page.pageIndex === 0) {
    // 标题（最多两行，第二行超出省略）
    ctx.fillStyle = p.text
    ctx.textBaseline = 'top'
    const titleWrap = wrapText(ctx, TITLE_FONT, page.title, CARD_W - SIDE * 2).slice(0, 2)
    let ty = 170
    if (titleWrap.length === 2) {
      const tw = titleWrap[1]
      const clipped =
        measureWidth(ctx, TITLE_FONT, tw) > CARD_W - SIDE * 2 ? tw.slice(0, 6) + '…' : tw
      ctx.font = TITLE_FONT
      ctx.fillText(titleWrap[0], SIDE, ty)
      ctx.fillText(clipped, SIDE, ty + 62)
      ty += 2 * 62
    } else {
      ctx.font = TITLE_FONT
      ctx.fillText(titleWrap[0] ?? '', SIDE, ty)
      ty += 62
    }
    ctx.textBaseline = 'alphabetic'

    // 琥珀色分隔线
    ctx.fillStyle = p.amber
    roundRect(ctx, SIDE, ty + 12, 132, 12, 6)
    ctx.fill()

    ty += 48
    drawContent(ctx, page.contentLines, p, ty, FIRST_PAGE_LINES)
    drawFooter(ctx, page, p)
  } else {
    // 续页：顶部分隔线 + 正文
    ctx.fillStyle = p.amber
    roundRect(ctx, SIDE, 96, 132, 12, 6)
    ctx.fill()
    drawContent(ctx, page.contentLines, p, 140, FOLLOW_PAGE_LINES)
    drawFooter(ctx, page, p)
  }
}

function drawContent(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  p: TextCardPalette,
  startBaseline: number,
  budget: number,
) {
  ctx.fillStyle = p.text2
  ctx.font = CONTENT_FONT
  const shown = lines.slice(0, budget)
  for (let i = 0; i < shown.length; i++) {
    ctx.fillText(shown[i], SIDE, startBaseline + i * 52)
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, page: TextPage, p: TextCardPalette) {
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const pageLabel =
    page.totalPages <= 1 ? '毛球喵社 · 文字卡片' : `第 ${page.pageIndex + 1} / ${page.totalPages} 页 · 文字卡片`

  ctx.fillStyle = p.text3
  ctx.font = FOOT_FONT
  ctx.textAlign = 'left'
  ctx.fillText(date, SIDE, CARD_H - 64)
  ctx.textAlign = 'right'
  ctx.fillText(pageLabel, CARD_W - SIDE, CARD_H - 64)
  ctx.textAlign = 'left'
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas 生成 PNG 失败'))),
      'image/png',
    )
  })
}

/**
 * 主入口：把标题 + 正文切成最多 N 张 3:4 文字卡片，返回 PNG Blob 列表。
 * 调用方逐张 new File([blob], 'text-card.png', { type: 'image/png' }) 后走 uploadImage。
 */
export async function textCardBlobs(title: string, content: string, theme: TextTheme): Promise<Blob[]> {
  const pages = buildTextPages(title, content)
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const blobs: Blob[] = []
  for (const page of pages) {
    drawPage(canvas, page, theme)
    blobs.push(await canvasToBlob(canvas))
  }
  return blobs
}

/** 生成第 1 页的 dataURL，用于发布/编辑页的实时预览 */
export function textCardPreview(title: string, content: string, theme: TextTheme): string {
  const pages = buildTextPages(title, content)
  if (!pages.length) return ''
  const canvas = document.createElement('canvas')
  drawPage(canvas, pages[0], theme)
  return canvas.toDataURL('image/png')
}

/** 当前主题快捷判断，跟 index.html 内联脚本一致 */
export function currentTextTheme(): TextTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/* ===================================================================== */
/* 品牌封面生成器（1080×1440 真 3:4）                                     */
/* ===================================================================== */

/** 封面用 1080×1440：比文字卡大一档，2x 屏下也是实打实的清晰 */
export const COVER_W = 1080
export const COVER_H = 1440

const COVER_FONT = "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
const COVER_SIDE = 84

/**
 * 画一张品牌封面：底色 + 软色斑 + 描边框 + 居中吉祥物 + 底部标题。
 *
 * 为什么要这个而不是直接拿 `frontend/public/mascot/*.webp` 当封面：
 * 那批插画实测只有 ~400px 宽、比例 0.81~1.99（横的方的都有），
 * 塞进 3:4 的封面格里要么被裁掉六成，要么在 2x 屏上发虚。
 * 这里以 1080×1440 输出，插画按「contain」画进 800px 的方框里（最多放大 2 倍，
 * 400→800 恰好是它的可用上限），四周留白由品牌底色补齐。
 *
 * canvas 读不到 CSS 变量，调色板同样自带一份（与 PALETTES 同源）。
 */
export async function brandCoverBlob(opts: {
  title: string
  mascotUrl: string
  theme: TextTheme
  /** 同色系里换点花样：0=默认，1=深色底，2=琥珀底 */
  variant?: number
}): Promise<Blob> {
  const { title, mascotUrl, theme } = opts
  const variant = opts.variant ?? 0
  const p = PALETTES[theme]

  const canvas = document.createElement('canvas')
  canvas.width = COVER_W
  canvas.height = COVER_H
  const ctx = canvas.getContext('2d')!
  ctx.textBaseline = 'alphabetic'

  /* ---- 1. 底色（三种变体，让一屏封面不至于长得完全一样） ---- */
  const bg =
    variant === 1
      ? theme === 'dark'
        ? '#3c4266'
        : '#e9edf8'
      : variant === 2
        ? p.amber
        : p.surface
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, COVER_W, COVER_H)

  /* ---- 2. 软色斑做「纸纹」层次 ---- */
  ctx.fillStyle = variant === 2 ? 'rgba(255,255,255,0.35)' : p.bgSoft
  ctx.beginPath()
  ctx.arc(-160, -160, 420, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(COVER_W + 180, COVER_H + 120, 380, 0, Math.PI * 2)
  ctx.fill()

  /* ---- 3. 外框（跟文字卡同一种手绘感） ---- */
  ctx.strokeStyle = p.stroke
  ctx.lineWidth = 6
  roundRect(ctx, 14, 14, COVER_W - 28, COVER_H - 28, 56)
  ctx.stroke()

  /* ---- 4. 品牌行 + 喵印章 ---- */
  ctx.fillStyle = variant === 2 ? p.amberInk : p.text3
  ctx.font = `28px ${COVER_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText('毛球喵社 FUZZBALL-MEOW', COVER_SIDE, 132)

  ctx.fillStyle = variant === 2 ? p.amberInk : p.amber
  ctx.beginPath()
  ctx.arc(COVER_W - COVER_SIDE - 30, 124, 30, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = variant === 2 ? p.amber : p.amberInk
  ctx.font = `bold 34px ${COVER_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('喵', COVER_W - COVER_SIDE - 30, 124)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  /* ---- 5. 吉祥物（contain 进 800 方框，居中） ---- */
  try {
    const img = await loadImage(mascotUrl)
    const box = 800
    const x = (COVER_W - box) / 2
    const y = 230
    const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    ctx.drawImage(img, x + (box - w) / 2, y + (box - h) / 2, w, h)
  } catch {
    // 插画缺失时封面照样能出（就少了主角），别让整批种子数据因此失败
  }

  /* ---- 6. 底部标题（最多两行，超长省略） ---- */
  const titleFont = `bold 64px ${COVER_FONT}`
  const lines = wrapText(ctx, titleFont, title, COVER_W - COVER_SIDE * 2).slice(0, 2)
  ctx.fillStyle = variant === 2 ? p.amberInk : p.text
  ctx.textBaseline = 'top'
  const startY = 1116
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (i === 1 && measureWidth(ctx, titleFont, line) > COVER_W - COVER_SIDE * 2) {
      line = line.slice(0, 8) + '…'
    }
    ctx.font = titleFont
    ctx.fillText(line, COVER_SIDE, startY + i * 84)
  }
  ctx.textBaseline = 'alphabetic'

  /* ---- 7. 落款 ---- */
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  ctx.fillStyle = variant === 2 ? p.amberInk : p.text3
  ctx.font = `26px ${COVER_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(date, COVER_SIDE, COVER_H - 72)
  ctx.textAlign = 'right'
  ctx.fillText('毛球喵社 · 封面', COVER_W - COVER_SIDE, COVER_H - 72)
  ctx.textAlign = 'left'

  return canvasToBlob(canvas)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('插画加载失败: ' + src))
    img.src = src
  })
}