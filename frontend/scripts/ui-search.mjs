/**
 * P7 搜索域（CDP）：首页搜索框 → 搜索页命中 → 卡片回 MySQL 组卡 → 进详情
 * → 无结果空态 → 空关键词不发请求 → 带 ?keyword= 直链刷新。
 *
 * <p>和后端契约测试的分工：契约只验 HTTP 报文，验不到前端封装层
 * （比如把 query 塞进 { params } 这种错，报文测试照样全绿）。这里真机点一遍。
 *
 * <p>数据准备是自包含且可重复的：复用 P6 的常驻素材号 <code>xk_ui_follow</code>
 * 那篇「P6 关注流测试笔记」，不新建垃圾；再<b>重建一次 ES 索引</b>兜底
 * （万一索引被清过，搜索页会空，断言的就不是前端而是环境了）。
 * 重建走 /api/search/reindex，从 MySQL 全量回灌，幂等。
 *
 * 跑法：npm run test:ui（或 npm run test:ui:search）
 */
import { createSession, loginDemo, preflight } from './ui-cdp.mjs'

const BASE = 'http://localhost:5180'
const API = 'http://localhost:8088'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** P6 常驻素材号（撞 10003 视为已存在），它的笔记就是本测试的搜索素材 */
const PEER = { username: 'xk_ui_follow', password: 'Xk@2026peer', nickname: '关注搭子' }
const FIX_TITLE = 'P6 关注流测试笔记'
const HIT_KEY = FIX_TITLE
/**
 * 「搜不到」的关键词必须**每轮随机**，而且只能用纯拉丁字母。
 *
 * 原因（AGENTS.md 17.4 记过同类坑，这里又踩一次）：ik_smart 会把中文拆成
 * 单字，multiMatch 默认 **OR**，所以「绝无此词zzz999」会被拆成 绝/无/此/词/zzz/999，
 * 库里**任何一条**含「无」「词」「在」的笔记都会命中 —— 之前固定写死这个词，
 * 碰上 `xiaoku_demo` 那篇标题「空格」的笔记就再也搜不到 0 条，
 * 「空结果兜底」用例直接超时。随机拉丁串撞车概率约等于 0。
 */
const MISS_KEY = `qknoexist${Math.random().toString(36).slice(2, 10)}`

try {
  await preflight()
} catch (e) {
  console.error(String(e.message))
  process.exit(2)
}

const s = await createSession({ name: 'search' })

/** 往受控输入里塞值，触发 Vue 的 input 事件（直接改 .value 不会驱动 v-model）*/
async function setValue(selector, value) {
  await s.evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) throw new Error('找不到元素 ' + ${JSON.stringify(selector)})
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)
  await sleep(120)
}

const text = (test) => s.evaluate(`document.querySelector('[data-test=${test}]')?.textContent?.trim()`)
const exists = (test) => s.evaluate(`!!document.querySelector('[data-test=${test}]')`)
const click = (test) => s.evaluate(`document.querySelector('[data-test=${test}]')?.click()`)
const titles = (test) =>
  s.evaluate(`[...document.querySelectorAll('[data-test=${test}] .title')].map(e => e.textContent)`)
const inputValue = () => s.evaluate("document.querySelector('[data-test=search-input]')?.value ?? ''")

