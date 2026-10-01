/**
 * 布局体检：几何层的重叠 / 横向溢出 / 关键尺寸断言 + 页面量化报告。
 *
 * 为什么是几何而不是截图：这台机器上读不了图片，「有没有遮挡」这类问题
 * 必须变成可判定的数字。`auditPage` 返回：
 *
 *   overlaps  —— 文本宿主与 IMG/INPUT/TEXTAREA/BUTTON 两两矩形相交
 *                （排除祖先关系），每条带面积。**正常应为 0。**
 *   overflow  —— .page 内 overflow-x:visible 且 scrollWidth > clientWidth 的元素。
 *   doc       —— 文档级横向溢出（scrollWidth > innerWidth）。
 *   spec      —— 分路由的关键尺寸（Track 4 断言）：
 *                首页 columns=4 + 列距、详情图列 440 + object-fit、
 *                发布页预览 max-height、填字后计数与输入是否相交。
 *
 * 断言之外还有一份**量化体检表**（计划 Track 4 的「代替看图」）：
 * `node scripts/ui-layout-audit.mjs --report` 打印每页的行长分布 / 首屏占用 /
 * 字号直方图 / 对比度 / 点击热区 / 卡片宽高比。只打印，不断言。
 *
 * 单跑：node scripts/ui-layout-audit.mjs
 */
import { createSession, preflight } from './ui-cdp.mjs'

const BASE = 'http://localhost:5180'
const DESKTOP = 1280
const MOBILE = 430

/** 在页面里跑的表达式（必须自包含，不能引用外部变量） */
export const AUDIT_EXPR = `(() => {
  const sel = (el) => {
    let s = el.tagName.toLowerCase()
    if (el.id) return s + '#' + el.id
    if (typeof el.className === 'string' && el.className.trim()) {
      s += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
    }
    return s
  }
  const vis = (el) => {
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false
    const b = el.getBoundingClientRect()
    return b.width > 0 && b.height > 0
  }
  const who = (el) => {
    const t = (el.getAttribute('data-test') || sel(el) + ' <<' +
      String(el.textContent || el.value || el.tagName).trim().slice(0, 14) + '>>')
    return t
  }

  const nodes = [...document.querySelectorAll('body *')].filter(el => {
    if (!vis(el)) return false
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    const isCtl = ['IMG', 'INPUT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)
    return hasText || isCtl
  })

  const overlaps = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]
      if (a.contains(b) || b.contains(a)) continue
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (ox > 3 && oy > 3) {
        overlaps.push(who(a) + '  X  ' + who(b) + '  [' + Math.round(ox) + 'x' + Math.round(oy) + ']')
      }
    }
  }

  const overflow = []
  for (const el of document.querySelectorAll('.page, .page *')) {
    if (!vis(el)) continue
    const st = getComputedStyle(el)
    if (st.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 2) {
      overflow.push(sel(el) + ' scrollW=' + el.scrollWidth + ' clientW=' + el.clientWidth)
    }
  }

  /* ---- 分路由关键尺寸（给外层 .mjs 的 specChecks 用）---- */
  const spec = {}
  const h = location.hash
  const rectHit = (a, b) => {
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return ox > 3 && oy > 3
  }
  if (h === '#/') {
    const items = document.querySelector('.items')
    if (items) {
      spec.homeCols = getComputedStyle(items).columnCount
      const lefts = [...items.children].map(li => Math.round(li.getBoundingClientRect().left))
      const d = [...new Set(lefts)].sort((a, b) => a - b)
      spec.homeColGap = d.length > 1 ? d[1] - d[0] : 0
    }
  } else if (h.startsWith('#/note/')) {
    const g = document.querySelector('.detail-grid .grid')
    if (g) {
      spec.detailCol1 = Math.round(g.getBoundingClientRect().width)
      const im = g.querySelector('img')
      spec.detailImgFit = im ? getComputedStyle(im).objectFit : ''
    }
    const dc = document.querySelector('[data-test=note-detail]')
    spec.cardPad = dc ? parseFloat(getComputedStyle(dc).padding) : -1
  } else if (h.startsWith('#/publish')) {
    const ti = document.querySelector('[data-test=note-title]')
    spec.titleFont = ti ? parseFloat(getComputedStyle(ti).fontSize) : 0
    const cp = document.querySelector('.card-preview')
    if (cp) {
      const cs = getComputedStyle(cp)
      spec.preview = {
        maxH: Math.round(parseFloat(cs.maxHeight)),
        fit: cs.objectFit,
        w: Math.round(cp.getBoundingClientRect().width),
        h: Math.round(cp.getBoundingClientRect().height),
      }
    }
    spec.countOverlap = false
    for (const f of document.querySelectorAll('.field')) {
      const c = f.querySelector('.count')
      const i = f.querySelector('input, textarea')
      if (c && i && rectHit(c.getBoundingClientRect(), i.getBoundingClientRect())) spec.countOverlap = true
    }
  }

  return JSON.stringify({
    url: location.hash,
    vw: innerWidth,
    doc: { scrollW: document.documentElement.scrollWidth, innerW: innerWidth },
    overlaps,
    overflow,
    spec,
  })
})()`

