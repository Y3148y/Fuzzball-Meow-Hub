/**
 * P2 用户模块 —— HTTP 契约测试。
 *
 * 为什么不用 JUnit / RestAssured / Testcontainers：
 * 这一层要验的是「HTTP 报文长什么样」——业务码、错误码、双 token 轮换、
 * 鉴权白名单、VO 有没有漏出敏感字段。这些用裸 HTTP 打一遍最直接，
 * 零依赖意味着任何人不装 Maven 插件、不起容器也能跑：
 *
 *     cd backend
 *     node scripts/contract-test.mjs
 *
 * 真正的单元测试 / 集成测试留给后续阶段按需引入（service 层用 Mockito 测分支）。
 * 这里是「接口契约快照」，作用是改 Controller / DTO / 拦截器时能立刻发现
 * 前端依赖的报文形状被改坏了。
 *
 * 依赖：Node 18+（用到全局 fetch）。默认打 http://localhost:8088，
 * 换地址用 XK_API_BASE 覆盖。
 */

const BASE = (process.env.XK_API_BASE ?? 'http://localhost:8088').replace(/\/+$/, '')

// ---------------------------------------------------------------- 迷你断言

let passed = 0
let failed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`PASS  ${name}${detail ? '  ' + detail : ''}`)
  } else {
    failed++
    failures.push(name)
    console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`)
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, actual === expected ? `= ${JSON.stringify(actual)}` : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

/** 断言业务码，同时把服务端 message 打出来方便定位 */
function codeIs(name, body, expected) {
  const actual = body?.code
  check(name, actual === expected,
    actual === expected ? `code=${actual} ${body?.message ?? ''}` : `期望 code=${expected}，实际 code=${actual} (${body?.message ?? '无 message'})`)
}

// ---------------------------------------------------------------- HTTP 助手

async function call(method, path, { token, body, raw } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = token
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    if (raw) return { status: res.status, text, json: null }
  }
  return { status: res.status, json, text }
}

const get = (p, o) => call('GET', p, o)
const post = (p, o) => call('POST', p, o)
const put = (p, o) => call('PUT', p, o)

// ---------------------------------------------------------------- 预检

async function preflight() {
  try {
    const { json } = await get('/api/system/ping')
    if (json?.code !== 0) throw new Error(`ping 返回 code=${json?.code}`)
  } catch (e) {
    console.error(`\n预检失败：连不上后端 ${BASE}`)
    console.error(`  ${e.message}`)
    console.error(`  先启动：cd backend && mvnw.cmd spring-boot:run`)
    console.error(`  或用 XK_API_BASE 指向别的地址\n`)
    process.exit(2)
  }
}

// ---------------------------------------------------------------- 用例

/** 每次跑用随机用户名，避免和上一轮残留数据冲突 */
const stamp = Date.now().toString(36).slice(-6)
const U = `ct_${stamp}`
const P = 'Xk@123456'

async function main() {
  await preflight()
  console.log(`目标 ${BASE}，测试账号 ${U}\n`)

  // ---- 1. 健康检查在白名单里，不带 token 也能过
  {
    const { status, json } = await get('/api/system/ping')
    codeIs('健康检查免鉴权', json, 0)
    check('健康检查返回 HTTP 200', status === 200, `status=${status}`)
  }

  // ---- 2. 鉴权：白名单之外的接口默认全部要登录
  {
    const { json } = await get('/api/user/me')
    codeIs('不带 token 访问 /me 被拒（10005）', json, 10005)
  }
  {
    const { json } = await get('/api/user/me', { token: 'Bearer not-a-real-jwt' })
    codeIs('带坏 token 访问 /me 被拒（10006）', json, 10006)
  }
  {
    const { json } = await put('/api/user/profile', { body: { nickname: 'x' } })
    codeIs('不带 token 写接口同样被拒（白名单必须收紧）', json, 10005)
  }

  // ---- 3. 参数校验
  {
    const { json } = await post('/api/user/register', { body: { username: 'ab', password: '123' } })
    codeIs('注册参数非法被拦（100001）', json, 100001)
    check('校验失败时带上了具体原因', typeof json?.message === 'string' && json.message.length > 0, `"${json?.message}"`)
  }
  {
    const { json } = await post('/api/user/register', { body: { username: 'bad-name!', password: P } })
    codeIs('用户名含非法字符被拦（100001）', json, 100001)
  }
  {
    // 6 位，低于 @Size(min = 8)
    const { json } = await post('/api/user/login', { body: { username: U, password: 'Xk@123' } })
    codeIs('登录口令过短被拦（100001）', json, 100001)
  }

  // ---- 4. 注册
  let userId = null
  {
    const { json } = await post('/api/user/register', { body: { username: U, password: P, nickname: '契约测试' } })
    codeIs('注册成功', json, 0)
    userId = json?.data?.id
    check('注册返回用户 ID', typeof userId === 'number' || typeof userId === 'bigint', `id=${userId}`)
    eq('注册返回的 username 正确', json?.data?.username, U)
    eq('注册返回的 nickname 取了传入值', json?.data?.nickname, '契约测试')
  }
  {
    // 最重要的一条：Entity 里有 password，VO 里绝不能有。
    const { json } = await post('/api/user/register', { body: { username: `ct2_${stamp}`, password: P } })
    const keys = Object.keys(json?.data ?? {})
    check('UserVO 没有漏出 password 字段', !keys.includes('password'), `字段=${keys.join(',')}`)
    check('UserVO 也没有漏出 status/deleted 等内部字段',
      !keys.includes('status') && !keys.includes('deleted'),
      `字段=${keys.join(',')}`)
    eq('未传 nickname 时回落到 username', json?.data?.nickname, `ct2_${stamp}`)
  }
  {
    const { json } = await post('/api/user/register', { body: { username: U, password: P } })
    codeIs('同名重复注册被拒（10003）', json, 10003)
  }

  // ---- 5. 登录：用户不存在与口令错误必须返回同一个码（防枚举）
  {
    const { json } = await post('/api/user/login', { body: { username: U, password: 'WrongPass123' } })
    const wrongPwd = json?.code
    const wrongPwdMsg = json?.message
    const { json: j2 } = await post('/api/user/login', { body: { username: `nobody_${stamp}`, password: 'WrongPass123' } })
    eq('用户不存在与口令错误返回同一个错误码（防用户名枚举）', j2?.code, wrongPwd)
    check('两个场景的提示文案也一致（否则仍可枚举）', j2?.message === wrongPwdMsg, `"${wrongPwdMsg}"`)
    codeIs('口令错误返回 10002', { code: wrongPwd }, 10002)
  }

  // ---- 6. 登录成功 → 双 token
  let access = null
  let refresh = null
  {
    const { json } = await post('/api/user/login', { body: { username: U, password: P } })
    codeIs('登录成功', json, 0)
    access = json?.data?.accessToken
    refresh = json?.data?.refreshToken
    check('拿到 accessToken', typeof access === 'string' && access.split('.').length === 3, `${String(access).slice(0, 24)}…`)
    check('拿到 refreshToken', typeof refresh === 'string' && refresh.split('.').length === 3, `${String(refresh).slice(0, 24)}…`)
    check('access 与 refresh 不是同一个 token', access !== refresh)
    check('返回 expiresIn', Number.isFinite(json?.data?.expiresIn) && json.data.expiresIn > 0, `expiresIn=${json?.data?.expiresIn}s`)
    check('登录响应里带 userInfo', typeof json?.data?.userInfo?.id !== 'undefined', `userId=${json?.data?.userInfo?.id}`)
  }

  // ---- 7. 带 access 访问受保护接口
  {
    const { json } = await get('/api/user/me', { token: `Bearer ${access}` })
    codeIs('带 access token 访问 /me 成功', json, 0)
    eq('/me 返回的 username 正确', json?.data?.username, U)
  }
  {
    const { json } = await get('/api/user/me/context', { token: `Bearer ${access}` })
    codeIs('ThreadLocal 上下文注入成功', json, 0)
    eq('上下文里的 userId 与登录用户一致', json?.data?.userId ?? json?.data?.userID ?? json?.data?.id, userId)
  }
  {
    // 类型隔离：refresh token 不能当 access 用，否则等于绕过 access 的有效期
    const { json } = await get('/api/user/me', { token: `Bearer ${refresh}` })
    codeIs('拿 refresh token 当 access 用被拒（10006）', json, 10006)
  }

  // ---- 8. 刷新：轮换 + 类型校验
  {
    const { json } = await post('/api/user/refresh', { query: '' }) // 无 query 参数
    codeIs('refresh 缺参数被拦（100001）', json, 100001)
  }
  {
    const { json } = await post(`/api/user/refresh?refreshToken=${encodeURIComponent(access)}`)
    codeIs('拿 access token 去刷新被拒（10006 类型不符）', json, 10006)
  }
  {
    const { json } = await post(`/api/user/refresh?refreshToken=garbage`)
    codeIs('refresh 传垃圾 token 被拒（10006）', json, 10006)
  }
  let newAccess = null
  let newRefresh = null
  {
    const { json } = await post(`/api/user/refresh?refreshToken=${encodeURIComponent(refresh)}`)
    codeIs('refresh 成功', json, 0)
    newAccess = json?.data?.accessToken
    newRefresh = json?.data?.refreshToken
    check('刷新后拿到新的 accessToken', typeof newAccess === 'string' && newAccess.length > 0)
    check('refreshToken 也同步轮换了（防重放）', newRefresh !== refresh, `旧 ${String(refresh).slice(12, 26)}… → 新 ${String(newRefresh).slice(12, 26)}…`)
    const { json: j2 } = await get('/api/user/me', { token: `Bearer ${newAccess}` })
    codeIs('刷新后的 access 可以正常访问 /me', j2, 0)
  }

  // ---- 9. 部分更新资料
  {
    const { json } = await put('/api/user/profile', {
      token: `Bearer ${newAccess}`,
      body: { nickname: '改名后', gender: 2 },
    })
    codeIs('修改个人资料成功', json, 0)
    eq('nickname 已更新', json?.data?.nickname, '改名后')
    eq('gender 已更新', json?.data?.gender, 2)
  }
  {
    const { json } = await put('/api/user/profile', {
      token: `Bearer ${newAccess}`,
      body: { nickname: 'x'.repeat(33) },
    })
    codeIs('昵称超长被拦（100001）', json, 100001)
  }
  {
    const { json } = await put('/api/user/profile', {
      token: `Bearer ${newAccess}`,
      body: { gender: 9 },
    })
    codeIs('性别越界被拦（100001）', json, 100001)
  }

  // ---- 10. 不支持的方法
  {
    const { json } = await call('DELETE', '/api/user/login')
    codeIs('不支持的请求方法被统一处理（100002）', json, 100002)
  }

  // ---- 汇总
  const total = passed + failed
  console.log(`\n===== ${passed}/${total} 通过 =====`)
  if (failed > 0) {
    console.log(`失败用例：\n${failures.map((f) => '  - ' + f).join('\n')}`)
    process.exit(1)
  }
  // 本脚本只走 HTTP，没有删用户接口，跑完会留下 2 个测试账号。
  // 这里直接把清理 SQL 打出来，省得下次翻聊天记录找。
  console.log(`\n测试账号 ${U} / ct2_${stamp} 已留在库里，清理：`)
  console.log(`  DELETE FROM xiaoku_db.user WHERE username IN ('${U}', 'ct2_${stamp}');`)
}

main().catch((e) => {
  console.error('\n契约测试自身异常：', e)
  process.exit(1)
})
