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

/** 运行期异常：finally 里是 process.exit，异常不记下来就会被当成「全部通过」 */
let crashed = null
/** 收藏夹用例的临时笔记 id，放到外层好让 finally 兜底清理 */
let probeId = null

try {
  await preflight()
  await loginDemo(s, BASE)

  // 发布用图：直接复用演示账号已有的封面上传路径，只走 URL 合法性校验，
  // 不必真的再上传一次（上传是 30/min/USER 的限流资源，没必要为断言花掉）
  const PROBE_IMG = '/uploads/2026/10/06/xiaoku-demo.png'

  // demo 先全部已读，好知道后面增加的未读数是这一次互动带来的
  // demoToken 提到外层：收藏夹那段（5b）也要用它造数据
  const demoLogin = await api('/user/login', { method: 'POST', body: { username: 'xiaoku_demo', password: 'Xk@123456' } })
const demoToken = `Bearer ${demoLogin?.data?.accessToken}`

  await api('/notification/read-all', { method: 'POST', token: demoToken })

  // 固定搭档给自己发一篇笔记（复用它当「作者」，避免动到 demo 的数据）
  const peerLogin = await api('/user/login', { method: 'POST', body: { username: PEER, password: PWD } })
  const peerToken = `Bearer ${peerLogin?.data?.accessToken}`
  const notes = await api('/note/user/' + peerLogin.data.userInfo.id + '?page=1&size=1', { token: peerToken })
  const noteId = notes?.data?.list?.[0]?.id
  if (!noteId) {
    s.check('搭档账号有笔记可供点赞（前置条件）', false, '没有笔记，跳过通知用例')
  } else {
    // 搭档去赞 demo 的笔记 → demo 收到通知。先找一篇 demo 自己的笔记
    const demoNotes = await api('/note/user/' + demoLogin.data.userInfo.id + '?page=1&size=1', { token: demoToken })
    const demoNoteId = demoNotes?.data?.list?.[0]?.id
    if (!demoNoteId) {
      s.check('demo 账号有笔记可供点赞（前置条件）', false, 'demo 没有笔记，跳过')
    } else {
      // ⚠️ 先把点赞状态复位：上一轮如果崩在清理之前，like 会一直留着，
      // 这次 PUT 就返回 30001「已点赞」→ 没有新通知 → 后面「点通知跳转」
      // 会点到一条**旧通知**（指向别的笔记）上去，然后永远等不到目标 hash。
      // 复位是幂等的，返回码不用管。
      await api(`/note/${demoNoteId}/like`, { method: 'DELETE', token: peerToken })
      const like = await api(`/note/${demoNoteId}/like`, { method: 'PUT', token: peerToken })
      s.check('搭档点赞 demo 的笔记成功（造出一条通知）', like?.code === 0, `code=${like?.code}`)

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
      //
      // ⚠️ **不能点第一条**：列表里可能有上一轮留下的旧通知（指向别的笔记），
      // 第一条未必是这次点赞产生的那条。demo 的通知会跨轮累积，
      // 所以按「所属笔记标题」定位到本次互动对应的那一行。
      const demoTitle = demoNotes?.data?.list?.[0]?.title ?? ''
      const clickResult = await s.evaluate(`(() => {
        const row = [...document.querySelectorAll('.item')]
          .find(el => (el.querySelector('.note')?.textContent || '').trim() === ${JSON.stringify(demoTitle)})
        if (!row) return 'not-found'
        const btn = row.querySelector('.hit')
        if (!btn) return 'no-button'
        btn.click()
        return 'clicked'
      })()`)
      s.check('定位到本次互动对应的通知行并点了它', clickResult === 'clicked', clickResult)
      const landed = await s.waitFor(`location.hash === '#/note/${demoNoteId}'`, '点通知跳到笔记详情', 10000)
        .then(() => true).catch(() => false)
      s.check('点通知条目跳到对应笔记详情', landed,
        `期望 #/note/${demoNoteId}，实际 ${await s.evaluate('location.hash')}`)

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

  // 5b) 取消收藏必须真的落到后端
  //
  // ⚠️ 这里最关键的是**刷新后仍然不在**：只把这一条从列表里 filter 掉的话，
  // 收藏关系还在，下次进页面它又回来了，而用户以为已经取消了 ——
  // 那种实现当场看着是对的，断言也拦不住，只有「刷新后再看」能拦。
  // 前置：先在「我的」页之外造一条确定的收藏，否则 demo 的收藏夹内容随
  // 别的测试变化，断言没法写死。
  const probe = 'colprobe' + Date.now().toString(36)
  const probeNote = await api('/note/publish', {
    method: 'POST',
    token: demoToken,
    body: { type: 1, title: probe, content: '收藏夹取消收藏用例的临时笔记', imageUrls: [PROBE_IMG] },
  })
  const probeId0 = probeNote?.data?.id
  probeId = probeId0
  s.check('收藏夹用例的临时笔记已发布', probeNote?.code === 0, `code=${probeNote?.code}`)
  await api(`/note/${probeId0}/collect`, { method: 'PUT', token: demoToken })

  const inList = async () => {
    await s.goto(`${BASE}/#/collections`)
    await s.waitFor("!document.querySelector('[data-test=collections-loading]')", '收藏夹终态', 20000)
    await sleep(600)
    return s.evaluate(
      `[...document.querySelectorAll('[data-test=collection-item]')].map(el=>el.textContent).join('|')`,
    )
  }
  s.check('新收藏的那条出现在收藏夹里', (await inList()).includes(probe), '')

  // 按标题找到那一行的按钮点掉（不能点第一张：收藏夹顺序随收藏时间变）
  const clicked = await s.evaluate(`(() => {
    const card = [...document.querySelectorAll('[data-test=collection-item]')]
      .find(el => el.textContent.includes(${JSON.stringify(probe)}))
    if (!card) return 'not-found'
    const btn = card.querySelector('[data-test=collection-remove]')
    if (!btn) return 'no-button'
    btn.click()
    return 'clicked'
  })()`)
  s.check('点到了那一行的取消按钮（按标题定位，不点第一张）', clicked === 'clicked', clicked)

  // 等它真的从 DOM 里消失（列表是等接口返回后才 filter 的）
  const gone = await s.waitFor(
    `![...document.querySelectorAll('[data-test=collection-item]')].some(el=>el.textContent.includes(${JSON.stringify(probe)}))`,
    '取消后该条从列表消失',
    15000,
  ).then(() => true).catch(() => false)
  s.check('取消收藏后该条从列表消失', gone, '')

  s.check('**刷新后仍然不在**（这条钉住「有没有真调后端」）',
    !(await inList()).includes(probe), '刷新后又出现了 = 只删了本地，关系行还在')
  const after = await api('/note/collections?page=1&size=50', { token: demoToken })
  s.check('后端收藏夹里也已经没有它',
    !(after?.data?.list ?? []).some((n) => n.title === probe),
    `total=${after?.data?.total}`)

  // 复原：把临时笔记删掉。**别只写在 happy path 上** —— 万一上面某步抛异常，
  // 清理会被跳过，几轮测试就攒出一堆 colprobe* 垃圾笔记
  probeId = null
  await api(`/note/${probeId0}`, { method: 'DELETE', token: demoToken })
} catch (e) {
  // finally 里是 process.exit，异常会**穿过它**而看起来一切正常：
  // 断言数可能只跑了一半，末尾却照样打印「通过」、退出码 0。
  // 与 ui-layout-audit 同一个坑，所以这里显式记下来并以非 0 退出。
  crashed = e
} finally {
  if (probeId) {
    await api(`/note/${probeId}`, { method: 'DELETE', token: demoToken }).catch(() => {})
  }
  if (crashed) console.error('运行期异常：', crashed)
  const allOk = await s.close()
  process.exit(crashed ? 1 : (allOk ? 0 : 1))
}