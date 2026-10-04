/**
 * 发现流的**数据集**脚本：造足够多的笔记，让 `ORDER BY` 的 filesort 真的疼起来。
 * 零依赖（Node 18+ 内置 fetch），与 seed.mjs 同风格。
 *
 * 为什么要单独一个：
 *   seed.mjs 造的是「压测用的家当」（1 作者 + 12 篇 + 10 读者），browse 场景够用；
 *   但发现流的排序键 `EXISTS(...) DESC, (赞+藏+评) DESC, create_time DESC`
 *   **全都进不了索引**（见 AGENTS「P14 发现流已知缺口」），十几篇时 MySQL 随手就
 *   排完了，量出来的 p95 没有意义。这个脚本按需造几百上千篇。
 *
 * 用法
 *   node deploy/loadtest/seed-big.mjs                  # 8 作者 × 15 篇 = 120 篇
 *   node deploy/loadtest/seed-big.mjs --authors=20 --notes=30
 *   XK_API_BASE=http://x:8080/api node deploy/loadtest/seed-big.mjs
 *
 * 幂等：标题带固定前缀 + 参数指纹，重复跑会跳过已存在的，不会造重。
 * 限流：register 10/min/IP、publish 20/min/用户。所以作者数别开太大，
 *      并且每个作者**只上传一次图片**、之后复用同一个 URL（省掉 image 限流）。
 * ⚠️ 造出来的 `xk_big_*` 账号/笔记要手删（后端没有删账号接口）：
 *    清理 SQL 见 AGENTS 第 5 节，把正则换成 '^xk_big_'。
 */

import zlib from 'node:zlib'

const BASE = process.env.XK_API_BASE || 'http://127.0.0.1:18080/api'
const PASSWORD = 'Xk@Big2026'

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : dflt
}
const AUTHORS = arg('authors', 8)
const NOTES = arg('notes', 15)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(path, { method = 'GET', token, body, raw } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = token
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })
  return res.json().catch(() => null)
}

/** 最小合法 PNG：8×8 纯色。P11 起图文必须至少一张图 */
function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, c])
}

function makePng(r, g, b) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(8, 0)
  ihdr.writeUInt32BE(8, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = []
  for (let y = 0; y < 8; y++) {
    raw.push(Buffer.from([0, r, g, b]))
    for (let x = 0; x < 7; x++) raw.push(Buffer.from([r, g, b]))
  }
  return new File([Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ])], 'seed.png', { type: 'image/png' })
}

const tag = `A${AUTHORS}N${NOTES}`
const titleOf = (a, i) => `xkbig${tag}_${a}_${i}`

async function main() {
  console.log(`seed-big -> ${BASE}  作者=${AUTHORS} 每人笔记=${NOTES} 共=${AUTHORS * NOTES}篇`)

  let made = 0
  let skipped = 0
  let failed = 0

  for (let a = 1; a <= AUTHORS; a++) {
    const user = `xk_big_a${String(a).padStart(2, '0')}`
    let r = await call('/user/register', {
      method: 'POST',
      body: { username: user, password: PASSWORD, nickname: `大数据${a}` },
    })
    if (r?.code === 10003) {
      // 已存在：撞 10003 判为通过（项目惯例）
    } else if (r?.code !== 0) {
      console.log(`  注册 ${user} 失败 code=${r?.code} ${r?.message}`)
      continue
    }
    r = await call('/user/login', { method: 'POST', body: { username: user, password: PASSWORD } })
    const token = `Bearer ${r?.data?.accessToken}`
    if (!r?.data?.accessToken) { console.log(`  登录 ${user} 失败`); continue }

    // 每个作者只上传一次图，之后复用同一个 URL
    const fd = new FormData()
    fd.append('file', makePng(40 * a, 90, 200 - 10 * a))
    r = await call('/note/image', { method: 'POST', token, raw: fd })
    const imgUrl = typeof r?.data === 'string' ? r.data : (r?.data?.url ?? r?.data?.path)
    if (!imgUrl) { console.log(`  ${user} 上传图失败 ${JSON.stringify(r)}`); continue }

    for (let i = 1; i <= NOTES; i++) {
      const title = titleOf(a, i)
      /*
       * 限流退避：publish 是 20/min/**用户**，造大数据集时必然撞（100005）。
       * 不做退避的话 --notes=60 会静默丢掉 2/3 的数据（2026-10-04 实测 480 篇里
       * 失败 320 篇），而脚本只会打印一行「失败=N」，很容易被当成别的问题。
       * 这里撞了就等 65s 再重试，最多 3 次。
       */
      let p = null
      for (let attempt = 0; attempt < 3; attempt++) {
        p = await call('/note/publish', {
          method: 'POST',
          token,
          body: { title, content: `压测数据集笔记 ${title}。正文凑够长度用来看排序与分页行为，重复段落。`.repeat(3), imageUrls: [imgUrl] },
        })
        if (p?.code !== 100005) break
        console.log(`  ${title} 撞发布限流，等 65s 后重试（第 ${attempt + 1} 次）`)
        await sleep(65000)
      }
      if (p?.code === 0) made++
      else if (p?.code === 100001) skipped++   // 已发布过（幂等跳过）
      else {
        failed++
        if (failed <= 3) console.log(`  发布 ${title} 失败 code=${p?.code} ${p?.message}`)
      }
    }
    console.log(`  ${user} 完成`)
  }

  console.log(`\n新增=${made}已存在跳过=${skipped} 失败=${failed}`)
  console.log('接着可以跑：node deploy/loadtest/feed-bench.mjs')
}

await main()
