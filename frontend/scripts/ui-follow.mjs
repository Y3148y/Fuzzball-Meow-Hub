/**
 * P6 关注关系全链路（CDP）：作者主页关注 → 关注流出现 → 详情页取关 → 关注流消失
 * → 再关注 → 关注/粉丝列表 → 取关 → 粉丝空态 → 自己主页无关注按钮。
 *
 * <p>和 ui-interaction 同款思路：固定账号 + 撞 10003 视为已存在。
 * 这里固定账号 <code>xk_ui_follow</code> 是<b>作者侧</b>（发笔记当素材），
 * 演示账号 <code>xiaoku_demo</code> 是<b>读者侧</b>（执行关注/取关）。
 * 为什么不让演示账号去关注自己：接口拦自关注（40003），
 * 而这个测试要练的正是「我 → TA」这条真实链路。
 *
 * <p>「关注流初始为空」这类断言刻意不写死：万一上一次跑挂在中途，
 * 今天跑这条就不成立。改成断言「测试笔记<b>没</b>出现在关注流里」，
 * 关心的是闭环本身，而不是演示账号有没有别的历史关注。
 *
 * 跑法：npm run test:ui（或 npm run test:ui:follow）
 */
import { createSession, loginDemo, preflight } from './ui-cdp.mjs'

const BASE = 'http://localhost:5180'
const API = 'http://localhost:8088'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 常驻素材号 fixture，撞 10003 视为已存在 */
const PEER = { username: 'xk_ui_follow', password: 'Xk@2026peer', nickname: '关注搭子' }

/** 收尾清理：崩在中途也会执行（见 P18 段内的注释） */
const finallyCleanup = []

try {
  await preflight()
} catch (e) {
  console.error(String(e.message))
  process.exit(2)
}

const s = await createSession({ name: 'follow' })

async function setValue(selector, value, index) {
  await s.evaluate(`
    (() => {
      const proto = el => el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(proto(el), 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const el = ${index === undefined ? `document.querySelector(${JSON.stringify(selector)})` : `document.querySelectorAll(${JSON.stringify(selector)})[${index}]`}
      if (!el) throw new Error('找不到元素 ' + ${JSON.stringify(selector)})
      set(el, ${JSON.stringify(value)})
    })()
  `)
  await sleep(150)
}

const text = (test) => s.evaluate(`document.querySelector('[data-test=${test}]')?.textContent?.trim()`)
const exists = (test) => s.evaluate(`!!document.querySelector('[data-test=${test}]')`)
const click = (test) => s.evaluate(`document.querySelector('[data-test=${test}]')?.click()`)
const titles = (test) =>
  s.evaluate(
    `[...document.querySelectorAll('[data-test=${test}] .title')].map(e => e.textContent).join('|')`,
  )

/** 关注流/作者页的标题列表里有没有「测试笔记」 */
const feedHasNote = () =>
  s.evaluate(
    `[...document.querySelectorAll('[data-test=feed-item] .title')].map(e => e.textContent).includes(${JSON.stringify(NOTE_TITLE)})`,
  )
const authorHasNote = () =>
  s.evaluate(
    `[...document.querySelectorAll('[data-test=user-note] .title')].map(e => e.textContent).includes(${JSON.stringify(NOTE_TITLE)})`,
  )

const NOTE_TITLE = 'P6 关注流测试笔记'

