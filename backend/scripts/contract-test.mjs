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
 * 覆盖范围：P2 用户模块（注册/登录/刷新/资料），P3 笔记域（上传/发布/详情），
 * P5 互动域，P6 关注域，P7 搜索域（发布→Kafka→ES 异步索引→检索回 MySQL 组卡）。
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

async function call(method, path, { token, body, raw, headers: extra } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = token
  // 幂等 token 之类的自定义头从这里进来；不能覆盖 Content-Type
  // （那是 fetch 对普通 JSON 请求自己填的）
  if (extra) Object.assign(headers, extra)
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
async function uploadImage(token, { name = 'tiny.png', type = 'image/png', bytes = TINY_PNG, idemKey } = {}) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), name)
  const headers = token ? { Authorization: token } : {}
  if (idemKey) headers['X-Idempotency-Key'] = idemKey
  const res = await fetch(`${BASE}/api/note/image`, {
    method: 'POST',
    // 只带 Authorization：Content-Type 必须由 fetch 自己填，否则少了 boundary
    headers,
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
    // P6 起 NoteVO 刻意暴露 authorId：详情页要做「关注作者」按钮，前端必须拿得到
    // 作者的可寻址 ID。这是对 P3「不暴露 userId」决定的刻意反转，动机写在 NoteVO 注释里。
    check('NoteVO 带 authorId（P6 起暴露，用于详情页关注作者）',
      typeof json?.data?.authorId === 'string' && /^\d+$/.test(json?.data?.authorId),
      `authorId=${json?.data?.authorId}`)
    check('authorId 是字符串且精度未截断（雪花 ID 不能当数字）',
      BigInt(json?.data?.authorId) > 9007199254740991n, `BigInt=${json?.data?.authorId}`)
    eq('自己看自己的笔记，authorFollowed=false', json?.data?.authorFollowed, false)
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
    const { json } = await post('/api/note/publish', { token: auth, body: { title: '图文没图', content: 'c', type: 1 } })
    codeIs('图文笔记必须至少一张图（P11，对齐小红书）', json, 100001)
  }
  {
    // 图文 + 空图组（null / []）同样算没图，检验「有图」判断用的是非空图片列表而不是「传了字段」
    for (const images of [null, []]) {
      const { json } = await post('/api/note/publish', { token: auth, body: { title: '空图组', content: 'c', type: 1, imageUrls: images } })
      codeIs('图文笔记 imageUrls 为 null/[] 同样被拦（100001）', json, 100001)
    }
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
  // 需要第三个账号：note 的作者是 ct_，点赞/收藏必须由「非作者」来点，
  // 否则计数/关系行都落在作者自己身上，测不到独立视角。
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
    // P15 收藏夹：收藏完要能找回来（以前只有收藏动作、没有查询接口，
    // 收藏完就「丢了」）。私有数据：只查自己的，不传 userId。
    const empty = await get('/api/note/collections?page=1&size=20', { token: actorAuth })
    codeIs('收藏夹查询成功', empty.json, 0)
    eq('收藏夹 total 是 JSON number', typeof empty.json?.data?.total, 'number')
    eq('此时收藏夹是空的（刚刚已取消收藏）', empty.json?.data?.list?.length, 0)

    await put(`/api/note/${noteId}/collect`, { token: actorAuth })
    const { json } = await get('/api/note/collections?page=1&size=20', { token: actorAuth })
    codeIs('收藏后收藏夹查询成功', json, 0)
    const ids = (json?.data?.list ?? []).map((n) => n.id)
    eq('收藏夹里有刚收藏的那篇', ids.includes(noteId), true)
    eq('收藏夹 total=1', json?.data?.total, 1)
    const row = json?.data?.list?.[0]
    check('收藏夹卡片带作者信息（收藏夹里是别人的笔记）',
      typeof row?.authorId === 'string' && typeof row?.authorNickname === 'string'
        && row.authorNickname.length > 0,
      `author=${row?.authorNickname}`)
    check('收藏夹卡片的 authorFollowed 是布尔（要实时判断，不能拿「在收藏夹里」推断）',
      typeof row?.authorFollowed === 'boolean', `${row?.authorFollowed}`)
    check('收藏夹卡片没有漏 password', !Object.keys(row ?? {}).includes('password'))

    // 已下架的笔记不该出现在收藏夹里（点进去会撞 20002）
    await put(`/api/note/${noteId}/status`, { token: auth, body: { status: 2 } })
    const down = await get('/api/note/collections?page=1&size=20', { token: actorAuth })
    check('笔记下架后从收藏夹消失（不给点不开的条目）',
      !(down.json?.data?.list ?? []).some((n) => n.id === noteId),
      `ids=${(down.json?.data?.list ?? []).map((n) => n.id).join(',')}`)
    await put(`/api/note/${noteId}/status`, { token: auth, body: { status: 1 } })
    const back = await get('/api/note/collections?page=1&size=20', { token: actorAuth })
    check('重新上架后回到收藏夹',
      (back.json?.data?.list ?? []).some((n) => n.id === noteId), '')

    // 复原：取消收藏，别把 noteId 留给后面的用例
    await del(`/api/note/${noteId}/collect`, { token: actorAuth })
    const anon = await get('/api/note/collections')
    codeIs('未登录访问收藏夹返回 10005', anon.json, 10005)
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
    // P11 起作者可以在自己笔记下评论/回复（对齐小红书「作者运营评论区」），
    // 发完立刻删掉，维持 commentCount 从 0 开始供下游章节使用
    const { json } = await post('/api/comment', {
      token: auth,
      body: { noteId, content: '作者在自己的笔记下发一条评论' },
    })
    codeIs('作者可以评论自己的笔记（P11 放开自评限制，对齐小红书）', json, 0)
    eq('自己的评论 mine=true', json?.data?.mine, true)
    const ownId = json?.data?.id
    check('自评拿到评论 ID', typeof ownId === 'string' && /^\d+$/.test(ownId), `ownId=${ownId}`)
    const { json: j2 } = await del(`/api/comment/${ownId}`, { token: auth })
    codeIs('删除刚才那条自评（还原计数）', j2, 0)
    const { json: j3 } = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('自评已删，commentCount 回到 0', j3?.data?.commentCount, 0)
  }
  {
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId, content: '   ' },
    })
    codeIs('纯空白评论被拦（100001）', json, 100001)
  }
  {
    // 上限 1000（对齐小红书真机，原 500）：必须跟着 schema.sql 的
    // comment.content 列宽和 CommentCreateDTO 的 @Size 一起改
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId, content: '字'.repeat(1001) },
    })
    codeIs('评论超 1000 字被拦（100001）', json, 100001)
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
      body: { title: '另一篇', content: '另一篇的正文', imageUrls: [imageUrl] },
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

  // ---- 15. P6 关注域：关注 / 取关 / 关注流 / 作者主页
  //
  // 关系图（这轮刻意做成「互关 + 单向」两边都覆盖）：
  //   ct   → 关注 → ct2、ct3        （ct 是看关注流的人，也是笔记作者）
  //   ct2  → 关注 → ct               （互关，测「viewer 已关注 TA 时 followed=true」）
  //   ct3  → 谁都不关注               （测「另一边视角 followed=false」和空关注流）
  // 用到的账号：ct_<stamp>（main auth）、ct2_<stamp>、ct3_<stamp>（actorAuth）。
  const ct2Login = await post('/api/user/login', { body: { username: `ct2_${stamp}`, password: P } })
  const ct2Auth = `Bearer ${ct2Login.json?.data?.accessToken}`
  const ct2Me = await get('/api/user/me', { token: ct2Auth })
  const ct2Id = ct2Me.json?.data?.id
  check('引导账号 ct2 登录可用（关注流需要「关注的人也有笔记」）', typeof ct2Auth === 'string' && ct2Auth.length > 5)
  check('拿到 ct2 的 ID', typeof ct2Id === 'string' && /^\d+$/.test(ct2Id), `ct2Id=${ct2Id}`)
  const actorMe = await get('/api/user/me', { token: actorAuth })
  const actorId = actorMe.json?.data?.id

  {
    const { json } = await put(`/api/follow/${userId}`, { token: auth })
    codeIs('不能关注自己（40003）', json, 40003)
  }
  {
    const { json } = await put('/api/follow/123456789012345', { token: auth })
    codeIs('关注不存在的用户返回 10001（不能留下指向虚空的关注关系）', json, 10001)
  }
  {
    const { json } = await put(`/api/follow/${ct2Id}`, { token: auth })
    codeIs('关注 ct2 成功', json, 0)
    eq('返回的是被关注者的行', json?.data?.id, ct2Id)
    eq('返回行 followed=true', json?.data?.followed, true)
    check('FollowUserVO 没有漏 password',
      !Object.keys(json?.data ?? {}).includes('password'))
  }
  {
    const { json } = await put(`/api/follow/${ct2Id}`, { token: auth })
    codeIs('重复关注返回 40001（靠唯一索引，不是先查后插）', json, 40001)
  }
  {
    const { json } = await put(`/api/follow/${actorId}`, { token: auth })
    codeIs('关注 ct3 成功', json, 0)
    const me = await get('/api/user/me', { token: auth })
    eq('ct 的 followCount=2', me.json?.data?.followCount, 2)
    const ct2After = await get('/api/user/me', { token: ct2Auth })
    eq('ct2 的 fansCount=1', ct2After.json?.data?.fansCount, 1)
  }
  {
    const { json } = await put(`/api/follow/${actorId}`, { token: auth })
    codeIs('重复关注 ct3 也返回 40001', json, 40001)
  }

  // 被关注者发笔记，作为关注流的内容源
  let ct2NoteId = null
  let ct3NoteId = null
  {
    const n2 = await post('/api/note/publish', { token: ct2Auth, body: { title: '关注流测试一', content: 'ct2 的正文', imageUrls: [imageUrl] } })
    codeIs('ct2 发布笔记成功', n2.json, 0)
    ct2NoteId = n2.json?.data?.id
    createdNoteIds.push(ct2NoteId)
    const n3 = await post('/api/note/publish', { token: actorAuth, body: { title: '关注流测试二', content: 'ct3 的正文', imageUrls: [imageUrl] } })
    codeIs('ct3 发布笔记成功', n3.json, 0)
    ct3NoteId = n3.json?.data?.id
    createdNoteIds.push(ct3NoteId)
  }

  // 详情页关注按钮依赖 authorId + authorFollowed
  {
    const { json } = await get(`/api/note/${ct2NoteId}`, { token: auth })
    codeIs('看 ct2 的笔记详情成功', json, 0)
    eq('authorId 带出作者', json?.data?.authorId, ct2Id)
    check('authorId 是字符串且精度未截断', BigInt(json?.data?.authorId) > 9007199254740991n)
    eq('已关注作者的笔记 authorFollowed=true', json?.data?.authorFollowed, true)
  }

  // 关注流：只含已关注作者的已发布笔记，按时间倒序
  {
    const { json } = await get('/api/feed/follow?page=1&size=10', { token: auth })
    codeIs('关注流查询成功', json, 0)
    eq('关注流 total 是 JSON number', typeof json?.data?.total, 'number')
    eq('关注流共 2 篇（ct2+ct3）', json?.data?.total, 2)
    const ids = (json?.data?.list ?? []).map((n) => n.id)
    check('包含 ct2 的笔记', ids.includes(ct2NoteId), `ids=${ids.join(',')}`)
    check('包含 ct3 的笔记', ids.includes(ct3NoteId), `ids=${ids.join(',')}`)
    check('不含自己的笔记（自己不能关注自己）', !ids.includes(noteId), `ids=${ids.join(',')}`)
    const first = json?.data?.list?.[0]
    check('关注流行带作者信息', typeof first?.authorId === 'string' && first?.authorId !== '' && typeof first?.authorNickname === 'string' && first.authorNickname.length > 0,
      `authorId=${first?.authorId} nickname=${first?.authorNickname}`)
    eq('关注流行 authorFollowed=true', first?.authorFollowed, true)
    check('关注流行没有漏 password', !Object.keys(first ?? {}).includes('password'))
  }
  {
    const { json } = await get('/api/feed/follow', { token: actorAuth })
    codeIs('没关注任何人时关注流为空（空态不是报错）', json, 0)
    eq('空关注流 total=0', json?.data?.total, 0)
    eq('空关注流 list 为空数组', json?.data?.list?.length, 0)
  }

  // 作者主页：TA 发布的笔记
  {
    const { json } = await get(`/api/note/user/${ct2Id}?page=1&size=10`, { token: auth })
    codeIs('作者主页笔记列表成功', json, 0)
    eq('ct2 主页只有 ct2 的笔记', json?.data?.total, 1)
    eq('列表行 authorId 正确', json?.data?.list?.[0]?.authorId, ct2Id)
    eq('列表行 authorFollowed=true（ct 仍关注 ct2）', json?.data?.list?.[0]?.authorFollowed, true)
  }
  {
    const { json } = await get(`/api/note/user/123456789012345`, { token: auth })
    codeIs('查不存在作者的主页返回 10001（与「TA 没发笔记」区分开）', json, 10001)
  }
  {
    // 作者主页的用户卡片：一次接口拿到用户信息 + 当前登录者是否已关注
    const { json } = await get(`/api/follow/user/${ct2Id}`, { token: auth })
    codeIs('作者卡片查询成功', json, 0)
    eq('作者卡片是目标用户', json?.data?.id, ct2Id)
    eq('作者卡片带昵称', json?.data?.nickname, `ct2_${stamp}`)
    eq('当前登录者已关注 → followed=true', json?.data?.followed, true)
    check('作者卡片没有漏 password', !Object.keys(json?.data ?? {}).includes('password'))
  }
  {
    const { json } = await get('/api/follow/user/123456789012345', { token: actorAuth })
    codeIs('查不存在用户的关注状态返回 10001', json, 10001)
  }

  // 互关：ct2 关注 ct、也关注 ct3，让关注列表出现「viewer 也关注了这一行」的互惠语义
  {
    const { json } = await put(`/api/follow/${userId}`, { token: ct2Auth })
    codeIs('ct2 关注 ct 成功（互关场景）', json, 0)
    const { json: j2 } = await put(`/api/follow/${actorId}`, { token: ct2Auth })
    codeIs('ct2 关注 ct3 成功', j2, 0)
  }
  {
    const { json } = await get(`/api/follow/fans?userId=${userId}`, { token: auth })
    codeIs('粉丝列表查询成功', json, 0)
    const row = (json?.data?.list ?? []).find((r) => r.id === ct2Id)
    check('ct 的粉丝里有 ct2', typeof row !== 'undefined', `list=${JSON.stringify(json?.data?.list)}`)
    eq('viewer 已关注该粉丝 → followed=true（互关）', row?.followed, true)
  }
  {
    // ct2 的关注列表 = [ct, ct3]。followed 的语义是「viewer（ct）是否也关注了这一行的用户」：
    //   - 行=ct：ct 不能关注自己 → false
    //   - 行=ct3：ct 关注了 ct3 → true
    const { json } = await get(`/api/follow/followings?userId=${ct2Id}`, { token: auth })
    codeIs('关注列表查询成功', json, 0)
    const rowCt = (json?.data?.list ?? []).find((r) => r.id === userId)
    check('ct2 的关注里有 ct', typeof rowCt !== 'undefined')
    eq('行=ct：viewer 与 ct 是同一人，不能自关 → followed=false', rowCt?.followed, false)
    const rowCt3 = (json?.data?.list ?? []).find((r) => r.id === actorId)
    eq('行=ct3：viewer 也关注了 TA → followed=true（互惠语义）', rowCt3?.followed, true)
  }
  {
    // 换一个「没关注 ct」的 viewer（ct3）来看 ct2 的关注列表
    const { json } = await get(`/api/follow/followings?userId=${ct2Id}`, { token: actorAuth })
    const row = (json?.data?.list ?? []).find((r) => r.id === userId)
    eq('另一个 viewer 没关注 ct → followed=false（视图态按人算，不是全局缓存）', row?.followed, false)
    check('FollowUserVO 也没有漏 password', !Object.keys(row ?? {}).includes('password'))
  }
  {
    const { json } = await get(`/api/follow/fans?userId=${userId}&page=1&size=1`, { token: auth })
    eq('粉丝列表 size=1 只回 1 条', json?.data?.list?.length, 1)
    eq('total 按全量算仍是 1', json?.data?.total, 1)
    eq('page 回显', json?.data?.page, 1)
    eq('size 回显', json?.data?.size, 1)
  }

  // 取关：计数回退、关注流剔除、40002 兜底
  {
    const { json } = await del(`/api/follow/${ct2Id}`, { token: auth })
    codeIs('取关 ct2 成功', json, 0)
    eq('取关后返回行 followed=false', json?.data?.followed, false)
  }
  {
    const { json } = await del(`/api/follow/${ct2Id}`, { token: auth })
    codeIs('未关注却取关返回 40002（不静默成功）', json, 40002)
  }
  {
    const me = await get('/api/user/me', { token: auth })
    eq('取关后 ct 的 followCount 退回 1', me.json?.data?.followCount, 1)
    const ct2After = await get('/api/user/me', { token: ct2Auth })
    eq('ct2 的 fansCount 退回 0', ct2After.json?.data?.fansCount, 0)
    const { json } = await get(`/api/note/${ct2NoteId}`, { token: auth })
    eq('取关后详情 authorFollowed=false', json?.data?.authorFollowed, false)
  }
  {
    const { json } = await get('/api/feed/follow', { token: auth })
    codeIs('取关后再查关注流成功', json, 0)
    eq('取关后关注流只剩 1 篇', json?.data?.total, 1)
    const ids = (json?.data?.list ?? []).map((n) => n.id)
    check('ct2 的笔记已从关注流消失，ct3 的还在',
      ids.includes(ct3NoteId) && !ids.includes(ct2NoteId), `ids=${ids.join(',')}`)
  }
  {
    const { json } = await get('/api/feed/follow')
    codeIs('未登录不能看关注流（10005）', json, 10005)
  }

  // ---- 16. P7 搜索域：发布 → Kafka → ES 异步入索引 → 检索回 MySQL 组卡
  {
    const { json } = await get('/api/search/note?keyword=x')
    codeIs('未登录不能搜索（10005，搜索沿用「默认全部需要登录」）', json, 10005)
  }
  {
    const { json } = await get('/api/search/note?keyword=', { token: auth })
    codeIs('空关键词被拦（50002）', json, 50002)
  }
  let searchNoteId = null
  // 唯一词必须是<b>纯 ASCII</b>，这一点踩过坑：
  //
  // 第一版把随机尾缀接在中文后面（`星尘电台a1b2c3`），想着「有随机尾就只会命中自己」。
  // 但 ES 用的是默认 standard 分析器（项目没装 IK），中文会被切成独立的字/词，
  // 字母数字串又是另一个 token，而 multi_match 默认 OR 语义 ——
  // 于是 <b>历次测试留在 ES 里的孤儿文档</b>（MySQL 已删、ES 仍在，删库不删索引）
  // 只要含「星尘」或「电台」就被召回，「首条就是刚发布的种子笔记」随机失败。
  // 之前一直没炸，只是因为每次收尾都 reindex 把索引清干净了。
  //
  // 改成纯 ASCII token 后，它在 standard 分析器下是<b>单一不可分 token</b>，
  // 只有标题里带这段字符串的文档能命中，索引脏不脏都不影响这条断言。
  const searchUnique = `xkseed${stamp}${Math.random().toString(36).slice(2, 6)}`.toLowerCase()
  // 轮询专用账号：为什么不能复用 auth？
  //
  // P8 上线了 60 次/分钟/用户的搜索限流，而「等异步入索引」吃的是真实搜索接口的额度。
  // 老写法用 auth 轮询 50 次 + 后面还有 ~5 次断言搜索，恰好卡在 60 的临界线，
  // 一旦消费端积压超过 10s（历史包袱没消化完时真发生过 14s），轮询把额度烧光就
  // 只能拿到 100005 而永远等不到首条 —— 一颗随时会爆的雷。
  // 隔离账号后轮询额度与断言账号互不干扰，预算从此随便给。
  // 名字带 ct5_ 前缀，与 AGENTS.md 的清理正则 ^ct[0-9]?_ 对齐。
  const pollName = `ct5_${stamp}`
  const pollPwd = 'Xk@2026poll'
  {
    const { json } = await post('/api/user/register', { body: { username: pollName, password: pollPwd } })
    codeIs('搜索轮询账号注册成功（隔离限流额度）', json, 0)
  }
  const pollLogin = await post('/api/user/login', { body: { username: pollName, password: pollPwd } })
  const pollAuth = `Bearer ${pollLogin.json?.data?.accessToken}`
  check('搜索轮询账号登录可用', typeof pollAuth === 'string' && pollAuth.length > 5)
  {
    const { json } = await post('/api/note/publish', {
      token: auth,
      body: { title: `星尘电台 ${searchUnique}`, content: '在银河系边缘收听毛球乐队', type: 1, imageUrls: [imageUrl] },
    })
    codeIs('搜索种子笔记发布成功（应进入 ES 索引）', json, 0)
    searchNoteId = json?.data?.id
    createdNoteIds.push(searchNoteId)
  }
  // 发布 → Kafka → 消费 → ES 全程异步，轮询等入索引。50×500ms ≈ 25s 兜底。
  // 睡 500ms 而不是 200ms：同样的 50 次调用把覆盖窗口从 10s 拉长到 25s，
  // 消费端积压（实测出现过 14s）也能等到，且不额外烧搜索额度。
  {
    let found = false
    for (let i = 0; i < 50 && !found; i++) {
      const { json } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}`, { token: pollAuth })
      found = json?.code === 0 && (json?.data?.total ?? 0) > 0
      if (!found) await new Promise((r) => setTimeout(r, 500))
    }
    check('发布后经 Kafka 异步入索引（轮询 25s 内命中）', found)
  }
  {
    const { json } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}`, { token: auth })
    codeIs('关键词命中后搜索成功', json, 0)
    eq('命中首条就是刚发布的种子笔记', json?.data?.list?.[0]?.id, searchNoteId)
    check('卡片作者昵称来自 MySQL 回填（ES 只做检索）',
      typeof json?.data?.list?.[0]?.authorNickname === 'string' && json.data.list[0].authorNickname.length > 0,
      `author=${json?.data?.list?.[0]?.authorNickname}`)
    eq('自己看自己的搜索卡 authorFollowed=false', json?.data?.list?.[0]?.authorFollowed, false)
    eq('total 与 list 长度一致', json?.data?.total, json?.data?.list?.length)
    eq('page 回显', json?.data?.page, 1)
    eq('size 回显（默认 20）', json?.data?.size, 20)
  }
  {
    const { json } = await get(`/api/search/note?keyword=${stamp}zzzqqqno`, { token: auth })
    codeIs('完全无关的关键词返回成功（不报错）', json, 0)
    eq('搜不到时 total=0 且 list 为空', json?.data?.total, 0)
  }
  // ---- 16.x 召回收紧：minimumShouldMatch("50%")
  //
  // 钉两件事，一件防「太松」、一件防「太紧」。**都不钉具体数字**：库里还有种子号、
  // 演示号、压测残留，每加一次数据总数就会变，写死必然要回来改。
  {
    // 防太松：OR 语义下 ik_smart 拆出的单字会让任何含「在/的/不」的笔记命中。
    // 实测（库里 163 篇时）：OR=28 篇 → msm50=1 篇。所以判据是「很少」。
    const junk = `绝不存在${stamp}${Math.random().toString(36).slice(2, 6)}`
    const { json } = await get(`/api/search/note?keyword=${encodeURIComponent(junk)}`, { token: auth })
    codeIs('搜中文乱词返回成功', json, 0)
    check('中文乱词几乎搜不到（≤3 篇；OR 语义下会命中几十篇）',
      (json?.data?.total ?? 999) <= 3, `keyword=${junk} total=${json?.data?.total}`)
  }
  {
    // 防太紧：改AND 语义会把正常中文词一起杀掉（实测「毛球喵社」OR=2 / AND=0）。
    // 用本文件早前发布过的中文标题短语当锚点，搜不到就说明收紧过头了。
    const { json } = await get(`/api/search/note?keyword=${encodeURIComponent('契约测试')}`, { token: auth })
    codeIs('搜中文实词返回成功', json, 0)
    check('正常中文词仍能召回（收紧没把好词一起杀掉）',
      (json?.data?.total ?? 0) > 0, `total=${json?.data?.total}`)
  }
  {
    const { json } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}&page=1&size=1`, { token: auth })
    codeIs('分页搜索成功', json, 0)
    eq('size=1 只回 1 条', json?.data?.list?.length, 1)
    eq('size 回显', json?.data?.size, 1)
  }
  {
    // 对账兜底：reindex 删旧索引 + 从 MySQL 全量回灌，重建后数据必须还在
    const { json } = await post('/api/search/reindex', { token: auth })
    codeIs('重建索引成功', json, 0)
    check('reindex 返回回灌文档数', typeof json?.data?.indexed === 'number' && json.data.indexed > 0, `indexed=${json?.data?.indexed}`)
    await new Promise((r) => setTimeout(r, 1500))
    const { json: j2 } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}`, { token: auth })
    eq('重建后种子笔记仍可搜到', j2?.data?.list?.[0]?.id, searchNoteId)
  }

  // ---- 16.0 P8 分布式锁
  //
  // reindex = 删旧索引 + 从库回灌，两个请求同时跑会互相拆台（A 删了 B 正在写的索引）。
  // Redisson 锁把它串行化：同时打进来的两个重建请求，一个赢，另一个立刻返回
  // 50001「已有重建任务在跑」。两个账号一起来是为了避开「同账号 reindex 3 次/分钟」
  // 的限流桶（auth 已用 1 次、ct2 已用 1 次，各自还剩 2 次额度）。
  //
  // 时序上赢家持锁覆盖整个重建窗口（删+建+回灌约几百毫秒），本地 localhost 两个
  // 请求几乎同时到达，输家拿不到锁是确定性的。
  {
    const r1 = post('/api/search/reindex', { token: auth })
    const r2 = post('/api/search/reindex', { token: ct2Auth })
    const [a, b] = await Promise.all([r1, r2])
    const codes = [a?.json?.code, b?.json?.code].sort()
    check('并发重建互斥：一个成功一个 50001（不会同时删旧建新）',
      codes[0] === 0 && codes[1] === 50001, `codes=${JSON.stringify(codes)}`)
    // 锁测试自身也消耗了两人各 1 次重建额度，醒来后确认索引没被破坏
    await new Promise((r) => setTimeout(r, 1500))
    const { json: j3 } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}`, { token: auth })
    eq('锁测试后索引完好（种子笔记仍可搜到）', j3?.data?.list?.[0]?.id, searchNoteId)
  }

  // ---- 16.1 P8 限流
  //
  // 刻意用「一个全新账号」而不是复用 auth：限流额度是按 userId 分桶的，
  // 复用 auth 的话它前面几节已经花掉了一些（搜索 4 次、reindex 1 次），
  // 断言就得写成「第 N 次开始报错」——那是在测别处的调用次数，
  // 别人随手加一节搜索测试就会把这条断言搞挂，排查起来毫无头绪。
  //
  // 隔离出来还有个副作用好处：trip 掉一个账号的桶不会影响别的用例。
  const rlName = `ct4_${stamp}`
  const rlPwd = 'Xk@2026rlpwd'
  {
    const { json } = await post('/api/user/register', { body: { username: rlName, password: rlPwd } })
    codeIs('限流测试账号注册成功（账号名带随机 stamp，不该撞号）', json, 0)
  }
  const rlLogin = await post('/api/user/login', { body: { username: rlName, password: rlPwd } })
  const rlAuth = `Bearer ${rlLogin.json?.data?.accessToken}`
  check('限流测试账号登录可用', typeof rlAuth === 'string' && rlAuth.length > 5)
  {
    // reindex 的阈值是 3 次/分钟（重建是重操作，阈值给得比别处紧）
    const codes = []
    for (let i = 0; i < 4; i++) {
      const { json } = await post('/api/search/reindex', { token: rlAuth })
      codes.push(json?.code)
    }
    eq('额度内前 3 次重建都放行', JSON.stringify(codes.slice(0, 3)), JSON.stringify([0, 0, 0]))
    codeIs('第 4 次超阈值被限流（100005）', { code: codes[3] }, 100005)
  }
  {
    const { json } = await post('/api/search/reindex', { token: ct2Auth })
    codeIs('换个账号不受牵连（额度按 userId 分桶，不是全局）', json, 0)
  }
  {
    // 限流挂在 Controller 方法上，但拦截器先跑：拿一个格式合法、签名无效的 token，
    // 期望在鉴权阶段就被打回 10006（凭证无效）而不是「当作未登录放进去再限流」。
    // 反过来如果这里拿到 10005，说明鉴权把非法凭证当成了游客，
    // 游客请求会绕过「必须有登录态」的前提去消耗限流桶。
    const { json } = await call('POST', '/api/search/reindex', { token: 'Bearer not-a-real-token' })
    codeIs('无 token 时先撞鉴权 10006，不进限流', json, 10006)
  }
  {
    // IP 维度的 login 没法在契约里稳定 trip：契约测试本身要注册+登录几十次，
    // 一旦把登录阈值压到测试用量的量级，以后加任何一节都会连环失败。
    // IP 维度限流的正确测法是「用真实 IP 打同一个 IP 的桶」，
    // 属于本地/压测手段，不适合放进每次都跑的契约（前提：注解读的是这个 IP）。
    const { json } = await post('/api/user/login', { body: { username: rlName, password: rlPwd } })
    codeIs('正常登录不被 IP 限流误伤（本机 60 次/分钟额度充足）', json, 0)
  }

  // ---- 16.2 P8 幂等
  //
  // 协议：请求头 X-Idempotency-Key。带了就幂等，不带就走老逻辑（老客户端不受影响）。
  //
  // 这里用 P8 里另一个账号（rlAuth）来发，理由是 P5 那几节已经把 auth 的
  // 笔记/评论都用过了，再往里塞幂等断言会让「哪个 id 是幂等产生的」不好认。
  const idem = (t) => ({ 'X-Idempotency-Key': t })
  const idemNote = { title: `幂等${stamp}`, content: '同一个 token 连发两次', type: 1, imageUrls: [imageUrl] }
  let rlNoteId = null
  {
    const token = `pub-${stamp}`
    const r1 = await post('/api/note/publish', { token: rlAuth, body: idemNote, headers: idem(token) })
    codeIs('带幂等 token 首次发布成功', r1.json, 0)
    rlNoteId = r1.json?.data?.id
    const r2 = await post('/api/note/publish', { token: rlAuth, body: idemNote, headers: idem(token) })
    codeIs('同 token 重复发布回放成功（不是报错）', r2.json, 0)
    eq('同 token 两次拿到同一个 noteId', r2.json?.data?.id, r1.json?.data?.id)
    createdNoteIds.push(rlNoteId)

    // 只断言「返回同一个 id」不够：那个 id 可能只是被回放了，库里其实有两条。
    // 直接查作者列表数出现次数，才钉住「真的只落了一行」
    const me = await get('/api/user/me', { token: rlAuth })
    const list = await get(`/api/note/user/${me.json?.data?.id}?page=1&size=100`, { token: rlAuth })
    const hit = (list.json?.data?.list ?? []).filter((n) => n.id === r1.json?.data?.id).length
    eq('库里只有一条（不是回放了 id 却仍写了两行）', hit, 1)
  }
  {
    const r = await post('/api/note/publish', {
      token: rlAuth,
      body: { ...idemNote, title: `${idemNote.title}B` },
      headers: idem(`pub-${stamp}-other`),
    })
    codeIs('换 token 等于新的一次发布', r.json, 0)
    check('换 token 拿到不同的 noteId', r.json?.data?.id !== undefined, `id=${r.json?.data?.id}`)
    createdNoteIds.push(r.json?.data?.id)
  }
  {
    // 不带 token 必须照常工作：幂等是「客户端配合才生效」的能力，
    // 不能因为加了它就把 curl / 老版本客户端堵在门外
    const r = await post('/api/note/publish', { token: rlAuth, body: { ...idemNote, title: `${idemNote.title}C` } })
    codeIs('不带幂等 token 也能发布（向后兼容）', r.json, 0)
    createdNoteIds.push(r.json?.data?.id)
  }
  {
    // 幂等 key 里带 userId：别人拿同一个 token 不该被算成同一次提交
    const token = `xuser-${stamp}`
    const r1 = await post('/api/note/publish', { token: rlAuth, body: { ...idemNote, title: `${idemNote.title}D` }, headers: idem(token) })
    const r2 = await post('/api/note/publish', { token: actorAuth, body: { ...idemNote, title: `${idemNote.title}D` }, headers: idem(token) })
    codeIs('同一 token 换用户发布成功', r2.json, 0)
    check('换 userId 后视为新提交（key 里绑了用户）', r1.json?.data?.id !== r2.json?.data?.id,
      `${r1.json?.data?.id} vs ${r2.json?.data?.id}`)
    createdNoteIds.push(r1.json?.data?.id, r2.json?.data?.id)
  }
  {
    // 业务失败必须把 key 还回去：否则「参数写错了重发一次」会永远得到
    // 100004 重复提交，而正确的内容永远提交不上——比不做幂等更糟
    // 触发源用「给不存在的笔记评论」：20001 在业务层抛出且不写数据。
    // 注意不能再用「评论自己的笔记」：P11 起作者自评是允许的，那条分支已不存在
    const token = `cfail-${stamp}`
    const r1 = await post('/api/comment', {
      token: rlAuth,
      body: { noteId: '123456789012345', content: '触发业务失败' },
      headers: idem(token),
    })
    codeIs('业务失败（给不存在的笔记评论）被拒（20001）', r1.json, 20001)
    const r2 = await post('/api/comment', {
      token: rlAuth,
      body: { noteId: '123456789012345', content: '触发业务失败' },
      headers: idem(token),
    })
    codeIs('失败后同 token 再来仍是真实业务错（20001，不是 100004）', r2.json, 20001)
  }
  {
    // 成功路径：同 token 发两次评论只落一条 —— 「同一条评论出现两遍」
    // 是用户一眼就能看出来的功能缺陷，比接口超时更难解释
    const token = `cmt-${stamp}`
    const otherNoteId = createdNoteIds[0]
    const r1 = await post('/api/comment', { token: rlAuth, body: { noteId: otherNoteId, content: '幂等评论' }, headers: idem(token) })
    codeIs('带 token 首次评论成功', r1.json, 0)
    const r2 = await post('/api/comment', { token: rlAuth, body: { noteId: otherNoteId, content: '幂等评论' }, headers: idem(token) })
    codeIs('同 token 重复评论回放成功', r2.json, 0)
    eq('同 token 两次拿到同一个 commentId', r2.json?.data?.id, r1.json?.data?.id)
    const list = await get(`/api/comment/list?noteId=${otherNoteId}&page=1&size=100`, { token: rlAuth })
    const same = (list.json?.data?.list ?? []).filter((c) => c.content === '幂等评论').length
    eq('评论列表里只有一条（真的没写两行）', same, 1)
    await del(`/api/comment/${r1.json?.data?.id}`, { token: rlAuth })
  }
  {
    const r = await post('/api/note/publish', {
      token: rlAuth,
      body: idemNote,
      headers: idem('x'.repeat(200)),
    })
    codeIs('超长幂等 token 被拒（100004，不静默截断）', r.json, 100004)
  }
  {
    // 上传重试不该多出一个孤儿文件：同 token 重传拿回同一个 URL
    const token = `up-${stamp}`
    const r1 = await uploadImage(rlAuth, { idemKey: token })
    const r2 = await uploadImage(rlAuth, { idemKey: token })
    codeIs('带 token 上传成功', r1.json, 0)
    eq('同 token 重传拿回同一个 URL（不产生孤儿文件）', r2.json?.data?.url, r1.json?.data?.url)
    const r3 = await uploadImage(rlAuth)
    check('不带 token 上传拿到的是新 URL', r3.json?.data?.url !== r1.json?.data?.url,
      `${r3.json?.data?.url}`)
  }

  // ---- 17. P8 计数权威：多人聚合（ZSet 当裁判）
  //
  // P5 的单人断言在「计数 = DB 行数 / 自增列」的实现下也能通过；
  // P8 把计数搬到 Redis ZSet，用两个互不相干的账号（ct3_ / ct4_）在
  // 同一篇笔记上各自点赞、取消，才能钉住「计数是集合成员数的聚合」：
  //   1. 第二个人的 like 必须让第一个人看到 +1（不是各自落一行 DB 更新互不可见）
  //   2. 一个人取消不能把另一个人顶掉（common 的「删除即清零」实现会挂）
  //   3. Redis key 一旦丢了，读路径得回退 DB 底账而不是返回 0 / false
  //      （fallback 语义单靠 HTTP 只能验到 DB 一致时的结果，见 NoteCounterStore）
  // 起始状态由 P5 保证：本笔记 like=0 / collect=0，两个账号都没点过。
  {
    const d0 = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('P8 基线 likeCount=0', d0.json?.data?.likeCount, 0)
    eq('P8 基线 collectCount=0', d0.json?.data?.collectCount, 0)
  }
  {
    const a1 = await put(`/api/note/${noteId}/like`, { token: actorAuth })
    codeIs('账号 A 点赞成功', a1.json, 0)
    eq('A 点赞后 likeCount=1', a1.json?.data?.likeCount, 1)
    eq('A 自己 liked=true', a1.json?.data?.liked, true)
    const b1 = await put(`/api/note/${noteId}/like`, { token: rlAuth })
    codeIs('账号 B 点赞成功', b1.json, 0)
    eq('B 点赞后 likeCount=2（ZSet 聚合，不是各自记一份）', b1.json?.data?.likeCount, 2)
    eq('B 自己 liked=true', b1.json?.data?.liked, true)
  }
  {
    // 关键：A 视角读详情，必须看到 B 攒的那个 +1，两者不能互相遮蔽
    const d = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('A 视角 likeCount=2（能看到 B 的点赞）', d.json?.data?.likeCount, 2)
    eq('A 视角 liked=true（自己的那票还在）', d.json?.data?.liked, true)
    const f = await get(`/api/note/user/${userId}?page=1&size=100`, { token: actorAuth })
    const cards = (f.json?.data?.list ?? []).filter((n) => n.id === noteId)
    check('作者笔记列表（applyCounts 路径）与详情计数一致', cards.length === 1 && cards[0]?.likeCount === 2,
      `list likeCount=${cards[0]?.likeCount}`)
  }
  {
    // 一人取消，另一个人不能被顶掉
    const b2 = await del(`/api/note/${noteId}/like`, { token: rlAuth })
    codeIs('B 取消点赞成功', b2.json, 0)
    eq('B 取消后 likeCount=1（A 的票还在）', b2.json?.data?.likeCount, 1)
    eq('B 自己 liked=false', b2.json?.data?.liked, false)
    const d = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('A 视角 likeCount=1 且 liked=true', d.json?.data?.likeCount, 1)
  }
  {
    // 收藏维度同构验证：B 收藏时 A 的收藏也应在，且收藏与点赞互不干扰
    const a1 = await put(`/api/note/${noteId}/collect`, { token: actorAuth })
    eq('A 收藏后 collectCount=1', a1.json?.data?.collectCount, 1)
    const b1 = await put(`/api/note/${noteId}/collect`, { token: rlAuth })
    eq('B 收藏后 collectCount=2，likeCount 保持 1', b1.json?.data?.collectCount, 2)
    eq('B 收藏后另一维 likeCount 未被碰', b1.json?.data?.likeCount, 1)
    const a2 = await del(`/api/note/${noteId}/collect`, { token: actorAuth })
    eq('A 取消收藏后 collectCount=1（B 的还在）', a2.json?.data?.collectCount, 1)
    eq('A 取消收藏后 collected=false', a2.json?.data?.collected, false)
  }
  {
    // 收尾还原：两个账号都清掉，计数回到基线 0，不给后续/下次运行留尾巴
    const d1 = await del(`/api/note/${noteId}/like`, { token: actorAuth })
    codeIs('最后清掉 A 的点赞', d1.json, 0)
    const d2 = await del(`/api/note/${noteId}/collect`, { token: rlAuth })
    codeIs('最后清掉 B 的收藏', d2.json, 0)
    const d3 = await get(`/api/note/${noteId}`, { token: actorAuth })
    eq('全部还原后 likeCount=0', d3.json?.data?.likeCount, 0)
    eq('全部还原后 collectCount=0', d3.json?.data?.collectCount, 0)
  }

  // ---- 17.1 P10 笔记编辑（PUT /api/note/{id}，作者本人，全量更新）
  {
    const { json } = await put(`/api/note/${noteId}`, { token: actorAuth, body: { title: 'x', content: 'y' } })
    codeIs('非作者编辑返回 20001（不泄露存在性，和删除/评论同一套防探测）', json, 20001)
  }
  {
    const { json } = await put(`/api/note/${noteId}`, { body: { title: 'x', content: 'y' } })
    codeIs('未登录编辑被拒（10005）', json, 10005)
  }
  {
    const { json } = await put('/api/note/123456789012345', { token: auth, body: { title: 'x', content: 'y' } })
    codeIs('编辑不存在的笔记返回 20001', json, 20001)
  }
  {
    const { json } = await put(`/api/note/${noteId}`, { token: auth, body: { title: '', content: 'y' } })
    codeIs('编辑时空标题被拦（100001）', json, 100001)
  }
  {
    // 视频类型缺 videoUrl 的兜底和发布同构
    const { json } = await put(`/api/note/${noteId}`, { token: auth, body: { title: '改视频', content: 'y', type: 2 } })
    codeIs('编辑成视频却缺 videoUrl 被拦（100001）', json, 100001)
  }
  let editImageUrl = null
  {
    const up = await uploadImage(auth)
    editImageUrl = up.json?.data?.url
    const { json } = await put(`/api/note/${noteId}`, {
      token: auth,
      body: { title: '编辑后的标题', content: '编辑后的正文', imageUrls: [editImageUrl] },
    })
    codeIs('作者编辑笔记成功', json, 0)
    eq('编辑后标题生效', json?.data?.title, '编辑后的标题')
    eq('编辑后正文生效', json?.data?.content, '编辑后的正文')
    eq('编辑后封面取新图', json?.data?.cover, editImageUrl)
    eq('编辑后图片整表重建为新列表', JSON.stringify(json?.data?.images), JSON.stringify([editImageUrl]))
    eq('编辑不动状态（仍是 status=1）', json?.data?.status, 1)
    eq('编辑不动计数', json?.data?.likeCount, 0)
  }
  {
    const { json } = await get(`/api/note/${noteId}`, { token: auth })
    eq('详情回读标题是编辑后的', json?.data?.title, '编辑后的标题')
    eq('详情图片与编辑一致', JSON.stringify(json?.data?.images), JSON.stringify([editImageUrl]))
  }
  {
    // 清空图片：cover 要走「显式 set null」路径（updateById 的 not_null 会跳过空值，旧封面残留）
    const { json } = await put(`/api/note/${noteId}`, {
      token: auth,
      body: { title: '编辑后的标题', content: '编辑后的正文' },
    })
    codeIs('编辑清空图片成功', json, 0)
    eq('清空后 images 为空数组', JSON.stringify(json?.data?.images), JSON.stringify([]))
    check('清空后 cover 为 null，旧封面没有残留', json?.data?.cover == null, `cover=${JSON.stringify(json?.data?.cover)}`)
  }

  // ---- 17.2 P10 上下架（PUT /api/note/{id}/status，只认 1/2）+ 搜索可见性
  {
    const { json } = await put(`/api/note/${searchNoteId}/status`, { token: auth, body: { status: 0 } })
    codeIs('status=0（草稿）不允许走接口被拦（100001）', json, 100001)
  }
  {
    const { json } = await put(`/api/note/${searchNoteId}/status`, { token: auth, body: {} })
    codeIs('status 缺失被拦（100001）', json, 100001)
  }
  {
    const { json } = await put(`/api/note/${searchNoteId}/status`, { token: auth, body: { status: 3 } })
    codeIs('status=3 被拦（100001）', json, 100001)
  }
  {
    const { json } = await put(`/api/note/${searchNoteId}/status`, { token: actorAuth, body: { status: 2 } })
    codeIs('非作者下架返回 20001（防探测）', json, 20001)
  }
  {
    const { json } = await put(`/api/note/${searchNoteId}/status`, { token: auth, body: { status: 2 } })
    codeIs('作者下架成功', json, 0)
    eq('下架后详情 status=2', json?.data?.status, 2)
  }
  {
    // 曾经公开过，对非作者明确报「已下架」而不是装不存在
    const { json } = await get(`/api/note/${searchNoteId}`, { token: actorAuth })
    codeIs('非作者看已下架笔记返回 20002', json, 20002)
  }
  {
    // P10 门禁改动：作者本人能看到自己的下架笔记（否则编辑入口会「自己的东西突然 404」）
    const { json } = await get(`/api/note/${searchNoteId}`, { token: auth })
    codeIs('作者本人看自己的下架笔记成功', json, 0)
    eq('作者视角详情 status=2', json?.data?.status, 2)
  }
  {
    // 下架 → Kafka → ES 删除文档：轮询直到搜不到（复用轮询账号的独立限流额度）
    let gone = false
    for (let i = 0; i < 50 && !gone; i++) {
      const { json } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}`, { token: pollAuth })
      gone = json?.code === 0 && (json?.data?.total ?? 0) === 0
      if (!gone) await new Promise((r) => setTimeout(r, 500))
    }
    check('下架后经 Kafka 从索引移除（25s 内搜不到）', gone)
  }
  {
    const { json } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}`, { token: auth })
    eq('下架后的确认搜索 total=0', json?.data?.total, 0)
  }
  {
    // 他人主页 = 公开视图，只含已发布
    const { json } = await get(`/api/note/user/${userId}?page=1&size=100`, { token: actorAuth })
    const cards = (json?.data?.list ?? []).filter((n) => n.id === searchNoteId)
    eq('他人视角作者主页不含下架笔记', cards.length, 0)
  }
  {
    // 作者自己的主页 = 管理视图，草稿/下架都能看到
    const { json } = await get(`/api/note/user/${userId}?page=1&size=100`, { token: auth })
    const cards = (json?.data?.list ?? []).filter((n) => n.id === searchNoteId)
    check('作者自己主页能看到下架笔记且 status=2',
      cards.length === 1 && cards[0]?.status === 2, `cards=${JSON.stringify(cards)}`)
  }
  {
    const { json } = await put(`/api/note/${searchNoteId}/status`, { token: auth, body: { status: 1 } })
    codeIs('作者重新上架成功', json, 0)
    eq('上架后详情 status=1', json?.data?.status, 1)
  }
  {
    // 幂等：设置成当前状态不该报错、不该产生多余事件
    const { json } = await put(`/api/note/${searchNoteId}/status`, { token: auth, body: { status: 1 } })
    codeIs('重复设置为已上架成功（幂等）', json, 0)
  }
  {
    // 上架 → 重新入索引：等 Kafka 回灌（createTime 保持首发值）
    let back = false
    for (let i = 0; i < 50 && !back; i++) {
      const { json } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}`, { token: pollAuth })
      back = json?.code === 0 && (json?.data?.total ?? 0) > 0
      if (!back) await new Promise((r) => setTimeout(r, 500))
    }
    check('上架后重新入索引（25s 内恢复可搜到）', back)
    const { json } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}`, { token: auth })
    eq('上架后的确认搜索首条仍是该笔记', json?.data?.list?.[0]?.id, searchNoteId)
  }

  // ---- 17.3 P10 评论点赞（PUT/DELETE /api/comment/{id}/like）
  //
  // 用 actorAuth 的评论：它发过不少评论（已烧掉一部分 10/分钟 的桶），
  // 只用 1 次额度就够，避免「恰好卡在 10 次」这种脆断言。
  {
    const { json } = await del('/api/comment/123456789012345/like', { token: actorAuth })
    codeIs('给不存在的评论取消点赞返回 30005', json, 30005)
  }
  {
    const { json } = await put('/api/comment/123456789012345/like', { token: actorAuth })
    codeIs('给不存在的评论点赞返回 30005', json, 30005)
  }
  let likeCommentId = null
  {
    const { json } = await post('/api/comment', {
      token: actorAuth,
      body: { noteId, content: 'P10 评论点赞测试' },
    })
    codeIs('发布一条用于点赞测试的评论', json, 0)
    likeCommentId = json?.data?.id
    eq('新评论 likeCount=0', json?.data?.likeCount, 0)
    eq('发布者自己 liked=false', json?.data?.liked, false)
  }
  {
    const { json } = await put(`/api/comment/${likeCommentId}/like`, { token: rlAuth })
    codeIs('评论点赞成功', json, 0)
    eq('点赞后 likeCount=1', json?.data?.likeCount, 1)
    eq('点赞者 liked=true', json?.data?.liked, true)
  }
  {
    const { json } = await put(`/api/comment/${likeCommentId}/like`, { token: rlAuth })
    codeIs('重复点赞返回 30001（唯一索引当裁判，不是先查后插）', json, 30001)
  }
  {
    const { json } = await put(`/api/comment/${likeCommentId}/like`, { token: actorAuth })
    codeIs('评论作者也能给自己的评论点赞', json, 0)
    eq('第二个人点赞后 likeCount=2', json?.data?.likeCount, 2)
  }
  {
    const { json } = await del(`/api/comment/${likeCommentId}/like`, { token: rlAuth })
    codeIs('取消点赞成功', json, 0)
    eq('取消后 likeCount=1（作者的赞还在）', json?.data?.likeCount, 1)
    eq('取消者 liked=false', json?.data?.liked, false)
  }
  {
    const { json } = await del(`/api/comment/${likeCommentId}/like`, { token: rlAuth })
    codeIs('没点赞却取消返回 30002', json, 30002)
  }
  {
    // 已下架笔记的评论不能再点赞（requireLikeableComment 的 20002 分支）
    await put(`/api/note/${noteId}/status`, { token: auth, body: { status: 2 } })
    const { json } = await put(`/api/comment/${likeCommentId}/like`, { token: actorAuth })
    codeIs('已下架笔记的评论点赞被拒（20002）', json, 20002)
    await put(`/api/note/${noteId}/status`, { token: auth, body: { status: 1 } })
  }
  {
    // 取消点赞不被「笔记已下架」阻拦（撤销一个已有的赞不依赖笔记状态）
    // 与笔记点赞「下架后无法取消」那个已知缺口对照，评论侧刻意没这个坑
    await put(`/api/note/${noteId}/status`, { token: auth, body: { status: 2 } })
    const { json } = await del(`/api/comment/${likeCommentId}/like`, { token: actorAuth })
    codeIs('笔记下架后仍能取消自己的评论赞', json, 0)
    eq('取消后 likeCount=0', json?.data?.likeCount, 0)
    await put(`/api/note/${noteId}/status`, { token: auth, body: { status: 1 } })
  }
  {
    // actorAuth 的赞刚在上一步取消了，先把赞点回去再断言列表状态
    const like = await put(`/api/comment/${likeCommentId}/like`, { token: actorAuth })
    codeIs('列表断言前先把自己的赞点回去', like.json, 0)
    const { json } = await get(`/api/comment/list?noteId=${noteId}&page=1&size=10`, { token: actorAuth })
    const row = (json?.data?.list ?? []).find((c) => c.id === likeCommentId)
    check('点赞后列表里该评论 liked 状态正确（loadLikedIds 走 IN 批量判）',
      typeof row === 'object' && row?.liked === true, `liked=${row?.liked}`)
  }
  {
    const { json } = await del(`/api/comment/${likeCommentId}`, { token: actorAuth })
    codeIs('清理点赞测试评论（回归零状态）', json, 0)
  }

  // ---- 17.4 P11 删除笔记（DELETE /api/note/{id}，作者本人）
  //
  // 验证链：删除 → 作者/他人详情都 20001 → 作者主页消失 → 评论清空 → 索引移除。
  // 删除先造好互动 + 评论（含子回复 + 评论点赞），专测「级联清理」没漏子表。
  //
  // <b>搜索词绝不能带共享的 ${stamp}</b>：ik_smart 会把「删除测试 <stamp>」拆成
  // 删除/测试 + stamp 若干 token，multiMatch 是 OR 语义，一旦命中任何同样带
  // 这个 stamp 的其它笔记标题，total 就恒≥1，轮询永远等不到 0（实测 20 撞车）。
  // 用独立随机串做搜索锚点，跟 P7 的 searchUnique 同一个套路。
  const delUnique = `delok${Math.random().toString(36).slice(2, 8)}`.toLowerCase()
  let deleteMeId = null
  {
    const d = await post('/api/note/publish', {
      token: rlAuth,
      body: { title: `${delUnique} 待删除种子`, content: '删除后会从索引消失的种子', type: 1, imageUrls: [imageUrl] },
    })
    codeIs('删除测试笔记发布成功', d.json, 0)
    deleteMeId = d.json?.data?.id
    const like = await put(`/api/note/${deleteMeId}/like`, { token: actorAuth })
    codeIs('给删除对象点赞成功（验证级联清 note_like）', like.json, 0)
    const collect = await put(`/api/note/${deleteMeId}/collect`, { token: actorAuth })
    codeIs('给删除对象收藏成功（验证级联清 note_collect）', collect.json, 0)
    const root = await post('/api/comment', {
      token: rlAuth,
      body: { noteId: deleteMeId, content: '要跟着笔记一起删掉的评论' },
    })
    codeIs('删除对象上发一条评论', root.json, 0)
    const reply = await post('/api/comment', {
      token: rlAuth,
      body: { noteId: deleteMeId, content: '跟着删的子回复', parentId: root.json?.data?.id },
    })
    codeIs('删除对象上发一条子回复（验证级联清 comment_like 依赖链）', reply.json, 0)
    const cl = await put(`/api/comment/${root.json?.data?.id}/like`, { token: rlAuth })
    codeIs('给删除对象的评论点赞成功', cl.json, 0)
    check('删除对象 ID 有效', typeof deleteMeId === 'string' && /^\d+$/.test(deleteMeId), `id=${deleteMeId}`)
  }
  {
    const { json } = await del(`/api/note/${deleteMeId}`)
    codeIs('未登录删除被拒（10005）', json, 10005)
  }
  {
    const { json } = await del(`/api/note/${deleteMeId}`, { token: actorAuth })
    codeIs('非作者删除返回 20001（防探测）', json, 20001)
  }
  {
    const d = await del(`/api/note/${deleteMeId}`, { token: rlAuth })
    codeIs('作者删除成功', d.json, 0)
    const mine = await get(`/api/note/${deleteMeId}`, { token: rlAuth })
    codeIs('删除后作者自己也查不到（20001）', mine.json, 20001)
    const other = await get(`/api/note/${deleteMeId}`, { token: actorAuth })
    codeIs('删除后他人同样查不到', other.json, 20001)
    const cm = await get(`/api/comment/list?noteId=${deleteMeId}&page=1&size=10`, { token: actorAuth })
    // 删除后评论列表随笔记一起消失：CommentQueryServiceImpl 先校验笔记存在再分页，
    // 已删笔记整口返回 20001，而不是「空列表」——没有半死状态
    codeIs('删除后评论列表随笔记一同消失（20001，而非空列表）', cm.json, 20001)
  }
  {
    const again = await del(`/api/note/${deleteMeId}`, { token: rlAuth })
    codeIs('重复删除返回 20001（幂等语义走 NOT_FOUND）', again.json, 20001)
  }
  {
    const me = await get('/api/user/me', { token: rlAuth })
    const list = await get(`/api/note/user/${me.json?.data?.id}?page=1&size=100`, { token: rlAuth })
    const cards = (list.json?.data?.list ?? []).filter((n) => n.id === deleteMeId)
    eq('作者主页不再包含已删笔记', cards.length, 0)
  }
  {
    // 删除 → afterCommit 事件 → Kafka → ES deleteById：轮询直到搜不到
    // 用 rlAuth 而非 pollAuth：pollAuth 的 60/min 已被 P7 与 17.2 的轮询占满，
    // 窄窗口内再叠加一段 25s 轮询必然被打回（实测 100005 抓到过）
    const kw = encodeURIComponent(delUnique)
    let gone = false
    for (let i = 0; i < 50 && !gone; i++) {
      const { json } = await get(`/api/search/note?keyword=${kw}&page=1&size=10`, { token: rlAuth })
      gone = json?.code === 0 && (json?.data?.total ?? 0) === 0
      if (!gone) await new Promise((r) => setTimeout(r, 500))
    }
    check('删除后经 Kafka 从搜索索引移除（25s 内搜不到）', gone)
  }

  // ---- 17.5 P14 发现流：GET /api/feed/discover（关注优先 → 互动量 → 最新补位）
  //
  // 断言刻意**不钉 total 的具体数字**：库里还有种子号（xk_seed_*）、演示号、
  // 压测残留等一堆别人的笔记，写死数字每加一次种子数据就得重写这条断言。
  // 钉的是「集合关系 + 排序规则」这两件真正会回归的事。
  {
    const { json } = await get('/api/feed/discover?page=1&size=100', { token: auth })
    codeIs('发现流查询成功', json, 0)
    const list = json?.data?.list ?? []
    eq('发现流 total 是 JSON number', typeof json?.data?.total, 'number')
    check('发现流 list 长度 = min(total, size)',
      list.length === Math.min(json?.data?.total ?? 0, 100),
      `total=${json?.data?.total} size=100 list=${list.length}`)

    const ids = list.map((n) => n.id)
    check('发现流不含自己的笔记', !ids.includes(noteId), `ids含自己=${ids.includes(noteId)}`)
    check('发现流全部是已发布（status=1）', list.every((n) => n.status === 1),
      `status=${[...new Set(list.map((n) => n.status))].join(',')}`)
    check('发现流 authorFollowed 是布尔（不是字符串/数字）',
      list.every((n) => typeof n.authorFollowed === 'boolean'),
      `${list.find((n) => typeof n.authorFollowed !== 'boolean')?.authorFollowed}`)
    check('发现流行没有漏 password', !Object.keys(list[0] ?? {}).includes('password'))

    // 排序第一级：关注过的作者必须**连成前缀**排在未关注之前
    const followedFlags = list.map((n) => (n.authorFollowed ? 1 : 0))
    const firstUnfollowed = followedFlags.indexOf(0)
    check('已关注作者的笔记连成前缀、排在未关注之前（关注优先）',
      firstUnfollowed === -1 || followedFlags.slice(firstUnfollowed).every((x) => x === 0),
      `flags=${followedFlags.join('')}`)
    check('已关注作者的笔记确实出现（对照：本次造过 ct2/ct3 的关注）',
      followedFlags.some((x) => x === 1), `flags=${followedFlags.join('')}`)

    // 排序第二级：同一档内按互动量（赞+藏+评）非递增；第三级是时间，交给列表本身
    const score = (n) => (n.likeCount ?? 0) + (n.collectCount ?? 0) + (n.commentCount ?? 0)
    const scoreOf = (n) => score(n)
    for (const seg of [list.filter((n) => n.authorFollowed), list.filter((n) => !n.authorFollowed)]) {
      const scores = seg.map(scoreOf)
      check('同一档内互动量非递增（互动量排序）',
        scores.every((v, i) => i === 0 || scores[i - 1] >= v), `${scores.join(',')}`)
    }
  }
  {
    // 这一条是这个流存在的**全部理由**：没关注任何人时关注流是空的，发现流必须仍有内容
    const { json } = await get('/api/feed/discover?page=1&size=10', { token: actorAuth })
    codeIs('没关注任何人时发现流照样查询成功', json, 0)
    check('没关注任何人时发现流不为空（冷启动不再空白首页）',
      (json?.data?.list?.length ?? 0) > 0, `list=${json?.data?.list?.length}`)
    const ids = (json?.data?.list ?? []).map((n) => n.id)
    check('没关注任何人时发现流不含自己的笔记',
      !(json?.data?.list ?? []).some((n) => n.authorId === actorId),
      `ids=${ids.join(',')} actorId=${actorId}`)
    check('没关注任何人时这些笔记的 authorFollowed 全为 false',
      (json?.data?.list ?? []).every((n) => n.authorFollowed === false),
      `${(json?.data?.list ?? []).filter((n) => n.authorFollowed !== false).length} 条异常`)
  }
  {
    // 分页与入参夹取
    const { json } = await get('/api/feed/discover?page=1&size=1', { token: auth })
    codeIs('发现流分页 size=1 查询成功', json, 0)
    eq('发现流 size=1 只回 1 条', json?.data?.list?.length, 1)
    const big = await get('/api/feed/discover?page=1&size=1000', { token: auth })
    check('发现流 size 上限被夹到 100', (big?.json?.data?.list?.length ?? 0) <= 100,
      `len=${big?.json?.data?.list?.length}`)
    const zero = await get('/api/feed/discover?page=0&size=0', { token: auth })
    codeIs('发现流 page/size 非法值被夹住而不是报错', zero?.json, 0)
  }
  {
    const { json } = await get('/api/feed/discover')
    codeIs('未登录访问发现流 10005', json, 10005)
  }
  {
    // 回归：assemble 改成「authorFollowed 实时判断」后，关注流不能被带坏
    const { json } = await get('/api/feed/follow', { token: auth })
    codeIs('改造后关注流仍查询成功', json, 0)
    check('改造后关注流仍只含已关注作者的笔记',
      (json?.data?.list ?? []).every((n) => n.authorFollowed === true),
      `${(json?.data?.list ?? []).filter((n) => n.authorFollowed !== true).length} 条异常`)
    check('发现流改造没有影响关注流的 total', json?.data?.total >= 1, `total=${json?.data?.total}`)
  }

  // ---- 17.6 P15 通知中心：GET /api/notification/list | unread-count | {id}/read | read-all
  //
  // 社交闭环里最短的那条链：没有它，别人赞了我/评论了我我完全不知道。
  // 断言刻意**不钉通知条数的具体数字** —— 同一个 ct 账号在本文件前面已经被
  // 关注、点赞、评论过好几次，通知表里本来就有存量。钉的是「集合关系 + 排序规则
  // + 幂等 + 权限」，这四样才是会回归的地方。
  //
  // 参与者：auth（笔记作者）/ actorAuth（互动者，与本文件 P5/P6 用的同一个人）
  {
    const { json } = await get('/api/notification/list?page=1&size=50', { token: auth })
    codeIs('通知列表查询成功', json, 0)
    const list = json?.data?.list ?? []
    eq('通知列表 total 是 JSON number', typeof json?.data?.total, 'number')
    eq('通知列表 list 长度 = min(total, size)', list.length, Math.min(json?.data?.total ?? 0, 50))
    check('通知行字段齐全（id/type/typeText/actorId/actorNickname/isRead/createTime）',
      list.every((n) => typeof n.id === 'string' && n.id !== ''
        && Number.isInteger(n.type) && typeof n.typeText === 'string' && n.typeText.length > 0
        && typeof n.actorId === 'string' && typeof n.actorNickname === 'string'
        && (n.isRead === 0 || n.isRead === 1) && !!n.createTime),
      JSON.stringify(list[0] ?? {}))
    check('通知的 ID 是字符串且精度未截断（雪花 ID 走 ToStringSerializer）',
      list.every((n) => BigInt(n.id) > 9007199254740991n),
      list.map((n) => n.id).join(','))
    check('通知没有漏 password', !Object.keys(list[0] ?? {}).includes('password'))
    // 排序：未读优先，再按时间倒序（同档内）
    const flags = list.map((n) => n.isRead)
    const firstRead = flags.indexOf(1)
    check('未读排在已读前面（未读优先）',
      firstRead === -1 || flags.slice(firstRead).every((x) => x === 1),
      `flags=${flags.join('')}`)
    let descOk = true
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1].isRead === list[i].isRead && list[i - 1].createTime < list[i].createTime) {
        descOk = false
      }
    }
    check('同一档内按时间倒序', descOk, list.map((n) => n.createTime).join(' | '))
    // 笔记类通知必须带得上笔记标题（免 JOIN 的那一列真的填对了）
    const withNote = list.filter((n) => n.noteId !== undefined)
    check('笔记类通知带上了笔记标题（note_id 冗余列填对）',
      withNote.length === 0 || withNote.every((n) => typeof n.noteTitle === 'string' && n.noteTitle.length > 0),
      withNote.map((n) => `${n.typeText}:${n.noteTitle}`).join(' | '))
    // 关注类通知**不该**有 noteId：这一列语义是「所属笔记」，
    // 拿 userId 冒充会让标题回填查不到东西
    check('关注类通知不带 noteId（不拿 userId 冒充笔记 ID）',
      list.filter((n) => n.type === 4).every((n) => n.noteId === undefined && n.noteTitle === undefined),
      JSON.stringify(list.filter((n) => n.type === 4).slice(0, 1)))
  }
  {
    // 未读数必须是 JSON number —— 这里踩过坑：写成 Result<Long> 时 Jackson 会用
    // ToStringSerializer 把 0 变成 "0"，前端 `unread === 0` 恒为 false
    // （与 PageVO.total 当年改成 Integer 是同一个坑）
    const { json } = await get('/api/notification/unread-count', { token: auth })
    codeIs('未读数查询成功', json, 0)
    eq('未读数是 JSON number 而不是字符串（前端要能做 === 0）',
      typeof json?.data, 'number')
    check('未读数非负', typeof json?.data === 'number' && json.data >= 0, `unread=${json?.data}`)
  }
  {
    const { json } = await get('/api/notification/list?page=1&size=1000', { token: auth })
    codeIs('通知 size 上限被夹住而不是报错', json, 0)
    check('通知 size 被夹到 100', (json?.data?.list?.length ?? 0) <= 100, `len=${json?.data?.list?.length}`)
  }
  {
    // 幂等：同一个人对同一个对象重复互动，通知列表只该有一条
    const before = await get('/api/notification/list?page=1&size=50', { token: auth })
    const likeN = (before.json?.data?.list ?? []).filter((n) => n.type === 1).length
    await put(`/api/note/${noteId}/like`, { token: actorAuth })
    await del(`/api/note/${noteId}/like`, { token: actorAuth })
    await put(`/api/note/${noteId}/like`, { token: actorAuth })
    const after = await get('/api/notification/list?page=1&size=50', { token: auth })
    const likeA = (after.json?.data?.list ?? []).filter((n) => n.type === 1).length
    eq('重复赞同一篇笔记不会刷出第二条通知（uk_notify_once + touchExisting）', likeA, likeN)
  }
  {
    // 不给自己发通知：自己赞自己的笔记不该收到通知
    const before = await get('/api/notification/list?page=1&size=50', { token: auth })
    const totalBefore = before.json?.data?.total ?? 0
    await put(`/api/note/${noteId}/like`, { token: auth })
    const after = await get('/api/notification/list?page=1&size=50', { token: auth })
    eq('自己赞自己的笔记不产生通知（receiver == actor 直接 return）',
      after.json?.data?.total, totalBefore)
    // 复原：把自己刚点的赞取消掉，别把 noteId 留给后面的用例
    await del(`/api/note/${noteId}/like`, { token: auth })
  }
  {
    // 权限：别人通知我不能标已读，且不该报错
    const mine = await get('/api/notification/list?page=1&size=1', { token: auth })
    const other = await get('/api/notification/list?page=1&size=1', { token: actorAuth })
    const otherFirst = other.json?.data?.list?.[0]
    if (otherFirst) {
      const { json } = await post(`/api/notification/${otherFirst.id}/read`, { token: auth })
      codeIs('标读别人的通知不报错', json, 0)
      eq('标读别人的通知无效（返回 false，越权被 SQL 的 receiver_id 挡住）', json?.data, false)
    } else {
      check('（互动者恰好没有通知，跳过越权用例）', true)
    }
    const mineFirst = mine.json?.data?.list?.[0]
    if (mineFirst) {
      const r1 = await post(`/api/notification/${mineFirst.id}/read`, { token: auth })
      eq('单条标已读返回 true', r1.json?.data, true)
      const r2 = await post(`/api/notification/${mineFirst.id}/read`, { token: auth })
      eq('重复标已读幂等（返回 false，不报错）', r2.json?.data, false)
      const un = await get('/api/notification/list?page=1&size=50&onlyUnread=true', { token: auth })
      check('onlyUnread 过滤掉已读',
        !(un.json?.data?.list ?? []).some((n) => n.id === mineFirst.id),
        `onlyUnread 里仍有该条`)
    }
    const ra = await post('/api/notification/read-all', { token: auth })
    codeIs('全部已读成功', ra.json, 0)
    const un = await get('/api/notification/unread-count', { token: auth })
    eq('全部已读后未读数为 0', un.json?.data, 0)
  }
  {
    // 全站默认需要登录，通知也一样
    for (const p of ['/api/notification/list', '/api/notification/unread-count']) {
      const { json } = await get(p)
      codeIs(`未登录访问 ${p} 返回 10005`, json, 10005)
    }
    const { json } = await post('/api/notification/read-all')
    codeIs('未登录访问 /api/notification/read-all 返回 10005', json, 10005)
  }

  // ---- 17.7 P15 内容审核：敏感词命中返回 60001（发布 / 编辑 / 评论三个入口）
  //
  // 为什么单独一段而不是散进各处：审核是**横切**关注点，一个「漏接入口」就会留下
  // 后门（发的时候干净、编辑时塞进去、或者评论根本不审）。三条路径各钉一遍。
  {
    // 发布是 20/min/USER 的限流，而本文件前面各段已经发掉不少额度
    // （全文件 note/publish 出现 26 次）。**这一段必须用自己的账号**：
    // 挂在 auth 上会撞桶，表现为 okPub 莫名其妙返回非 0、后面全段连锁假红。
    // 账号名用 ct_mod 前缀，仍匹配 AGENTS.md 记录的清理正则 ^ct[0-9]?_[a-z0-9]+$。
    const modName = `ct_mod${stamp}`
    const { json: modReg } = await post('/api/user/register', { body: { username: modName, password: P } })
    codeIs('审核段落专用账号注册成功', modReg, 0)
    const { json: modLogin } = await post('/api/user/login', { body: { username: modName, password: P } })
    const modAuth = `Bearer ${modLogin?.data?.accessToken}`
    check('审核段落专用账号拿到令牌', typeof modAuth === 'string' && modAuth.length > 20, `${modAuth?.slice(0, 12)}…`)

    const IMG = ['/uploads/2026/10/06/xiaoku-demo.png']
    const pub = (title, content) => post('/api/note/publish', {
      token: modAuth,
      body: { type: 1, title, content, imageUrls: IMG },
    })

    // 词库是**占位词表**（moderation/words.txt），只放几条组合特征明显的短语。
    // 用词表里的原词入参是刻意的：词表换掉时这几条断言要一起换，
    // 但「命中即 60001」这个形状不变。
    const { json: t1 } = await pub('这是测试敏感词哦', '正文完全正常')
    codeIs('标题命中敏感词返回 60001', t1, 60001)
    const { json: c1 } = await pub('标题完全正常', '正文里写了地下钱庄')
    codeIs('正文命中敏感词返回 60001', c1, 60001)
    check('60001 的提示语不回显命中的词（告诉用户哪个词被禁＝教他怎么绕）',
      !String(t1?.message ?? '').includes('测试敏感词'), `msg=${t1?.message}`)

    // NFKC 归一 + 转小写：全角大写变体必须同样被拦。
    // 钉的是 DefaultTextModeration.normalize 这个行为，不是某个词条
    const { json: full } = await pub('标题完全正常', 'ＸＫ－ＳＰＡＭ－ＭＡＩＬ 加全角')
    codeIs('全角大写变体归一后同样拦截（绕过失败）', full, 60001)

    // 连续重复字符压缩：「的的的」等价「的的」，防填充绕过
    const { json: rep } = await pub('标题完全正常', '地下地下地下钱庄钱庄钱庄')
    codeIs('连续重复字符不影响命中（既不误放行也不误拦）', rep, 60001)

    // 正常内容必须放行 —— 否则这套东西等于「让全站发不出笔记」
    const clean = await pub('审核段落用的正常标题', '正常正文，讲的是咖啡探店')
    codeIs('不含敏感词的笔记正常发布', clean.json, 0)
    const cleanId = clean.json?.data?.id
    check('正常发布拿得到 noteId（后面编辑/评论用例要用）',
      typeof cleanId === 'string' && /^\d+$/.test(cleanId), `id=${cleanId}`)

    // 编辑是第二个入口：发布时干净、编辑时才塞敏感词，同样要拦
    const { json: e1 } = await put(`/api/note/${cleanId}`, {
      token: modAuth,
      body: { type: 1, title: '改标题：测试敏感词', content: '正文没动', imageUrls: IMG },
    })
    codeIs('编辑时把敏感词塞进标题返回 60001', e1, 60001)
    const { json: e2 } = await put(`/api/note/${cleanId}`, {
      token: modAuth,
      body: { type: 1, title: '标题没动', content: '正文改成：法外之地', imageUrls: IMG },
    })
    codeIs('编辑时把敏感词塞进正文返回 60001', e2, 60001)
    // 被拦的编辑不该有副作用：标题必须还是原来那个
    const { json: afterEdit } = await get(`/api/note/${cleanId}`, { token: modAuth })
    eq('审核拦截的编辑没有写库（标题保持原值）', afterEdit?.data?.title, '审核段落用的正常标题')

    // 评论是第三个入口。⚠️ 这条曾经假绿：审核被写在 setContent 之前，
    // 那一刻 comment.getContent() 还是 null，而 check 对 null 直接放行。
    const { json: cm1 } = await post('/api/comment', {
      token: modAuth,
      body: { noteId: cleanId, content: '这里有测试敏感词' },
    })
    codeIs('评论命中敏感词返回 60001', cm1, 60001)
    const { json: cm2 } = await post('/api/comment', {
      token: modAuth,
      body: { noteId: cleanId, content: '正常的评论内容' },
    })
    codeIs('正常评论仍然放行（审核不是把评论功能打死）', cm2, 0)

    // 收尾：把这篇笔记删掉，别给后面 18 段之外留垃圾
    const { json: rm } = await del(`/api/note/${cleanId}`, { token: modAuth })
    codeIs('审核段落用完的笔记已删除', rm, 0)
  }


  // ---- 17.8 P16「谁赞了/ 谁收藏了」：GET /api/note/{id}/likes | collects
  //
  // 为什么值得单独一段：计数与名单是两件事。计数只能给人一个数字，
  // 名单才带来社交感。数据本来就在 note_like / note_collect 表里，
  // P5 只做了计数方向。真正要钉的是**两个门禁**：
  //   ① 与笔记详情同一套可见性（下架的笔记别人拿不到名单）——
  //      这两条如果各自写一份门禁，迟早漏一处，结果是「正文打不开、
  //      但点赞人列表能拿到昵称头像」，等于门禁只做了一半
  //   ② 未登录 / 不存在的笔记
  {
    // 造两个明确的人来赞这一篇，好把名单内容钉死
    // ⚠️ 自己发一篇笔记，不复用全局 noteId —— 那个在 P5 段末尾被删了，
    // 而 17.1/17.2 也在用它，等于「这条笔记此刻还在不在」要看前面几十段没碰它。
    // 踩过：size=1 那条断言返回 0 条，排查半天才发现是笔记早没了。
    const { json: likerNote } = await post('/api/note/publish', {
      token: auth,
      body: { type: 1, title: `名单用例的笔记 ${stamp}`, content: '给 P16 名单段用', imageUrls: [imageUrl] },
    })
    codeIs('名单用例的笔记发布成功', likerNote, 0)
    const listNoteId = likerNote?.data?.id
    check('名单用例拿到笔记 ID', typeof listNoteId === 'string' && /^\d+$/.test(listNoteId), `id=${listNoteId}`)

    const likeName = `ct_liker${stamp}`
    const { json: lk } = await post('/api/user/register', { body: { username: likeName, password: P } })
    codeIs('点赞者账号注册成功', lk, 0)
    const { json: lkLogin } = await post('/api/user/login', { body: { username: likeName, password: P } })
    const likerAuth = `Bearer ${lkLogin?.data?.accessToken}`

    // 先复位：上一轮崩在清理之前就会一直留着，导致这次 PUT 返回 30001
    await del(`/api/note/${listNoteId}/like`, { token: likerAuth })
    const { json: liked } = await put(`/api/note/${listNoteId}/like`, { token: likerAuth })
    codeIs('点赞者点赞成功', liked, 0)
    await del(`/api/note/${listNoteId}/collect`, { token: likerAuth })
    const { json: col } = await put(`/api/note/${listNoteId}/collect`, { token: likerAuth })
    codeIs('点赞者收藏成功', col, 0)

    const { json: likes } = await get(`/api/note/${listNoteId}/likes?page=1&size=20`, { token: auth })
    codeIs('点赞人列表查询成功', likes, 0)
    eq('点赞人列表 total 是 JSON number（Long 会被序列化成字符串）',
      typeof likes?.data?.total, 'number')
    const likers = likes?.data?.list ?? []
    check('点赞人列表里能看到刚点赞的那个人',
      likers.some((u) => u.id === lk.data?.id), `ids=${likers.map((u) => u.id).join(',')}`)
    check('点赞人卡片带昵称与用户名（列表页要显示这两个）',
      likers.every((u) => typeof u.nickname === 'string' && u.nickname.length > 0
        && typeof u.username === 'string'), '')
    check('点赞人卡片的 followed 是布尔（行内还要放关注按钮）',
      likers.every((u) => typeof u.followed === 'boolean'),
      `${likers.map((u) => u.followed).join(',')}`)
    check('点赞人列表没有泄露 password 字段',
      likers.every((u) => !Object.keys(u).includes('password')), '')

    const { json: collects } = await get(`/api/note/${listNoteId}/collects`, { token: auth })
    codeIs('收藏人列表查询成功', collects, 0)
    check('收藏人列表里能看到刚收藏的那个人',
      (collects?.data?.list ?? []).some((u) => u.id === lk.data?.id), '')

    // 分页是这套列表唯一没做的部分，先钉住 page/size 真的生效，别让它悄悄变死循环
    // get() 返回的是 { json, ... }，不是响应体本身 —— 漏写 .json 的话
    // p1.data 是 undefined，断言会报「拿到 undefined」而不是「参数没生效」
    // 分页断言需要**至少 2 个赞**：只有 1 个赞时 page=2 必然是空列表，
    // 「两页不同」就成了恒真断言，测不出 size 有没有生效。actorAuth 正好第二个。
    // ⚠️ 这两步的返回值必须断：PUT 没成功时关系行根本没建，
    // 而下面 size=1 那条断言拿到 0 条 —— 症状离真因隔了 40 行。
    // 踩过：actorAuth 在这段之前对这条笔记已经赞过（跨段状态残留），
    // 于是 PUT 返回 100002/30001，两种情况都不会让断言给出任何提示。
    const { json: actorReset } = await del(`/api/note/${listNoteId}/like`, { token: actorAuth })
    const { json: actorLiked } = await put(`/api/note/${listNoteId}/like`, { token: actorAuth })
    codeIs('第二个点赞人点赞成功', actorLiked, 0)
    const { json: p1 } = await get(`/api/note/${listNoteId}/likes?page=1&size=1`, { token: auth })
    const { json: p2 } = await get(`/api/note/${listNoteId}/likes?page=2&size=1`, { token: auth })
    eq('size=1 时第一页只有 1 条', p1?.data?.list?.length, 1)
    check('第二页与第一页不是同一批（否则 size 参数被忽略了）',
      p1?.data?.list?.[0]?.id !== p2?.data?.list?.[0]?.id,
      `p1=${p1?.data?.list?.[0]?.id} p2=${p2?.data?.list?.[0]?.id}`)
    const { json: p0 } = await get(`/api/note/${listNoteId}/likes?size=0`, { token: auth })
    eq('size=0 被夹到 1（不能靠 size=0 一次拿到全部）', p0?.data?.list?.length, 1)

    // 门禁①：下架的笔记，非作者拿不到名单（20002），作者仍可（P10 编辑入口需要）
    await put(`/api/note/${listNoteId}/status`, { token: auth, body: { status: 2 } })
    const downAsOther = await get(`/api/note/${listNoteId}/likes`, { token: likerAuth })
    codeIs('非作者看不到下架笔记的点赞人名单（与详情同一门禁）', downAsOther.json, 20002)
    const downAsAuthor = await get(`/api/note/${listNoteId}/likes`, { token: auth })
    codeIs('作者仍能看到自己下架笔记的名单', downAsAuthor.json, 0)
    await put(`/api/note/${listNoteId}/status`, { token: auth, body: { status: 1 } })

    // 门禁②：不存在的笔记 20001、未登录 10005
    const missing = await get('/api/note/999999999999/likes', { token: auth })
    codeIs('不存在的笔记返回 20001', missing.json, 20001)
    const missingC = await get('/api/note/999999999999/collects', { token: auth })
    codeIs('不存在的笔记（收藏人）返回 20001', missingC.json, 20001)
    const anon = await get(`/api/note/${listNoteId}/likes`)
    codeIs('未登录访问点赞人列表返回 10005', anon.json, 10005)
    const anonC = await get(`/api/note/${listNoteId}/collects`)
    codeIs('未登录访问收藏人列表返回 10005', anonC.json, 10005)

    // 复原：清掉这条点赞/收藏关系
    await del(`/api/note/${listNoteId}/like`, { token: likerAuth })
    await del(`/api/note/${listNoteId}/collect`, { token: likerAuth })
    const { json: after } = await get(`/api/note/${listNoteId}/likes`, { token: auth })
    check('取消点赞后名单里没有他了',
      !(after?.data?.list ?? []).some((u) => u.id === lk.data?.id), '')
  }

// ---- 17.9 P17 话题与提及：#话题 / @某人
  //
  // 这一段钉三件事，每件都有具体的失败方式：
  //   ① 解析规则（去重、限长、标点截断、不误伤 C#）
  //   ② 关系行跟着正文走（编辑后旧话题必须消失，不是追加）
  //   ③ 可见性（下架的笔记不该让话题变热门）
  {
    const unique = 'T' + stamp
    const TOPIC = '探店' + unique

    const { json: p1 } = await post('/api/note/publish', {
      token: auth,
      body: {
        type: 1,
        title: `标题带 #${TOPIC} 的话题`,
        content: `正文又写了一遍 #${TOPIC}，还有一个 #很长很长的话题名字，和 @xk_ui_follow 的互动`,
        imageUrls: [imageUrl],
      },
    })
    codeIs('带话题的笔记发布成功', p1, 0)
    const topicNoteId = p1?.data?.id
    const { json: d1 } = await get(`/api/note/${topicNoteId}`, { token: auth })
    const topics = d1?.data?.topics ?? []
    eq('识别出 2 个话题（标题 1 + 正文 2，重复的去重）', topics.length, 2)
    check('话题名不含 #（存的是裸名，# 只是正文的语法）',
      topics.every((t) => typeof t.name === 'string' && !t.name.startsWith('#')),
      JSON.stringify(topics))
    check('重复的 #话题 只存了一条',
      topics.filter((t) => t.name === TOPIC).length === 1, JSON.stringify(topics))
    check('标题里的话题也被识别到了', topics.some((t) => t.name === TOPIC), JSON.stringify(topics))
    check('话题名限长 20（超长被截断而不是整段存进去）',
      topics.every((t) => t.name.length <= 20), JSON.stringify(topics.map((t) => t.name)))
    check('话题 id 是字符串（雪花 ID 不能变成数字）',
      topics.every((t) => typeof t.id === 'string' && /^\d+$/.test(t.id)), JSON.stringify(topics))
    // 关键一条：逗号必须截断，否则会解析出「很长很长的话题名字，和」
    // 这种把标点和后半句一起吞进去的话题 —— 用户完全没意识到自己建了个
    // 含逗号的话题，而话题页会按这个名字聚笔记
    check('话题名在标点处截断（不把「，和」吞进话题名）',
      !topics.some((t) => /[，。、,.]/.test(t.name)), JSON.stringify(topics.map((t) => t.name)))

    const mentions = d1?.data?.mentions ?? []
    eq('识别出 1 个提及', mentions.length, 1)
    check('提及带 id 与昵称（详情页要渲染成可点链接）',
      typeof mentions[0]?.id === 'string' && typeof mentions[0]?.nickname === 'string'
        && mentions[0].nickname.length > 0, JSON.stringify(mentions))
    check('提及回传的是昵称而不是用户名（两者不是一回事）',
      mentions[0]?.nickname !== 'xk_ui_follow', JSON.stringify(mentions))

    // 不存在的用户名：安静忽略，不报错
    const { json: ghost } = await post('/api/note/publish', {
      token: auth,
      body: { type: 1, title: '提到不存在的人', content: '@no_such_user_xyz 你好', imageUrls: [imageUrl] },
    })
    codeIs('提到不存在的用户仍然发布成功', ghost, 0)
    const { json: gd } = await get(`/api/note/${ghost?.data?.id}`, { token: auth })
    eq('不存在的用户名被忽略，提及列表为空', (gd?.data?.mentions ?? []).length, 0)
    await del(`/api/note/${ghost?.data?.id}`, { token: auth })

    const { json: hot } = await get('/api/topic/list?page=1&size=50', { token: auth })
    codeIs('热门话题列表查询成功', hot, 0)
    const hotRow = (hot?.data?.list ?? []).find((t) => t.name === TOPIC)
    check('新话题出现在热门列表里', !!hotRow, JSON.stringify((hot?.data?.list ?? []).map((t) => t.name)))
    eq('热门列表的 noteCount 是 JSON number（Long 会被序列化成字符串）',
      typeof hotRow?.noteCount, 'number')
    eq('该话题 noteCount=1', hotRow?.noteCount, 1)

    const { json: tn } = await get(`/api/topic/notes?name=${encodeURIComponent(TOPIC)}`, { token: auth })
    codeIs('话题页查询成功', tn, 0)
    check('话题页里有刚发的那篇',
      (tn?.data?.list ?? []).some((n) => n.id === topicNoteId),
      JSON.stringify((tn?.data?.list ?? []).map((n) => n.id)))

    // 不存在的话题必须报错，不能静默返回空列表 ——
    // 空列表在页面上和「这个话题还没内容」长得一模一样
    const { json: nope } = await get('/api/topic/notes?name=' + encodeURIComponent('绝不存在的话题' + unique), { token: auth })
    codeIs('不存在的话题返回 70001（而不是空列表）', nope, 70001)
    const { json: withHash } = await get(`/api/topic/notes?name=${encodeURIComponent('#' + TOPIC)}`, { token: auth })
    codeIs('话题名带 # 前缀也认得', withHash, 0)

    // 下架后不该再出现在话题页/热门榜里
    await put(`/api/note/${topicNoteId}/status`, { token: auth, body: { status: 2 } })
    const { json: down } = await get(`/api/topic/notes?name=${encodeURIComponent(TOPIC)}`, { token: auth })
    eq('笔记下架后话题页里没有了', (down?.data?.list ?? []).length, 0)
    const { json: hot2 } = await get('/api/topic/list?page=1&size=50', { token: auth })
    eq('笔记下架后该话题的 noteCount 归零',
      (hot2?.data?.list ?? []).find((t) => t.name === TOPIC)?.noteCount, 0)
    await put(`/api/note/${topicNoteId}/status`, { token: auth, body: { status: 1 } })

    // 编辑：关系行跟着正文全量换，不能留着旧话题
    const OLD = '旧话题' + unique
    const { json: withOld } = await post('/api/note/publish', {
      token: auth,
      body: { type: 1, title: `带 #${OLD}`, content: '先有个旧话题', imageUrls: [imageUrl] },
    })
    const editId = withOld?.data?.id
    const { json: ed } = await put(`/api/note/${editId}`, {
      token: auth,
      body: { type: 1, title: '改标题不带话题了', content: `换成 #${TOPIC}`, imageUrls: [imageUrl] },
    })
    codeIs('编辑成功', ed, 0)
    const { json: after } = await get(`/api/note/${editId}`, { token: auth })
    const afterTopics = after?.data?.topics ?? []
    eq('编辑后只剩新话题（旧的被替换，不是追加）', afterTopics.length, 1)
    check('编辑后话题是新写的那个', afterTopics[0]?.name === TOPIC, JSON.stringify(afterTopics))
    await del(`/api/note/${editId}`, { token: auth })

    // 删除笔记要清关系行，否则话题页会把不存在的笔记算进去
    await del(`/api/note/${topicNoteId}`, { token: auth })
    const { json: afterDel } = await get(`/api/topic/notes?name=${encodeURIComponent(TOPIC)}`, { token: auth })
    eq('删除笔记后话题页为空（关系行已级联清掉）', (afterDel?.data?.list ?? []).length, 0)

    const { json: anon } = await get('/api/topic/list')
    codeIs('未登录访问热门话题返回 10005', anon, 10005)
  }
