// 给 xk_ui_follow 的 5 篇 P6 无图笔记补封面。
//
// 为什么走页面里 import textCard.ts 而不是 Node 侧画：brandCoverBlob 是
// TS + canvas 实现，Node 没有 DOM。让 Vite 转译（seed-demo.mjs 的做法）：
// 页面里 import('/src/utils/textCard.ts')，Node 侧零依赖。
//
// ⚠️ P21 起图文笔记**编辑也必须带图**，所以这一次 PUT 就是「补图 + 全量覆盖」
// 合二为一：imageUrls 与原 title/content 一起提交（P10 起编辑是全量覆盖，
// 少传 content 会把正文清空）。
import { createSession, preflight, loginDemo } from '../../frontend/scripts/ui-cdp.mjs'

const BASE = 'http://localhost:5180'
const OWNER = { u: 'xk_ui_follow', p: 'Xk@2026peer' }
const IDS = [
  '362875257859608576',
  '362875585694797824',
  '362875851202629632',
  '362876165645406208',
  '362876874147237888',
]

let pass = 0, fail = 0
const log = (m) => console.log('  ' + m)
const ck = (n, ok, d = '') => {
  if (ok) { pass++; log('PASS  ' + n) } else { fail++; log('FAIL  ' + n + '  ' + d) }
  return ok
}

async function main() {
  // ⚠️ preflight() 无参、失败时 **throw**（不是返回 {ok}）——
  // 照抄 seed-demo 的 `const pre = await preflight(...)` 会拿到 undefined，
  // 然后 `pre.ok` 报 "Cannot read properties of undefined"。
  try {
    await preflight()
  } catch (e) {
    console.error('  预检失败：' + e.message)
    process.exit(1)
  }

  const s = await createSession({ name: 'backfill', port: 9444 })
  try {
    // 走公共 loginDemo：自带 20s × 3 次重试（login 限流 60/min/IP，
    // 全量连跑时前面几组刚把桶用掉）
    await loginDemo(s, BASE)
    const ok0 = await s.evaluate("!!localStorage.getItem('xk_token')")
    if (!ck('已登录', ok0, 'token 没拿到')) return

    // 换身份到笔记作者
    const login = await fetch('http://localhost:8088/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: OWNER.u, password: OWNER.p }),
    }).then(r => r.json())
    if (!ck('作者登录（拿 edit 权限的 token）', login.code === 0, `code=${login.code}`)) return
    await s.evaluate(`localStorage.setItem('xk_token', ${JSON.stringify(login.data.accessToken ?? login.data.token)})`)

    const r = await s.evaluate(`(async () => {
      const token = localStorage.getItem('xk_token')
      const out = []
      const mod = await import('/src/utils/textCard.ts')
      for (const id of ${JSON.stringify(IDS)}) {
        const d = await (await fetch('/api/note/' + id, { headers: { Authorization: 'Bearer ' + token } })).json()
        if (d.code !== 0) { out.push({ id, err: '读取 ' + d.code }); continue }
        const n = d.data
        const blob = await mod.brandCoverBlob({
          title: n.title,
          mascotUrl: '/mascot/m0' + ((out.length % 11) + 1) + '.webp',
          theme: 'light',
          variant: out.length % 4,
        })
        const form = new FormData()
        form.append('file', new Blob([blob], { type: 'image/png' }), 'cover.png')
        const up = await (await fetch('/api/note/image', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form,
        })).json()
        if (up.code !== 0) { out.push({ id, err: '上传 ' + up.code }); continue }
        // ⚠️ 编辑是全量覆盖：imageUrls + 原 title/content 必须一起给
        const put = await (await fetch('/api/note/' + id, {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 1, title: n.title, content: n.content, imageUrls: [up.data.url] }),
        })).json()
        out.push({ id, title: n.title, code: put.code, img: up.data.url })
        await new Promise(z => setTimeout(z, 500))
      }
      return out
    })()`)

    for (const o of r) {
      if (o.err) { ck('笔记 ' + o.id, false, o.err); continue }
      ck('补封面 ' + o.id.slice(-6) + ' 「' + o.title + '」', o.code === 0, `code=${o.code} img=${o.img ?? '?'}`)
    }

    // 复核：拿回来看 cover 是否真的落库
    const chk = await s.evaluate(`(async () => {
      const token = localStorage.getItem('xk_token')
      const out = []
      for (const id of ${JSON.stringify(IDS)}) {
        const d = await (await fetch('/api/note/' + id, { headers: { Authorization: 'Bearer ' + token } })).json()
        out.push({ id, code: d.code, cover: d.data && d.data.cover, title: d.data && d.data.title, content: d.data && d.data.content })
      }
      return out
    })()`)
    for (const c of chk) {
      ck('复核 ' + c.id.slice(-6) + ' 有封面且标题正文未丢',
        c.code === 0 && !!c.cover && !!c.title && !!c.content,
        `code=${c.code} cover=${c.cover ? '有' : '无'} title=${c.title ?? '空'} content=${c.content ?? '空'}`)
    }
  } finally {
    await s.close()
  }
  console.log(`\n  ${pass}/${pass + fail} 通过`)
  if (fail) process.exit(1)
}
main().catch(e => { console.error('  CRASH: ' + e.message); process.exit(1) })