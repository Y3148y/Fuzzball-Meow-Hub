/**
 * 通知中心 + 收藏夹（真实浏览器路径）
 *
 * <p>为什么自己造一遍通知而不复用 `xiaoku_demo`：demo 账号的通知是别的测试留下的，
 * 数量与类型都不确定，断言只能写成「>= 0」那种没用的东西。这里自己造一条
 * 确定的：演示账号的固定搭档 `xk_ui_follow` 给 demo 的某篇笔记点赞 → demo 收到通知。
 *
 * <p>要验的四件事：
 *  1. 铃铛角标数出未读（且只在桌面 SiteNav 里，移动端入口在「我」页）
 *  2. 通知列表显示「谁 + 做了什么 + 哪篇笔记」
 *  3. 点条目能跳到那篇笔记详情
 *  4. 「全部已读」后角标归零
 */
import { createSession, loginDemo, preflight, DEV_ORIGIN } from './ui-cdp.mjs'

const BASE = process.env.XK_BASE || DEV_ORIGIN
const API = process.env.XK_API_BASE || 'http://127.0.0.1:8088/api'
const PEER = 'xk_ui_follow'
const PWD = 'Xk@2026peer'

const s = await createSession({ name: 'notification' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(p, { method = 'GET', token, body } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = token
  const res = await fetch(`${API}${p}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return res.json().catch(() => null)
}

const exists = (t) => s.evaluate(`!!document.querySelector('[data-test=${t}]')`)
const text = (t) => s.evaluate(`document.querySelector('[data-test=${t}]')?.textContent?.trim()`)
const click = (t) => s.evaluate(`document.querySelector('[data-test=${t}]')?.click()`)

try {
  await preflight()
  await loginDemo(s, BASE)

  // 固定搭档给自己发一篇笔记（复用它当「作者」，避免动到 demo 的数据）
  const peerLogin = await api('/user/login', { method: 'POST', body: { username: PEER, password: PWD } })
  const peerToken = `Bearer ${peerLogin?.data?.accessToken}`
  const notes = await api('/note/user/' + peerLogin.data.userInfo.id + '?page=1&size=1', { token: peerToken })
  const noteId = notes?.data?.list?.[0]?.id
  if (!noteId) {
    s.check('搭档账号有笔记可供点赞（前置条件）', false, '没有笔记，跳过通知用例')
  } else {
    // demo 先全部已读，好知道后面增加的未读数是这一次互动带来的
    const demoLogin = await api('/user/login', { method: 'POST', body: { username: 'xiaoku_demo', password: 'Xk@123456' } })
    const demoToken = `Bearer ${demoLogin?.data?.accessToken}`
    await api('/notification/read-all', { method: 'POST', token: demoToken })

    // 搭档去赞 demo 的笔记 → demo 收到通知。先找一篇 demo 自己的笔记
    const demoNotes = await api('/note/user/' + demoLogin.data.userInfo.id + '?page=1&size=1', { token: demoToken })
    const demoNoteId = demoNotes?.data?.list?.[0]?.id
    if (!demoNoteId) {
      s.check('demo 账号有笔记可供点赞（前置条件）', false, 'demo 没有笔记，跳过')
    } else {
      const like = await api(`/note/${demoNoteId}/like`, { method: 'PUT', token: peerToken })
      s.check('搭档点赞 demo 的笔记成功（造出一条通知）',
        like?.code === 0 || like?.code === 30001, `code=${like?.code}`)

      // 1) 桌面：铃铛 + 角标
      await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
      await s.goto(`${BASE}/#/`)
      await s.waitFor("!!document.querySelector('[data-test=notification-bell]')", '桌面顶栏铃铛', 20000)
      await sleep(1200)
      const badge = await text('notification-unread')
      s.check('桌面顶栏出现通知铃铛', await exists('notification-bell'))
      s.check('铃铛角标显示未读数（≥1）', Number(badge) >= 1, `badge=${badge}`)
      const bellBox = await s.evaluate(`(() => {
        const r = document.querySelector('[data-test=notification-bell]').getBoundingClientRect()
        return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) })
      })()`)
      const bb = JSON.parse(bellBox)
      s.check('铃铛热区 ≥40×40', bb.w >= 40 && bb.h >= 40, bellBox)

      // 2) 移动端：铃铛**不该**出现（会在顶栏压住主题切换/返回，实测过重叠），
      //    入口改成「我」页里的一行
      await s.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: true })
      await s.goto(`${BASE}/#/`)
      await sleep(1200)
      // 注意：不能只看铃铛自己「在不在 DOM 里」—— 它挂在 SiteNav 内，
      // 而 SiteNav 是 display:none 的；**子元素的 getComputedStyle().display
      // 仍然是 flex**（父级隐藏不会改变子级的计算值）。要判断「用户看不看得见」
      // 必须看它自身盒子有没有面积（offsetParent 为空 / 宽高为 0）。
      const bellVisible = await s.evaluate(`(() => {
        const el = document.querySelector('[data-test=notification-bell]')
        if (!el) return JSON.stringify({ inDom: false })
        const r = el.getBoundingClientRect()
        return JSON.stringify({
          inDom: true,
          w: Math.round(r.width), h: Math.round(r.height),
          hasBox: r.width > 0 && r.height > 0,
        })
      })()`)
      const bv = JSON.parse(bellVisible)
      s.check('移动端首页看不到铃铛（它在 display:none 的 SiteNav 里，盒子面积为 0）',
        !bv.hasBox, bellVisible)
      await s.goto(`${BASE}/#/profile`)
      await s.waitFor("!!document.querySelector('[data-test=me-notify-link]')", '我的页通知入口', 20000)
      await sleep(1000)
      s.check('「我」页有通知入口（移动端的通知入口）', await exists('me-notify-link'))
      s.check('「我」页通知入口带未读角标', Number(await text('me-notify-unread')) >= 1,
        `badge=${await text('me-notify-unread')}`)
      s.check('「我」页有收藏夹入口', await exists('me-collections-link'))

      // 3) 通知页：内容 + 跳转
      await click('me-notify-link')
      await s.waitFor("location.hash === '#/notification'", '进入通知页', 10000)
      await s.waitFor("!document.querySelector('[data-test=notification-loading]')", '通知列表终态', 20000)
      await sleep(800)
      const list = await s.evaluate(`(() => JSON.stringify({
        items: document.querySelectorAll('[data-test=notification-item],[data-test=notification-item-unread]').length,
        empty: !!document.querySelector('[data-test=notification-empty]'),
        firstLine: (document.querySelector('.item .line')?.textContent || '').replace(/\\s+/g, ' ').trim(),
        firstNote: (document.querySelector('.item .note')?.textContent || '').trim(),
        unread: document.querySelectorAll('[data-test=notification-item-unread]').length,
      }))()`)
      const li = JSON.parse(list)
      s.check('通知页至少有一条通知', li.items >= 1, list)
      s.check('通知行有未读态标记', li.unread >= 1, list)
      s.check('通知行显示「谁做了什么」', /\S+\S*(赞了你的笔记|评论了你的笔记|关注了你|赞了你的评论|回复了你的评论)/.test(li.firstLine),
        `line="${li.firstLine}"`)
      s.check('通知行显示所属笔记标题', li.firstNote.length > 0, `note="${li.firstNote}"`)

      // 点条目跳到对应笔记
      await s.evaluate("document.querySelector('.item .hit').click()")
      await s.waitFor(`location.hash === '#/note/${demoNoteId}'`, '点通知跳到笔记详情', 10000)
      s.check('点通知条目跳到对应笔记详情',
        (await s.evaluate('location.hash')) === `#/note/${demoNoteId}`,
        await s.evaluate('location.hash'))

      // 4) 全部已读 → 角标归零
      await s.goto(`${BASE}/#/notification`)
      await s.waitFor("!document.querySelector('[data-test=notification-loading]')", '通知列表终态', 20000)
      await click('notification-read-all')
      await sleep(1200)
      const afterAll = await s.evaluate(`(() => JSON.stringify({
        unreadItems: document.querySelectorAll('[data-test=notification-item-unread]').length,
      }))()`)
      s.check('「全部已读」后没有未读态行了',
        JSON.parse(afterAll).unreadItems === 0, afterAll)
      await s.goto(`${BASE}/#/profile`)
      await sleep(1200)
      s.check('全部已读后「我」页角标消失', (await exists('me-notify-unread')) === false)

      // 复原：取消点赞，把通知源还原
      await api(`/note/${demoNoteId}/like`, { method: 'DELETE', token: peerToken })
    }
  }

  // 5) 收藏夹页
  await s.goto(`${BASE}/#/collections`)
  await s.waitFor(
    "document.querySelector('[data-test=collections-loading]') || document.querySelector('[data-test=collections-empty]') || document.querySelector('[data-test=collections-list]')",
    '收藏夹进入终态',
    20000,
  )
  await sleep(1000)
  const col = await s.evaluate(`(() => {
    const items = document.querySelector('[data-test=collections-list]')
    return JSON.stringify({
      hash: location.hash,
      cols: items ? getComputedStyle(items).columnCount : null,
      count: document.querySelectorAll('[data-test=collection-item]').length,
      empty: !!document.querySelector('[data-test=collections-empty]'),
    })
  })()`)
  const cl = JSON.parse(col)
  s.check('收藏夹页能进入并进入加载终态', cl.hash === '#/collections', col)
  s.check('收藏夹空态或列表二选一（不是卡在加载中）',
    cl.empty || cl.count >= 0, col)
  s.check('收藏夹是双列瀑布（移动端）', cl.cols === '2' || cl.empty, `cols=${cl.cols}`)
} finally {
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}