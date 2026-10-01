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

/**
 * 文字卡模板（小红书式的「模板选择」）。
 *
 * 模板决定卡片外观，**与 app 深浅主题解耦**：选了琥珀卡就是琥珀卡，
 * 不随主题翻转；`defaultTemplateId()` 只是按主题给出默认项。
 * 每套模板自带你这调色板 —— canvas 读不到 CSS 变量，颜色必须写死在这里。
 * text2 均按 ≥4.5:1 对比度选的（黄/粉/绿/蓝四套都手算过）。
 */
export type CardDecor = 'circles' | 'lines' | 'dots' | 'plain'

export interface CardTemplate {
  id: string
  name: string
  decor: CardDecor
  palette: TextCardPalette
}

export const CARD_TEMPLATES: CardTemplate[] = [
  { id: 'paper', name: '纸感', decor: 'circles', palette: PALETTES.light },
  { id: 'ink', name: '墨黑', decor: 'circles', palette: PALETTES.dark },
  {
    id: 'amber',
    name: '琥珀',
    decor: 'lines',
    palette: {
      surface: '#ffedbe',
      bgSoft: '#f6d98d',
      text: '#43300f',
      text2: '#6e5a2e',
      text3: '#96814d',
      stroke: '#4a3416',
      amber: '#ffffff',
      amberInk: '#43300f',
    },
  },
  {
    id: 'mint',
    name: '青瓷',
    decor: 'dots',
    palette: {
      surface: '#e4f4ec',
      bgSoft: '#cfeadc',
      text: '#153a2d',
      text2: '#3f6b5c',
      text3: '#71988a',
      stroke: '#1d4a3b',
      amber: '#2f9e73',
      amberInk: '#ffffff',
    },
  },
  {
    id: 'blush',
    name: '腮红',
    decor: 'lines',
    palette: {
      surface: '#fde9ec',
      bgSoft: '#f9d5da',
      text: '#4a1f28',
      text2: '#7c4b55',
      text3: '#a97f88',
      stroke: '#5d2f39',
      amber: '#e5484d',
      amberInk: '#ffffff',
    },
  },
  {
    id: 'blue',
    name: '雾蓝',
    decor: 'dots',
    palette: {
      surface: '#e9effc',
      bgSoft: '#d7e1f8',
      text: '#1b2b52',
      text2: '#4a5c8c',
      text3: '#7d8cb5',
      stroke: '#24345f',
      amber: '#5b7ad6',
      amberInk: '#ffffff',
    },
  },
]

/** 按 id 取模板，找不到（脏数据）回退第一套，绝不抛错 */
export function getTemplate(id: string): CardTemplate {
  return CARD_TEMPLATES.find((t) => t.id === id) ?? CARD_TEMPLATES[0]
}

/** 发布页的默认模板：跟 app 主题走一次（深色→墨黑，其余→纸感） */
export function defaultTemplateId(): string {
  return document.documentElement.dataset.theme === 'dark' ? 'ink' : 'paper'
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
/**
 * 正文 32px / 行高 56（1.75）：卡片展示宽只有 ~340px（900 缩到 0.38 倍），
 * 原 30px 折算过去才 11.3px，读起来发虚 —— 这是「卡片排版不对」的主因之一。
 * 预算复核（三段留白重排后）：
 *   单行标题 232+18 → 线 250-260 → 首基线 310，13 行末基线 310+12*56=982；
 *   两行标题 294+18 → 线 312-322 → 首基线 372，13 行末基线 1044；
 *   两者 ink 底均 < 落款 ink 顶 ≈1112；续页 174+16*56=1070 同样安全。
 */
const CONTENT_FONT = '32px ' + FONT_STACK
const CONTENT_LH = 56

/**
 * 标题 / 分隔线 / 正文的三段留白。
 *
 * 修「分隔线压正文」（2026-10-01 用户截图）：旧布局线底与首行 ink 顶
 * 只差 0~1px（单行标题线 244-256、基线 280 的 32px 字 ink 顶 ≈256），
 * 渲染出来线直接叠在第一行字上。现在三段各自留白、语义化命名：
 *   标题底 --18--> 线顶 --线高 10--> 线底 --26--> 首行 ink 顶 --24(上伸量)--> 基线
 */
const SEP_W = 132
const SEP_H = 10
const SEP_GAP_TITLE = 18
const SEP_GAP_CONTENT = 26
/** 32px 字 ink 相对基线的上伸量：drawContent 用基线定位，换算成 ink 顶用 */
const CONTENT_ASCENT = 24

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
 *
 * **先按 \n 切段再逐段折行**：段间空行保留为一整行。
 * 之前从不看 \n，裸换行会被 fillText 画成空格宽的缺口 ——
 * 用户报的「按了换行键却变成空格」就是这条（2026-10-01 诊断）。
 */
export function wrapText(ctx: CanvasRenderingContext2D, font: string, text: string, maxWidth: number): string[] {
  if (!text) return []
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('')
      continue
    }
    let line = ''
    for (const ch of para) {
      const next = line + ch
      if (line && measureWidth(ctx, font, next) > maxWidth) {
        out.push(line)
        line = ch
      } else {
        line = next
      }
    }
    if (line) out.push(line)
  }
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
 * 续页不重复画标题。模板决定配色 + 底纹。
 */
