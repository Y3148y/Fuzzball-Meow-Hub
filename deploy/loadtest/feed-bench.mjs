/**
 * 发现流 vs 关注流 的**对比压测**：回答一个问题 —— 发现流的filesort 现在疼不疼？
 *
 * 背景（AGENTS「P14 发现流已知缺口」）：`pageDiscover` 的排序键
 *   EXISTS(我关注了作者) DESC, (赞+藏+评) DESC, create_time DESC, id DESC
 * 前一个是子查询结果、第二个是三列之和，**都进不了索引**，EXPLAIN 实测
 * `Using filesort` + `DEPENDENT SUBQUERY`。但「形状不对」不等于「现在就有问题」，
 * 所以这个脚本用并发压测把它量成数字，再决定要不要引入物化的 hot_score 列。
 *
 * 零依赖（Node 18+ 内置 fetch）。k6 那套 mix.js 留着，需要更完整的场景时再用。
 *
 * 用法
 *   node deploy/loadtest/feed-bench.mjs
 *   XK_API_BASE=http://x:8080/api VUS=20 REQS=400 node deploy/loadtest/feed-bench.mjs
 *
 * 输出：每个目标的 p50/p95/p99、失败数、以及与关注流的比值；结果写
 * deploy/loadtest/feed-report.json，方便下次对比。
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.XK_API_BASE || 'http://127.0.0.1:18080/api'
const PASSWORD = process.env.XK_PASSWORD || 'Xk@Big2026'
const AUTHORS = Number(process.env.AUTHORS || 8)

const VUS = Number(process.env.VUS || 12)
const REQS = Number(process.env.REQS || 240)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 目标：既要浅页也要深页 —— OFFSET 越深越贵，filesort 的痛点主要在深页 */
const TARGETS = [
  { name: 'discover p1', path: '/feed/discover?page=1&size=20' },
  { name: 'discover p5', path: '/feed/discover?page=5&size=20' },
  { name: 'discover p25', path: '/feed/discover?page=25&size=20' },
  { name: 'follow   p1', path: '/feed/follow?page=1&size=20' },
  { name: 'follow   p5', path: '/feed/follow?page=5&size=20' },
]

async function login(username) {
  const res = await fetch(`${BASE}/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  })
  const j = await res.json().catch(() => null)
  return j?.data?.accessToken ? `Bearer ${j.data.accessToken}` : null
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0)

/**
 * 打一次目标，返回耗时ms；失败只计数不抛
 *
 * 同时回传 `empty`：**返回空集的目标不能用来比深页贵贱**。
 * 数据集比页码*size 还小时，MySQL 数到 OFFSET 就结束了，天然比浅页快 ——
 * 2026-10-04 第一轮就中过这个招：`discover p25` 量出 61.7ms 比 `discover p1`
 * 的 96.7ms 还快，看着像"深页更省"，其实是那一页压根没数据。
 */
async function hit(token, target) {
  const t0 = performance.now()
  let bad = 0
  let empty = 0
  try {
    const res = await fetch(`${BASE}${target.path}`, { headers: { Authorization: token } })
    const j = await res.json().catch(() => null)
    if (res.status !== 200 || j?.code !== 0) bad = 1
    else if (!j?.data?.list || j.data.list.length === 0) empty = 1
  } catch {
    bad = 1
  }
  return { ms: performance.now() - t0, bad, empty }
}

async function main() {
  // 拿 N 个作者的 token 当并发身份（登录 60/min/IP，所以别多）
  const tokens = []
  for (let a = 1; a <= AUTHORS && tokens.length < VUS; a++) {
    const t = await login(`xk_big_a${String(a).padStart(2, '0')}`)
    if (t) tokens.push(t)
  }
  if (tokens.length === 0) {
    console.log('拿不到任何 token —— 先跑 seed-big.mjs 造数据')
    process.exit(1)
  }

  /*
   * 预热 + 轮转起点，**这两步不做测量就是废的**（2026-10-04 第一次跑就栽在这）：
   * 每个 VU 按固定顺序打 5 个目标，于是「排第一的那个」独吞了 JIT 编译、
   * 连接池建立、MySQL 查询缓存冷启动的全部成本 —— 量出来 `discover p1` 68.6ms
   * 比 `discover p25` 36.2ms 还慢，深页反而更快的荒谬结果就是这么来的。
   */
  for (const t of TARGETS) {
    for (let i = 0; i < 15; i++) await hit(tokens[i % tokens.length], t)
  }

  const results = Object.fromEntries(TARGETS.map((t) => [t.name, { times: [], failed: 0, empty: 0 }]))
  const per = Math.ceil(REQS / tokens.length)
  const started = Date.now()
  await Promise.all(tokens.map(async (token, k) => {
    for (let i = 0; i < per; i++) {
      // 起点按 VU 轮转：谁都不总是第一个
      for (let j = 0; j < TARGETS.length; j++) {
        const t = TARGETS[(j + k) % TARGETS.length]
        const r = await hit(token, t)
        results[t.name].times.push(r.ms)
        results[t.name].failed += r.bad
        results[t.name].empty += r.empty
      }
    }
  }))
  const secs = ((Date.now() - started) / 1000).toFixed(1)

  const table = TARGETS.map((t) => {
    const r = results[t.name]
    const s = r.times.sort((a, b) => a - b)
    return {
      目标: t.name,
      请求数: s.length,
      失败: r.failed,
      空集: r.empty,
      p50ms: +pct(s, 50).toFixed(1),
      p95ms: +pct(s, 95).toFixed(1),
      p99ms: +pct(s, 99).toFixed(1),
      maxms: +s[s.length - 1].toFixed(1),
    }
  })

  console.log(`\n并发=${tokens.length} 每目标约${table[0].请求数} 次  用时=${secs}s`)
  console.table(table)

  // 数据不足护栏：空集多的目标说明页码超出数据集，它的耗时没有可比性
  const starved = table.filter((r) => r.空集 > r.请求数 / 2)
  if (starved.length) {
    console.log('\n⚠️ 以下目标大部分返回**空集**，页码超出数据集，耗时不可用于比深页贵贱：')
    for (const r of starved) console.log(`   ${r.目标} 空集率 ${Math.round((r.空集 / r.请求数) * 100)}%`)
    console.log('   要量深页请先加大数据集：node deploy/loadtest/seed-big.mjs --notes=60')
  }

  const d1 = table.find((r) => r.目标 === 'discover p1')
  const f1 = table.find((r) => r.目标 === 'follow   p1')
  if (d1 && f1 && f1.p95 > 0) {
    console.log(`\ndiscover p95 / follow p95 = ${(d1.p95ms / f1.p95ms).toFixed(2)}×`)
  }
  const deep = table.find((r) => r.目标 === 'discover p25')
  if (d1 && deep && d1.p95ms > 0) {
    console.log(`discover p25 / p1 = ${(deep.p95ms / d1.p95ms).toFixed(2)}×（深页贵多少）`)
  }

  const out = { at: new Date().toISOString(), vus: tokens.length, seconds: +secs, table }
  writeFileSync(join(HERE, 'feed-report.json'), JSON.stringify(out, null, 2), 'utf8')
  console.log('\n已写 deploy/loadtest/feed-report.json')
}

await main()
