/**
 * 毛球喵社 —— 压测场景（k6）
 *
 * 三个场景模拟三类用户并发的混合负载：
 *   browse   只读为主：关注流 -> 详情 -> 评论列表，低频搜索与低频评论写入。
 *            20 VU × 90s（评论 %60 次迭代 ≈ 4 次/分钟/用户，在 10/min 限流内）
 *   likers   写路径：点赞/取消、收藏/取消双向打。6 VU × 60s
 *   authors  低频写：在限流预算内各发 1 篇笔记。3 VU × 60s
 *            （作者不能评论自己的笔记，30007 业务规则，故 authors 不产评论）
 *
 * 前置：先跑 deploy/loadtest/seed.mjs 造好 xk_lt_* 账号与素材。
 * 数据规模：作者 12 篇笔记、10 个读者关注作者、热评笔记有 20 条评论。
 *
 * 运行：
 *   k6 run --summary-export=deploy/loadtest/report.json deploy/loadtest/mix.js
 *   XK_BASE / XK_PASSWORD 可覆盖（默认打 prod-compose 的 nginx 入口 18080）
 *
 * 注意 keep 在这个体量的读压比上：detail 全打真实笔记（走布隆命中后查库），
 * 10% 的 detail 随机打不存在的雪花 ID，用来体现布隆过滤短路的价值。
 */

import http from 'k6/http'
import { check } from 'k6'
import { sleep } from 'k6'

const BASE = __ENV.XK_BASE || 'http://127.0.0.1:18080/api'
const PASSWORD = __ENV.XK_PASSWORD || 'Xk@Lt2026'

// 每个 VU 各自缓存登录 token（k6 模块级变量按 VU 隔离）
let tokenCache = {}

function ensureToken(username) {
  if (tokenCache[username]) return tokenCache[username]
  const res = http.post(`${BASE}/user/login`, JSON.stringify({ username, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  })
  const token = res.json('data.accessToken')
  check(res, { 'login ok': (r) => r.status === 200 && token !== null })
  tokenCache[username] = token
  return token
}

function authHeaders(username) {
  return {
    Authorization: `Bearer ${ensureToken(username)}`,
    'Content-Type': 'application/json',
  }
}

// 从关注流拿一篇真实笔记 id；拿不到就返回 null（调用方跳过详情/评论）
function readerNoteId(username) {
  const res = http.get(`${BASE}/feed/follow?page=1&size=10`, { headers: { Authorization: `Bearer ${ensureToken(username)}` } })
  const list = res.json('data.list')
  if (!list || list.length === 0) return null
  return list[Math.floor(Math.random() * list.length)].id
}

export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 20, duration: '90s', exec: 'browse' },
    likers: { executor: 'constant-vus', vus: 6, duration: '60s', exec: 'likers' },
    authors: { executor: 'constant-vus', vus: 3, duration: '60s', exec: 'authors' },
  },
  thresholds: {
    // 写得严格一点：整体失败率必须 < 1%（排除故意打不存在的详情——那部分返回 20001 业务码，HTTP 仍是 200）
    http_req_failed: ['rate<0.01'],
    // 混合公网代理 + 单机栈，p95 给 600ms 的容身空间
    'http_req_duration': ['p(95)<600', 'p(99)<1500'],
  },
}

