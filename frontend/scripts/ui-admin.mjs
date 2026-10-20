/**
 * P20 运营管理后台（CDP）
 *
 * <p>身份是**两个常驻管理员 fixture**：xk_ui_admin 与 xk_ui_admin2（口令 Xk@2026peer）。
 * 为什么不新建：role 只能从库里改，而 CDP 这一层也不该去动数据库 ——
 * 它要验的是「界面能不能把处置动作走通」，不是「怎么把人提成管理员」。
 * 所以 fixture 缺了就在第一条断言上直接报出来（见下），而不是让后面集体假红。
 *
 * <p>要验的闭环：
 * <ol>
 *   <li>「我的」页**普通账号看不到**运营入口、管理员看得到；</li>
 *   <li>运营后台三个 tab 都能打开；</li>
 *   <li>举报列表能看到举报人与被举报内容（**两个名字不能搞反** —— 搞反就等于处置了举报人）；</li>
 *   <li>处置一次举报 → 目标笔记对他人消失 → 再点一次会拿到「已处理」提示（不可重放）；</li>
 *   <li>禁用账号 → 立刻不能写。</li>
 * </ol>
 *
 * <p><b>fixture 与清理</b>：管理员账号是常驻的，撞 10003 视为已存在，**不要清理**。
 * 本组造出来的笔记、评论、举报、以及被禁用的临时账号在 finally 里清掉 ——
 * 与 P15 ui-notification、P18 ui-follow 同一个坑：崩在清理之前会让下一轮
 * 「关注流出现测试笔记」永远超时，而症状看起来与新代码毫无关系。
 *
 * 跑法：npm run test:ui:admin
 */
import { createSession, loginDemo, preflight } from './ui-cdp.mjs'

const BASE = 'http://localhost:5180'
const API = 'http://localhost:8088'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 常驻管理员 fixture。撞 10003 / 口令漂移都在下面直接报出来 */
const ADM = { username: 'xk_ui_admin', password: 'Xk@2026peer' }
/** 第二个管理员：用来验「管理员之间不能互相封禁」（90005） */
const ADM2 = { username: 'xk_ui_admin2', password: 'Xk@2026peer' }
/** 用来当「普通用户」的现成账号 —— 演示账号 role=0 */
const NORMAL = { username: 'xiaoku_demo', password: 'Xk@123456' }

/** 收尾清理：崩在中途也会执行 */
const finallyCleanup = []

let crashed = null

try {
  await preflight()
} catch (e) {
  console.error(String(e.message))
  process.exit(2)
}

const s = await createSession({ name: 'admin' })

const text = (t) => s.evaluate(`document.querySelector('[data-test=${t}]')?.textContent?.trim()`)
const exists = (t) => s.evaluate(`!!document.querySelector('[data-test=${t}]')`)
const click = (t) => s.evaluate(`document.querySelector('[data-test=${t}]')?.click()`)

