/**
 * P3 笔记发布全链路（CDP）。
 *
 * 覆盖：守卫拦住未登录访问发布页、按钮在表单不完整时禁用、输入后解禁、
 * 上传图片拿到预览、发布后跳详情且图片真的解码成功（不是碎图）、
 * 超过 9 张被前端拦下、详情页对不存在的 ID 给出可读提示。
 *
 * 跑法：npm run test:ui
 */
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { createSession, preflight } from './ui-cdp.mjs'

const BASE = 'http://localhost:5180'
const API = 'http://localhost:8088'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await preflight()
} catch (e) {
  console.error(String(e.message))
  process.exit(2)
}

/**
 * 造两个 1x1 PNG 交给 <input type=file>。
 *
 * <b>为什么要用 DOM.setFileInputFiles 而不是 evaluate 造 File</b>：
 * 浏览器的 file input 只接受真实文件路径注入，JS 里 new 出来的 File
 * 塞不进去。用 DevTools 的 DOM 域命令才是等价于「用户真选了个文件」。
 */
function makePng(dir, name, r, g, b) {
  // 最小合法 PNG：8x8 纯色，IHDR/IDAT/IEND 三段手写
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
  const p = join(dir, name)
  writeFileSync(p, png)
  return p
}

const dir = mkdtempSync(join(tmpdir(), 'xk-note-'))
const pngA = makePng(dir, 'a.png', 240, 120, 60)
const pngB = makePng(dir, 'b.png', 60, 120, 240)
const tenFiles = Array.from({ length: 10 }, (_, i) => makePng(dir, `m${i}.png`, 120, 200, 120))

const s = await createSession({ name: 'note' })

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

try {
  // ---- 1. 守卫：未登录访问发布页被弹回登录
  await s.goto(`${BASE}/#/publish`)
  await s.waitFor("location.hash.startsWith('#/login')", '未登录访问发布页被守卫拦截', 20000)
  s.check('未登录访问 #/publish 被守卫重定向到 #/login', true, await s.evaluate('location.hash'))

  // ---- 2. 登录
  await s.waitFor("document.querySelector('.demo')", '演示账号按钮')
  await s.evaluate("document.querySelector('.demo').click()")
  await sleep(250)
  await s.evaluate("document.querySelector('.xk-btn').click()")
  await s.waitFor("location.hash === '#/'", '登录成功', 20000)
  s.check('演示账号登录成功', true)

  // ---- 3. 首页有发布入口
  await s.waitFor("document.querySelector('[data-test=go-publish]')", '发布入口按钮')
  s.check('首页展示「发布笔记」入口', true)
  await s.evaluate("document.querySelector('[data-test=go-publish]').click()")
  await s.waitFor("location.hash === '#/publish'", '跳到发布页', 20000)
  s.check('点击入口跳转到 #/publish', true)

  // ---- 4. 表单不完整时发布按钮禁用
  await s.waitFor("document.querySelector('[data-test=note-title]')", '标题输入框')
  const btn = () => s.evaluate("document.querySelector('.submit')?.disabled")
  s.check('空表单时「发布」按钮禁用', (await btn()) === true)
  await s.evaluate(`
    (() => {
      const set = (el, v) => {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(document.querySelector('[data-test=note-title]'), 'CDP 测试笔记')
      set(document.querySelector('[data-test=note-content]'), '这是由 ui-note.mjs 发布的正文内容。')
    })()
  `)
  await sleep(300)
  s.check('填完标题正文后按钮解禁', (await btn()) === false)
  const counters = await s.evaluate(
    "[...document.querySelectorAll('.field .count')].map(e=>e.textContent.trim()).join(' | ')",
  )
  s.check('字数计数器跟随输入', counters === '8/64 | 24/2000', counters)

  // ---- 5. 上传两张图片 -> 出现预览
  await setFiles('[data-test=note-file]', [pngA, pngB])
  await s.waitFor("document.querySelectorAll('[data-test=note-previews] .cell').length === 2", '预览出现', 20000)
  s.check('选 2 张图后出现 2 个本地预览', true)
  s.check(
    '图片计数显示 2/9',
    (await s.evaluate("document.querySelector('.pics-head .count')?.textContent?.trim()")) === '2/9',
  )

  // ---- 6. 一次选 10 张：超过上限的部分被拦在前端
  await setFiles('[data-test=note-file]', tenFiles)
  await sleep(400)
  const after = await s.evaluate("document.querySelectorAll('[data-test=note-previews] .cell').length")
  s.check('已选 2 张时再选 10 张，9 张上限把多出来的挡在门外', after === 2, `实际预览数=${after}`)
  const errText = await s.evaluate("document.querySelector('[data-test=note-error]')?.textContent?.trim()")
  s.check('超限时给出可读提示而不是静默丢弃', typeof errText === 'string' && errText.includes('9'), `"${errText}"`)

  // ---- 7. 发布
  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '发布后跳详情', 25000)
  s.check('发布成功并跳转到笔记详情', true, await s.evaluate('location.hash'))

  // ---- 8. 详情页真的把两张图渲染出来了（naturalWidth > 0 才算，不是碎图）
  await s.waitFor("document.querySelector('[data-test=note-detail]')", '详情卡片渲染')
  s.check(
    '详情页标题与作者正确',
    (await s.evaluate("document.querySelector('[data-test=note-detail-title]')?.textContent?.trim()")) === 'CDP 测试笔记',
  )
  await s.waitFor(
    "[...document.querySelectorAll('[data-test=note-detail-images] img')].length === 2 && [...document.querySelectorAll('[data-test=note-detail-images] img')].every(i => i.complete && i.naturalWidth > 0)",
    '详情图片解码完成',
    25000,
  )
  s.check('详情页两张图片都真实解码成功（非 404 碎图）', true)
  s.check(
    '详情页正文与输入一致',
    (await s.evaluate("document.querySelector('[data-test=note-detail-content]')?.textContent?.trim()"))
      === '这是由 ui-note.mjs 发布的正文内容。',
  )

  // ---- 9. 详情接口对不存在的 ID 返回可读提示
  const missing = await (await fetch(`${API}/api/note/123456789012345`, {
    headers: { Authorization: `Bearer ${await s.evaluate("localStorage.getItem('xk_token')")}` },
  })).json()
  s.check('查不存在的笔记返回 20001', missing.code === 20001, `code=${missing.code}`)
} catch (e) {
  s.check('用例执行到底', false, String(e.message))
} finally {
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