// ---- 18.0 P18 举报与黑名单：POST /api/report | /user/block/{id}
  //
  // 这一段钉两件性质完全不同的事，所以放一起：
  //   举报 = **公共治理**（要让运营知道，所以作者会收到通知）
  //   拉黑 = **私人屏蔽**（不通知对方，只改变「我」的视野）
  // 混在一起写会让人以为它们是一套机制的两面。
  {
    // 自己建一篇，交给另一个账号去举报 —— 被举报者必须是别人
    const { json: rp } = await post('/api/note/publish', {
      token: auth,
      body: { type: 1, title: `被举报的笔记 ${stamp}`, content: '用来测举报', imageUrls: [imageUrl] },
    })
    codeIs('被举报的笔记发布成功', rp, 0)
    const rpNoteId = rp?.data?.id

    // ---- 举报
    const reasons = await get('/api/report/reasons', { token: actorAuth })
    codeIs('举报原因列表可查', reasons.json, 0)
    check('举报原因是固定 6 项（前端据此渲染成可点的一排选项）',
      Array.isArray(reasons.json?.data) && reasons.json.data.length === 6
        && reasons.json.data.every((r) => typeof r.code === 'number' && typeof r.text === 'string'),
      JSON.stringify(reasons.json?.data))

    const { json: rep } = await post('/api/report', {
      token: actorAuth,
      body: { targetType: 1, targetId: rpNoteId, reasonCode: 1, detail: '这是广告' },
    })
    codeIs('举报成功', rep, 0)
    check('举报返回新举报 ID（字符串，雪花 ID 不能变成数字）',
      typeof rep.data === 'string' && /^\d+$/.test(rep.data), `id=${rep.data}`)

    const { json: rep2 } = await post('/api/report', {
      token: actorAuth,
      body: { targetType: 1, targetId: rpNoteId, reasonCode: 2 },
    })
    codeIs('同一个人重复举报同一条返回 80003', rep2, 80003)
    const { json: self } = await post('/api/report', {
      token: auth,
      body: { targetType: 1, targetId: rpNoteId, reasonCode: 1 },
    })
    codeIs('举报自己的内容返回 80004', self, 80004)
    const { json: ghost } = await post('/api/report', {
      token: actorAuth,
      body: { targetType: 1, targetId: 999999999999, reasonCode: 1 },
    })
    codeIs('举报不存在的笔记返回 20001', ghost, 20001)
    const { json: badCode } = await post('/api/report', {
      token: actorAuth,
      body: { targetType: 1, targetId: rpNoteId, reasonCode: 99 },
    })
    codeIs('非法举报原因被 DTO 拦下（100001）', badCode, 100001)
    const { json: noTarget } = await post('/api/report', {
      token: actorAuth,
      body: { reasonCode: 1 },
    })
    codeIs('缺少 targetId 被拦下（100001）', noTarget, 100001)
    const { json: longDetail } = await post('/api/report', {
      token: actorAuth,
      body: { targetType: 1, targetId: rpNoteId, reasonCode: 6, detail: 'x'.repeat(300) },
    })
    // 300 字被 @Size(max=200) 拦在 DTO 层。注意这里**不是** 80003：
    // 那条路径要先过 DTO 校验才到业务去重，所以超长字是参数错误。
    // 写成期望 80003 就会红 —— 「先入为先」不是「先业务后参数」
    codeIs('补充说明超 200 字返回 100001（DTO 层，不是业务去重）', longDetail, 100001)
    const { json: anonRep } = await post('/api/report', {
      body: { targetType: 1, targetId: rpNoteId, reasonCode: 1 },
    })
    codeIs('未登录举报返回 10005', anonRep, 10005)

    // 作者会收到通知，但**不告诉他是举报的**
    const { json: nlist } = await get('/api/notification/list?page=1&size=50', { token: auth })
    const reported = (nlist?.data?.list ?? []).find((x) => x.type === 7 && x.noteId === rpNoteId)
    check('作者收到「内容被举报」通知（类型 7）', !!reported, JSON.stringify((nlist?.data?.list ?? []).slice(0, 3)))
    if (reported) {
      check('通知文案不回显举报人身份（否则举报人等于暴露，从此没人敢举报）',
        !reported.content?.includes('ct'), reported.content)
    }

    // 举报**不**改变内容状态：处置是运营的权限
    const { json: still } = await get(`/api/note/${rpNoteId}`, { token: auth })
    codeIs('举报之后笔记仍然可读（举报不自动处置）', still, 0)
    eq('举报之后笔记没有被下架', still?.data?.status, 1)

    // ---- 黑名单
    const { json: blk } = await post(`/api/user/block/${userId}`, { token: actorAuth })
    codeIs('拉黑成功', blk, 0)
    const { json: blk2 } = await post(`/api/user/block/${userId}`, { token: actorAuth })
    codeIs('重复拉黑返回 80005', blk2, 80005)
    const { json: me } = await get('/api/user/me', { token: actorAuth })
    const { json: blkSelf } = await post(`/api/user/block/${me.data.id}`, { token: actorAuth })
    codeIs('拉黑自己返回 80007', blkSelf, 80007)

    const { json: bl } = await get('/api/user/block/list', { token: actorAuth })
    codeIs('黑名单列表可查', bl, 0)
    eq('黑名单里有 1 条', bl?.data?.total, 1)
    check('黑名单项带昵称与拉黑时间',
      typeof bl?.data?.list?.[0]?.nickname === 'string' && bl?.data?.list?.[0]?.createTime,
      JSON.stringify(bl?.data?.list?.[0]))

    // 拉黑后的可见性：详情、作者主页、两个流全都要变。
    // 每一处都是独立的读取入口，漏一处就等于「拉黑只生效了一半」
    const { json: hidden } = await get(`/api/note/${rpNoteId}`, { token: actorAuth })
    codeIs('拉黑后看不到对方的笔记详情（按「不存在」处理）', hidden, 20001)
    const { json: hiddenProfile } = await get(`/api/note/user/${userId}?page=1&size=20`, { token: actorAuth })
    eq('拉黑后对方的主页笔记数为 0', hiddenProfile?.data?.total, 0)
    const { json: disc } = await get('/api/feed/discover?page=1&size=50', { token: actorAuth })
    check('拉黑后发现流里没有对方的笔记',
      !(disc?.data?.list ?? []).some((n) => n.id === rpNoteId),
      `ids=${(disc?.data?.list ?? []).map((n) => n.id).join(',')}`)
    const { json: fol } = await get('/api/feed/follow?page=1&size=50', { token: actorAuth })
    check('拉黑后关注流里也没有对方的笔记',
      !(fol?.data?.list ?? []).some((n) => n.id === rpNoteId),
      `ids=${(fol?.data?.list ?? []).map((n) => n.id).join(',')}`)
    const { json: selfStill } = await get(`/api/note/${rpNoteId}`, { token: auth })
    codeIs('被拉黑的一方自己仍然能看到自己的笔记（否则会失去编辑入口）', selfStill, 0)

    const { json: unblk } = await call('DELETE', `/api/user/block/${userId}`, { token: actorAuth })
    codeIs('取消拉黑成功', unblk, 0)
    const { json: unblk2 } = await call('DELETE', `/api/user/block/${userId}`, { token: actorAuth })
    codeIs('没拉黑却取消返回 80006（不静默成功，否则前端会把按钮状态改掉）', unblk2, 80006)
    const { json: back } = await get(`/api/note/${rpNoteId}`, { token: actorAuth })
    codeIs('取消拉黑后又能看到', back, 0)

    // ---- 双向：对方拉黑我，我这边也不该再看见
    // 做成单向的话，「拉黑」就只是自己藏别人，而藏不住别人，
    // 与现实里的直觉相反
    const { json: rev } = await post(`/api/user/block/${me.data.id}`, { token: auth })
    codeIs('被拉黑的一方反向拉黑也成功', rev, 0)
    const { json: revHide } = await get(`/api/feed/discover?page=1&size=50`, { token: auth })
    check('对方拉黑我之后，我的发现流也过滤掉了 TA',
      !(revHide?.data?.list ?? []).some((n) => n.id === rpNoteId),
      `ids=${(revHide?.data?.list ?? []).map((n) => n.id).join(',')}`)
    await call('DELETE', `/api/user/block/${me.data.id}`, { token: auth })

    await del(`/api/note/${rpNoteId}`, { token: auth })
  }