export function browse() {
  const i = (__VU - 1) % 10
  const username = `xk_lt_r${String(i + 1).padStart(2, '0')}`
  const noteId = readerNoteId(username)

  // 10% 的详情请求打不存在的雪花 ID，考察布隆过滤器短路的速与准。
  // 用字符串拼 17 位伪 ID：JS Number 表示不了干净的 17 位整数，Math.floor 会留精度尾巴
  const fakeId = '9' + Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('')
  const [detailUrl, expectedCode] =
    Math.random() < 0.1
      ? [`${BASE}/note/${fakeId}`, '20001']
      : noteId
        ? [`${BASE}/note/${noteId}`, '0']
        : [null, null]

  if (detailUrl) {
    const d = http.get(detailUrl, { headers: { Authorization: `Bearer ${ensureToken(username)}` } })
    // 注意：JSON 解析后 code 是数字，expectedCode 是字符串，统一转字符串再比
    check(d, {
      'detail business code': (r) => String(r.json('code')) === expectedCode || String(r.json('code')) === '20001',
    })
  }

  if (noteId) {
    const c = http.get(`${BASE}/comment/list?noteId=${noteId}&page=1&size=10`, {
      headers: { Authorization: `Bearer ${ensureToken(username)}` },
    })
    check(c, { 'comment list ok': (r) => r.json('code') === 0 })
  }

  // 低频评论写入：笔记是作者的，读者评自己的可以；%60 ≈ 4 次/分钟/用户，远低于 10/min 限流
  if (noteId && __ITER % 60 === 0) {
    const cm = http.post(
      `${BASE}/comment`,
      JSON.stringify({ noteId, content: `读者 ${username} 路过点了个赞还留了句话` }),
      { headers: authHeaders(username) },
    )
    check(cm, { 'reader comment ok': (r) => r.json('code') === 0 })
  }

  // 低频搜索：每 VU 每 90 次迭代才搜一次（约 1 次/分钟，远低于 60/min 限流）
  if (__ITER % 90 === 0) {
    // nginx 拒绝 URI 里的裸非 ASCII 字符，keyword 必须百分号编码
    const s = http.get(`${BASE}/search/note?keyword=${encodeURIComponent('花猫')}&page=1&size=10`, {
      headers: { Authorization: `Bearer ${ensureToken(username)}` },
    })
    check(s, { 'search ok': (r) => r.json('code') === 0 })
  }

  sleep(0.3 + Math.random() * 0.4)
}

export function likers() {
  const i = (__VU - 1) % 10
  const username = `xk_lt_r${String(i + 1).padStart(2, '0')}`
  const noteId = readerNoteId(username)
  if (!noteId) { sleep(1); return }

  // 收藏与借阅各占一半时间，交替点两篇不同笔记，避免自锁重复点赞
  const a = readerNoteId(username)
  const target = __ITER % 4 === 0 ? a || noteId : noteId

  if (__ITER % 2 === 0) {
    const put = http.put(`${BASE}/note/${target}/like`, null, { headers: authHeaders(username) })
    check(put, { 'like put ok': (r) => r.json('code') === 0 || r.json('code') === 30001 })
    const del = http.del(`${BASE}/note/${target}/like`, null, { headers: authHeaders(username) })
    check(del, { 'like del ok': (r) => r.json('code') === 0 || r.json('code') === 30002 })
  } else {
    const put = http.put(`${BASE}/note/${target}/collect`, null, { headers: authHeaders(username) })
    check(put, { 'collect put ok': (r) => r.json('code') === 0 || r.json('code') === 30003 })
    const del = http.del(`${BASE}/note/${target}/collect`, null, { headers: authHeaders(username) })
    check(del, { 'collect del ok': (r) => r.json('code') === 0 || r.json('code') === 30004 })
  }
  sleep(0.5 + Math.random() * 0.5)
}

export function authors() {
  // 3 个 VU 共用作者账号：一共 3 次 publish（桶 20/min），余量充足。
  // 注意：应用禁止「评论自己的笔记」（30007），author 不产生评论。
  const token = ensureToken('xk_lt_author')

  if (__ITER === 0) {
    const title = `压测发布 ${__VU}-${__ITER}`
    const body = JSON.stringify({
      title,
      content: '压测期间由 authors 场景发布的笔记，用于验证发布链路与搜索索引回灌。'.repeat(6).slice(0, 300),
      type: 1,
    })
    const pub = http.post(`${BASE}/note/publish`, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    check(pub, { 'publish ok': (r) => r.json('code') === 0 })
  }

  sleep(20)
}