/** 量化体检表表达式：只出数，不断言（计划 Track 4 的「代替看图」清单） */
export const REPORT_EXPR = `(() => {
  const vis = (el) => {
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false
    const b = el.getBoundingClientRect()
    return b.width > 0 && b.height > 0
  }
  const all = [...document.querySelectorAll('body *')].filter(vis)
  const textEls = all.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))

  /* 行长：Range 把文本拆成行盒，统计渲染宽度分布（px；CJK ≈15px/字） */
  const widths = []
  for (const el of textEls) {
    try {
      const rg = document.createRange()
      rg.selectNodeContents(el)
      for (const rc of rg.getClientRects()) if (rc.width > 8 && rc.height > 5) widths.push(Math.round(rc.width))
    } catch (e) { /* 空元素没行盒 */ }
  }
  widths.sort((a, b) => a - b)
  const p = (q) => widths.length ? widths[Math.min(widths.length - 1, Math.floor(widths.length * q))] : 0

  /* 首屏占用：内容块铺到 10px 网格，occupied 比例 = 占用，其余算留白 */
  const cell = 10
  const cols = Math.ceil(innerWidth / cell), rows = Math.ceil(innerHeight / cell)
  const g = new Uint8Array(cols * rows)
  let blocks = 0
  for (const el of document.querySelectorAll('.page > section, .page > header, .page > .card, .item')) {
    if (!vis(el)) continue
    blocks++
    const b = el.getBoundingClientRect()
    const x0 = Math.max(0, Math.floor(b.left / cell)), x1 = Math.min(cols - 1, Math.ceil(b.right / cell))
    const y0 = Math.max(0, Math.floor(b.top / cell)), y1 = Math.min(rows - 1, Math.ceil(b.bottom / cell))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * cols + x] = 1
  }
  let occ = 0
  for (let i = 0; i < g.length; i++) occ += g[i]
  const coverPct = Math.round((occ / g.length) * 100)

  /* 字号直方图（找字阶之外的离群值） */
  const fs = {}
  for (const el of textEls) {
    const k = getComputedStyle(el).fontSize
    fs[k] = (fs[k] || 0) + 1
  }

  /* WCAG 对比度：前景色沿祖先找到第一个不透明背景，算亮度比 */
  const nums = (s) => (s.match(/[\\d.]+/g) || []).map(Number)
  const rgba = (s) => { const n = nums(s); return n.length >= 3 ? [n[0], n[1], n[2], n.length > 3 ? n[3] : 1] : [255, 255, 255, 1] }
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const bgOf = (el) => {
    let n = el
    while (n) {
      const c = rgba(getComputedStyle(n).backgroundColor)
      if (c[3] > 0.5) return c
      n = n.parentElement
    }
    return [255, 255, 255, 1]
  }
  let minR = 99, minWho = ''
  const low = []
  for (const el of textEls) {
    const st = getComputedStyle(el)
    const fg = rgba(st.color)
    if (fg[3] < 0.5) continue
    const r = ratio(fg, bgOf(el))
    if (r < minR) { minR = r; minWho = String(el.getAttribute('data-test') || el.className || el.tagName) }
    if (r < 4.5 && low.length < 6) low.push(String(el.getAttribute('data-test') || el.className || el.tagName).slice(0, 18) + '=' + r.toFixed(2))
  }

  /* 点击热区：可点元素任一边 <40px 记一条 */
  const small = []
  for (const el of all) {
    if (!el.matches('button, a[href], input, textarea, [role=button]')) continue
    const b = el.getBoundingClientRect()
    if (b.width < 40 || b.height < 40) {
      small.push(String(el.getAttribute('data-test') || el.className || el.tagName).slice(0, 16) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height))
    }
  }

  /* 卡片 / 图片宽高比分布（瀑布封面应集中在 0.75 = 3:4） */
  const ar = {}
  for (const el of document.querySelectorAll('.item .cover, .item img, .grid img')) {
    if (!vis(el)) continue
    const b = el.getBoundingClientRect()
    if (b.height < 4) continue
    const k = (b.width / b.height).toFixed(2)
    ar[k] = (ar[k] || 0) + 1
  }

  return JSON.stringify({
    url: location.hash, vw: innerWidth,
    elements: all.length, text: textEls.length,
    lines: widths.length, lenP50: p(0.5), lenP95: p(0.95),
    coverPct, blocks,
    fs, minR: Math.round(minR * 100) / 100, minWho: minWho.slice(0, 24), low,
    small, ar,
  })
})()`

