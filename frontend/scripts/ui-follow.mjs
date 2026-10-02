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

  // 用户资料（关注数/粉丝数）由 loadProfile 拉，等它渲染出「关注」入口再往下走
  await s.waitFor("document.querySelector('[data-test=home-follow]')", '首页数据')

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

  await s.goto(`${BASE}/#/`)
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

  await s.goto(`${BASE}/#/`)
  await s.waitFor("document.querySelector('[data-test=follow-list]') || document.querySelector('[data-test=follow-empty]')", '关注入口数据', 10000).catch(() => '')
  await s.waitFor("document.querySelector('[data-test=home-follow]')", '首页就绪')
  await click('home-follow')
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

  await s.goto(`${BASE}/#/`)
  await s.waitFor("document.querySelector('[data-test=home-fans]')", '首页就绪')
  await click('home-fans')
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
} catch (e) {
  s.check('用例执行到底', false, String(e.message))
} finally {
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
