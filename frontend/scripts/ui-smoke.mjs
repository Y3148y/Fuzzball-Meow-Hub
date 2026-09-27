/**
 * 登录/注册全链路冒烟。
 *
 * 覆盖：未登录被守卫拦、吉祥物与 CSS 真的加载、演示账号登录、双 token 落库、
 * 首页展示昵称、刷新保持登录、深浅双模式与持久化、退出登录、注册、前端校验。
 *
 * 跑法（要先起 dev server）：npm run test:ui
 */
import { createSession, preflight } from './ui-cdp.mjs'

const BASE = 'http://localhost:5180'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 注册冒烟用的固定账号。
 * 刻意不用时间戳：每次跑都造一个新账号的话，库里的垃圾行会随运行次数无上限增长。
 * 固定成一条常驻 fixture 后，既不会涨，后续测试也能直接复用它。
 */
const SMOKE_USERNAME = 'xk_ui_smoke'

// 必须在起浏览器之前：dev server 挂了要给出「去起服务」的提示，
// 否则报错会是 CDP 连接超时，看着像功能坏了。
try {
  await preflight()
} catch (e) {
  console.error(String(e.message))
  process.exit(2)
}

const s = await createSession({ name: 'smoke' })
let ok = true

try {
  // 1. 未登录访问 / 应被守卫弹到 #/login
  await s.goto(`${BASE}/#/`)
  await s.waitFor("location.hash.startsWith('#/login')", '守卫重定向', 20000)
  s.check('未登录访问 / 被守卫重定向到 #/login', true, await s.evaluate('location.hash'))

  // 2. 吉祥物和 CSS 都真的加载了
  await s.waitFor("document.querySelector('.mascot')?.complete", '吉祥物解码')
  s.check('吉祥物 WebP 实际解码成功（非 404 占位）',
    await s.evaluate("document.querySelector('.mascot')?.naturalWidth > 0"),
    `naturalWidth=${await s.evaluate("document.querySelector('.mascot')?.naturalWidth")}`)

  s.check('CSS token 生效（body 背景取到 --xk-bg）', (await waitBodyBg()) !== 'rgba(0, 0, 0, 0)',
    `body bg=${await waitBodyBg()}`)

  // 3. 演示账号填充 → 提交
  await s.waitFor("document.querySelector('.demo')", '演示账号按钮')
  await s.evaluate("document.querySelector('.demo').click()")
  await sleep(250)
  const filled = await s.evaluate(
    "[...document.querySelectorAll('.xk-input')].map((i) => i.value).join('|')",
  )
  s.check('点击「用演示账号填充」后表单被填入', filled === 'xiaoku_demo|Xk@123456', filled)

  await s.evaluate("document.querySelector('.xk-btn').click()")
  try {
    await s.waitFor("location.hash === '#/'", '登录成功跳转', 20000)
    s.check('登录成功并跳转到 #/', true)
  } catch {
    const err = await s.evaluate("document.querySelector('.error')?.textContent?.trim() || '(无提示)'")
    s.check('登录成功并跳转到 #/', false, `hash=${await s.evaluate('location.hash')} 提示=${err}`)
    throw new Error('登录失败，后续用例无意义')
  }

  // 4. 双 token 落库
  const tokens = await s.evaluate(
    "JSON.stringify({a: !!localStorage.getItem('xk_token'), r: !!localStorage.getItem('xk_refresh_token')})",
  )
  s.check('access + refresh 双 token 都已写入 localStorage', tokens === '{"a":true,"r":true}', tokens)

  // 5. 首页展示昵称
  await s.waitFor("document.querySelector('.nickname')?.textContent?.trim() === '小哭猫'", '昵称渲染')
  s.check('首页展示后端返回的昵称', true, '昵称=小哭猫')

  // 6. 刷新保持登录（走 App.vue 的 restore → /me）
  await s.goto(`${BASE}/#/`)
  await s.waitFor("document.querySelector('.nickname')?.textContent?.trim() === '小哭猫'", '刷新后昵称', 20000)
    .catch(() => false)
  s.check('刷新页面后仍是登录态（store.restore 拉 /me）',
    await s.evaluate("document.querySelector('.nickname')?.textContent?.trim() === '小哭猫'"))

  // 7. 深浅双模式
  const before = await s.evaluate("document.documentElement.dataset.theme")
  await s.evaluate("document.querySelector('.theme-toggle').click()")
  await sleep(400)
  const after = await s.evaluate("document.documentElement.dataset.theme")
  s.check('主题切换生效', before !== after, `${before} -> ${after}`)
  s.check('切换时同步了 Vant 的 .van-theme-dark',
    (await s.evaluate("document.documentElement.classList.contains('van-theme-dark')")) === (after === 'dark'),
    `theme=${after}`)

  // 8. 刷新后主题被记住
  await s.goto(`${BASE}/#/`)
  await sleep(800)
  s.check('刷新后主题选择被持久化', (await s.evaluate("document.documentElement.dataset.theme")) === after)

  // 9. 退出登录
  await s.evaluate("document.querySelector('.xk-btn--ghost').click()")
  await sleep(800)
  s.check('退出登录清空双 token',
    await s.evaluate("!localStorage.getItem('xk_token') && !localStorage.getItem('xk_refresh_token')"))
  s.check('退出后回到登录页', (await s.evaluate('location.hash')).startsWith('#/login'),
    await s.evaluate('location.hash'))

  await s.goto(`${BASE}/#/`)
  await s.waitFor("location.hash.startsWith('#/login')", '退出后再拦截', 20000)
    .catch(() => false)
  s.check('退出后再访问 / 仍被守卫拦截',
    await s.evaluate("location.hash.startsWith('#/login')"))

  // 10. 注册流程
  // 用户名固定，不用时间戳：每次跑都造一个新账号的话，跑一百次就多一百行垃圾数据。
  // 固定账号 + 容忍「用户名已被占用」= 库里恒为一条常驻 fixture，后面测试还能直接复用。
  await s.evaluate("[...document.querySelectorAll('.tab')][1].click()")
  await sleep(250)
  const missing = await fill(s, [['用户名', SMOKE_USERNAME], ['昵称', '界面测试猫'], ['密码', 'Xk@123456']])
  s.check('注册表单三个字段都能按 label 定位', missing.length === 0, JSON.stringify(missing))
  await sleep(250)
  await s.evaluate("document.querySelector('.xk-btn').click()")
  await sleep(2000)
  const regMsg = await s.evaluate("document.querySelector('.error')?.textContent?.trim() || ''")
  // 首次跑会真的注册成功；之后再跑会拿到 10003「用户名已被占用」，
  // 这同样说明请求打到了后端并走完了校验 + 唯一索引，两个分支都算通过
  const isFresh = regMsg.includes('注册成功')
  const isReused = regMsg.includes('已被占用')
  s.check('注册流程走通（首次新注册 / 之后复用固定账号）', isFresh || isReused,
    `${SMOKE_USERNAME} → ${regMsg}`)
  if (isFresh) {
    s.check('注册成功提示用成功色而非红色',
      await s.evaluate("!!document.querySelector('.error--ok')"))
  } else {
    s.log('复用固定账号，跳过成功色断言（此时提示是 error 态）')
  }

  // 11. 前端校验拦非法输入
  await s.evaluate("[...document.querySelectorAll('.tab')][1].click()")
  await sleep(200)
  await fill(s, [['用户名', 'bad name!'], ['密码', 'short']])
  await sleep(200)
  await s.evaluate("document.querySelector('.xk-btn').click()")
  await sleep(500)
  const vmsg = await s.evaluate("document.querySelector('.error')?.textContent?.trim() || ''")
  s.check('前端校验拦下非法用户名/过短密码', vmsg.includes('用户名'), vmsg)
} catch (e) {
  ok = false
  s.check('用例执行', false, String(e.message ?? e))
} finally {
  ok = (await s.close()) && ok
  process.exit(ok ? 0 : 1)
}

/** 等 dev 模式下由 JS 注入的样式真正落到 body 上 */
async function waitBodyBg() {
  for (let i = 0; i < 60; i++) {
    const c = await s.evaluate("getComputedStyle(document.body).backgroundColor")
    if (c && c !== 'rgba(0, 0, 0, 0)') return c
    await sleep(150)
  }
  return 'rgba(0, 0, 0, 0)'
}

/** 按 label 文字定位输入框：注册态会多一个「昵称」框，按下标填会错位 */
async function fill(session, pairs) {
  const r = await session.evaluate(`(() => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const fields = [...document.querySelectorAll('.field')]
    const missing = []
    for (const [label, value] of ${JSON.stringify(pairs)}) {
      const f = fields.find((x) => x.querySelector('.label')?.textContent.includes(label))
      if (!f) { missing.push(label); continue }
      set(f.querySelector('input'), value)
    }
    return JSON.stringify(missing)
  })()`)
  return JSON.parse(r)
}