/**
 * 跑一个视口下的体检。
 * @param {object} s   ui-cdp 的 session
 * @param {number} w   视口宽
 * @param {string} hash 待体检的路由，如 '#/publish'
 */
export async function auditPage(s, w, hash, height = 900) {
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: w, height, deviceScaleFactor: 1, mobile: w < 700,
  })
  if (hash) await s.goto(BASE + '/' + hash)
  await new Promise(r => setTimeout(r, 300))
  // 固定 700ms 在全量连跑时不够（实测撞过：idempotent 刚压完后端，
  // 首页关注流还没回来就在量，把「还没渲染」误报成「瀑布塌了」）。
  // 等到加载中标记消失（终态 = 列表/空态/错误态任一）再进体检；
  // 超时就按老节奏继续，宁可量早一点也不让体检自己挂死。
  await s.waitFor(`(() => {
    if (!document.querySelector('.page')) return false
    return !document.querySelector('[data-test=feed-loading]')
        && !document.querySelector('[data-test=follow-loading]')
  })()`, '页面进入终态', 10000).catch(() => {})
  return JSON.parse(await s.evaluate(AUDIT_EXPR))
}

function fmt(r) {
  const bad = r.overlaps.length + r.overflow.length + (r.doc.scrollW > r.doc.innerW ? 1 : 0)
  const head = `${bad === 0 ? 'PASS' : 'FAIL'}  ${r.url} @${r.vw}w  overlaps=${r.overlaps.length} overflow=${r.overflow.length} doc=${r.doc.scrollW}/${r.doc.innerW}`
  const detail = [...r.overlaps.map(x => '    overlap ' + x), ...r.overflow.map(x => '    overflow ' + x),
    ...(r.doc.scrollW > r.doc.innerW ? [`    page scrollW ${r.doc.scrollW} > innerW ${r.doc.innerW}`] : [])]
  return [head, ...detail].join('\n')
}

/** 登录演示账号（CDP 测试的既有做法） */
async function loginDemo(s) {
  await s.goto(`${BASE}/#/login`)
  await s.waitFor('document.querySelector(\'.demo\')', '演示账号按钮', 20000)
  await s.evaluate(`document.querySelector('.demo').click()`)
  await new Promise(r => setTimeout(r, 250))
  await s.evaluate(`document.querySelector('.xk-btn').click()`)
  await s.waitFor('location.hash === \'#/\'', '登录成功', 20000)
}

/** 取一条**有图**的笔记 id，供详情页体检用。
 *
 * 走关注流而不是搜索：搜索关键词「笔记」只会命中 xk_ui_follow 那 5 篇
 * 无图旧文，恰好落到详情页 `:has()` 的单栏兜底分支上 —— 两栏主分支就测不到了。
 * 关注流里是种子账号的新笔记，封面 1080×1440 必有图。
 */
async function someNoteId(s) {
  return s.evaluate(`(async () => {
    const t = localStorage.getItem('xk_token')
    const r = await fetch('/api/feed/follow?page=1&size=10', { headers: { Authorization: 'Bearer ' + t } })
    const j = await r.json()
    const list = (j && j.data && j.data.list) || []
    return list[0] ? list[0].id : ''
  })()`)
}