// ---- 18.1 P18 举报：POST /api/report | GET /api/report/reasons
  //
  // 契约层再钉一遍「通知不暴露举报人」与「举报不自动处置」，
  // 以及去重是**永久**的（没有撤回接口）—— 这三条是产品承诺，
  // 值得在服务端也钉住而不只是靠 UI 表现。
  {
    const { json: rs } = await get('/api/report/reasons', { token: actorAuth })
    codeIs('举报原因列表可查（固定 6 项，前端据此渲染弹窗）', rs, 0)
    eq('举报原因恰好 6 项', rs?.data?.length, 6)
    check('每项都有 code 与文案（前端不能写死）',
      (rs?.data ?? []).every((r) => Number.isInteger(r.code) && typeof r.text === 'string'),
      JSON.stringify(rs?.data))

    // 举报一条 actorAuth 的笔记（用 17.8 段自建的 listNoteId？它已被删，
    // 这里自己发一篇，避免依赖别的段）
    const { json: victim } = await post('/api/note/publish', {
      token: actorAuth,
      body: { type: 1, title: `被举报的笔记 ${stamp}`, content: '举报用例', imageUrls: [imageUrl] },
    })
    codeIs('被举报的笔记发布成功', victim, 0)
    const victimId = victim?.data?.id

    const { json: rp } = await post('/api/report', {
      token: auth,
      body: { targetType: 1, targetId: victimId, reasonCode: 1 },
    })
    codeIs('举报成功', rp, 0)
    const { json: again } = await post('/api/report', {
      token: auth,
      body: { targetType: 1, targetId: victimId, reasonCode: 3 },
    })
    codeIs('重复举报返回 80003（去重是永久的，没有撤回接口）', again, 80003)
    // 换个人举报同一条 —— 应该成功：去重维度是「谁举报的」
    const { json: other } = await post('/api/report', {
      token: rlAuth,
      body: { targetType: 1, targetId: victimId, reasonCode: 3 },
    })
    codeIs('换个举报人能再报一次（去重维度含 reporter）', other, 0)

    // 举报**不改变内容状态**：处置是运营的权限，不是举报这个动作的副作用
    const { json: still } = await get(`/api/note/${victimId}`, { token: actorAuth })
    codeIs('举报之后内容仍然可读（不自动下架）', still, 0)
    eq('举报之后 status 仍是 1（已发布）', still?.data?.status, 1)

    await del(`/api/note/${victimId}`, { token: actorAuth })
  }

  // ---- 18. 不支持的方法
  {
    const { json } = await call('DELETE', '/api/user/login')
    codeIs('不支持的请求方法被统一处理（100002）', json, 100002)
  }