export function drawPage(canvas: HTMLCanvasElement, page: TextPage, tpl: CardTemplate) {
  const ctx = canvas.getContext('2d')!
  const p = tpl.palette
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

  // 底纹（模板决定）：软圆 / 横线纸 / 点阵 / 素面
  ctx.fillStyle = p.bgSoft
  if (tpl.decor === 'circles') {
    // 左上、右下各一枚淡色圆，压在手写卡纸后面
    ctx.beginPath()
    ctx.arc(-90, -90, 180, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(CARD_W + 80, CARD_H + 40, 160, 0, Math.PI * 2)
    ctx.fill()
  } else if (tpl.decor === 'lines') {
    // 横线纸：等距细线铺满内容区（不压到描边）
    for (let y = 148; y < CARD_H - 110; y += 56) {
      ctx.fillRect(SIDE, y, CARD_W - SIDE * 2, 2)
    }
  } else if (tpl.decor === 'dots') {
    for (let y = 40; y < CARD_H - 40; y += 56) {
      for (let x = 40; x < CARD_W - 40; x += 56) {
        ctx.beginPath()
        ctx.arc(x, y, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

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

    // 分隔线：标题底 +18 起，正文首行基线 = 线底 + 26 + 24（三段留白见常量注释）
    const sepY = ty + SEP_GAP_TITLE
    ctx.fillStyle = p.amber
    roundRect(ctx, SIDE, sepY, SEP_W, SEP_H, SEP_H / 2)
    ctx.fill()

    const firstBaseline = sepY + SEP_H + SEP_GAP_CONTENT + CONTENT_ASCENT
    drawContent(ctx, page.contentLines, p, firstBaseline, FIRST_PAGE_LINES)
    drawFooter(ctx, page, p)
  } else {
    // 续页：品牌行(基线 96)下方的分隔线 + 正文，同一套三段留白
    const sepY = 96 + SEP_GAP_TITLE
    ctx.fillStyle = p.amber
    roundRect(ctx, SIDE, sepY, SEP_W, SEP_H, SEP_H / 2)
    ctx.fill()
    const firstBaseline = sepY + SEP_H + SEP_GAP_CONTENT + CONTENT_ASCENT
    drawContent(ctx, page.contentLines, p, firstBaseline, FOLLOW_PAGE_LINES)
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
    ctx.fillText(shown[i], SIDE, startBaseline + i * CONTENT_LH)
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
 * templateId 缺省（''/undefined/脏值）回退第一套模板，不抛错。
 */
export async function textCardBlobs(title: string, content: string, templateId?: string): Promise<Blob[]> {
  const tpl = getTemplate(templateId ?? '')
  const pages = buildTextPages(title, content)
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const blobs: Blob[] = []
  for (const page of pages) {
    drawPage(canvas, page, tpl)
    blobs.push(await canvasToBlob(canvas))
  }
  return blobs
}

/**
 * 生成第 pageIndex 页的 dataURL，用于发布/编辑页的实时预览。
 * 配合 textCardPageCount 做分页器 —— 预览只显示第 1 页会让用户以为
 * 超长正文被「吞」了，必须能翻到后面几页。
 */
export function textCardPreview(title: string, content: string, templateId?: string, pageIndex = 0): string {
  const tpl = getTemplate(templateId ?? '')
  const pages = buildTextPages(title, content)
  if (!pages.length) return ''
  const canvas = document.createElement('canvas')
  drawPage(canvas, pages[Math.min(Math.max(pageIndex, 0), pages.length - 1)], tpl)
  return canvas.toDataURL('image/png')
}

/** 当前标题/正文会切成几页（0 = 空内容不出卡） */
export function textCardPageCount(title: string, content: string): number {
  return buildTextPages(title, content).length
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