/** spec 断言（Track 4 计划 #3b/#4）：路由相关的关键尺寸 */
function specChecks(s, label, w, r) {
  const sp = r.spec || {}
  if (label === '首页' && w >= 1024) {
    s.check('首页瀑布 columns=4 且相邻列距>100px',
      sp.homeCols === '4' && sp.homeColGap > 100, `cols=${sp.homeCols} gap=${sp.homeColGap}`)
  }
  if (label === '详情页') {
    if (w >= 1024) {
      s.check('详情图列宽 440±8px', sp.detailCol1 >= 432 && sp.detailCol1 <= 448, `col1=${sp.detailCol1}`)
    }
    s.check('详情图 object-fit=contain（不裁 3:4）', sp.detailImgFit === 'contain', `fit=${sp.detailImgFit}`)
    s.check('详情卡内边距 >0（P13：文字不贴描边）', sp.cardPad > 0, `pad=${sp.cardPad}px`)
  }
  if (label === '发布页') {
    s.check('发布页标题输入 ≥16px（防 iOS 聚焦缩放）', sp.titleFont >= 16, `font=${sp.titleFont}px`)
  }
}

/** Track 4 计划 #7：种子封面 naturalWidth ≥1080，钉死「退回 8×8」的回归。
 * 用 decode() 等图片真解码完再量，lazy-load 下 naturalWidth=0 会假红。 */
async function checkCovers(s) {
  const arr = JSON.parse(await s.evaluate(`(async () => {
    const imgs = [...document.querySelectorAll('.items img[src*="/uploads/"]')].slice(0, 8)
    const out = []
    for (const im of imgs) { try { await im.decode() } catch (e) {} out.push(im.naturalWidth) }
    return JSON.stringify(out)
  })()`))
  const max = arr.length ? Math.max.apply(null, arr) : 0
  s.check('首页真封面 naturalWidth≥1080（钉死 8×8 回归）', arr.length > 0 && max >= 1080,
    `covers=${JSON.stringify(arr)}`)
}

/** 发布页填满 64 字标题 + 长正文：喂给 v-model 的原生 setter + input 事件 */
async function fillPublish(s) {
  await s.evaluate(`(() => {
    const setV = (el, v) => {
      if (!el) return
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setV(document.querySelector('[data-test="note-title"]'), '检字'.repeat(32))
    setV(document.querySelector('[data-test="note-content"]'), '这是用于布局体检的占位正文，反复填充以触发多行换行。'.repeat(8))
  })()`)
  await new Promise(r => setTimeout(r, 900)) // 文字卡预览 debounce 300ms + canvas 渲染 + Vue patch
}

/** Track 4 计划 #5/#6：填字后的发布页再量一遍（不能 goto，会清空表单） */
async function auditPublishFilled(s, w) {
  await fillPublish(s)
  const r = JSON.parse(await s.evaluate(AUDIT_EXPR))
  const bad = r.overlaps.length + r.overflow.length + (r.doc.scrollW > r.doc.innerW ? 1 : 0)
  const sp = r.spec || {}
  s.check('填满64字后计数与输入不相交', sp.countOverlap === false,
    bad ? JSON.stringify(r.overlaps.slice(0, 3)) : '')
  s.check(`发布页填字后无几何问题 overlaps=${r.overlaps.length} overflow=${r.overflow.length}`, bad === 0,
    fmt(r).replace(/\n/g, ' | '))
  if (w >= 1024) {
    s.check('桌面文字卡预览存在且 max-height≤480', !!sp.preview && sp.preview.maxH <= 480,
      sp.preview ? `maxH=${sp.preview.maxH} box=${sp.preview.w}x${sp.preview.h}` : '预览不存在')
    if (sp.preview) {
      s.check('桌面文字卡预览 object-fit=contain', sp.preview.fit === 'contain', `fit=${sp.preview.fit}`)
    }
  } else {
    s.check('移动文字卡预览存在', !!sp.preview, sp.preview ? `box=${sp.preview.w}x${sp.preview.h}` : '预览不存在')
  }
}

/** 一个页面 × 一个视口 → 一条几何断言（bad=0 才算过，失败时把明细打出来） */
async function auditOne(s, label, w, hash) {
  const r = await auditPage(s, w, hash)
  const bad = r.overlaps.length + r.overflow.length + (r.doc.scrollW > r.doc.innerW ? 1 : 0)
  const head = `${label} @${w}w overlaps=${r.overlaps.length} overflow=${r.overflow.length} doc=${r.doc.scrollW}/${r.doc.innerW}`
  if (bad) fmt(r).split('\n').forEach((l) => console.log('    ' + l))
  s.check(head, bad === 0, bad ? `${bad} 处几何问题` : '')
  specChecks(s, label, w, r)
  return r
}

