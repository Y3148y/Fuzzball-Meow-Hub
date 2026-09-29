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
    const n2 = await post('/api/note/publish', { token: ct2Auth, body: { title: '关注流测试一', content: 'ct2 的正文' } })
    codeIs('ct2 发布笔记成功', n2.json, 0)
    ct2NoteId = n2.json?.data?.id
    createdNoteIds.push(ct2NoteId)
    const n3 = await post('/api/note/publish', { token: actorAuth, body: { title: '关注流测试二', content: 'ct3 的正文' } })
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
  // 唯一词：seed 标题里带随机尾缀，保证只命中自己这篇，避开演示账号/固定 fixture 的笔记
  const searchUnique = `星尘电台${stamp}${Math.random().toString(36).slice(2, 6)}`.toLowerCase()
  {
    const { json } = await post('/api/note/publish', {
      token: auth,
      body: { title: searchUnique, content: '在银河系边缘收听毛球乐队', type: 1 },
    })
    codeIs('搜索种子笔记发布成功（应进入 ES 索引）', json, 0)
    searchNoteId = json?.data?.id
    createdNoteIds.push(searchNoteId)
  }
  // 发布 → Kafka → 消费 → ES 全程异步，轮询等入索引；50×200ms 兜底，别让测试卡死在这
  {
    let found = false
    for (let i = 0; i < 50 && !found; i++) {
      const { json } = await get(`/api/search/note?keyword=${encodeURIComponent(searchUnique)}`, { token: auth })
      found = json?.code === 0 && (json?.data?.total ?? 0) > 0
      if (!found) await new Promise((r) => setTimeout(r, 200))
    }
    check('发布后经 Kafka 异步入索引（轮询 10s 内命中）', found)
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

  // ---- 17. 不支持的方法
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
