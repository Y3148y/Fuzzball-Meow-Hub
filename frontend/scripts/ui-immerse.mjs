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

} catch (e) {
  crashed = e
  console.error('  用例执行异常：', e)
} finally {
  const allOk = await s.close()
  console.log(crashed ? `异常：${crashed.message}` : '')
  process.exit(crashed || !allOk ? 1 : 0)
}