/** 桌面/移动两套 token 必须各走各的：Track 1 的覆盖块写错选择器时这里会挂 */
async function auditTokens(s) {
  const read = () => s.evaluate(`JSON.stringify({
    strokeW: getComputedStyle(document.documentElement).getPropertyValue('--xk-stroke-w').trim(),
    radius: getComputedStyle(document.documentElement).getPropertyValue('--xk-radius-blob').trim(),
  })`)
  await s.send('Emulation.setDeviceMetricsOverride', { width: DESKTOP, height: 900, deviceScaleFactor: 1, mobile: false })
  const desk = JSON.parse(await read())
  s.check('桌面 token：细描边 1px + 规整圆角', desk.strokeW === '1px' && desk.radius === '16px',
    `strokeW=${desk.strokeW} radius=${desk.radius}`)
  await s.send('Emulation.setDeviceMetricsOverride', { width: MOBILE, height: 900, deviceScaleFactor: 1, mobile: true })
  const mob = JSON.parse(await read())
  s.check('移动 token：粗描边 2px + 手绘圆角', mob.strokeW === '2px' && mob.radius !== '16px',
    `strokeW=${mob.strokeW} radius=${mob.radius.slice(0, 24)}`)
}

const PAGE_LIST = (noteId) => [
  ['首页', '#/'],
  ['详情页', noteId ? `#/note/${noteId}` : '#/'],
  ['搜索页', `#/search?keyword=${encodeURIComponent('周末')}`],
  ['我的', '#/profile'],
  ['发布页', '#/publish'],
]

function fmtReport(r) {
  const SCALE = new Set(['11px', '12px', '13px', '14px', '15px', '17px', '20px', '24px', '30px'])
  const off = Object.keys(r.fs).filter(k => !SCALE.has(k)).sort()
  const ar = Object.entries(r.ar).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}×${v}`).join(' ')
  const small = r.small.length ? r.small.slice(0, 6).join(', ') : '无'
  return [
    `report ${r.url} @${r.vw}w  元素=${r.elements} 文本=${r.text} 行数=${r.lines} ` +
    `行长P50=${r.lenP50}px(≈${Math.round(r.lenP50 / 15)}字) P95=${r.lenP95}px  首屏占用=${r.coverPct}% 留白=${100 - r.coverPct}%`,
    `  字号分布 ${JSON.stringify(r.fs)}${off.length ? '  离群[' + off.join(',') + ']' : '  （全在字阶内）'}`,
    `  对比度 min=${r.minR} (${r.minWho})  <4.5: ${r.low.length ? r.low.join(' ') : '无'}`,
    `  点击热区<40px: ${small}`,
    `  卡片宽高比 ${ar}`,
  ].join('\n')
}

/** --report：每页打一份量化体检表（桌面 1280），不断言 */
async function runReport(s) {
  const noteId = await someNoteId(s)
  for (const [label, hash] of PAGE_LIST(noteId)) {
    await s.send('Emulation.setDeviceMetricsOverride', { width: DESKTOP, height: 900, deviceScaleFactor: 1, mobile: false })
    await s.goto(BASE + '/' + hash)
    await new Promise(r => setTimeout(r, 700))
    console.log(fmtReport(JSON.parse(await s.evaluate(REPORT_EXPR))))
  }
}

async function main() {
  await preflight()
  const report = process.argv.includes('--report')
  const s = await createSession({ name: 'layout-audit' })
  try {
    /* 未登录态先体检登录页：登进去之后 #/login 会被守卫重定向回首页，
     * 那时候再访「登录页」实际量的是首页，白跑一遍。 */
    for (const w of [MOBILE, DESKTOP]) await auditOne(s, '登录页', w, '#/login')

    await auditTokens(s)
    await loginDemo(s)

    const noteId = await someNoteId(s)
    const pages = PAGE_LIST(noteId)
    for (const w of [DESKTOP, MOBILE]) {
      for (const [label, hash] of pages) {
        await auditOne(s, label, w, hash)
        if (label === '首页' && w === DESKTOP) await checkCovers(s)
        if (label === '发布页') await auditPublishFilled(s, w)
      }
    }

    if (report) await runReport(s)
  } finally {
    const allOk = await s.close()
    process.exit(allOk ? 0 : 1)
  }
}

/* 直接执行时跑全量；被 import 时只导出工具（Windows 路径斜杠方向不一致，
 * 所以不比对 import.meta.url，只看入口文件名） */
const invoked = process.argv[1] && /[/\\]ui-layout-audit\.mjs$/.test(process.argv[1])
if (invoked) await main()
