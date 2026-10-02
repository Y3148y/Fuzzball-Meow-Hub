/**
 * P8 幂等（CDP）。
 *
 * 契约测试已经覆盖了「后端收到同一个 token 会回放」，但它走裸 HTTP，
 * 绕开了整个前端封装层 —— 而「token 有没有真的发出去」正是封装层的事。
 * 这一组专测三件契约测试测不到的东西：
 *
 * 1. 实际发出的请求里**真的有** X-Idempotency-Key（读协议层的 requestWillBeSent，
 *    不是读页面里的 axios 对象：封装层写错了读后者照样「对」）。
 * 2. 不同操作拿到不同 token（上传 ≠ 发布），否则第二次上传会拿到第一张图的 URL。
 * 3. **401 刷新后重放用的是同一个 token**。这是整个前端幂等的命门：
 *    请求拦截器每次都重新生成一个 token 的话，笔记照样会发两遍，
 *    而且这个 bug 极难发现——功能测试全绿，只有弱网用户会撞上。
 *
 * 跑法：npm run test:ui:idem
 */
import { createSession, loginDemo, preflight } from './ui-cdp.mjs'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

const BASE = 'http://localhost:5180'
const API = 'http://localhost:8088'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await preflight()
} catch (e) {
  console.error(String(e.message))
  process.exit(2)
}

const s = await createSession({ name: 'idem' })

/** 造一个 8x8 纯色 PNG（P11 起图文发布必须带图，发布流程都要先传图） */
function makePng(name, r, g, b) {
  const crc = (buf) => {
    let c = ~0
    for (const byte of buf) {
      c ^= byte
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(8, 0)
  ihdr.writeUInt32BE(8, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const raw = []
  for (let y = 0; y < 8; y++) {
    raw.push(Buffer.from([0, r, g, b]))
    for (let x = 0; x < 7; x++) raw.push(Buffer.from([r, g, b]))
  }
  const idat = zlib.deflateSync(Buffer.concat(raw))
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const p = join(mkdtempSync(join(tmpdir(), 'xk-idem-')), name)
  writeFileSync(p, png)
  return p
}
const pngA = makePng('a.png', 240, 120, 60)

/** 通过 CDP 给 input[type=file] 注入文件列表 */
async function setFiles(selector, files) {
  const doc = await s.send('DOM.getDocument')
  const { nodeId } = await s.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector,
  })
  if (!nodeId) throw new Error(`找不到文件输入框 ${selector}`)
  await s.send('DOM.setFileInputFiles', { nodeId, files })
}

/** 记录每个后端请求实际带的头，按 path 分桶 */
const seen = []
const off = s.on('Network.requestWillBeSent', (p) => {
  const url = p.request?.url ?? ''
  // 只留真正的后端调用：/src/api/xxx.ts 也含 "/api/"，
  // 不过滤的话模块加载会往桶里塞一堆源码请求，排查时看着像有幽灵请求
  if (!url.includes('/api/') || url.includes('/src/')) return
  seen.push({
    path: new URL(url).pathname,
    method: p.request.method,
    idem: p.request.headers?.['X-Idempotency-Key'] ?? p.request.headers?.['x-idempotency-key'] ?? '',
  })
})
await s.send('Network.enable')

const idemOf = (path) => seen.filter((r) => r.path === path && r.idem)

try {
  // ---- 1. 登录

  await loginDemo(s, BASE)
  s.check('演示账号登录成功', true)

  // ---- 2. 发布页走一遭：上传 + 发布
  await s.waitFor("document.querySelector('[data-test=go-publish]')", '发布入口按钮')
  await s.evaluate("document.querySelector('[data-test=go-publish]').click()")
  await s.waitFor("location.hash === '#/publish'", '跳到发布页', 20000)
  await s.waitFor("document.querySelector('[data-test=note-title]')", '标题输入框')
  const title = `幂等CDP${Date.now().toString(36).slice(-5)}`
  await s.evaluate(`
    (() => {
      const set = (el, v) => {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(document.querySelector('[data-test=note-title]'), ${JSON.stringify(title)})
      set(document.querySelector('[data-test=note-content]'), '由 ui-idempotent.mjs 发布')
    })()
  `)
  await sleep(300)
  seen.length = 0
  await setFiles('[data-test=note-file]', [pngA])
  await sleep(500)
  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '发布后跳详情', 25000)

  const pub = idemOf('/api/note/publish')
  s.check('发布请求带了 X-Idempotency-Key', pub.length === 1 && pub[0].idem.length > 0,
    `token=${pub[0]?.idem}`)

  // ---- 3. 不同操作必须是不同 token
  // 复用同一个 token 的话，第二次上传会拿回第一张图的 URL，发布出来就是错图
  await s.goto(`${BASE}/#/publish`)
  await s.waitFor("document.querySelector('[data-test=note-title]')", '标题输入框')
  seen.length = 0
  await s.evaluate(`
    (() => {
      const set = (el, v) => {
        // 标题是 input、正文是 textarea，value 的 setter 在各自的原型上：
        // 拿错原型调用会直接抛 Illegal invocation
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(document.querySelector('[data-test=note-title]'), ${JSON.stringify(`${title}B`)})
      set(document.querySelector('[data-test=note-content]'), '第二次')
    })()
  `)
  await sleep(300)
  await setFiles('[data-test=note-file]', [pngA])
  await sleep(500)
  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '第二次发布', 25000)
  const pub2 = idemOf('/api/note/publish')
  s.check('两次发布是两次独立操作，token 不同',
    pub2.length === 1 && pub[0].idem !== pub2[0].idem,
    `${pub[0]?.idem} vs ${pub2[0]?.idem}`)

  // ---- 4. 401 刷新后重放必须复用同一个 token
  //
  // 目标场景：页面加载时 token 还是好的，用户填完表单这段时间里 access token 过期了，
  // 于是点发布 → 10006 → 前端静默刷新 → 用<b>同一个 config</b> 重放。
  // 如果请求拦截器每次都重新生成幂等 token，重放就会被后端当成一次新提交，笔记照样发两遍。
  //
  // 怎么把 token 弄坏，踩过两个坑：
  // 1. 不能靠 localStorage.setItem —— token.ts 的 accessToken 是 ref，
  //    只在模块加载时读一次 localStorage，之后只有 ref→localStorage 的单向 watch。
  //    改 localStorage 改不动内存里那份，请求照常用好 token 发出，不会触发 10006。
  // 2. 不能靠「改完 localStorage 再整页重载」—— 路由守卫加载时会先打 /api/user/me，
  //    它撞上 10006 就把 token 刷好了，等点发布时又是有效 token，一次重放都不会有。
  //    （实测发布页加载时就是 /api/user/me 先触发了 refresh。）
  // 所以用 CDP 的 Fetch 域：只把<b>第一个</b> publish 请求的 Authorization 换成垃圾值，
  // 之后的一律原样放行。这才是「只在点击那一刻 token 失效」的精确模拟。
  let publishHits = 0
  const offFetch = s.on('Fetch.requestPaused', (p) => {
    publishHits += 1
    if (publishHits > 1) {
      s.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {})
      return
    }
    const headers = Object.entries(p.request.headers ?? {}).map(([name, value]) =>
      name.toLowerCase() === 'authorization'
        ? { name, value: 'Bearer expired.access.token' }
        : { name, value },
    )
    s.send('Fetch.continueRequest', { requestId: p.requestId, headers }).catch(() => {})
  })
  await s.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/note/publish' }] })

  await s.goto(`${BASE}/#/publish`)
  await s.waitFor("document.querySelector('[data-test=note-title]')", '标题输入框')
  await s.evaluate(`
    (() => {
      const set = (el, v) => {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(document.querySelector('[data-test=note-title]'), ${JSON.stringify(`${title}C`)})
      set(document.querySelector('[data-test=note-content]'), '过期 token 下发布')
    })()
  `)
  await sleep(300)
  seen.length = 0
  await setFiles('[data-test=note-file]', [pngA])
  await sleep(500)
