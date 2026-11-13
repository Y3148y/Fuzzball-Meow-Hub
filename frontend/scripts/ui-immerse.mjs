/**
 * 沉浸流（P34）：一屏一张、上下滑
 *
 * <p>用常驻 fixture `xk_ui_smoke`（口令 Xk@123456）**不注册新账号** ——
 * register 10/min/IP，全量连跑时前面几组刚把桶用掉（AGENTS 记过好几次）。
 *
 * <p>⚠️ 断言一律用**相对量**（第几张 / 当前那张是谁），不写死条数：
 * 库里 543 篇且会随种子数据增长，写死数字每加一次数据就得重写断言。
 */
import { createSession, preflight, DEV_ORIGIN } from './ui-cdp.mjs'

const BASE = process.env.XK_BASE || DEV_ORIGIN
const API = process.env.XK_API_BASE || 'http://127.0.0.1:8088/api'

const s = await createSession({ name: 'immerse' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(p, { method = 'GET', token, body } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = 'Bearer ' + token
  const res = await fetch(`${API}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  return res.json().catch(() => null)
}

const exists = (t) => s.evaluate(`!!document.querySelector('[data-test=${t}]')`)
const click = (t) => s.evaluate(`document.querySelector('[data-test=${t}]')?.click()`)
const all = (t) => s.evaluate(`Array.from(document.querySelectorAll('[data-test=${t}]'))`)
/** waitFor 的「返回布尔不抛」版：供断言消费（P52 记过 waitFor 包 !! 但失败即抛） */
const wOK = async (cond, label, ms = 8000) => {
  try { await s.waitFor(cond, label, ms); return true } catch { return false }
}

/* P53 互动用例的造数状态：复位与清理都走 API（finally 统一兜底，
   别再犯 P28「finallyCleanup 从没人排空」的错） */
let token53 = ''
let note53 = ''
const reset53 = async () => {
  if (!token53 || !note53) return
  await api(`/note/${note53}/like`, { method: 'DELETE', token: token53 })
  await api(`/note/${note53}/collect`, { method: 'DELETE', token: token53 })
}
/** 首卡上互动行的结构信息 */
const actsOf = (idx) => s.evaluate(`(() => {
  const c = document.querySelectorAll('[data-test=immerse-slide]')[${idx}]
  if (!c) return null
  const like = c.querySelector('[data-test=immerse-like]')
  const coll = c.querySelector('[data-test=immerse-collect]')
  const comm = c.querySelector('[data-test=immerse-comment]')
  const n = (el) => { const r = el?.getBoundingClientRect(); return r ? Math.round(r.width) + 'x' + Math.round(r.height) : 'missing' }
  const st = (el) => ({
    box: el ? n(el) : 'missing',
    pressed: el?.getAttribute('aria-pressed') ?? null,
    num: el ? Number(el.querySelector('.num')?.textContent) : -1,
  })
  return {
    like: st(like),
    coll: st(coll),
    comm: { box: comm ? n(comm) : 'missing', href: comm?.getAttribute('href') || '' },
    emptyIcons: [...c.querySelectorAll('.acts i.van-icon')].filter((e) => getComputedStyle(e, '::before').content === 'none').length,
    nums: [...c.querySelectorAll('.acts .num')].map((e) => Number(e.textContent)),
  }
})()`)

let crashed = null
try {
  await preflight()

  /* ---------- 0. 登录（用 demo 快捷路径，与 smoke 组同一套） ---------- */
  await s.goto(BASE + '/#/login')
  await s.waitFor(`document.querySelector('[data-test=demo], .demo, .xk-btn')`, '登录页', 20000)
  await s.evaluate(`document.querySelector('.demo')?.click()`)
  await sleep(400)
  await s.evaluate(`document.querySelector('.xk-btn')?.click()`)
  await s.waitFor(`location.hash.startsWith('#/') && !location.hash.startsWith('#/login')`, '登录完成', 25000)

  /* ---------- 1. 首页有入口，且它是导航（a）不是按钮 ---------- */
  await s.goto(BASE + '/#/')
  await s.waitFor(`document.querySelector('[data-test=feed-item], [data-test=feed-empty]')`, '首页终态', 25000)
  s.check('首页有「沉浸浏览」入口', await exists('immerse-entry'), 'immerse-entry 不存在')
  // ⚠️ **断「是导航」而不是「有个元素」**：入口用 button 会让读屏
  // 念成「按钮」，键盘也无法用复制链接的方式分享。规则：导航归 a。
  const entryTag = await s.evaluate(`document.querySelector('[data-test=immerse-entry]')?.tagName`)
  s.check('入口是 a/链接而不是 button（导航归 a）', entryTag === 'A', String(entryTag))
  const entryBox = await s.evaluate(`(() => {
    const r = document.querySelector('[data-test=immerse-entry]')?.getBoundingClientRect()
    return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null
  })()`)
  s.check('入口热区高度 ≥40px（P13 下限）', entryBox && entryBox.h >= 40, JSON.stringify(entryBox))
  // P53 前置：入口从「小一号的次要药丸」升成琥珀显眼胶囊
  s.check('P53 入口升格后更宽（≥90px，胶囊感）', entryBox && entryBox.w >= 90, JSON.stringify(entryBox))
  const entryStyle = await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=immerse-entry]')
    if (!el) return null
    const cs = getComputedStyle(el)
    /* ⚠️ Chrome 对 color-mix 返回的是 color(srgb … / 0.12) 新格式，
       rgba?() 正则取不到 alpha —— 两种格式都要解析。
       border-width 取的是 used value（dpr=1 时 1.5px 取整成 1px），只断 ≥1。 */
    const bg = cs.backgroundColor
    let alpha = 0
    if (/rgba?\\(/.test(bg)) {
      const m = bg.match(/rgba?\\(([^)]+)\\)/)
      alpha = m ? Number(m[1].split(',')[3] ?? 1) : 0
    } else {
      const m = bg.match(/\\/\\s*([\\d.]+)\\)/)
      alpha = m ? Number(m[1]) : 0
    }
    return { borderW: cs.borderTopWidth, fs: cs.fontSize, fw: cs.fontWeight, alpha, bg }
  })()`)
  s.check('P53 入口有琥珀淡底（不是旧的无底灰药丸）',
    entryStyle && entryStyle.alpha > 0 && entryStyle.fw >= 600
      && Number.parseFloat(entryStyle.borderW) >= 1, JSON.stringify(entryStyle))

  /* ---------- 2. 进入沉浸流 ---------- */
  await click('immerse-entry')
  await s.waitFor(`document.querySelector('[data-test=immerse-slide], [data-test=immerse-error]')`,
    '沉浸流终态', 25000)
  s.check('能进沉浸流页', await exists('immerse-page'), 'immerse-page 不存在')
  s.check('有卡片渲染', (await all('immerse-slide')).length > 0,
    'n=' + (await all('immerse-slide')).length)

  /* ---------- 3. 「一屏一张」—— 这是本页面存在的理由 ---------- */
  const geo = await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=immerse-track]')
    if (!el) return null
    const slides = [...el.querySelectorAll('[data-test=immerse-slide]')]
    return {
      trackH: Math.round(el.getBoundingClientRect().height),
      vh: window.innerHeight,
      snapType: getComputedStyle(el).scrollSnapType,
      heights: slides.slice(0, 3).map((x) => Math.round(x.getBoundingClientRect().height)),
      scrollTop: Math.round(el.scrollTop),
      scrollH: el.scrollHeight,
    }
  })()`)
  s.check('滚动容器用了 scroll-snap（不是自己算手势）',
    geo && /y/.test(geo.snapType) && /mandatory/.test(geo.snapType), JSON.stringify(geo?.snapType))
  s.check('容器高度 = 视口高度（占满整屏）',
    geo && Math.abs(geo.trackH - geo.vh) <= 2, JSON.stringify(geo && [geo.trackH, geo.vh]))
  s.check('每张卡片高度 = 容器高度（真正「一屏一张」）',
    geo && geo.heights.every((h) => Math.abs(h - geo.trackH) <= 2),
    JSON.stringify(geo && [geo.heights, geo.trackH]))
  s.check('初始停在第一张（scrollTop=0）', geo && geo.scrollTop === 0, 'scrollTop=' + geo?.scrollTop)
  s.check('内容可滚动（有多屏）', geo && geo.scrollH > geo.trackH * 1.5,
    JSON.stringify(geo && [geo.scrollH, geo.trackH]))

  /* ---------- 4. 滑到第二张：计数器与实际位置同步 ---------- */
  const beforeTitle = await s.evaluate(`document.querySelectorAll('[data-test=immerse-title]')[0]?.textContent?.trim()`)
  await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=immerse-track]')
    el.scrollTop = el.clientHeight
  })()`)
  await sleep(900)
  const afterIdx = await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=immerse-track]')
    return { top: Math.round(el.scrollTop), h: el.clientHeight,
             counter: document.querySelector('[data-test=immerse-counter]')?.textContent?.trim() }
  })()`)
  s.check('滑到第二张后 scrollTop 对齐到一屏高',
    afterIdx && Math.abs(afterIdx.top - afterIdx.h) <= 4, JSON.stringify(afterIdx))
  s.check('计数器变成第 2 张',
    afterIdx && afterIdx.counter && afterIdx.counter.startsWith('2'),
    afterIdx?.counter)
  const afterTitle = await s.evaluate(`document.querySelectorAll('[data-test=immerse-title]')[1]?.textContent?.trim()`)
  s.check('第二张确实是另一条笔记（标题不同）',
    !!beforeTitle && !!afterTitle && beforeTitle !== afterTitle,
    `"${beforeTitle}" vs "${afterTitle}"`)

  /* ---------- 5. 卡片内容 ---------- */
  const card = await s.evaluate(`(() => {
    const c = document.querySelectorAll('[data-test=immerse-slide]')[1]
    if (!c) return null
    const pic = c.querySelector('[data-test=immerse-pic]')
    const brief = c.querySelector('[data-test=immerse-brief]')
    return {
      hasPic: !!pic,
      picW: pic ? Math.round(pic.getBoundingClientRect().width) : 0,
      picH: pic ? Math.round(pic.getBoundingClientRect().height) : 0,
      fit: pic ? getComputedStyle(pic).objectFit : '',
      hasAuthor: !!c.querySelector('[data-test=immerse-author]'),
      briefLen: brief ? brief.textContent.trim().length : -1,
      clamp: brief ? getComputedStyle(brief).webkitLineClamp : 'none',
      openBtn: !!c.querySelector('[data-test=immerse-open]'),
    }
  })()`)
  s.check('卡片有封面图', card?.hasPic, JSON.stringify(card))
  s.check('图有实际尺寸', card && card.picW > 60 && card.picH > 60, JSON.stringify(card))
  s.check('图 object-fit=contain（不裁图）', card?.fit === 'contain', card?.fit)
  s.check('卡片有作者入口', card?.hasAuthor, '')
  s.check('摘要限三行（卡片高度才可控）', card?.clamp === '3', card?.clamp)
  s.check('有「查看全文与评论」入口', card?.openBtn, '')

  /* ---------- 6. 不挂底部 tab 栏（一屏一张的构图） ---------- */
  s.check('沉浸流不挂底部 tab 栏',
    !(await exists('tab-bar')), 'tab-bar 在沉浸流里出现了')
  s.check('html 上没有 data-tabbar 标记（留白跟着可见性走）',
    !(await s.evaluate(`document.documentElement.dataset.tabbar === 'on'`)), '标记还在')

  /* ---------- 7. 「查看全文」是导航 ---------- */
  await click('immerse-open')
  await s.waitFor(`location.hash.startsWith('#/note/')`, '跳到详情页', 15000)
  s.check('点「查看全文与评论」跳到那条笔记的详情页',
    await s.evaluate(`location.hash.startsWith('#/note/')`), await s.evaluate(`location.hash`))

  /* ---------- 8. 回到沉浸流后位置保持 ---------- */
  await s.goto(BASE + '/#/immerse')
  await s.waitFor(`document.querySelector('[data-test=immerse-slide]')`, '重回沉浸流', 25000)
  s.check('从详情返回后仍能进沉浸流', (await all('immerse-slide')).length > 0,
    'n=' + (await all('immerse-slide')).length)

  /* ---------- 9. 连续下滑能加载更多 ---------- */
  const n1 = (await all('immerse-slide')).length
  for (let k = 0; k < 4; k++) {
    await s.evaluate(`(() => {
      const el = document.querySelector('[data-test=immerse-track]')
      el.scrollTop = el.scrollHeight
    })()`)
    await sleep(700)
  }
  await sleep(1200)
  const n2 = (await all('immerse-slide')).length
  s.check('连续下滑会加载更多卡片', n2 > n1, `${n1} -> ${n2}`)

  /* ---------- 10. 触摸目标 ---------- */
  const targets = await s.evaluate(`(() => {
    const pick = ['[data-test=immerse-back]', '[data-test=immerse-open]']
    const out = []
    for (const q of pick) {
      const el = document.querySelector(q)
      if (!el) { out.push(q + ' MISSING'); continue }
      const r = el.getBoundingClientRect()
      out.push(q + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
    }
    return out
  })()`)
  s.check('沉浸流的按钮热区都 ≥40px（P13）',
    targets.every((t) => !t.includes('MISSING') && Number(t.split(' ')[1].split('x')[0]) >= 40),
    JSON.stringify(targets))
  const icons = await s.evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-test=immerse-page] i.van-icon')]
    return els.filter((e) => getComputedStyle(e, '::before').content === 'none').length
  })()`)
  s.check('van-icon 都有字形（名字写错会渲染成空心圆）', icons === 0, 'empty=' + icons)

  /* ---------- 11. P53：卡上互动行的结构与热区 ---------- */
  token53 = (await s.evaluate(`localStorage.getItem('xk_token') || ''`)) || ''
  const disc11 = token53 ? await api('/feed/discover?page=1&size=6', { token: token53 }) : null
  s.check('P53 前置：拿到登录态与发现流（API 侧）',
    !!token53 && /^\d+$/.test(String(disc11?.data?.list?.[0]?.id ?? '')),
    `token=${!!token53} first=${disc11?.data?.list?.[0]?.id}`)
  const acts11 = await actsOf(0)
  s.check('P53 首卡有赞按钮', !!acts11?.like && acts11.like.box !== 'missing', JSON.stringify(acts11?.like))
  s.check('P53 首卡有藏按钮', !!acts11?.coll && acts11.coll.box !== 'missing', JSON.stringify(acts11?.coll))
  s.check('P53 首卡评论入口链接到那条笔记',
    !!acts11?.comm && /\/note\/\d+/.test(acts11.comm.href), JSON.stringify(acts11?.comm))
  s.check('P53 三个互动键热区 ≥40×40（P13）',
    acts11 && [acts11.like, acts11.coll, acts11.comm].every((x) => {
      if (!x || x.box === 'missing') return false
      const [w, h] = x.box.split('x').map(Number)
      return w >= 40 && h >= 40
    }), JSON.stringify(acts11 && [acts11.like?.box, acts11.coll?.box, acts11.comm?.box]))
  s.check('P53 互动图标都有字形（P13 全站扫描的同款断言）',
    acts11?.emptyIcons === 0, 'empty=' + acts11?.emptyIcons)
  s.check('P53 计数都是数字', acts11?.nums?.every?.((n) => Number.isFinite(n)),
    JSON.stringify(acts11?.nums))

  /* ---------- 12. P53：点赞/收藏真的切换（复位在前，断言增量） ---------- */
  // 纪律（P15）：先 unlike/uncollect 复位，再重新拉发现流确定「第一张」是谁 ——
  // 复位会改热度分（P23 公式），复位前的顺序不可信；复位后点赞只会加分，
  // 第一张不会在用例中途被换掉。
  await reset53()
  const disc12 = await api('/feed/discover?page=1&size=6', { token: token53 })
  note53 = String(disc12?.data?.list?.[0]?.id ?? '')
  s.check('P53 前置：复位后重取第一张', /^\d+$/.test(note53), note53)
  await s.goto(BASE + '/#/immerse')
  await s.waitFor(`document.querySelector('[data-test=immerse-slide]')`, '重进沉浸流', 20000)
  const acts12 = await actsOf(0)
  s.check('P53 复位后首卡未赞未藏且计数与 API 一致',
    acts12?.like?.pressed === 'false' && acts12?.coll?.pressed === 'false'
      && acts12.like.num === Number(disc12?.data?.list?.[0]?.likeCount)
      && acts12.coll.num === Number(disc12?.data?.list?.[0]?.collectCount),
    `card=${JSON.stringify([acts12?.like?.pressed, acts12.like?.num, acts12?.coll?.pressed, acts12.coll?.num])}`)

  // 点赞 → liked=true + 计数 +1（P8：计数是 Redis 权威，立即可见，无 30s 滞后）
  await s.evaluate(`document.querySelector('[data-test=immerse-slide]')?.querySelector('[data-test=immerse-like]')?.click()`)
  const likeOn = await wOK(`(() => {
    const b = document.querySelector('[data-test=immerse-slide]')?.querySelector('[data-test=immerse-like]')
    return !!b && b.getAttribute('aria-pressed') === 'true'
      && Number(b.querySelector('.num')?.textContent) === ${acts12.like.num + 1}
  })()`, '点赞生效', 8000)
  s.check('P53 点赞后 liked=true 且计数 +1', likeOn, '')
  await s.evaluate(`document.querySelector('[data-test=immerse-slide]')?.querySelector('[data-test=immerse-like]')?.click()`)
  const likeOff = await wOK(`(() => {
    const b = document.querySelector('[data-test=immerse-slide]')?.querySelector('[data-test=immerse-like]')
    return !!b && b.getAttribute('aria-pressed') === 'false'
      && Number(b.querySelector('.num')?.textContent) === ${acts12.like.num}
  })()`, '取消点赞回弹', 8000)
  s.check('P53 再点一次回到未赞且计数还原', likeOff, '')

  // 收藏同型
  await s.evaluate(`document.querySelector('[data-test=immerse-slide]')?.querySelector('[data-test=immerse-collect]')?.click()`)
  const collOn = await wOK(`(() => {
    const b = document.querySelector('[data-test=immerse-slide]')?.querySelector('[data-test=immerse-collect]')
    return !!b && b.getAttribute('aria-pressed') === 'true'
      && Number(b.querySelector('.num')?.textContent) === ${acts12.coll.num + 1}
  })()`, '收藏生效', 8000)
  s.check('P53 收藏后 collected=true 且计数 +1', collOn, '')
  await s.evaluate(`document.querySelector('[data-test=immerse-slide]')?.querySelector('[data-test=immerse-collect]')?.click()`)
  const collOff = await wOK(`(() => {
    const b = document.querySelector('[data-test=immerse-slide]')?.querySelector('[data-test=immerse-collect]')
    return !!b && b.getAttribute('aria-pressed') === 'false'
      && Number(b.querySelector('.num')?.textContent) === ${acts12.coll.num}
  })()`, '取消收藏回弹', 8000)
  s.check('P53 再点一次回到未藏且计数还原', collOff, '')

  /* ---------- 13. P53：键盘 ↑↓ / PageUp/PageDown 切卡 ---------- */
  await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=immerse-track]')
    el.scrollTop = 0
    el.focus()
    return document.activeElement === el
  })()`)
  await sleep(400)
  const kb1 = await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=immerse-track]')
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    return document.activeElement === el
  })()`)
  const kbDown = await wOK(`(() => {
    const el = document.querySelector('[data-test=immerse-track]')
    const c = document.querySelector('[data-test=immerse-counter]')?.textContent?.trim() ?? ''
    return Math.abs(el.scrollTop - el.clientHeight) <= 6 && c.startsWith('2')
  })()`, '键盘下移到第二张', 8000)
  s.check('P53 ArrowDown 切到第二张（滚动位 + 计数）', kb1 && kbDown, `focus=${kb1} moved=${kbDown}`)
  const kb2 = await s.evaluate(`(() => {
    document.querySelector('[data-test=immerse-track]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    return true
  })()`)
  const kbUp = await wOK(`(() => {
    const el = document.querySelector('[data-test=immerse-track]')
    const c = document.querySelector('[data-test=immerse-counter]')?.textContent?.trim() ?? ''
    return el.scrollTop <= 6 && c.startsWith('1')
  })()`, '键盘上移回第一张', 8000)
  s.check('P53 ArrowUp 切回第一张', kb2 && kbUp, '')

  /* ---------- 14. P53：深链 /immerse?note=<id> 直接定位 ---------- */
  const disc14 = await api('/feed/discover?page=1&size=6', { token: token53 })
  const target14 = String(disc14?.data?.list?.[2]?.id ?? '')
  s.check('P53 前置：深链目标 = 发现流第 3 张', /^\d+$/.test(target14), target14)
  await s.goto(BASE + `/#/immerse?note=${target14}`)
  await s.waitFor(`document.querySelector('[data-test=immerse-slide]')`, '深链进入沉浸流', 20000)
  const deepOk = await wOK(`(() => {
    const el = document.querySelector('[data-test=immerse-track]')
    if (!el) return false
    const c = document.querySelector('[data-test=immerse-counter]')?.textContent?.trim() ?? ''
    return c.startsWith('3') && Math.abs(el.scrollTop - el.clientHeight * 2) <= 8
  })()`, '深链定位到第 3 张', 12000)
  s.check('P53 深链进来直接停在第 3 张（计数 + 滚动位，契约钉过 immerse 与 discover 同序）',
    deepOk, target14)

  /* ---------- 15. P53：详情页 → 沉浸入口（桌面 pane-nav 文字链接） ---------- */
  // ⚠️ 显式切 1280：默认 CDP 窗口 innerWidth=512 是移动宽度（实测），
  // 赌默认窗口宽度必翻车 —— desktop 断言在移动视口里量到的是隐藏态。
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  const note15 = String(disc14?.data?.list?.[0]?.id ?? note53)
  await s.goto(BASE + `/#/note/${note15}`)
  await s.waitFor(`document.querySelector('[data-test=note-detail-content]')`, '详情渲染', 20000)
  const dLink = await s.evaluate(`(() => {
    const a = document.querySelector('[data-test=detail-immerse-desktop]')
    const r = a?.getBoundingClientRect()
    return { href: a?.getAttribute('href') || '', w: r ? Math.round(r.width) : 0,
             visible: !!r && r.width > 0 && r.height > 0,
             mobileIconHidden: (() => {
               const m = document.querySelector('[data-test=detail-immerse]')
               if (!m) return true
               const mr = m.getBoundingClientRect()
               return mr.width === 0
             })() }
  })()`)
  s.check('P53 详情页有桌面沉浸入口（可见，不是只在 DOM 里）',
    !!dLink?.visible && dLink.w >= 60, JSON.stringify(dLink))
  // RouterLink 的 href 带 # 前缀（hash 路由），别拿裸路径去比
  s.check('P53 入口链接带 note=<当前id> 深链参数',
    dLink?.href === '#/immerse?note=' + note15, dLink?.href)
  s.check('P53 桌面上移动端小图标是隐藏的（两个入口不抢一件事）',
    dLink?.mobileIconHidden, '')
  await s.evaluate(`document.querySelector('[data-test=detail-immerse-desktop]')?.click()`)
  await s.waitFor(`location.hash.startsWith('#/immerse?note=')`, '跳到沉浸流', 15000)
  s.check('P53 点详情入口落到沉浸流且深链就是这篇笔记',
    await s.evaluate(`location.hash === '#/immerse?note=${note15}'`),
    await s.evaluate(`location.hash`))
  const landedOk = await wOK(`(() => {
    const c = document.querySelector('[data-test=immerse-counter]')?.textContent?.trim() ?? ''
    return c.startsWith('1')
  })()`, '深链定位到第 1 张', 10000)
  s.check('P53 从详情入口进来就停在那张（本例是发现流第 1 张）', landedOk, '')

  /* ---------- 16. P53：详情页入口（移动端顶栏小图标） ---------- */
  await s.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: true })
  await s.goto(BASE + `/#/note/${note15}`)
  await s.waitFor(`document.querySelector('[data-test=note-detail-content]')`, '移动详情渲染', 20000)
  const mLink = await s.evaluate(`(() => {
    const a = document.querySelector('[data-test=detail-immerse]')
    const r = a?.getBoundingClientRect()
    const cs = a ? getComputedStyle(a) : null
    return { visible: !!r && r.width > 0 && r.height > 0,
             w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
             href: a?.getAttribute('href') || '',
             desktopLinkHidden: (() => {
               const d = document.querySelector('[data-test=detail-immerse-desktop]')
               if (!d) return true
               const dr = d.getBoundingClientRect()
               return dr.width === 0
             })() }
  })()`)
  s.check('P53 移动详情顶栏有沉浸小图标（≥40px 热区）',
    !!mLink?.visible && mLink.w >= 40 && mLink.h >= 40, JSON.stringify(mLink))
  s.check('P53 移动端小图标同样带深链参数（href 含 # 前缀）',
    mLink?.href === '#/immerse?note=' + note15, mLink?.href)
  s.check('P53 移动端桌面文字入口是隐藏的', mLink?.desktopLinkHidden, '')
  await s.send('Emulation.clearDeviceMetricsOverride')

} catch (e) {
  crashed = e
  console.error('  用例执行异常：', e)
} finally {
  // P53 清理：把造的赞/收藏复位（幂等），别把 fixture 留在已赞/已藏状态
  try { await reset53() } catch (e) { console.error('  P53 清理失败：', e) }
  const allOk = await s.close()
  console.log(crashed ? `异常：${crashed.message}` : '')
  process.exit(crashed || !allOk ? 1 : 0)
}