/**
 * 压测素材播种脚本（零依赖，Node 18+ 自带 fetch）
 *
 * 目标：给压测造一份「内容有位」的数据 ——
 *   1 个作者 + 12 篇笔记 + 10 个读者 + 读者关注作者 + 读者在一根笔记下留评论。
 * 这样 browse 场景的 feed（关注流）有货、详情可点、评论列表有数。
 *
 * 为什么一个个排队、还 sleep：register 被 10/min/IP 限流、publish 被 20/min/用户
 * 限流，播种脚本自己在限流窗口内快进，碰上限流几乎必然是脚本写错，不是被测系统错。
 * 脚本全程幂等：用户已存在（10003）视为成功；重复跑只会补足缺的笔记/评论。
 *
 * 用法：
 *   node deploy/loadtest/seed.mjs                 # 默认打 http://127.0.0.1:18080/api
 *   XK_API_BASE=http://x:8080/api node deploy/loadtest/seed.mjs
 *
 * 注意：账号口令硬编码在这个脚本里（Xk@Lt2026 仅压测环境用），
 * 面向公网的部署请走别的口令体系。
 */

const BASE = process.env.XK_API_BASE || 'http://127.0.0.1:18080/api'
const PASSWORD = 'Xk@Lt2026'
const AUTHOR = 'xk_lt_author'
const READER_COUNT = 10
const NOTES = 12
const COMMENTS_PER_READER = 2

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return { http: res.status, body: await res.json() }
}

async function put(path, token) {
  const res = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })
  return { http: res.status, body: await res.json() }
}

async function register(username, nickname, maxWaitMs = 30000) {
  // register 10/min/IP：初次跑或中途失败重跑时，按 10003 幂等跳过
  const deadline = Date.now() + maxWaitMs
  for (;;) {
    const { http, body } = await post('/user/register', {
      username, password: PASSWORD, nickname, gender: 0,
    })
    if (body.code === 0 || body.code === 10003) return { ok: true, existing: body.code === 10003 }
    console.log(`  [retry] ${username} -> ${http} ${body.code} ${body.message}`)
    if (Date.now() > deadline) return { ok: false, code: body.code, message: body.message }
    await sleep(3000)
  }
}

async function login(username) {
  const { body } = await post('/user/login', { username, password: PASSWORD })
  if (body.code !== 0) throw new Error(`login failed ${username}: ${JSON.stringify(body)}`)
  return body.data.accessToken
}

const pad = (n) => String(n).padStart(2, '0')

async function main() {
  console.log(`seed -> ${BASE} (author=${AUTHOR}, readers=${READER_COUNT}, notes=${NOTES})`)

  // ---- 1) 作者 + 读者：限 10/min/IP，逐个 7s 间隔 ----
  const ids = [AUTHOR, ...Array.from({ length: READER_COUNT }, (_, i) => `xk_lt_r${pad(i + 1)}`)]
  for (const u of ids) {
    const r = await register(u, u === AUTHOR ? '压测作者' : `压测读者${u.slice(-2)}`)
    console.log(`  ${r.ok ? (r.existing ? 'exists ' : 'created') : 'FAIL  '} ${u}`)
    await sleep(7000)
  }

  // ---- 2) 作者发 N 篇笔记 ----
  const authorTok = await login(AUTHOR)
  const noteIds = []
  for (let i = 1; i <= NOTES; i++) {
    const { body } = await post('/note/publish', {
      title: `压测素材 ${i} 花猫`,
      content: `第 ${i} 篇压测素材。花猫伸了个懒腰，把爪子搭在窗台上，窗外阳光刚好。`.repeat(8).slice(0, 900),
      type: 1,
    }, authorTok)
    if (body.code === 0) {
      noteIds.push(body.data.id)
    } else if (body.code === 100000 || body.code === 30000) {
      console.log(`  [warn] publish ${i} -> ${body.code}（超限？等待 5s 重试）`)
      await sleep(5000)
      i-- // 重试同一条
      continue
    } else {
      console.log(`  [warn] publish ${i} -> ${body.code} ${body.message}`)
    }
    await sleep(4000)
  }
  console.log(`  notes created: ${noteIds.length}/${NOTES}`)

  if (noteIds.length === 0) {
    console.error('没有可用的笔记，压测 browse 场景会没有内容。')
    process.exit(1)
  }

  // ---- 3) 读者关注作者 + 各留两条评论 ----
  const hot = noteIds[0]
  for (let i = 1; i <= READER_COUNT; i++) {
    const u = `xk_lt_r${pad(i)}`
    const tok = await login(u)
    // 关注作者：从笔记详情拿 authorId（关注流 feed 靠关注关系才有内容）
    const hotResp = await fetch(BASE + `/note/${hot}`, {
      headers: { Authorization: `Bearer ${tok}` },
    }).then((r) => r.json())
    const authorId = hotResp.data?.authorId
    if (authorId) await put(`/follow/${authorId}`, tok)
    for (let c = 0; c < COMMENTS_PER_READER; c++) {
      await post('/comment', { noteId: hot, content: `读者 ${u} 的第 ${c + 1} 条评价：花猫真精神。` }, tok)
      await sleep(1500)
    }
    console.log(`  reader ${u}: followed + ${COMMENTS_PER_READER} comments`)
    await sleep(2000)
  }
  console.log('seed done')
}

async function meId(token) {
  const r = await fetch(BASE + '/user/me', { headers: { Authorization: `Bearer ${token}` } })
  return (await r.json()).data?.id
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})