await s.evaluate("document.querySelector('.submit').click()")
  /*
   * 超时是"看不到原因"的典型：发布失败时页面会停在原地（业务错误/限流/校验
   * 都一样），只报「超时：刷新后重放成功」根本看不出是哪一种。所以超时时
   * 顺手把页面上可见的错误文案带出来。
   */
  const navOk = await s
    .waitFor("location.hash.startsWith('#/note/')", '刷新后重放成功', 25000)
    .then(() => true)
    .catch(() => false)
  await s.send('Fetch.disable')
  offFetch()
  if (!navOk) {
    const why = await s.evaluate(
      `(document.querySelector('.err')?.textContent || document.querySelector('.hint')?.textContent || '(页面无错误提示)').trim()`,
    )
    s.check('刷新后重放成功', false, `未跳转详情页，页面提示：${why}`)
  }

  const replays = idemOf('/api/note/publish')
  s.check('access token 失效时确实重放了一次', replays.length === 2, `实际发了几次=${replays.length}`)
  s.check('重放用的是同一个幂等 token（这才是幂等的关键）',
    replays.length === 2 && replays[0].idem === replays[1].idem,
    replays.map((r) => r.idem).join(' | '))
  s.check('access token 已被刷新成新值',
    (await s.evaluate("localStorage.getItem('xk_token')")) !== 'expired.access.token')

  // ---- 5. 端到端：同一个 token 手写两次，只有一篇笔记
  const auth = await s.evaluate("localStorage.getItem('xk_token')")
  const me = await (await fetch(`${API}/api/user/me`, {
    headers: { Authorization: `Bearer ${auth}` },
  })).json()
  // P11 起图文发布必须带图，裸 fetch 也要先传图拿 URL
  const imgResp = await (await fetch(`${API}/api/note/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}` },
    body: (() => {
      const fd = new FormData()
      fd.append('file', new Blob([readFileSync(pngA)], { type: 'image/png' }), 'dup.png')
      return fd
    })(),
  })).json()
  const dupToken = `cdp-dup-${Date.now()}`
  const body = { title: `${title}D`, content: '同一个 token 手写两次', type: 1, imageUrls: [imgResp.data.url] }
  const post2 = () =>
    fetch(`${API}/api/note/publish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': dupToken,
      },
      body: JSON.stringify(body),
    }).then((r) => r.json())
  const a = await post2()
  const b = await post2()
  s.check('同一 token 两次拿到同一个 noteId', a.code === 0 && b.code === 0 && a.data.id === b.data.id,
    `${a.data?.id} vs ${b.data?.id}`)
  const list = await (await fetch(
    `${API}/api/note/user/${me.data.id}?page=1&size=100`,
    { headers: { Authorization: `Bearer ${auth}` } })).json()
  const same = (list.data?.list ?? []).filter((n) => n.title === body.title).length
  s.check('作者主页里只有一篇（没写两行）', same === 1, `篇数=${same}`)
} catch (e) {
  s.check('用例执行到底', false, String(e.message))
} finally {
  off()
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