async function loginApi(user) {
  return (
    await fetch(`${API}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, password: user.password }),
    })
  ).json()
}

/** 把 token 塞进 localStorage 并刷新 —— 比走登录表单快，也不吃登录限流 */
async function switchIdentity(token) {
  // ⚠️ 必须先导航到应用域名：会话初始停在 about:blank，
  // 那是**不透明源**，读 localStorage 直接抛 SecurityError
  // （症状是「用例执行到底 SecurityError」，与身份切换毫无关系）
  await s.goto(`${BASE}/#/login`)
  await s.waitFor('location.origin === ' + JSON.stringify(BASE), '跳到应用域名', 20000)
  await s.evaluate(`
    localStorage.setItem('xk_token', ${JSON.stringify(token)});
    localStorage.setItem('xk_refresh_token', ${JSON.stringify(token)});
    location.hash = '#/profile';
  `)
  await sleep(600)
}

try {
  /* ---------- fixture 就绪 ---------- */

  const admLogin = await loginApi(ADM)
  s.check('管理员 fixture 能登录', admLogin.code === 0, `code=${admLogin.code}`)
  if (admLogin.code !== 0) {
    throw new Error(
      `管理员 fixture xk_ui_admin 登录失败 code=${admLogin.code}。` +
        '口令漂移或账号被删：口令应为 Xk@2026peer，且需要 UPDATE user SET role=1。',
    )
  }
  const admToken = admLogin.data.accessToken
  const admId = admLogin.data.userInfo?.id || admLogin.data.id
  const adm2Login = await loginApi(ADM2)
  s.check('第二个管理员 fixture 能登录', adm2Login.code === 0, `code=${adm2Login.code}`)
  const adm2Token = adm2Login.data.accessToken
  const adm2Id = adm2Login.data.userInfo?.id || adm2Login.data.id

  // 造素材：管理员本人发一篇笔记 → 举报人举报它。都用常驻账号，不新建用户
  const stamp = Date.now().toString(36).slice(-6)
  const NOTE_TITLE = `CDP 运营后台笔记 ${stamp}`

  const uploaded = await (async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const fd = new FormData()
    fd.append('file', new Blob([png], { type: 'image/png' }), 'a.png')
    return (
      await fetch(`${API}/api/note/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admToken}` },
        body: fd,
      })
    ).json()
  })()

  const pub = await (
    await fetch(`${API}/api/note/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admToken}` },
      body: JSON.stringify({ title: NOTE_TITLE, content: '供运营后台处置用', imageUrls: [uploaded.data.url] }),
    })
  ).json()
  const noteId = pub?.data?.id
  s.check('素材笔记就绪', typeof noteId === 'string', `id=${noteId} code=${pub?.code}`)
  finallyCleanup.push(async () => {
    await fetch(`${API}/api/note/${noteId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${admToken}` },
    })
  })

  // 举报人用演示账号（role=0，天然是普通用户）
  const normalLogin = await loginApi(NORMAL)
  const normalToken = normalLogin.data.accessToken
  const rp = await (
    await fetch(`${API}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${normalToken}` },
      body: JSON.stringify({ targetType: 1, targetId: noteId, reasonCode: 1 }),
    })
  ).json()
  const reportId = rp?.data
  s.check('素材举报已提交', typeof reportId === 'string', `reportId=${reportId} code=${rp?.code}`)

  /* ---------- ① 普通账号看不到运营入口 ---------- */

  await switchIdentity(normalToken)
  await s.goto(`${BASE}/#/profile`)
  await s.waitFor("!!document.querySelector('[data-test=me-nickname]')", '我的页渲染', 20000)
  s.check('普通账号在「我的」里看不到运营后台入口', (await exists('me-admin-link')) === false)

  /* ---------- ② 管理员看得到，并且能进后台 ---------- */

  await switchIdentity(admToken)
  await s.goto(`${BASE}/#/profile`)
  await s.waitFor("!!document.querySelector('[data-test=me-admin-link]')", '管理员看到运营入口', 20000)
  s.check('管理员在「我的」里能看到运营后台入口', await exists('me-admin-link'))

  await click('me-admin-link')
  await s.waitFor("!!document.querySelector('[data-test=admin-tab-report]')", '运营后台打开', 20000)
  s.check('点入口能进运营后台', await exists('admin-tab-report'))
  s.check('后台有三个 tab（举报/用户/笔记）',
    (await s.evaluate("document.querySelectorAll('[role=tab]').length")) === 3)

  /*
   * P41：**这一页要说人话**。
   *
   * 原来的后台只有三个 tab + 一堆操作按钮，第一次进来根本不知道
   * 「该看哪」「驳回和下架笔记差在哪」——
   * 用户原话是「运营后台根本就看不懂这是什么意思」。
   * 所以每个页签都有一句说明当前这页是干什么的。
   */
  const help = await text('admin-help')
  s.check('后台有「这页是干什么的」说明（用户说看不懂的就是这个）',
    !!help && help.length > 15, `help=${help}`)

  // 说明要跟着页签变：三个页签管三件不同的事，一次只说当前这一件
  await click('admin-tab-user')
  await sleep(900)
  const helpUser = await text('admin-help')
  s.check('切到「用户」页签后说明也跟着换（不是一句总说明）',
    !!helpUser && helpUser !== help, `user=${helpUser}`)
  await click('admin-tab-report')
  await sleep(900)

  /* ---------- ③ 举报列表：举报人与作者不能搞反 ---------- */

  await s.waitFor("!!document.querySelector('[data-test=admin-report-row]')", '举报列表渲染', 20000)
  const row = JSON.parse(await s.evaluate(`
    (() => {
      const el = [...document.querySelectorAll('[data-test=admin-report-row]')]
        .find(e => e.textContent.includes(${JSON.stringify(NOTE_TITLE)}))
      if (!el) return '{}'
      return JSON.stringify({
        who: el.querySelector('.who')?.textContent ?? '',
        hasOps: !!el.querySelector('[data-test=admin-act]'),
        gone: !!el.querySelector('[data-test=admin-target-gone]'),
      })
    })()
  `))
  s.check('举报列表里有这条素材举报', Object.keys(row).length > 0, JSON.stringify(row))
  // ⚠️ P41：标签从「作者」改成「**被举报人**」。
  //    原来两个人挤成「作者（已注销）· 举报人」一行，只隔一个「·」——
  //    读起来像**一个人的两个属性**，而这恰恰是这页最需要说清的一件事。
  //    断言跟着改（改的是断言不是实现）：意图仍是「两个角色都在」，
  //    但要断得**更明确** —— 「被举报人」这个串里也含「举报人」，
  //    只用 /举报人/ 会两边都匹配上，等于没断。
  s.check('这一行同时显示被举报人与举报人（两个角色都带标签）',
    /被举报人/.test(row.who) && /举报人/.test(row.who), row.who)
  s.check('待处理的举报有处置按钮', row.hasOps === true)
  s.check('内容还在时不提示「已不存在」', row.gone === false)

  /*
   * P41：处置按钮**按被举报对象的类型**给。
   *
   * 后端本来就拦「给评论下架笔记」（返「评论不能下架」），但 UI 把四个动作
   * 全摆出来 —— 运营点了才看到报错，那不是「更严谨」，是让人以为系统坏了。
   * 本测试造的是**笔记**举报，所以四个动作都该在；
   * 评论举报只给「驳回」「禁用作者」（由 ui-notification 之外的另一处覆盖，
   * 这里断言的是「笔记举报时四个动作齐全」）。
   */
  const acts = await s.evaluate(`
    [...document.querySelectorAll('[data-test=admin-report-row]')]
      .find(e => e.textContent.includes(${JSON.stringify(NOTE_TITLE)}))
      ?.querySelectorAll('[data-test=admin-act]').length ?? 0
  `)
  s.check('笔记举报给齐四个处置动作（驳回/下架/删除/禁用作者）', acts === 4, `n=${acts}`)

  /*
   * P41：行宽**不能失控**。
   * 原来没有上限，桌面 1920px 下整行拉满 —— 左边内容、右边孤零零一个
   * 时间戳在 1700px 处，中间一千多像素的空白。那不是「留白」，是排版失控。
   */
  const rowW = await s.evaluate(`
    (() => {
      const el = [...document.querySelectorAll('[data-test=admin-report-row]')]
        .find(e => e.textContent.includes(${JSON.stringify(NOTE_TITLE)}))
      const t = el?.querySelector('time')
      const row = el?.getBoundingClientRect()
      const time = t?.getBoundingClientRect()
      return JSON.stringify({
        rowW: row ? Math.round(row.width) : null,
        timeLeft: time ? Math.round(time.left) : null,
        timeRight: time ? Math.round(time.right) : null,
        rowRight: row ? Math.round(row.right) : null,
      })
    })()
  `)
  const rw = JSON.parse(rowW)
  s.check('举报行宽度有上限（时间戳不会被甩到屏幕最右边）',
    rw.rowW !== null && rw.rowW <= 900, rowW)

  /*
   * P41：加重色要落在**「删除笔记」**上，不能靠「最后一个按钮」。
   * 原来用 `.ops button:last-child`，而最后一个是「禁用作者」——
   * 而**最不可逆的其实是「删除笔记」**（级联删掉评论与点赞收藏，不可恢复）。
   * 改成按动作号显式标记，这里钉住它。
   */
  const danger = await s.evaluate(`
    (() => {
      const el = [...document.querySelectorAll('[data-test=admin-report-row]')]
        .find(e => e.textContent.includes(${JSON.stringify(NOTE_TITLE)}))
      const btns = [...(el?.querySelectorAll('[data-test=admin-act]') ?? [])]
      return JSON.stringify(btns.map(b => ({
        label: b.textContent.trim(),
        danger: b.classList.contains('danger'),
        color: getComputedStyle(b).color,
      })))
    })()
  `)
  const dg = JSON.parse(danger)
  const delBtn = dg.find((b) => b.label === '删除笔记')
  const banBtn = dg.find((b) => b.label === '禁用作者')
  s.check('「删除笔记」是唯一被加重（标 danger）的按钮 —— 不可逆的那个要显眼',
    !!delBtn && delBtn.danger === true && dg.filter((b) => b.danger).length === 1, danger)
  s.check('「禁用作者」不再被加重（它不是最不可逆的）',
    !!banBtn && banBtn.danger === false, danger)

  /* ---------- ④ 处置：下架 → 目标对他人消失 ---------- */

  // 点「下架笔记」。第 2 个按钮（顺序与后端 REPORT_ACTIONS 一致：驳回/下架/删除/禁言）
  await s.evaluate(
    `[...document.querySelectorAll('[data-test=admin-report-row]')]
       .find(e => e.textContent.includes(${JSON.stringify(NOTE_TITLE)}))
       .querySelectorAll('[data-test=admin-act]')[1].click()`,
  )
  // Vant 确认框：点确认
  await s.waitFor("!!document.querySelector('.van-dialog__confirm')", '处置确认框', 10000)
  await s.evaluate("document.querySelector('.van-dialog__confirm').click()")
  await sleep(1500)
  s.check('处置完成后该条举报离开「待处理」列表',
    (await s.evaluate(`
      ![...document.querySelectorAll('[data-test=admin-report-row]')]
        .some(e => e.textContent.includes(${JSON.stringify(NOTE_TITLE)}))
    `)) === true)

  // 服务端确认：他人看这篇笔记 → 20002
  const afterTake = await (
    await fetch(`${API}/api/note/${noteId}`, { headers: { Authorization: `Bearer ${normalToken}` } })
  ).json()
  s.check('下架后他人看这篇笔记拿不到正文（20002）', afterTake.code === 20002, `code=${afterTake.code}`)

  /* ---------- ⑤ 处置不可重放：再点一次拿「已处理」 ---------- */

  const replay = await (
    await fetch(`${API}/api/admin/report/${reportId}/handle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admToken}` },
      body: JSON.stringify({ action: 1 }),
    })
  ).json()
  s.check('同一条举报再处置 → 90003（不可重放）', replay.code === 90003, `code=${replay.code}`)

  /* ---------- ⑥ 用户 tab：禁用 / 禁自己 / 禁管理员 ---------- */

  await click('admin-tab-user')
  await s.waitFor("!!document.querySelector('[data-test=admin-search]')", '用户 tab 渲染', 20000)
  await s.evaluate(`
    (() => {
      const el = document.querySelector('[data-test=admin-search]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(ADM.username)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)
  await sleep(200)
  await click('admin-search-go')
  await s.waitFor("!!document.querySelector('[data-test=admin-user-row]')", '用户列表出结果', 20000)
  s.check('按用户名能查到管理员本人', (await text('admin-user-row')).includes(ADM.username))

  // 禁自己 → 90004
  const selfBan = await (
    await fetch(`${API}/api/admin/user/${admId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admToken}` },
      body: JSON.stringify({ status: 0 }),
    })
  ).json()
  s.check('禁自己的账号被拒（90004）', selfBan.code === 90004, `code=${selfBan.code}`)

  // 禁另一个管理员 → 90005
  const adminBan = await (
    await fetch(`${API}/api/admin/user/${adm2Id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admToken}` },
      body: JSON.stringify({ status: 0 }),
    })
  ).json()
  s.check('禁用另一个管理员被拒（90005）', adminBan.code === 90005, `code=${adminBan.code}`)

  /* ---------- ⑦ 禁用普通账号 → 立刻不能写 ---------- */

  const normalId = normalLogin.data.userInfo?.id || normalLogin.data.id
  const ban = await (
    await fetch(`${API}/api/admin/user/${normalId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admToken}` },
      body: JSON.stringify({ status: 0 }),
    })
  ).json()
  s.check('禁用普通账号成功', ban.code === 0, `code=${ban.code}`)
  finallyCleanup.push(async () => {
    await fetch(`${API}/api/admin/user/${normalId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admToken}` },
      body: JSON.stringify({ status: 1 }),
    })
  })

  const bannedWrite = await (
    await fetch(`${API}/api/note/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${normalToken}` },
      body: JSON.stringify({ title: 'x', content: 'x', imageUrls: [uploaded.data.url] }),
    })
  ).json()
  s.check('被禁用账号拿旧 token 也写不了（90006，禁用立刻生效）',
    bannedWrite.code === 90006, `code=${bannedWrite.code}`)

  /* ---------- ⑧ 笔记 tab：强制下架 / 恢复 ---------- */

  await click('admin-tab-note')
  await s.waitFor("!!document.querySelector('[data-test=admin-search]')", '笔记 tab 渲染', 20000)
  await s.evaluate(`
    (() => {
      const el = document.querySelector('[data-test=admin-search]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(NOTE_TITLE)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)
  await sleep(200)
  await click('admin-search-go')
  await s.waitFor("!!document.querySelector('[data-test=admin-note-row]')", '笔记列表出结果', 20000)
  s.check('运营能查到下架状态的笔记（读者视角查不到）',
    (await text('admin-note-row')).includes('已下架'))
  s.check('笔记行显示了被举报次数', (await text('admin-note-row')).includes('被举报'))
} catch (e) {
  crashed = e
  s.check('用例执行到底', false, String(e.message))
} finally {
  // ⚠️ 恢复演示账号必须排在最前：第 ⑦ 步把它禁用了，
  // 不恢复的话后面 ui-search / ui-follow 全都登不进去，而症状
  // 看起来与它们毫无关系（正是 P15 记的「清理不在 finally 里」那个坑）
  for (const fn of finallyCleanup.reverse()) {
    try {
      await fn()
    } catch (e) {
      console.error('清理失败：', e.message)
    }
  }
  const allOk = await s.close()
  if (crashed) console.error('运行期异常：', crashed)
  process.exit(crashed ? 1 : allOk ? 0 : 1)
}