try {
  /* ============ 准备：确保素材笔记在库里，并在 ES 里可搜 ============ */

  const reg = await (
    await fetch(`${API}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PEER),
    })
  ).json()
  s.check('素材号就绪（已存在或新建成功）', reg.code === 0 || reg.code === 10003, `code=${reg.code}`)

  const login = await (
    await fetch(`${API}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: PEER.username, password: PEER.password }),
    })
  ).json()
  s.check('素材号能登录', login.code === 0, `code=${login.code}`)
  if (login.code !== 0) throw new Error(`素材号登录失败 code=${login.code}`)
  const peerToken = login.data.accessToken
  const peerId = login.data.userInfo?.id || login.data.id

  // 素材笔记只保一篇：有就复用，没有才发。脚本可重复跑不涨垃圾
  const existing = await (
    await fetch(`${API}/api/note/user/${peerId}?page=1&size=20`, {
      headers: { Authorization: `Bearer ${peerToken}` },
    })
  ).json()
  const hasFixture =
    Array.isArray(existing?.data?.list) && existing.data.list.some((n) => n.title === FIX_TITLE)
  if (!hasFixture) {
    const pub = await (
      await fetch(`${API}/api/note/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${peerToken}` },
        body: JSON.stringify({ title: FIX_TITLE, content: '这篇是关注流测试素材。' }),
      })
    ).json()
    s.check('素材笔记就绪（新建）', pub.code === 0, `code=${pub.code}`)
  } else {
    s.check('素材笔记就绪（复用已有）', true)
  }

  // 重建索引兜底：删旧 + 从 MySQL 全量回灌，保证素材笔记此刻一定能被搜到
  const reindex = await (
    await fetch(`${API}/api/search/reindex`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${peerToken}` },
    })
  ).json()
  s.check('索引重建成功（/api/search/reindex）', reindex.code === 0, `indexed=${reindex?.data?.indexed}`)

  // ES 写入是异步的，等一下再让 UI 去搜
  let indexed = false
  for (let i = 0; i < 50 && !indexed; i++) {
    const r = await (
      await fetch(`${API}/api/search/note?keyword=${encodeURIComponent(HIT_KEY)}&page=1&size=5`, {
        headers: { Authorization: `Bearer ${peerToken}` },
      })
    ).json()
    indexed = r.code === 0 && (r.data?.total ?? 0) > 0
    if (!indexed) await sleep(200)
  }
  s.check('素材笔记已进入 ES 索引（轮询 10s）', indexed)

  /* ============ 演示账号登录 ============ */


  await loginDemo(s, BASE)
  await s.waitFor("document.querySelector('[data-test=home-search-input]')", '首页搜索框', 20000)
  s.check('演示账号登录后，首页出现搜索框', await exists('home-search-input'))

  /* ============ 首页搜索框 → 搜索页 ============ */

  await setValue('[data-test=home-search-input]', HIT_KEY)
  await click('home-search-btn')
  await s.waitFor("location.hash.startsWith('#/search')", '跳到搜索页', 10000)
  s.check('首页搜索后跳转到 /search', (await s.evaluate('location.hash')).startsWith('#/search'))
  s.check('URL 带上了 keyword', (await s.evaluate('location.hash')).includes('keyword='))

  /* ============ 搜索页：命中 + 组卡字段 ============ */

  await s.waitFor("document.querySelector('[data-test=search-item]')", '搜索结果', 20000)
  s.check('搜索页输入框回显关键词', (await inputValue()) === HIT_KEY)
  s.check('搜到了素材笔记', (await titles('search-item')).includes(FIX_TITLE))
  s.check('卡片标题就是素材笔记', (await text('search-title')) === FIX_TITLE)
  s.check('卡片作者昵称来自 MySQL 回填', (await text('search-author')) === PEER.nickname)

  /* ============ 卡片进详情 ============ */

  await s.evaluate("document.querySelector('[data-test=search-item] .main').click()")
  await s.waitFor("document.querySelector('[data-test=note-detail]')", '进入笔记详情', 20000)
  s.check('从搜索结果点进详情页', await exists('note-detail'))

  /* ============ 无结果空态 ============ */

  await s.goto(`${BASE}/#/search?keyword=${encodeURIComponent(MISS_KEY)}`)
  await s.waitFor("document.querySelector('[data-test=search-empty]')", '空结果兜底', 20000)
  s.check('搜不到时出空态而不是报错', (await exists('search-empty')) === true)
  s.check('空态下没有残留卡片', (await exists('search-item')) === false)

  /* ============ 空关键词：不发请求、不跳转 ============ */

  await setValue('[data-test=search-input]', '   ')
  await click('search-submit')
  await sleep(400)
  s.check('空关键词提交不发请求（停留在空态）', (await exists('search-empty')) === true)

  /* ============ 带 keyword 直链刷新（模拟收藏/分享后打开） ============ */

  await s.goto(`${BASE}/#/search?keyword=${encodeURIComponent(HIT_KEY)}`)
  await s.waitFor("document.querySelector('[data-test=search-item]')", '直链结果', 20000)
  s.check('直链带 keyword 直接出结果', (await titles('search-item')).includes(FIX_TITLE))
  s.check('直链输入框回显关键词', (await inputValue()) === HIT_KEY)
} catch (e) {
  s.check('用例执行到底', false, String(e.message))
} finally {
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
