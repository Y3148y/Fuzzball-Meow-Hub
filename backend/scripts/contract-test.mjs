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
 * 覆盖范围：P2 用户模块（注册/登录/刷新/资料），P3 笔记域（上传/发布/详情）。
 *
 * 依赖：Node 18+（用到全局 fetch 与 FormData）。默认打 http://localhost:8088，
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
const del = (p, o) => call('DELETE', p, o)

/** 1x1 透明 PNG，用来测图片上传 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')

/**
 * multipart 图片上传。
 *
 * <b>刻意不手写 multipart 报文</b>：boundary 的换行、结尾 CRLF 一旦写错，
 * 测出来的是「服务器解析失败」而不是「业务逻辑对不对」，属于自己骗自己。
 * 用 FormData 让 undici 自己拼 boundary，和浏览器/前端发出来的形态一致。
 */
async function uploadImage(token, { name = 'tiny.png', type = 'image/png', bytes = TINY_PNG } = {}) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), name)
  const res = await fetch(`${BASE}/api/note/image`, {
    method: 'POST',
    // 只带 Authorization：Content-Type 必须由 fetch 自己填，否则少了 boundary
    headers: token ? { Authorization: token } : {},
    body: form,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 保留 raw 形态供断言 */
  }
  return { status: res.status, json, text }
}

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
    check('注册返回用户 ID', typeof userId === 'string' && /^\d+$/.test(userId), `id=${userId}`)
    // 雪花 ID 是 10^17 量级，JS 的 Number 存不下，超过 MAX_SAFE_INTEGER
    // 会被静默四舍五入，回传后端就变成另一个 ID，表现为「明明有数据却查不到」。
    // 所以后端必须把 Long 序列化成字符串，这里把这条钉死。
    check('用户 ID 是字符串而不是 JSON 数字（否则前端会静默丢精度）',
      typeof json?.data?.id === 'string', `实际类型 ${typeof json?.data?.id}`)
    check('用户 ID 精度未被截断（与 ping 的雪花样本同量级）',
      BigInt(userId) > 9007199254740991n, `BigInt=${userId}`)
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

  // ---- 10. P3 笔记域：图片上传
  const createdNoteIds = []
  const auth = `Bearer ${newAccess}`
  {
    const { json } = await post('/api/note/publish', { body: { title: 't', content: 'c' } })
    codeIs('未登录不能发布笔记（10005）', json, 10005)
  }
  {
    const { json } = await uploadImage(undefined)
    codeIs('未登录不能上传图片（10005）', json, 10005)
  }
  {
    const { json } = await uploadImage(auth, { type: 'application/x-sh', bytes: Buffer.from('#!/bin/sh\nrm -rf /\n') })
    codeIs('非图片类型被拒（100001）', json, 100001)
  }
  {
    const { json } = await uploadImage(auth, { bytes: Buffer.alloc(0) })
    codeIs('空文件被拒（100001）', json, 100001)
  }

  let imageUrl = null
  {
    // 文件名故意写成路径穿越形态：服务端必须无视它
    const { json } = await uploadImage(auth, { name: '../../../../etc/cron.d/evil.png' })
    codeIs('上传真实 PNG 成功', json, 0)
    imageUrl = json?.data?.url
    check('返回的是 /static/uploads/ 下的 URL', typeof imageUrl === 'string' && imageUrl.startsWith('/static/uploads/'), `url=${imageUrl}`)
    check('落盘文件名由服务端生成，不含原始文件名（防路径穿越/扩展名伪装）',
      /^\/static\/uploads\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f]{32}\.png$/.test(imageUrl ?? ''),
      imageUrl ?? 'null')
  }
  {
    // 上传完必须真的能取到，否则前端 <img> 全是碎图
    const res = await fetch(`${BASE}${imageUrl}`)
    eq('上传后的图片可以通过静态映射取回', res.status, 200)
    check('Content-Type 是图片类型', (res.headers.get('content-type') ?? '').startsWith('image/'),
      `content-type=${res.headers.get('content-type')}`)
  }

  // ---- 11. P3 笔记域：发布
  let noteId = null
  {
    const { json } = await post('/api/note/publish', {
      token: auth,
      body: { title: '契约测试笔记', content: '正文内容', imageUrls: [imageUrl] },
    })
    codeIs('发布笔记成功', json, 0)
    noteId = json?.data?.id
    createdNoteIds.push(noteId)
    check('返回笔记 ID', typeof noteId === 'string' && /^\d+$/.test(noteId), `noteId=${noteId}`)
    eq('封面缺省取第一张图', json?.data?.cover, imageUrl)
    eq('图片列表原样返回', JSON.stringify(json?.data?.images), JSON.stringify([imageUrl]))
    eq('作者昵称带出', json?.data?.authorNickname, '改名后')
    eq('未点赞时 liked 为 false', json?.data?.liked, false)
    const keys = Object.keys(json?.data ?? {})
    check('NoteVO 没有漏出内部字段 userId', !keys.includes('userId'), `字段=${keys.join(',')}`)
  }
  {
    const { json } = await post('/api/note/publish', { token: auth, body: { title: '', content: 'c' } })
    codeIs('空标题被拦（100001）', json, 100001)
  }
  {
    const { json } = await post('/api/note/publish', { token: auth, body: { title: 't', content: 'x'.repeat(2001) } })
    codeIs('正文超 2000 字被拦（100001）', json, 100001)
  }
  {
    const { json } = await post('/api/note/publish', { token: auth, body: { title: 'x'.repeat(65), content: 'c' } })
    codeIs('标题超 64 字被拦（100001）', json, 100001)
  }
  {
    // 9 张是上限，10 张才越界：边界两侧都要测，只测 10 的话把 @Size 写成 10 也会通过
    const nine = Array.from({ length: 9 }, () => imageUrl)
    const { json } = await post('/api/note/publish', { token: auth, body: { title: '九图边界', content: 'c', imageUrls: nine } })
    codeIs('9 张图在上限内，可以发布', json, 0)
    createdNoteIds.push(json?.data?.id)
  }
  {
    const ten = Array.from({ length: 10 }, () => imageUrl)
    const { json } = await post('/api/note/publish', { token: auth, body: { title: '十图超限', content: 'c', imageUrls: ten } })
    codeIs('10 张图越界，用专用错误码 20004 而不是通用 100001', json, 20004)
  }
  {
    const { json } = await post('/api/note/publish', {
      token: auth,
      body: { title: 'xss', content: 'c', imageUrls: ['javascript:alert(1)'] },
    })
    codeIs('javascript: 图片地址被拒（100001，避免渲染成 XSS）', json, 100001)
  }
  {
    const { json } = await post('/api/note/publish', {
      token: auth,
      body: { title: 'data', content: 'c', imageUrls: ['data:text/html;base64,PHNjcmlwdD4='] },
    })
    codeIs('data: 图片地址被拒（100001）', json, 100001)
  }
  {
    const { json } = await post('/api/note/publish', { token: auth, body: { title: '视频', content: 'c', type: 2 } })
    codeIs('视频笔记缺 videoUrl 被拦（100001）', json, 100001)
  }
  {
    const { json } = await post('/api/note/publish', { token: auth, body: { title: '类型', content: 'c', type: 9 } })
    codeIs('非法笔记类型被拦（100001）', json, 100001)
  }

  // ---- 12. P3 笔记域：详情
  {
    const { json } = await get(`/api/note/${noteId}`, { token: auth })
    codeIs('查看笔记详情成功', json, 0)
    eq('标题回显正确', json?.data?.title, '契约测试笔记')
    eq('图片列表顺序保持上传顺序', JSON.stringify(json?.data?.images), JSON.stringify([imageUrl]))
  }
  {
    const { json } = await get('/api/note/123456789012345', { token: auth })
    codeIs('查不存在的笔记返回 20001', json, 20001)
  }
  {
    const { json } = await get(`/api/note/${noteId}`)
    codeIs('未登录不能看笔记详情（10005，默认全部需要登录）', json, 10005)
  }

  // ---- 13. P5 互动域：点赞 / 收藏
  //
  // 需要第三个账号：note 的作者是 ct_，而规则禁止评论自己的笔记（30007），
  // 点赞/收藏也要一个「非作者」来点，否则测不到 30007 这条规则。
  let actorAuth = null
  let actorName = `ct3_${stamp}`
  {
    const reg = await post('/api/user/register', { body: { username: actorName, password: P } })
    codeIs('互动测试账号注册成功', reg.json, 0)
    const login = await post('/api/user/login', { body: { username: actorName, password: P } })
    actorAuth = `Bearer ${login.json?.data?.accessToken}`
    check('互动测试账号登录成功', typeof actorAuth === 'string' && actorAuth.length > 5)
  }

  // 点赞：幂等 + 计数
  {
    const { json } = await put(`/api/note/${noteId}/like`, { token: actorAuth })
    codeIs('点赞成功', json, 0)
    eq('点赞后 likeCount=1', json?.data?.likeCount, 1)
    eq('点赞后 liked=true', json?.data?.liked, true)
  }
  {
    const { json } = await put(`/api/note/${noteId}/like`, { token: actorAuth })
    codeIs('重复点赞返回 30001（靠唯一索引，不是先查后插）', json, 30001)
  }
  {
    // 重复点赞失败后计数不能被带偏，这是最容易出错的地方：
    // 如果实现是「先判存在再返回错误」而忘了回滚，计数会多一次
    const { json } = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('重复点赞失败后计数没有被动过', json?.data?.likeCount, 1)
  }
  {
    const { json } = await del(`/api/note/${noteId}/like`, { token: actorAuth })
    codeIs('取消点赞成功', json, 0)
    eq('取消后 likeCount=0', json?.data?.likeCount, 0)
    eq('取消后 liked=false', json?.data?.liked, false)
  }
  {
    const { json } = await del(`/api/note/${noteId}/like`, { token: actorAuth })
    codeIs('没点赞却取消返回 30002（不静默成功，否则前端会以为真取消了）', json, 30002)
  }

  // 收藏：语义与点赞同构
  {
    const { json } = await put(`/api/note/${noteId}/collect`, { token: actorAuth })
    codeIs('收藏成功', json, 0)
    eq('收藏后 collectCount=1', json?.data?.collectCount, 1)
    eq('收藏后 collected=true', json?.data?.collected, true)
  }
  {
    const { json } = await put(`/api/note/${noteId}/collect`, { token: actorAuth })
    codeIs('重复收藏返回 30003', json, 30003)
  }
  {
    const { json } = await del(`/api/note/${noteId}/collect`, { token: actorAuth })
    codeIs('取消收藏成功', json, 0)
    eq('取消后 collectCount=0', json?.data?.collectCount, 0)
  }
  {
    const { json } = await del(`/api/note/${noteId}/collect`, { token: actorAuth })
    codeIs('没收藏却取消返回 30004', json, 30004)
  }
  {
    // 点赞和收藏是两套独立关系，任何一边都不该动另一边的计数。
    // 先收藏让 collectCount 变成 1，再点赞，回来时 collectCount 必须仍是 1
    // ——如果实现里两边共用了同一个字段或同一个自增语句，这里就会变成 0 或 2
    const c1 = await put(`/api/note/${noteId}/collect`, { token: actorAuth })
    eq('先收藏，collectCount=1', c1.json?.data?.collectCount, 1)
    const l1 = await put(`/api/note/${noteId}/like`, { token: actorAuth })
    eq('点赞没有动 collectCount', l1.json?.data?.collectCount, 1)
    eq('点赞后 likeCount=1', l1.json?.data?.likeCount, 1)
    eq('点赞没有动 collected 状态', l1.json?.data?.collected, true)
    await del(`/api/note/${noteId}/like`, { token: actorAuth })
    await del(`/api/note/${noteId}/collect`, { token: actorAuth })
  }
  {
    const { json } = await put('/api/note/123456789012345/like', { token: actorAuth })
    codeIs('给不存在的笔记点赞返回 20001（不能留下指向虚空的脏关系）', json, 20001)
  }
  {
    const { json } = await put(`/api/note/${noteId}/like`)
    codeIs('未登录点赞被拒（10005）', json, 10005)
  }

  // ---- 14. P5 评论
  let commentId = null
  let replyId = null
  {
    const { json } = await post('/api/comment', {
      token: auth,
      body: { noteId, content: '作者评论自己的笔记' },
    })
    codeIs('不能评论自己的笔记（30007，兑现 P0 定下的规则）', json, 30007)
  }
  {
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId, content: '   ' },
    })
    codeIs('纯空白评论被拦（100001）', json, 100001)
  }
  {
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId, content: '字'.repeat(501) },
    })
    codeIs('评论超 500 字被拦（100001）', json, 100001)
  }
  {
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId: '123456789012345', content: '给不存在的笔记评论' },
    })
    codeIs('给不存在的笔记评论返回 20001', json, 20001)
  }
  {
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId, content: '这篇写得不错' },
    })
    codeIs('发表评论成功', json, 0)
    eq('评论内容回显', json?.data?.content, '这篇写得不错')
    eq('自己发的评论 mine=true', json?.data?.mine, true)
    // parentId / rootCommentId 是 Long，0 哨兵已在 CommentConverter 里转成 null。
    //
    // 用 == null 而不是 === null：application.yml 配了
    // default-property-inclusion: non_null，null 字段会被**整个从 JSON 里删掉**，
    // 前端拿到的是 undefined 而不是 null。两种都算通过，
    // 关键是这个字段绝不能是 0 或 "0"。
    check('一级评论 rootCommentId 不是 0 哨兵', json?.data?.rootCommentId == null,
      `实际 ${JSON.stringify(json?.data?.rootCommentId)}`)
    check('一级评论 parentId 不是 0 哨兵', json?.data?.parentId == null,
      `实际 ${JSON.stringify(json?.data?.parentId)}`)
    commentId = json?.data?.id
    check('评论 ID 是字符串（雪花 ID 不能当数字）', typeof commentId === 'string' && /^\d+$/.test(commentId),
      `commentId=${commentId}`)
  }
  {
    const { json } = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('评论后 note.commentCount=1', json?.data?.commentCount, 1)
  }
  {
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId, content: '补充一句', parentId: commentId },
    })
    codeIs('回复评论成功', json, 0)
    eq('回复的 rootCommentId 指向根评论', json?.data?.rootCommentId, commentId)
    eq('回复的 parentId 指向被回复的评论', json?.data?.parentId, commentId)
    replyId = json?.data?.id
  }
  {
    // 两层封顶：回复"回复的回复"要被拉平到同一个根评论下，
    // 否则会出现没人看得懂的无限楼中楼
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId, content: '回复的回复', parentId: replyId },
    })
    codeIs('回复的回复成功', json, 0)
    eq('楼中楼被拉平到同一个根评论', json?.data?.rootCommentId, commentId)
    const { json: j2 } = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('三级回复仍各算一条评论', j2?.data?.commentCount, 3)
  }
  {
    // 跨笔记回复必须拦，否则两篇笔记的评论数会互相污染
    const other = await post('/api/note/publish', {
      token: auth,
      body: { title: '另一篇', content: '另一篇的正文' },
    })
    const otherId = other.json?.data?.id
    createdNoteIds.push(otherId)
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId: otherId, content: '跨笔记回复', parentId: commentId },
    })
    codeIs('跨笔记回复被拒（30005，否则两篇笔记的评论数互相污染）', json, 30005)
  }
  {
    const { json } = await get(`/api/comment/list?noteId=${noteId}&page=1&size=10`, { token: actorAuth })
    codeIs('评论列表查询成功', json, 0)
    // total/page/size 是 Integer 才是 JSON number。PageVO 最初用 long，
    // 会被 JacksonConfig 序列化成字符串，前端 total === 1 恒为 false
    eq('total 是 JSON number 而不是字符串', typeof json?.data?.total, 'number')
    eq('分页 total 只数一级评论', json?.data?.total, 1)
    eq('列表长度 1', json?.data?.list?.length, 1)
    const root = json?.data?.list?.[0]
    eq('子回复挂在根评论下', root?.replies?.length, 2)
    eq('replyTotal 是子回复总数', root?.replyTotal, 2)
    check('子回复带上了昵称', typeof root?.replies?.[0]?.nickname === 'string' && root.replies[0].nickname.length > 0,
      `nickname=${root?.replies?.[0]?.nickname}`)
    eq('子回复的 rootCommentId 指向根评论', root?.replies?.[0]?.rootCommentId, commentId)
  }
  {
    // MAX_REPLIES_PER_ROOT = 3 的截断必须有覆盖：
    // 只造 2 条子回复的话「replies 被截断」这条路径一次都走不到，
    // 阈值调成 10 也照样全绿
    for (let i = 0; i < 4; i++) {
      await post('/api/comment', {
        token: actorAuth,
        body: { noteId, content: `补一条回复 ${i}`, parentId: commentId },
      })
    }
    const { json } = await get(`/api/comment/list?noteId=${noteId}&page=1&size=10`, { token: actorAuth })
    const root = json?.data?.list?.[0]
    eq('子回复超过 3 条时只返回前 3 条', root?.replies?.length, 3)
    eq('replyTotal 仍然是真实总数 6', root?.replyTotal, 6)
    const { json: j2 } = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('6 条子回复都计入了 commentCount', j2?.data?.commentCount, 7)
  }
  {
    // 别人的评论一律按「不存在」处理，不能靠错误码差异探测评论是否存在
    const { json } = await del(`/api/comment/${commentId}`, { token: auth })
    codeIs('删别人的评论返回 30005（不泄露存在性）', json, 30005)
  }
  {
    const { json } = await del('/api/comment/123456789012345', { token: actorAuth })
    codeIs('删不存在的评论返回 30005', json, 30005)
  }
  {
    // 删根评论要连子树一起删，计数一次性退掉，不能循环减
    const { json } = await del(`/api/comment/${commentId}`, { token: actorAuth })
    codeIs('删除自己的评论成功', json, 0)
    const { json: j2 } = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('删根评论后 commentCount 退到 0（自己 + 6 条子回复一次退完）', j2?.data?.commentCount, 0)
    const { json: j3 } = await get(`/api/comment/list?noteId=${noteId}`, { token: actorAuth })
    eq('列表里不再有孤儿子回复', j3?.data?.total, 0)
  }

  // ---- 15. 不支持的方法
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
  // 本脚本只走 HTTP，没有删用户/删笔记接口，跑完会留下测试账号与测试笔记。
  // 这里直接把清理 SQL 打出来，省得下次翻聊天记录找。
  //
  // 顺序有讲究：先子表后父表。comment_like 依赖 comment，comment 又依赖 note。
  //
  // 正则写成 ^ct[0-9]?_ 而不是 ^ct2?_：P5 起有第三个互动账号 ct3_，
  // 原来的正则匹配不到它，会漏一个常驻垃圾账号。
  //
  // <b>所有涉及笔记的删除都必须带 note_id IN (...)</b>，不能写成
  // `DELETE FROM xiaoku_db.comment;` 那种全表清空。
  // 本地库里同时还有演示账号和 xk_ui_* 常驻 fixture 的数据，
  // 一条无 WHERE 的 DELETE 会把它们一起清掉，而这种误删是<b>不可逆</b>的：
  // 脚本跑完只看得到「清理成功」，不会有人发现顺手删掉了别的东西。
  const noteList = createdNoteIds.filter((n) => typeof n === 'string').join(', ')
  console.log(`\n测试账号 ${U} / ct2_${stamp} / ${actorName} 与笔记 ${noteList} 已留在库里，清理：`)
  console.log(`  -- 先子表，comment_like 依赖 comment`)
  console.log(`  DELETE FROM xiaoku_db.comment_like WHERE comment_id IN (SELECT id FROM xiaoku_db.comment WHERE note_id IN (${noteList}));`)
  console.log(`  DELETE FROM xiaoku_db.comment WHERE note_id IN (${noteList});`)
  console.log(`  DELETE FROM xiaoku_db.note_like WHERE note_id IN (${noteList});`)
  console.log(`  DELETE FROM xiaoku_db.note_collect WHERE note_id IN (${noteList});`)
  console.log(`  DELETE FROM xiaoku_db.note_image WHERE note_id IN (${noteList});`)
  console.log(`  DELETE FROM xiaoku_db.note WHERE id IN (${noteList});`)
  console.log(`  DELETE FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$';`)
  console.log(`  图片文件在 backend/uploads/（已 gitignore），要清就整个删掉该目录`)
  console.log(`  注意：xk_ui_smoke / xk_ui_interact / xiaoku_demo 是常驻 fixture，别删`)
}

main().catch((e) => {
  console.error('\n契约测试自身异常：', e)
  process.exit(1)
})