// ---- 19. P19 视频：POST /api/note/video + type=2 发布
  //
  // 这一段只钉「上传与落盘这条链路」，**不钉「视频真的能播」**：
  // 契约测试发上去的是构造出来的字节，不是真 mp4，验证不了解码。
  // 「详情页播放器拿得到 src」由 CDP 的 ui-note 验（那边是真浏览器）。
  //
  // 三个刻意不做：
  //   ① 不做转码（引 ffmpeg 是另一件事，要单独立项）
  //   ② 不校验魔数 —— 只按 content-type 白名单放行 mp4/webm
  //   ③ 不做多码率切片
  {
    const up = async (filename, type, bytes) => {
      const fd = new FormData()
      fd.append('file', new Blob([bytes], { type }), filename)
      const r = await fetch(`${BASE}/api/note/video`, {
        method: 'POST',
        headers: { Authorization: auth },
        body: fd,
      })
      return r.json()
    }

    const up1 = await up('p19.mp4', 'video/mp4', new Uint8Array(64 * 1024))
    codeIs('上传 mp4 成功', up1, 0)
    const videoUrl = up1?.data?.url
    check('返回的是可访问的相对路径（不是磁盘绝对路径）',
      typeof videoUrl === 'string' && videoUrl.startsWith('/'), `url=${videoUrl}`)
    check('文件名是 UUID 而不是用户提供的原始名（防路径穿越）',
      !videoUrl.includes('p19.mp4') && /\/[0-9a-f]{32}\.mp4$/.test(videoUrl), `url=${videoUrl}`)
    // 目录按日期分：避免单目录几百万个文件（ext4 查目录会明显变慢）
    check('按日期分目录存放', /\/\d{4}\/\d{2}\/\d{2}\//.test(videoUrl), `url=${videoUrl}`)

    const up2 = await up('p19.webm', 'video/webm', new Uint8Array(1024))
    codeIs('上传 webm 成功（浏览器能直接播的两种格式）', up2, 0)

    // mov / avi 需要转码，放行它们等于「传完看到黑屏」，比明确拒绝更糟
    const mov = await up('p19.mov', 'video/quicktime', new Uint8Array(1024))
    codeIs('mov 被拒（100001）：浏览器不能直接播，要先转码', mov, 100001)
    const spoof = await up('p19.mp4', 'text/plain', new Uint8Array(1024))
    codeIs('伪装 content type 被拒（100001）：扩展名按 content-type 反查', spoof, 100001)

    const got = await fetch(`${BASE}${videoUrl}`)
    eq('上传后的 URL 真能取到文件（静态资源已挂载）', got.status, 200)

    const { json: note } = await post('/api/note/publish', {
      token: auth,
      body: { type: 2, title: '视频笔记', content: '播放器验证', videoUrl },
    })
    codeIs('发布视频笔记（type=2）成功', note, 0)
    const { json: detail } = await get(`/api/note/${note?.data?.id}`, { token: auth })
    eq('详情里的 videoUrl 与上传一致', detail?.data?.videoUrl, videoUrl)
    eq('视频笔记的 type 是 2', detail?.data?.type, 2)

    // 反过来：type=2 却没给视频地址，必须被拒（否则会产生「永远播不出来」的笔记）
    const { json: noVid } = await post('/api/note/publish', {
      token: auth,
      body: { type: 2, title: '没有视频的视频', content: 'x' },
    })
    codeIs('type=2 但没给 videoUrl 返回 100001', noVid, 100001)

    // ⚠️ 本项目未登录是 **HTTP 200 + body code 10005**，不是 401 ——
    // 断言按 401 写会红，而红的原因（约定记错）与视频功能无关
    const anonFd = new FormData()
    anonFd.append('file', new Blob([new Uint8Array(16)], { type: 'video/mp4' }), 'anon.mp4')
    const anon = await fetch(`${BASE}/api/note/video`, { method: 'POST', body: anonFd })
    eq('未登录上传视频返回 10005（HTTP 仍是 200，全站统一约定）',
      (await anon.json())?.code, 10005)

    await del(`/api/note/${note?.data?.id}`, { token: auth })
    eq('删除后详情返回 20001', (await get(`/api/note/${note?.data?.id}`, { token: auth })).json?.code, 20001)
  }

/* ================================================================
   * 20.1 运营管理后台（P20）
   *
   * 身份：**不新建管理员**。role 是只能从库里改的列，而契约测试只走 HTTP、
   * 没有任何提权入口 —— 所以它依赖两个常驻管理员 fixture
   * （xk_ui_admin / xk_ui_admin2，口令 Xk@2026peer）。
   * 下面第一条断言就是检查它们还在：fixture 没了会立刻报出来，
   * 而不是让后面几十条集体假红成「鉴权坏了」。
   *
   * 本段只注册 **2 个**新账号（register 是 10/min/IP，这个文件前面已用掉
   * 不少额度）。第三个身份是 p20a 自己 —— 见下面「评论作者」那段注释，
   * 那里踩过一个坑：把评论发给谁，就决定了「禁用作者」禁的是谁。
   * ================================================================ */
  {
    const ADM = 'xk_ui_admin'
    const ADM2 = 'xk_ui_admin2'
    const ADMP = 'Xk@2026peer'
    const admLogin = await post('/api/user/login', { body: { username: ADM, password: ADMP } })
    eq('管理员 fixture 能登录（口令 Xk@2026peer）', admLogin.json?.code, 0)
    const adm = `Bearer ${admLogin.json?.data?.accessToken}`
    const admLogin2 = await post('/api/user/login', { body: { username: ADM2, password: ADMP } })
    eq('第二个管理员 fixture 能登录', admLogin2.json?.data?.accessToken !== undefined, true)
    const adm2 = `Bearer ${admLogin2.json?.data?.accessToken}`

    /* ---------- 鉴权分层：本阶段最重要的一段 ---------- */

    codeIs('未登录访问管理端 → 10005（AuthInterceptor 先拦）',
      (await get('/api/admin/report/list')).json, 10005)
    codeIs('普通用户访问管理端 → 90001（已登录只是没权限，不是未登录）',
      (await get('/api/admin/report/list', { token: auth })).json, 90001)
    codeIs('普通用户改笔记状态 → 90001（写接口同样被拦）',
      (await put('/api/admin/note/1/status', { token: auth, body: { status: 2 } })).json, 90001)
    check('90001 与 10005 是两个码（分开告警的前提）',
      (await get('/api/admin/report/list', { token: auth })).json?.code === 90001)
    eq('管理员能进管理端', (await get('/api/admin/report/pending-count', { token: adm })).json?.code, 0)

    const acts = (await get('/api/admin/report/actions', { token: adm })).json
    eq('处置动作字典返回 4 个动作', acts?.data?.length, 4)
    check('字典里能读到「禁用作者」', acts?.data?.some((s) => s.startsWith('4=')), JSON.stringify(acts?.data))

    /* ---------- 造数据 ---------- */

    const p20a = `ct_p20a${stamp}`
    const p20r = `ct_p20r${stamp}`
    for (const nm of [p20a, p20r]) {
      await post('/api/user/register', { body: { username: nm, password: P } })
    }
    const lA = await post('/api/user/login', { body: { username: p20a, password: P } })
    const lR = await post('/api/user/login', { body: { username: p20r, password: P } })
    const tA = `Bearer ${lA.json?.data?.accessToken}`
    const tR = `Bearer ${lR.json?.data?.accessToken}`
    check('两个测试身份都拿到 token', lA.json?.code === 0 && lR.json?.code === 0,
      `A=${lA.json?.code} R=${lR.json?.code}`)

    // ⚠️ uploadImage 返回 {status, json, text}，URL 在 json.data.url ——
    // 直接把返回值塞进 imageUrls 会让发布返 100001，症状像「发布坏了」。
    const p20Img = (await uploadImage(tA)).json?.data?.url
    check('图片上传拿到 URL', typeof p20Img === 'string', `url=${p20Img}`)

    const p20Note = await post('/api/note/publish', {
      token: tA,
      body: { title: `P20 待处置 ${stamp}`, content: '待处置正文', imageUrls: [p20Img] },
    })
    const p20Id = p20Note.json?.data?.id
    check('造出待处置笔记', typeof p20Id === 'string', `id=${p20Id}`)

    /* ---------- 处置：下架，且不可重放 ---------- */

    const rep = await post('/api/report', {
      token: tR, body: { targetType: 1, targetId: p20Id, reasonCode: 1, detail: '垃圾广告' },
    })
    const repId = rep.json?.data
    check('举报入库', typeof repId === 'string', `reportId=${repId}`)

    const rl = await get('/api/admin/report/list?status=0', { token: adm })
    const row = rl.json?.data?.list?.find((x) => x.id === repId)
    check('运营列表能查到这条举报', row !== undefined)
    eq('举报人字段是举报人（不是作者）', row?.reporterUsername, p20r)
    eq('举报人昵称与作者昵称不是同一个（搞反了就等于处置了举报人）',
      row?.targetAuthorNickname !== row?.reporterNickname, true)
    eq('被举报内容标记为存在', row?.targetExists, true)
    eq('举报理由是可读文案', row?.reasonText, '垃圾广告')

    eq('处置（下架）成功',
      (await post(`/api/admin/report/${repId}/handle`, {
        token: adm, body: { action: 2, handleNote: '违规广告' } })).json?.code, 0)
    eq('下架后他人看详情 → 20002',
      (await get(`/api/note/${p20Id}`, { token: tR })).json?.code, 20002)
    eq('被处置的举报不再出现在待处理里',
      (await get('/api/admin/report/list?status=0', { token: adm })).json?.data?.list
        ?.some((x) => x.id === repId), false)
    codeIs('重复处置 → 90003（处置不可重放）',
      (await post(`/api/admin/report/${repId}/handle`, { token: adm, body: { action: 3 } })).json, 90003)
    codeIs('处置不存在的举报 → 90002',
      (await post('/api/admin/report/1/handle', { token: adm, body: { action: 1 } })).json, 90002)
    codeIs('非法处置动作 → 100001（DTO 层先拦）',
      (await post(`/api/admin/report/${repId}/handle`, { token: adm, body: { action: 99 } })).json, 100001)

    /* ---------- 处置「禁用作者」：禁的是【内容的作者】 ---------- */

    const noteC = (await post('/api/note/publish', {
      token: tA, body: { title: `P20 评论举报 ${stamp}`, content: '正文', imageUrls: [p20Img] },
    })).json?.data?.id
    check('造出第二篇笔记', typeof noteC === 'string', `id=${noteC}`)

    // ⚠️ 关键：评论由 tR（p20r）发出，所以「禁用作者」禁的是 **tR**。
    // 这一点我第一版写反了（让 tA 发评论，却断言 tC 被禁），症状是
    // 后面几条集体返 10006「凭证无效」—— 因为被禁的那个账号
    // 后续所有写操作都在拦截器那里被挡下来了。真因离症状隔了整屏。
    const cmId = (await post('/api/comment', {
      token: tR, body: { noteId: noteC, content: `待处置评论 ${stamp}` } })).json?.data?.id
    check('造出待处置评论', typeof cmId === 'string', `commentId=${cmId}`)
    const repC = await post('/api/report', {
      token: tA, body: { targetType: 2, targetId: cmId, reasonCode: 1 },
    })
    const repCId = repC.json?.data
    check('对评论的举报入库', typeof repCId === 'string', `reportId=${repCId}`)

    codeIs('对评论「下架」→ 100001（评论没有下架状态，不能静默忽略）',
      (await post(`/api/admin/report/${repCId}/handle`, { token: adm, body: { action: 2 } })).json, 100001)
    eq('对评论「禁用作者」→ 0',
      (await post(`/api/admin/report/${repCId}/handle`, {
        token: adm, body: { action: 4, handleNote: '违规评论' } })).json?.code, 0)

    codeIs('被禁用账号拿旧 token 写操作 → 90006（禁用要立刻生效）',
      (await post('/api/comment', {
        token: tR, body: { noteId: noteC, content: '还想发' } })).json, 90006)
    eq('被禁用账号读操作仍可用（他要能看到自己出什么事了）',
      (await get(`/api/note/${noteC}`, { token: tR })).json?.code, 0)
    codeIs('被禁用账号再登录 → 10007 账号已禁用',
      (await post('/api/user/login', { body: { username: p20r, password: P } })).json, 10007)

    // 处置「禁用作者」只禁账号、不删评论：内容还在，运营能看到处置前长什么样
    eq('禁言是账号级动作，被处置的评论仍在列表里',
      (await get(`/api/comment/list?noteId=${noteC}&page=1&size=10`, { token: tA })).json?.data?.list
        ?.some((c) => c.id === cmId), true)

    /* ---------- 账号禁用的两条禁令 ---------- */

    const meAdm = (await get('/api/user/me', { token: adm })).json?.data?.id
    const meAdm2 = (await get('/api/user/me', { token: adm2 })).json?.data?.id
    codeIs('禁自己的账号 → 90004',
      (await put(`/api/admin/user/${meAdm}/status`, { token: adm, body: { status: 0 } })).json, 90004)
    codeIs('禁用另一个管理员 → 90005（管理员之间不能互相封禁）',
      (await put(`/api/admin/user/${meAdm2}/status`, { token: adm, body: { status: 0 } })).json, 90005)

    const idR = (await get('/api/user/me', { token: tR })).json?.data?.id
    eq('恢复账号 → 0', (await put(`/api/admin/user/${idR}/status`, {
      token: adm, body: { status: 1 } })).json?.code, 0)
    // 刻意**不再登录一次**来验证恢复：login 是 60/min/IP，而这个文件从头到尾
    // 已经登录了二十几次，跑到最后一段桶基本见底，多一次就吃 100005 ——
    // 而 100005 与「恢复失败」完全无关，看着却像同一件事。
    // 用**手里那个已经被禁用过的 token** 来验证更准确：恢复要立刻对同一会话生效，
    // 而不是「重新登录之后才生效」。
    eq('恢复后同一个 token 立刻能写（禁用/恢复都是即时生效）',
      (await post('/api/comment', { token: tR, body: { noteId: noteC, content: '恢复了' } })).json?.code, 0)
    codeIs('改不存在的用户状态 → 90007',
      (await put('/api/admin/user/1/status', { token: adm, body: { status: 0 } })).json, 90007)
    codeIs('非法账号状态 → 100001',
      (await put(`/api/admin/user/${idR}/status`, { token: adm, body: { status: 7 } })).json, 100001)

    /* ---------- 运营强制下架 / 恢复笔记 ---------- */

    eq('运营强制下架 → 0', (await put(`/api/admin/note/${p20Id}/status`, {
      token: adm, body: { status: 2 } })).json?.code, 0)
    eq('运营恢复上架 → 0', (await put(`/api/admin/note/${p20Id}/status`, {
      token: adm, body: { status: 1 } })).json?.code, 0)
    eq('恢复后作者能看到', (await get(`/api/note/${p20Id}`, { token: tA })).json?.code, 0)
    codeIs('草稿状态 0 → 100001（运营不能把别人的笔记按回草稿）',
      (await put(`/api/admin/note/${p20Id}/status`, { token: adm, body: { status: 0 } })).json, 100001)

    /* ---------- 列表的过滤与分页夹取 ---------- */

    // 上面已把笔记恢复成 status=1，所以**两个方向都要断言**：
    // 按 status=2 查不到（过滤生效）+ 不过滤时看得到且状态是 1。
    // 只写一条的话，过滤坏没坏都可能「看起来对」
    eq('运营笔记列表按 status=2 过滤：已恢复的笔记查不到',
      (await get(`/api/admin/note/list?keyword=P20 待处置 ${stamp}&status=2`,
        { token: adm })).json?.data?.total, 0)
    const nl = await get(`/api/admin/note/list?keyword=P20 待处置 ${stamp}`, { token: adm })
    eq('运营笔记列表能按关键词查到这篇笔记（读者视角查不到）',
      nl.json?.data?.list?.[0]?.status, 1)
    check('运营笔记列表带被举报次数', nl.json?.data?.list?.[0]?.reportCount >= 1,
      `reportCount=${nl.json?.data?.list?.[0]?.reportCount}`)
    eq('运营用户列表能按用户名查到',
      (await get(`/api/admin/user/list?keyword=${p20a}`, { token: adm })).json?.data?.list?.[0]?.username, p20a)
    eq('size 被夹到 100（不会因为前端传 999 就一次拉全表）',
      (await get('/api/admin/report/list?size=999', { token: adm })).json?.data?.size, 100)

    /* ---------- 清理 ---------- */

    await del(`/api/note/${p20Id}`, { token: tA })
    await del(`/api/note/${noteC}`, { token: tA })
    // 账号名用「ct_ + 前缀 + stamp」的连续形式：stamp 是 base36 小写字母数字，
    // 中间多一个下划线就匹配不上脚本末尾打印的那条清理正则
    // '^ct[0-9]?_[a-z0-9]+$'，于是每次跑完都留下一个清理不到的常驻垃圾账号。
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
  console.log(`\n测试账号 ${U} / ct2_${stamp} / ${actorName} / ${rlName} 与笔记 ${noteList} 已留在库里，清理：`)
  console.log(`  -- 先子表，comment_like 依赖 comment`)
  console.log(`  DELETE FROM xiaoku_db.comment_like WHERE comment_id IN (SELECT id FROM xiaoku_db.comment WHERE note_id IN (${noteList}));`)
  console.log(`  DELETE FROM xiaoku_db.comment WHERE note_id IN (${noteList});`)
  console.log(`  DELETE FROM xiaoku_db.note_like WHERE note_id IN (${noteList});`)
  console.log(`  DELETE FROM xiaoku_db.note_collect WHERE note_id IN (${noteList});`)
  console.log(`  DELETE FROM xiaoku_db.note_image WHERE note_id IN (${noteList});`)
  console.log(`  DELETE FROM xiaoku_db.note WHERE id IN (${noteList});`)
  // user_follow 没有外键，删 user 之前必须先删它,否则留下一堆指向虚空的关注关系
  console.log(`  DELETE FROM xiaoku_db.user_follow WHERE user_id IN (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$') OR follow_id IN (SELECT id FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$');`)
  console.log(`  DELETE FROM xiaoku_db.user WHERE username REGEXP '^ct[0-9]?_[a-z0-9]+$';`)
  console.log(`  图片文件在 backend/uploads/（已 gitignore），要清就整个删掉该目录`)
  console.log(`  注意：xk_ui_smoke / xk_ui_interact / xiaoku_demo 是常驻 fixture，别删`)
  console.log(`  ES 会留下已删笔记的孤儿文档（搜索回填时会按 MySQL 过滤掉，不影响结果）`)
  console.log(`  要彻底清空索引：重启后端后调 POST /api/search/reindex 从当前库重建`)
}

main().catch((e) => {
  console.error('\n契约测试自身异常：', e)
  process.exit(1)
})