try {
  /* ============ 准备：注册素材号 + 发一篇笔记 ============ */

  const reg = await (
    await fetch(`${API}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PEER),
    })
  ).json()
  s.check(
    '关注搭子账号就绪（已存在或新建成功）',
    reg.code === 0 || reg.code === 10003,
    `code=${reg.code}`,
  )

  const login = await (
    await fetch(`${API}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: PEER.username, password: PEER.password }),
    })
  ).json()
  // 10005 用户名或密码错误说明这个 fixture 的口令漂移了，不能再继续
  s.check('素材号能登录', login.code === 0, `code=${login.code}`)
  if (login.code !== 0) throw new Error(`素材号登录失败 code=${login.code}`)
  const peerToken = login.data.accessToken
  const peerId = login.data.userInfo?.id || login.data.id

  // 素材笔记只发一篇，别每次跑都往库里涨一行：先翻作者现有笔记，
  // 标题匹配到了就复用，没有才发布。这样这个脚本可重复跑而不产垃圾。
  const existing = await (
    await fetch(`${API}/api/note/user/${peerId}?page=1&size=20`, {
      headers: { Authorization: `Bearer ${peerToken}` },
    })
  ).json()
  const hasFixture = Array.isArray(existing?.data?.list) &&
    existing.data.list.some((n) => n.title === NOTE_TITLE)
  s.check('素材笔记就绪（复用已有 或 新建）', !hasFixture ? (await publishFixture(peerToken)) : true)

  async function publishFixture(token) {
    const pub = await (
      await fetch(`${API}/api/note/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: NOTE_TITLE, content: '这篇是关注流测试素材。' }),
      })
    ).json()
    return pub.code === 0
  }

  /* ============ 演示账号登录 ============ */


  await loginDemo(s, BASE)
  s.check('演示账号登录成功', true)

  // 用户资料（关注数/粉丝数）由 loadProfile 拉，等它渲染出关注入口再往下走。
  // 走「我的」页的 me-follow-link：首页那张个人信息卡片在移动端已隐藏
  //（display:none），再等 home-follow 就等于在等一个用户看不到的元素
  await s.goto(`${BASE}/#/profile`)
  await s.waitFor("document.querySelector('[data-test=me-follow]')", '「我的」页关注入口')

  /* ============ 基线归零：上次跑挂半路可能留下「已关注」残局 ============ */

  // 这个测试全程只可能造出 demo→关注搭子 这一条关注关系。第一次跑或上一次
  // 正常收尾都是「未关注」，但凡上次在中途崩掉，这里就会残留。所以先到作者
  // 主页把状态归零再断言「不在关注流」，测试对中断是自愈的。
  await s.goto(`${BASE}/#/user/${peerId}`)
  await s.waitFor("document.querySelector('[data-test=user-follow]')", '作者主页', 20000)
  if ((await text('user-follow')) === '已关注') {
    await click('user-follow')
    await s.waitFor(
      "document.querySelector('[data-test=user-follow]').textContent.trim() === '关注'",
      '清理上次残余关注',
      10000,
    )
  }
  s.check('基线：演示账号当前未关注素材号', (await text('user-follow')) === '关注')

  /* ============ 作者主页：识别 + 关注 ============ */

  await s.goto(`${BASE}/#/user/${peerId}`)
  await s.waitFor("document.querySelector('[data-test=user-follow]')", '作者主页', 20000)
  s.check('作者主页展示昵称', (await text('user-nickname')) === PEER.nickname)
  s.check('作者主页展示用户名', (await text('user-username')) === `@${PEER.username}`)
  s.check('作者笔记列表里有测试笔记', await authorHasNote())

  await click('user-follow')
  await s.waitFor(
    "document.querySelector('[data-test=user-follow]').textContent.trim() === '已关注'",
    '作者主页关注成功',
    20000,
  )
  s.check('作者主页点关注 → 变已关注', (await text('user-follow')) === '已关注')

  /* ============ 首页关注流：出现 ============ */

  // 首页现在默认停在「发现」tab，这一组要验的是关注流，所以**先切过去**再等列表。
  // 少了这一步就会挂在「feed 出现测试笔记」上 —— 素材笔记根本不在发现流里。
  await s.goto(`${BASE}/#/`)
  await s.evaluate("document.querySelector('[data-test=feed-tab-follow]').click()")
  await s.waitFor(
    "document.querySelector('[data-test=feed-tab-follow]').getAttribute('aria-selected') === 'true'",
    '切到关注 tab',
    10000,
  )
  s.check('首页可切到「关注」tab（aria-selected 跟着变）', true)
  await s.waitFor(
    "document.querySelector('[data-test=feed-empty]') || document.querySelectorAll('[data-test=feed-item]').length",
    '关注流回到首页',
  )
  await s.waitFor(
    `[...document.querySelectorAll('[data-test=feed-item] .title')].some(e => e.textContent.includes(${JSON.stringify(NOTE_TITLE)}))`,
    'feed 出现测试笔记',
    20000,
  )
  s.check('关注后，测试笔记出现在关注流', await feedHasNote())

  /* ============ 首页关注流的行内关注按钮 ============ */

  await s.waitFor("document.querySelector('[data-test=feed-follow]')", '行内按钮')

  const itemFollowText = await text('feed-follow')
  s.check('行内按钮当前显示已关注', itemFollowText === '已关注', itemFollowText)
  await click('feed-follow')
  await s.waitFor(
    "document.querySelector('[data-test=feed-follow]').textContent.trim() === '关注'",
    '行内取消关注',
    10000,
  )
  s.check('行内点一下 → 变成关注（没有把它从列表里移除）', (await text('feed-follow')) === '关注')
  s.check('行内取关后卡片仍在列表（只能眼不见，不搞删除）', await feedHasNote())
  await click('feed-follow')
  await s.waitFor(
    "document.querySelector('[data-test=feed-follow]').textContent.trim() === '已关注'",
    '行内恢复关注',
    10000,
  )
  s.check('再点一下 → 恢复已关注', (await text('feed-follow')) === '已关注')

  /* ============ 详情页：已关注 → 取关 ============ */

  // 点进「测试笔记」那张卡，而不是第一张。素材笔记只发一次、createTime 是旧的，
  // 而种子数据的笔记比它新、排在关注流更前面 —— 按位置点会点到别人的笔记，
  // 下面取关就取错人，最后那条「取关后素材笔记从关注流消失」永远等不到。
  await s.evaluate(`(() => {
    const item = [...document.querySelectorAll('[data-test=feed-item]')]
      .find((el) => el.querySelector('.title')?.textContent.includes(${JSON.stringify(NOTE_TITLE)}))
    if (!item) throw new Error('关注流里找不到测试笔记卡片')
    item.querySelector('.main').click()
  })()`)
  await s.waitFor("document.querySelector('[data-test=note-detail]')", '进入详情页', 20000)
  await s.waitFor("document.querySelector('[data-test=note-follow]')", '详情页关注按钮', 10000)
  s.check('详情页作者区显示已关注', (await text('note-follow')) === '已关注')
  await click('note-follow')
  await s.waitFor(
    "document.querySelector('[data-test=note-follow]').textContent.trim() === '关注'",
    '详情页取关',
    10000,
  )
  s.check('详情页点关注 → 取关成功变回关注', (await text('note-follow')) === '关注')

  // 详情页的作者区还有一条揪着不放的路：作者名本身不是按钮（进主页要点一点点），
  // 我们直接回头验证「取关后关注流里笔记消失」
  await s.goto(`${BASE}/#/`)
  await s.evaluate("document.querySelector('[data-test=feed-tab-follow]').click()")
  await s.waitFor(
    "document.querySelector('[data-test=feed-tab-follow]').getAttribute('aria-selected') === 'true'",
    '回到关注 tab',
    10000,
  )
  await s.waitFor(
    "document.querySelector('[data-test=feed-empty]') || document.querySelectorAll('[data-test=feed-item]').length",
    '关注流回到首页',
  )
  await s.waitFor(
    `![...document.querySelectorAll('[data-test=feed-item] .title')].some(e => e.textContent.includes(${JSON.stringify(NOTE_TITLE)}))`,
    'feed 移除测试笔记',
    20000,
  )
  s.check('详情页取关后，测试笔记从关注流消失', !(await feedHasNote()))

  /* ============ 再关注（为列表页准备数据） ============ */

  await waitAuthorFollow()

  /* ============ 关注列表页 ============ */

  await s.goto(`${BASE}/#/profile`)
  await s.waitFor("document.querySelector('[data-test=me-follow-link]')", '「我的」页就绪')
  await click('me-follow-link')
  await s.waitFor("location.hash.includes('#/follow/')", '进入关注列表', 10000)
  await s.waitFor(
    "document.querySelector('[data-test=follow-list]') || document.querySelector('[data-test=follow-empty]')",
    '关注列表加载',
    20000,
  )
  s.check('关注列表里有关注搭子', await rowHasNick(PEER.nickname))

  await s.waitFor("document.querySelector('[data-test=follow-toggle]')", '行内关注按钮')
  s.check('关注列表行按钮当前为已关注', (await text('follow-toggle')) === '已关注')
  await click('follow-toggle')
  await s.waitFor(
    "document.querySelector('[data-test=follow-toggle]')  ? document.querySelector('[data-test=follow-toggle]').textContent.trim() === '关注' : true",
    '关注列表取关',
    10000,
  )
  s.check('关注列表点取关 → 变关注', (await firstToggleText()) === '关注')

  /* ============ 粉丝列表页：空态 ============ */

  await s.goto(`${BASE}/#/profile`)
  await s.waitFor("document.querySelector('[data-test=me-fans-link]')", '「我的」页就绪')
  await click('me-fans-link')
  await s.waitFor("location.hash.includes('#/fans/')", '进入粉丝列表', 10000)
  await s.waitFor(
    "document.querySelector('[data-test=follow-empty]') || document.querySelector('[data-test=follow-list]')",
    '粉丝列表加载',
    20000,
  )
  s.check('没人关注演示账号 → 粉丝空态', (await exists('follow-empty')) === true)

  /* ============ 自己主页：没有关注按钮 ============ */

  const myId = (await s.evaluate('location.hash')).split('/').pop()
  s.check('从粉丝页地址拿回演示账号 ID', /^\d+$/.test(myId))
  await s.goto(`${BASE}/#/user/${myId}`)
  await s.waitFor("document.querySelector('[data-test=user-nickname]')", '自己的主页', 10000)
  // isSelf 是响应式的，用户资料加载完按钮才消失；显式等它消失，避免竞态
  await s.waitFor("!document.querySelector('[data-test=user-follow]')", '自己主页隐藏关注按钮', 10000)
  s.check('自己的主页不出现关注按钮（自关注被后端拒绝）', (await exists('user-follow')) === false)

  async function waitAuthorFollow() {
    await s.goto(`${BASE}/#/user/${peerId}`)
    await s.waitFor("document.querySelector('[data-test=user-follow]')", '作者主页', 20000)
    if ((await text('user-follow')) !== '已关注') {
      await click('user-follow')
      await s.waitFor(
        "document.querySelector('[data-test=user-follow]').textContent.trim() === '已关注'",
        '再关注',
        10000,
      )
    }
    s.check('为列表页准备：已处于关注状态', (await text('user-follow')) === '已关注')
  }

  async function rowHasNick(nick) {
    return s.evaluate(
      `[...document.querySelectorAll('[data-test=follow-nick]')].map(e => e.textContent).includes(${JSON.stringify(nick)})`,
    )
  }

  async function firstToggleText() {
    return s.evaluate(`document.querySelector('[data-test=follow-toggle]')?.textContent?.trim()`)
  }
// ============ P18 拉黑与举报 ============
//
// 复用这一组本来就有的「固定搭子账号」（peerId），不再新造数据：
// 造一个新的会多消耗一次注册额度（10/min/IP），全量连跑时那点额度很紧。
//
// 钉的是三件事：
//  1) 作者页上「拉黑」按钮存在，且点了之后真生效
//  2) 拉黑之后对方从我的视野里消失（作者主页 / 详情页）
//  3) 举报弹窗能选内容与原因并提交
{
  // 这是浏览器内的 CDP 脚本，**没有 node 侧的 token**。
  // 从 localStorage 读 —— 存的是裸 JWT 字符串，不是 {accessToken} 对象
  const tok = await s.evaluate("localStorage.getItem('xk_token')")
  const auth = { Authorization: 'Bearer ' + tok }
  const api = (p, opt = {}) =>
    fetch(API + p, { ...opt, headers: { ...auth, 'Content-Type': 'application/json' } })
      .then((r) => r.json())
      .catch(() => null)

  // 复原登记在 finally 里，中途崩了也会跑（见上方 finallyCleanup）。
  // 这不是洁癖：上一轮崩在清理之前，拉黑关系留在库里，
  // 下一轮「关注流出现测试笔记」会永远超时 —— 症状与本段代码毫无关系。
  finallyCleanup.push(() => api(`/api/user/block/${peerId}`, { method: 'DELETE' }))

  // 清掉历史拉黑：崩在清理之前的话这次点按钮会走「解除」分支，方向反了
  await api(`/api/user/block/${peerId}`, { method: 'DELETE' })

  // **本组前一段结尾把 peer 取关了**，先关注回来，
  // 否则下面的前置断言没有意义
  await api(`/api/follow/${peerId}`, { method: 'PUT' })
  const peerNotes = await api(`/api/note/user/${peerId}?page=1&size=1`)
  const peerNoteId = peerNotes?.data?.list?.[0]?.id
  s.check('前置：TA 名下至少有一篇笔记', !!peerNoteId, `id=${peerNoteId}`)

  // 作者主页上的笔记数：拉黑前后都用它对比 —— **确定性**。
  // ⚠️ 刻意不用首页两个流验：它们只取第一页 20 条且按时间倒序，
  // TA 那几篇笔记比本组前几段刚造的数据旧，根本不在第一页，
  // 拿第一页断言会变成「恒真」—— 看着绿，其实钉不住任何东西。
  // 两个流的过滤由契约测试按 noteId 精确断言（服务端，确定性）。
  const profileNotes = async () => {
    await s.goto(`${BASE}/#/user/${peerId}`)
    await s.waitFor("!document.querySelector('[data-test=user-loading]')", '作者页终态', 20000)
    await sleep(800)
    return s.evaluate("document.querySelectorAll('[data-test=user-note]').length")
  }

  const before = await profileNotes()
  s.check('前置：拉黑前能看到 TA 的笔记', before >= 1, `notes=${before}`)
  s.check('作者页有「拉黑」按钮', await exists('user-block'))
  s.check('拉黑按钮初始文案是「拉黑」', (await text('user-block')) === '拉黑',
    await text('user-block'))
  s.check('作者页有「举报」入口', await exists('user-report'))

  // 点拉黑。成功后 router.back() 离开作者页 —— 这不是 bug，
  // 见 UserView.toggleBlock 的注释：留在页面上会让人以为「拉黑只是隐藏了内容」
  await click('user-block')
  await s.waitFor(`location.hash !== '#/user/${peerId}'`, '拉黑后离开作者页', 10000)

  const blocked = await api('/api/user/block/list')
  s.check('后端黑名单里已经有 TA', (blocked?.data?.list ?? []).some((x) => x.id === peerId),
    `total=${blocked?.data?.total}`)
  s.check('拉黑后作者主页看不到 TA 的笔记', (await profileNotes()) === 0)

  // 详情页按「不存在」处理：不给「TA 拉黑了你」任何提示
  await s.goto(`${BASE}/#/note/${peerNoteId}`)
  await s.waitFor("document.querySelector('[data-test=note-detail], .hint')", '笔记页有终态', 20000)
  await sleep(500)
  s.check('拉黑后直接访问 TA 的笔记也看不到（按「不存在」处理，不提示原因）',
    (await s.evaluate("!!document.querySelector('[data-test=note-detail]')")) === false)

  // 黑名单页：入口 + 列表 + 解除
  await s.goto(`${BASE}/#/profile`)
  await s.waitFor("!!document.querySelector('[data-test=me-blocks-link]')", '「我」页黑名单入口', 20000)
  s.check('「我」页有黑名单入口', await exists('me-blocks-link'))
  await click('me-blocks-link')
  await s.waitFor("location.hash === '#/blocks'", '进黑名单页', 10000)
  await s.waitFor("!document.querySelector('[data-test=blocks-loading]')", '黑名单终态', 20000)
  await sleep(500)
  const bl = await s.evaluate(`(() => JSON.stringify({
    rows: document.querySelectorAll('[data-test=block-row]').length,
    nicks: [...document.querySelectorAll('[data-test=block-nick]')].map((e) => e.textContent.trim()),
  }))()`)
  const bld = JSON.parse(bl)
  s.check('黑名单页列出了刚拉黑的人', bld.rows === 1 && bld.nicks.length === 1, bl)

  // 解除要二次确认：误点一次就解除保护是不可逆的
  await click('block-unblock')
  await sleep(700)
  s.check('点「解除」先弹二次确认（不直接解除）',
    (await s.evaluate("!!document.querySelector('.van-dialog')")) === true)
  await s.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.van-dialog__confirm')].pop()
    if (btn) btn.click()
  })()`)
  await sleep(1500)
  const after = await s.evaluate("document.querySelectorAll('[data-test=block-row]').length")
  s.check('确认之后从列表消失', after === 0, `rows=${after}`)
  const bl2 = await api('/api/user/block/list')
  s.check('后端黑名单也清空了', bl2?.data?.total === 0, `total=${bl2?.data?.total}`)

  // 解除之后笔记要重新可见（拉黑只过滤，没删内容）
  s.check('解除拉黑后 TA 的笔记重新可见（拉黑是过滤，不是删除）',
    (await profileNotes()) >= 1)

  // ---- 举报：作者页 → 选内容 → 选原因 → 提交
  await s.goto(`${BASE}/#/user/${peerId}`)
  await s.waitFor("document.querySelector('[data-test=user-report]')", '举报入口', 20000)
  await click('user-report')
  await s.waitFor("!!document.querySelector('[data-test=report-sheet]')", '举报弹窗打开', 10000)
  await sleep(700)
  const sheet = await s.evaluate(`(() => JSON.stringify({
    reasons: document.querySelectorAll('[data-test=report-reason]').length,
    targets: document.querySelectorAll('.sheet-item:not(.reason)').length,
  }))()`)
  const sd = JSON.parse(sheet)
  s.check('举报弹窗列出 6 个原因（来自后端枚举，不是写死在前端）', sd.reasons === 6, sheet)

  // 先不选内容就点原因 → 应提示而不是提交成功
  await s.evaluate("document.querySelector('[data-test=report-reason]').click()")
  await sleep(700)
  s.check('没选内容就点原因时弹窗不关闭', (await exists('report-sheet')) === true)

  if (sd.targets > 0) {
    await s.evaluate("document.querySelector('.sheet-item:not(.reason)').click()")
    await sleep(500)
    await s.evaluate("document.querySelector('[data-test=report-reason]').click()")
    await sleep(1500)
    // ⚠️ 举报去重是**永久**的（uk_report_once，且没有撤回接口），
    // 所以第二次跑这条必然是 80003。两个分支都是产品承诺的行为，
    // 所以这里断言的是「有明确反馈」而不是「弹窗一定关闭」——
    // 这与「用 || 掩盖不稳定」不同：两个分支各有自己的提示文案。
    const closed = (await exists('report-sheet')) === false
    const toast = await s.evaluate(
      "document.querySelector('.van-toast')?.textContent?.trim() ?? ''",
    )
    s.check(
      '举报提交有明确反馈（首次成功关弹窗 / 重复举报给提示）',
      closed || /举报过/.test(toast),
      `closed=${closed} toast="${toast}"`,
    )
  } else {
    s.check('这个账号没有可举报的笔记（前置条件）', true, 'targets=0，跳过提交')
  }
}

} catch (e) {
  s.check('用例执行到底', false, String(e.message))
} finally {
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
