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
  await s.waitFor("document.querySelector('[data-test=message-row-me], [data-test=message-row-peer], [data-test=message-empty]')", '聊天页终态', 20000)
  s.check('点会话行进到了聊天页（URL 带对方 id）',
    await s.evaluate(`location.hash.startsWith('#/message/')`),
    await s.evaluate(`location.hash`))

  // ⚠️ P31 把气泡拆成了「行」(.row = 头像 + 气泡 + 时间戳)，
  // 所以断言的 data-test 从 message-bubble-* 改成了 message-row-*。
  // 刻意**不同时保留旧名**：留着两套名字会让「哪套是当前契约」变得不确定，
  // 而这个文件里所有断言都该指向同一个 DOM。
  const bubbles = await all('message-row-peer')
  const mineBubbles = await all('message-row-me')
  s.check('聊天页有对方气泡（左侧）', bubbles.length > 0, `peer=${bubbles.length}`)
  s.check('聊天页有自己的气泡（右侧）', mineBubbles.length > 0, `me=${mineBubbles.length}`)
  s.check('本轮造的两条消息都在页面上',
    bubbles.concat(mineBubbles).some((t) => t.includes(stamp)),
    `stamp=${stamp}`)
  // 气泡左右必须真的分居两侧：几何而不是 class，否则「都渲染成对方」也会绿
  // ⚠️ 量的是**行内的 .bub 气泡**，不是整行 .row。
  // P31 加了头像之后行本身是 flex 满宽的（头像在左、气泡靠右对齐），
  // 量行的 left 两侧都是 54 —— 那是 padding，不是「都在左边」。
  // 气泡的左右才是「谁的字」这件事本身。
  const geom = await s.evaluate(`(() => {
    const mine = document.querySelector('[data-test=message-row-me] .bub')
    const peer = document.querySelector('[data-test=message-row-peer] .bub')
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

  /* ---------- 4b. P31：日期线 / 头像 / 时间戳 ---------- */

  await s.goto(BASE + `/#/message/${idFollow}`)
  await s.waitFor("document.querySelector('[data-test=message-row-me], [data-test=message-row-peer], [data-test=message-empty]')",
    '回到聊天页', 20000)

  // ① 日期线：只**验存在与居中**，不验数量 ——
  // 「今天」这一组无论几条消息都只要一条线，数量对不上是分组的锅还是
  // 测试数据跨天的锅，分不清，所以只验「有这条线且它是分隔用的」。
  const dayl = await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=message-dayline]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { text: el.textContent.trim(), centered: Math.abs((r.left + r.width / 2) - window.innerWidth / 2) < 40 }
  })()`)
  s.check('消息之间有日期分隔线', !!dayl && dayl.text.length > 0, JSON.stringify(dayl))
  s.check('日期线是居中的灰色分隔（不是一条消息）', !!dayl && dayl.centered, JSON.stringify(dayl))
  s.check('日期线文案是「今天 / 昨天 / X月X日」之一',
    !!dayl && /^(今天|昨天|\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月\d{1,2}日)$/.test(dayl.text),
    dayl?.text)

  // ② 对方气泡有头像，自己的没有（自己这侧是等宽占位）
  const av = await s.evaluate(`(() => {
    const im = document.querySelector('[data-test=message-row-peer] [data-test=message-avatar]')
    const ghost = document.querySelector('[data-test=message-row-me] .avatar-ghost')
    const ib = im && im.getBoundingClientRect()
    return { hasImg: !!im, imgW: ib ? Math.round(ib.width) : 0, imgLeft: ib ? Math.round(ib.left) : 0, hasGhost: !!ghost }
  })()`)
  s.check('对方气泡带头像', av.hasImg, JSON.stringify(av))
  s.check('头像尺寸 ≥32px（P13 热区下限的一半，气泡内缩略）', av.imgW >= 32, JSON.stringify(av))
  s.check('自己这侧用等宽占位（否则两侧气泡左右不对称）', av.hasGhost, JSON.stringify(av))
  // ⚠️ 头像必须在气泡**左边**（对方侧）—— 占位放错边的话头像会跑到气泡中间
  const peerRow = await s.evaluate(`(() => {
    const row = document.querySelector('[data-test=message-row-peer]')
    const a = row.querySelector('[data-test=message-avatar]')?.getBoundingClientRect()
    const b = row.querySelector('.bub')?.getBoundingClientRect()
    return a && b ? Math.round(b.left - a.left) : null
  })()`)
  s.check('头像在气泡左边（位置而非仅存在）', peerRow !== null && peerRow > 0, `dx=${peerRow}`)

  // ③ 时间戳：只显示到分，且同一分钟不重复
  const stamps = await all('message-time')
  s.check('气泡旁有时间戳', stamps.length > 0, `n=${stamps.length}`)
  s.check('时间戳是 HH:mm 格式',
    stamps.length > 0 && stamps.every((t) => /^\d{2}:\d{2}$/.test(t.trim())),
    JSON.stringify(stamps.slice(0, 4)))
  // ⚠️ 「同一分钟不重复」只在**真实存在**这种密集时才验得出来。
  // 如果这一轮造的消息恰好分散在不同分钟，全都会显示 —— 那不是 bug。
  // 所以这条只断言「不出现连续的相同时间戳」，反过来验。
  s.check('同一分钟里不重复显示时间戳',
    !stamps.some((t, i) => i > 0 && t.trim() === stamps[i - 1].trim()),
    JSON.stringify(stamps.slice(0, 6)))

  /* ---------- 4c. P31：加载更多（往上的分页） ---------- */

  // 用 Node 侧先造够一条消息，看「加载更早」按钮出现。
  // ⚠️ 造消息**必须在进页面之前**：页面已经加载过一次之后，
  // 轮询会把新消息直接追加进来，看不出「翻页」这件事。
  const filler = `P31 ${stamp} 历史`
  for (let i = 0; i < 3; i++) {
    await api('/message/send', { method: 'POST', token: tFollow, body: { toUserId: idSmoke, content: `${filler} #${i}` } })
  }
  await s.goto(BASE + `/#/message/${idFollow}`)
  await s.waitFor("document.querySelector('[data-test=message-row-me], [data-test=message-empty]')", '聊天页重新加载', 20000)
  const moreVisible = await exists('message-load-more')
  // 这条消息库里的总量可能本来就 < PAGE_SIZE（30），那就没有「更多」是**对的**。
  // 所以只在真的有更多时才要求按钮出现。
  const totalNow = await s.evaluate(`document.querySelectorAll('[data-test=message-row-me],[data-test=message-row-peer]').length`)
  s.check('有更多历史时出现「加载更早的消息」按钮',
    totalNow < 30 ? true : moreVisible,
    `本页 ${totalNow} 条, 按钮=${moreVisible}`)
  if (moreVisible) {
    const before = await s.evaluate(`document.querySelectorAll('[data-test=message-row-me],[data-test=message-row-peer]').length`)
    // ⚠️ 先滚到顶 —— 「加载更早」是在顶部触发的，不滚过去就验不到那条不变式
    await s.evaluate(`(() => {
      const el = document.querySelector('[data-test=message-scroller]')
      if (el) el.scrollTop = 0
    })()`)
    await sleep(400)
    // 记下点之前**视口内第一条**消息 —— 它是「我刚才在看的那条」。
    // 存进 window 而不是留在 Node 侧变量里：下面那次 evaluate 找不到它，
    // 而症状是「锚点找不到」，与「锚点没存」毫无关系。
    await s.evaluate(`(() => {
      const el = document.querySelector('[data-test=message-scroller]')
      const top = el.getBoundingClientRect().top
      for (const r of el.querySelectorAll('[data-test=message-row-me],[data-test=message-row-peer]')) {
        if (r.getBoundingClientRect().bottom > top + 1) {
          window.__p31anchor = r.querySelector('.bub').textContent.trim().slice(0, 24)
          return true
        }
      }
      window.__p31anchor = null
      return false
    })()`)
    const firstBefore = await s.evaluate(`window.__p31anchor`)
    await click('message-load-more')
    await sleep(1500)
    const after = await s.evaluate(`document.querySelectorAll('[data-test=message-row-me],[data-test=message-row-peer]').length`)
    s.check('点「加载更早」后消息数变多', after > before, `${before} -> ${after}`)
    // ⚠️ 核心不变式：插入在**前面**会把视口内容顶走。
    // 用户看到的是「我明明没动，消息却自己往上跑」——比加载不出来更糟。
    //
    // ⚠️ 钉「那条消息**仍在屏幕内**」而不是「仍是第一条」：
    // 用户本来就停在最顶，加载更早之后新历史出现在它上面，它当然不再是第一条
    // —— 那正是应该发生的事。真正的回归是它被推出视口。
    // 同理不能比 scrollTop 绝对值（列表从 30 条涨到 60 条时它必然变化）。
    const visReal = await s.evaluate(`(() => {
      const el = document.querySelector('[data-test=message-scroller]')
      const box = el.getBoundingClientRect()
      const all = Array.from(el.querySelectorAll('[data-test=message-row-me],[data-test=message-row-peer]'))
      const idx = all.findIndex((r) => r.querySelector('.bub').textContent.trim().slice(0, 24) === window.__p31anchor)
      if (idx < 0) return { found: false }
      const rc = all[idx].getBoundingClientRect()
      return { found: true, dy: Math.round(rc.top - box.top), inView: rc.top < box.bottom && rc.bottom > box.top }
    })()`)
    s.check('加载更早后「刚在看的那条」仍在视口内（不被顶走）',
      firstBefore && visReal.found && visReal.inView,
      `${firstBefore} -> dy=${visReal.dy} inView=${visReal.inView}`)

    // ⚠️ 上面那条**验不满**补偿逻辑：用户本来停在最顶时 scrollTop=0，
    // 插入不插入都一样 —— 没有补偿它也「通过」。
    // 所以补一条**滚到中间**的情形：这才是「加载更早」按钮真被用到的场景，
    // 也是没有补偿时视口会被明显顶走的那一种。
    await s.evaluate(`(() => {
      const el = document.querySelector('[data-test=message-scroller]')
      el.scrollTop = Math.floor(el.scrollHeight / 2)
    })()`)
    await sleep(500)
    const midAnchor = await s.evaluate(`(() => {
      const el = document.querySelector('[data-test=message-scroller]')
      const top = el.getBoundingClientRect().top
      for (const r of el.querySelectorAll('[data-test=message-row-me],[data-test=message-row-peer]')) {
        const rc = r.getBoundingClientRect()
        if (rc.bottom > top + 1) { window.__p31mid = r.querySelector('.bub').textContent.trim().slice(0, 24); break }
      }
      return window.__p31mid ?? null
    })()`)
    const midBefore = await s.evaluate(`(() => {
      const el = document.querySelector('[data-test=message-scroller]')
      const all = Array.from(el.querySelectorAll('[data-test=message-row-me],[data-test=message-row-peer]'))
      const i = all.findIndex((r) => r.querySelector('.bub').textContent.trim().slice(0, 24) === window.__p31mid)
      return i < 0 ? null : Math.round(all[i].getBoundingClientRect().top - el.getBoundingClientRect().top)
    })()`)
    await click('message-load-more')
    await sleep(1500)
    const midAfter = await s.evaluate(`(() => {
      const el = document.querySelector('[data-test=message-scroller]')
      const all = Array.from(el.querySelectorAll('[data-test=message-row-me],[data-test=message-row-peer]'))
      const i = all.findIndex((r) => r.querySelector('.bub').textContent.trim().slice(0, 24) === window.__p31mid)
      if (i < 0) return null
      const dy = Math.round(all[i].getBoundingClientRect().top - el.getBoundingClientRect().top)
      const b = all[i].getBoundingClientRect(), bx = el.getBoundingClientRect()
      return { dy, inView: b.top < bx.bottom && b.bottom > bx.top }
    })()`)
    s.check('在页面中间加载更早，视野内的消息仍在原位（补偿真的生效）',
      midAnchor && midBefore !== null && midAfter
      && Math.abs(midAfter.dy - midBefore) < 40,
      `${midAnchor}: ${midBefore} -> ${midAfter?.dy} inView=${midAfter?.inView}`)
  }

  /* ---------- 4d. P31：表情面板 ---------- */

  await click('message-emoji-toggle')
  await s.waitFor("document.querySelector('[data-test=emoji-panel]')", '表情面板打开', 5000)
  s.check('点表情按钮打开面板', await exists('emoji-panel'), 'emoji-panel 没出现')
  const emojiBox = await s.evaluate(`(() => {
    const r = document.querySelector('[data-test=emoji-panel]').getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), inViewport: r.bottom <= window.innerHeight + 1 && r.top >= -1 }
  })()`)
  s.check('面板在视口内（不是被推到屏幕外）', emojiBox.inViewport, JSON.stringify(emojiBox))
  s.check('面板有高度（不是 0 高）', emojiBox.h > 100, JSON.stringify(emojiBox))
  const cells = await all('emoji-item')
  s.check('面板里有表情', cells.length > 10, `n=${cells.length}`)
  const cellBox = await s.evaluate(`(() => {
    const r = document.querySelector('[data-test=emoji-item]').getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  })()`)
  s.check('表情热区 ≥40px（P13 下限）', cellBox.w >= 40 && cellBox.h >= 40, JSON.stringify(cellBox))
  // ⚠️ 表情必须真的渲染成字形，不是豆腐块。
  // emoji 是双码位或代理对，一个字宽 ≠ 表情宽。
  const rendered = await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=emoji-item]')
    const t = el.textContent.trim()
    return { text: t, codepoints: [...t].length, width: Math.round(el.getBoundingClientRect().width) }
  })()`)
  s.check('表情是真实字形（有码位）', rendered.codepoints > 0, JSON.stringify(rendered))

  // 点一个表情 → 应该插进输入框
  await click('emoji-item')
  await sleep(300)
  const draftVal = await s.evaluate(`document.querySelector('[data-test=message-input]')?.value ?? ''`)
  s.check('点表情插入到输入框', draftVal.length > 0, `draft="${draftVal}"`)
  // 再点第二个 → 追加
  await click('emoji-item')
  await sleep(300)
  const draftVal2 = await s.evaluate(`document.querySelector('[data-test=message-input]')?.value ?? ''`)
  s.check('连点两个表情都插入（长度递增）', draftVal2.length > draftVal.length,
    `"${draftVal}" -> "${draftVal2}"`)
  // 切换分组
  await click('emoji-tab-动物')
  await sleep(300)
  s.check('切分组后仍是动物表情',
    (await text('emoji-grid-动物'))?.includes('\u{1F435}') === true ||
    (await s.evaluate(`!!document.querySelector('[data-emoji="\\u{1F435}"]')`)),
    await text('emoji-grid-动物'))
  // 关闭
  await click('message-emoji-toggle')
  await sleep(300)
  s.check('再点一次关闭面板', !(await exists('emoji-panel')), '面板没关')
  // 清理草稿，别把它发出去
  await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=message-input]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)

  /* ---------- 4e. P31：发送失败留在原地可重发 ---------- */

// ⚠️ 必须**真的让发送失败**，不能只断言"失败时应该长什么样"——
// 那样的断言永远绿，因为根本没有失败发生。
  // ⚠️ **拦截 XHR 而不是 fetch**：axios 走 XHR，hook `window.fetch`
  // 一条都拦不到（AGENTS P30 段记过这个坑，那次诊断值恒为 null，
  // 结果开始怀疑产品代码）。两个都挂上，才不依赖「本项目用哪个」。
  await s.evaluate(`
    window.__p31blk = true
    const oOpen = XMLHttpRequest.prototype.open
    const oSend = XMLHttpRequest.prototype.send
    window.__p31restore = () => {
      XMLHttpRequest.prototype.open = oOpen
      XMLHttpRequest.prototype.send = oSend
    }
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__p31url = String(u)
      return oOpen.apply(this, arguments)
    }
    XMLHttpRequest.prototype.send = function () {
      if (window.__p31blk && this.__p31url && this.__p31url.indexOf('/message/send') >= 0) {
        Object.defineProperty(this, 'readyState', { value: 4, configurable: true })
        Object.defineProperty(this, 'status', { value: 200, configurable: true })
        Object.defineProperty(this, 'responseText', {
          value: JSON.stringify({ code: 50099, message: '模拟的发送失败' }),
          configurable: true,
        })
        Object.defineProperty(this, 'response', {
          value: JSON.stringify({ code: 50099, message: '模拟的发送失败' }),
          configurable: true,
        })
        setTimeout(() => this.dispatchEvent(new Event('loadend')), 10)
        return
      }
      return oSend.apply(this, arguments)
    }
    true
  `)
  await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=message-input]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, 'P31 这条应该发不出去')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await click('message-send')
  await s.waitFor("document.querySelector('[data-test=message-failed-bubble]')", '失败气泡留在原地', 10000)
  s.check('发送失败时气泡留在原地（不是弹个 toast 就消失）',
    await exists('message-failed-bubble'), '失败气泡没出现')
  const badText = await text('message-failed-bubble')
  s.check('失败气泡保留了原文（用户不用重新打一遍）',
    (badText ?? '').includes('P31 这条应该发不出去'), `text="${badText}"`)
  s.check('失败气泡标红',
    await s.evaluate(`(() => {
      const el = document.querySelector('[data-test=message-failed-bubble]')
      return el ? getComputedStyle(el).borderStyle === 'dashed' : false
    })()`), '不是虚线边')
  s.check('失败时给出了原因', !!(await text('message-failed-reason')), '没有原因文案')
  s.check('失败气泡旁有「重新发送」按钮', await exists('message-retry'), '没有重发按钮')
  s.check('发送失败后输入框已清空（内容进了气泡，不该留在框里）',
    (await s.evaluate(`document.querySelector('[data-test=message-input]').value`)) === '',
    '输入框还留着原文')

  // 解除拦截 → 点重发 → 应该变成一条真消息、失败气泡消失
  await s.evaluate(`(() => { window.__p31blk = false; window.__p31restore(); return true })()`)
  await click('message-retry')
  await s.waitFor(`!document.querySelector('[data-test=message-failed-bubble]')`,
    '重发成功后失败气泡消失', 10000)
  s.check('点「重新发送」后失败气泡消失', !(await exists('message-failed-bubble')), '还在')
  const sentNow = await s.evaluate(`document.body.textContent.includes('P31 这条应该发不出去')`)
  const stillFailed = await exists('message-failed-bubble')
  s.check('重发后消息真的发出去了（不再是失败态）', sentNow && !stillFailed,
    `sent=${sentNow} failed=${stillFailed}`)

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
  // ⚠️ XHR 拦截必须在 close() **之前**恢复：留着它，这一轮崩了之后
  // 同一个浏览器会话里的后续请求全拿到假响应，而症状会指向别处。
  // （与 P28 的 finallyCleanup 同源：清理不排空，受害的不是本组。）
  await s.evaluate(`(() => { try { window.__p31blk = false; window.__p31restore && window.__p31restore() } catch (e) {} return true })()`).catch(() => {})
  const allOk = await s.close()
  const crashedMsg = crashed ? `异常：${crashed.message}` : ''
  console.log(crashedMsg)
  // ⚠️ crashed 时必须以非 0 退出：否则中途异常会被 close() 的汇总
  // 变成「N/N 通过」+ exit 0（AGENTS P15 段记的坑，ui-layout-audit 与
  // ui-notification 都犯过）
  process.exit(crashed || !allOk ? 1 : 0)
}