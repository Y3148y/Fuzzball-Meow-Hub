/**
 * 专项验证 JWT 双 token 刷新链路 —— 最容易被改坏、又最难手测的部分。
 *
 * 手法：登录后把 localStorage 里的 accessToken 换成垃圾串再整页重载。
 * 冷启动时 token.ts 的 ref 会读到这个坏值，isLogin 仍为 true，
 * 于是 store.restore() 打 /me 必然拿到 10006，正好触发「刷新 → 重放原请求」。
 *
 * 跑法（要先起 dev server）：npm run test:ui:refresh
 */
import { createSession, preflight } from './ui-cdp.mjs'

const BASE = 'http://localhost:5180'

try {
  await preflight()
} catch (e) {
  console.error(String(e.message))
  process.exit(2)
}

const s = await createSession({ name: 'refresh' })
let ok = true

const getLs = (k) => s.evaluate(`localStorage.getItem('${k}')`)
const setLs = async (k, v) =>
  s.evaluate(
    `(() => { ${
      v === null ? `localStorage.removeItem('${k}')` : `localStorage.setItem('${k}', ${JSON.stringify(v)})`
    } })()`,
  )

try {
  // 1. 正常登录，拿到基线 token
  await s.goto(`${BASE}/#/login`)
  await s.waitFor("document.querySelector('.demo')", '登录页')
  await s.evaluate("document.querySelector('.demo').click()")
  await sleep(300)
  await s.evaluate("document.querySelector('.xk-btn').click()")
  await s.waitFor("location.hash === '#/'", '登录成功', 20000)
  const at1 = await getLs('xk_token')
  const rt1 = await getLs('xk_refresh_token')
  s.check('基线：登录拿到 access + refresh', !!at1 && !!rt1, `at=${at1?.length}字 rt=${rt1?.length}字`)

  // 2. 破坏 accessToken 后整页重载 —— 期望静默刷新 + 重放 /me，用户无感
  await setLs('xk_token', 'broken.access.token.value')
  await s.goto(`${BASE}/#/`)

  // 断言不能只看 .nickname 存在：加载中占位符「加载中…」也是非空文本，
  // 那样会在刷新往返完成之前就误判成功。
  let ok2 = true
  try {
    await s.waitFor("document.querySelector('.nickname')?.textContent?.trim() === '小哭猫'",
      '刷新后拿到真实昵称', 20000)
  } catch {
    ok2 = false
  }
  s.check('accessToken 失效后自动 refresh 并重放原请求，没被踢下线', ok2,
    `昵称=${await s.evaluate("document.querySelector('.nickname')?.textContent?.trim() || '(未拿到)'")}`)

  // 3. 新 token 真的落库（watch 是异步 flush，昵称出现说明往返已结束，再读是安全的）
  const at2 = await getLs('xk_token')
  s.check('accessToken 已被换成新值', !!at2 && at2 !== 'broken.access.token.value', `新 at=${at2?.length}字`)

  const rt2 = await getLs('xk_refresh_token')
  s.check('refreshToken 也同步轮换了（后端会轮换）', !!rt2 && rt2 !== rt1,
    `旧 rt=${rt1?.slice(0, 12)}… 新 rt=${rt2?.slice(0, 12)}…`)

  // 4. 双 token 一起坏 —— 期望清理并回登录页
  await setLs('xk_token', 'broken.again')
  await setLs('xk_refresh_token', 'broken.refresh.too')
  await s.goto(`${BASE}/#/`)
  let ok4 = true
  try {
    await s.waitFor("location.hash.startsWith('#/login')", '回登录页', 20000)
  } catch {
    ok4 = false
  }
  s.check('refreshToken 也失效时清理登录态并回登录页', ok4, `hash=${await s.evaluate('location.hash')}`)
  s.check('失效后双 token 被清空',
    await s.evaluate("!localStorage.getItem('xk_token') && !localStorage.getItem('xk_refresh_token')"))

  // 5. 只有坏 accessToken、没有 refreshToken —— 不能无限重试，直接判定登出
  await setLs('xk_token', 'broken.no.refresh')
  await setLs('xk_refresh_token', null)
  await s.goto(`${BASE}/#/`)
  let ok5 = true
  try {
    await s.waitFor("location.hash.startsWith('#/login')", '无 refresh 时回登录页', 20000)
  } catch {
    ok5 = false
  }
  s.check('只有坏 accessToken、没有 refreshToken 时也能安全回登录页', ok5,
    `hash=${await s.evaluate('location.hash')}`)
} catch (e) {
  ok = false
  s.check('用例执行', false, String(e.message ?? e))
} finally {
  ok = (await s.close()) && ok
  process.exit(ok ? 0 : 1)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
