/**
 * 私信（P22）：会话列表 + 聊天页
 *
 * <p>用两个常驻 fixture 互发（xk_ui_smoke / xk_ui_follow，口令分别是
 * Xk@123456 / Xk@2026peer）。**不注册新账号** —— register 10/min/IP，
 * 全量连跑时前面几组刚把桶用掉。
 *
 * <p>⚠️ 两个 fixture 之间**可能已经有会话**（本组反复跑，历史消息会累积）。
 * 所以凡是要断言「列表里有几条」「历史有几条」的地方，一律用
 * 「本次操作前后的差值」而不是绝对值 —— 写死绝对值的话，
 * 第二次跑就全红，而症状与代码无关。
 */
import { createSession, loginDemo, preflight, DEV_ORIGIN } from './ui-cdp.mjs'

const BASE = process.env.XK_BASE || DEV_ORIGIN
const API = process.env.XK_API_BASE || 'http://127.0.0.1:8088/api'
const PWD_PEER = 'Xk@2026peer'

const s = await createSession({ name: 'message' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(p, { method = 'GET', token, body } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = 'Bearer ' + token
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
const all = (t) => s.evaluate(`Array.from(document.querySelectorAll('[data-test=${t}]')).map(e => e.textContent.trim())`)

/** ⚠️ 入口必须 try/catch/finally + crashed 标志（见 AGENTS P15 段记的两个坑） */
let crashed = null
try {
  await preflight()

  /* ---------- 1. 两个 fixture 互发私信（Node 侧先打底，UI 才有的可看） ---------- */

  const loginSmoke = await api('/user/login', { method: 'POST', body: { username: 'xk_ui_smoke', password: 'Xk@123456' } })
  const loginFollow = await api('/user/login', { method: 'POST', body: { username: 'xk_ui_follow', password: PWD_PEER } })
  s.check('两个 fixture 都能登录', loginSmoke?.code === 0 && loginFollow?.code === 0,
    `smoke=${loginSmoke?.code} follow=${loginFollow?.code}`)
  if (loginSmoke?.code !== 0 || loginFollow?.code !== 0) throw new Error('fixture 登录失败')

  const tSmoke = loginSmoke.data.accessToken
  const tFollow = loginFollow.data.accessToken
  const idSmoke = loginSmoke.data.userInfo.id
  const idFollow = loginFollow.data.userInfo.id

  const stamp = Date.now().toString(36)
  // 本轮造的消息都带这个唯一前缀，finally 里按标题删不掉（私信没法删），
  // 所以这里刻意用**计数差**而不是「找那条消息」来断言，避免历史累积影响
  const msgA = `P22 CDP ${stamp} 甲`
  const msgB = `P22 CDP ${stamp} 乙`

  const send1 = await api('/message/send', { method: 'POST', token: tFollow, body: { toUserId: idSmoke, content: msgA } })
  s.check('follow→smoke 发消息成功', send1?.code === 0, `code=${send1?.code} ${send1?.message ?? ''}`)
  const send2 = await api('/message/send', { method: 'POST', token: tSmoke, body: { toUserId: idFollow, content: msgB } })
  s.check('smoke→follow 回消息成功', send2?.code === 0, `code=${send2?.code}`)
  s.check('两个方向落在同一个会话（规范化生效）',
    send1?.data?.sessionId === send2?.data?.sessionId,
    `${send1?.data?.sessionId} vs ${send2?.data?.sessionId}`)

  /* ---------- 2. 切到「有会话」的那个身份，再验会话列表与聊天页 ---------- */

  // ⚠️ **顺序很关键：换身份必须在任何 loginDemo 之前做，且要用一次完整的
  // 页面导航来完成**。
  //
  // `token.ts` 的 accessToken 是**模块级 ref**，模块加载时从 localStorage
  // 读一次就固定了 —— 应用已启动后再改 localStorage，内存里那份不变，
  // axios 仍然带着**旧身份**的 token 发请求，于是会话列表「必然是空的」。
  // 而在 evaluate 里调 `location.reload()` 会销毁执行上下文，
  // 紧接着的 goto 会和这次重载打架（实测落在空列表上）。
  //
  // 可靠做法就是诊断脚本验证过的那条：会话还在 about:blank 时就
  // 先 goto 应用域名 → 写 token → 再 goto 目标页。此时是**首次**应用启动，
  // 模块级 ref 从一开始就是新身份。
  //
  // 另外 `s.goto('#/login')` 在已登录时会被 guestOnly 守卫弹回 '#/'，
  // 所以这里 goto 的是 '/'，不依赖守卫行为。
  await s.goto(BASE + '/')
  await s.waitFor(`location.origin === ${JSON.stringify(BASE)}`, '会话到应用域名', 20000)
  await s.evaluate(`
    localStorage.setItem('xk_token', ${JSON.stringify(tSmoke)});
    localStorage.setItem('xk_refresh_token', ${JSON.stringify(tSmoke)});
  `)
  // 用一次带 hash 的**全量导航**让应用重新启动（不是 reload）
  await s.goto(BASE + '/#/profile')
  await s.waitFor("document.querySelector('[data-test=me-message-link]')", '「我的」页加载', 20000)
  s.check('「我的」页有私信入口', await exists('me-message-link'), 'me-message-link 不存在')

  await s.goto(BASE + '/#/message')
  await s.waitFor("document.querySelector('[data-test=session-row], [data-test=session-empty]')", '会话页终态', 20000)
  s.check('私信会话页可打开', await exists('session-list'), 'session-list 没渲染')
  s.check('会话列表有会话行（有身份才看得到）',
    (await s.evaluate(`document.querySelectorAll('[data-test=session-row]').length`)) > 0,
    await s.evaluate(`document.querySelector('[data-test=session-empty]') ? '空态' : '无'`))

  await click('session-row')
  await s.waitFor("document.querySelector('[data-test=message-bubble-me], [data-test=message-bubble-peer], [data-test=message-empty]')", '聊天页终态', 20000)
  s.check('点会话行进到了聊天页（URL 带对方 id）',
    await s.evaluate(`location.hash.startsWith('#/message/')`),
    await s.evaluate(`location.hash`))

  const bubbles = await all('message-bubble-peer')
  const mineBubbles = await all('message-bubble-me')
  s.check('聊天页有对方气泡（左侧）', bubbles.length > 0, `peer=${bubbles.length}`)
  s.check('聊天页有自己的气泡（右侧）', mineBubbles.length > 0, `me=${mineBubbles.length}`)
  s.check('本轮造的两条消息都在页面上',
    bubbles.concat(mineBubbles).some((t) => t.includes(stamp)),
    `stamp=${stamp}`)
  // 气泡左右必须真的分居两侧：几何而不是 class，否则「都渲染成对方」也会绿
  const geom = await s.evaluate(`(() => {
    const mine = document.querySelector('[data-test=message-bubble-me]')
    const peer = document.querySelector('[data-test=message-bubble-peer]')
    if (!mine || !peer) return null
    const a = mine.getBoundingClientRect(), b = peer.getBoundingClientRect()
    return { mineLeft: Math.round(a.left), peerLeft: Math.round(b.left), mineW: Math.round(a.width), peerW: Math.round(b.width) }
  })()`)
  s.check('我的气泡在右、对方在左（真几何，不是 class）',
    !!geom && geom.mineLeft > geom.peerLeft,
    JSON.stringify(geom))

  /* ---------- 3. 输入框可发、发送后立刻上屏 ---------- */

  await click('message-input')
  await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=message-input]')
    if (!el) throw new Error('message-input 不存在 —— 没进聊天页？')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(`P22 UI ${stamp}`)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(200)
  s.check('输入后发送按钮可点（未被 disabled）',
    await s.evaluate(`!document.querySelector('[data-test=message-send]').disabled`))
  await click('message-send')
  await s.waitFor(`document.body.textContent.includes(${JSON.stringify(`P22 UI ${stamp}`)})`,
    'UI 发的消息上屏', 15000)
  s.check('UI 发出的消息立刻出现在会话里', true)

  /* ---------- 4. 输入框 16px（防 iOS 聚焦缩放）+ 发送钮热区 ---------- */

  const inputFs = await s.evaluate(`getComputedStyle(document.querySelector('[data-test=message-input]')).fontSize`)
  s.check('消息输入框字号 ≥16px（iOS 聚焦会缩放整页）', parseFloat(inputFs) >= 16, `font=${inputFs}`)
  const sendBox = await s.evaluate(`(() => {
    const r = document.querySelector('[data-test=message-send]').getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  })()`)
  s.check('发送按钮热区 ≥40px（P13 下限）', sendBox.h >= 40, JSON.stringify(sendBox))

  /* ---------- 5. 会话列表：有未读角标，点进去变已读 ---------- */

  await s.goto(BASE + '/#/message')
  await s.waitFor("document.querySelector('[data-test=session-row], [data-test=session-empty]')", '会话列表终态', 20000)
  s.check('会话列表渲染出至少一个会话',
    (await all('session-item')).length + (await all('session-item-unread')).length > 0)
  // 上面刚读过会话，所以角标此刻**应该**是 0 —— 这本身就是断言：
  // 「进会话即已读」若没生效，这里会看到残留角标
  s.check('刚读完的会话不再显示未读角标（进会话即已读）',
    !(await exists('session-unread-badge')),
    '角标仍在，说明 read-all 没生效')

  /* ---------- 6. 未登录不能进私信（守卫） ---------- */

  // ⚠️ 清 localStorage 之后**必须重新导航**，否则守卫仍然认为已登录：
  // `token.ts` 的 accessToken 是模块级 ref，内存里那份还在。
  // 只清存储不清内存 = 没登出（与上面换身份是同一个坑的两面）。
  await s.goto(BASE + '/')
  await s.waitFor(`location.origin === ${JSON.stringify(BASE)}`, '到应用域名', 20000)
  await s.evaluate(`localStorage.removeItem('xk_token'); localStorage.removeItem('xk_refresh_token')`)
  await s.goto(BASE + '/#/message')
  await sleep(1500)
  s.check('未登录访问私信被守卫弹回登录页',
    // ⚠️ 守卫会带 `?redirect=` 回跳参数（登录后回到原来想去的页面），
    // 所以断言必须是 **前缀** 而不是全等 —— 写全等的话这条永远红，
    // 而「加个回跳参数」恰恰是守卫**做得对**的证据
    await s.evaluate(`location.hash.startsWith('#/login')`),
    await s.evaluate(`location.hash`))

} catch (e) {
  crashed = e
  console.error('  用例执行异常：', e)
} finally {
  const allOk = await s.close()
  const crashedMsg = crashed ? `异常：${crashed.message}` : ''
  console.log(crashedMsg)
  // ⚠️ crashed 时必须以非 0 退出：否则中途异常会被 close() 的汇总
  // 变成「N/N 通过」+ exit 0（AGENTS P15 段记的坑，ui-layout-audit 与
  // ui-notification 都犯过）
  process.exit(crashed || !allOk ? 1 : 0)
}