/**
 * P3 笔记发布全链路（CDP）。
 *
 * 覆盖：守卫拦住未登录访问发布页、按钮在表单不完整时禁用、输入后解禁、
 * 上传图片拿到预览、发布后跳详情且图片真的解码成功（不是碎图）、
 * 超过 9 张被前端拦下、详情页对不存在的 ID 给出可读提示、作者管理操作，
 * 以及 P11 后「纯文字→自动生成文字卡片」的无图发布链路。
 * P13 追加：6 套模板切换、正文 \n 按行切分、长文预览分页器翻页/收起、
 * 文本输入 ≥16px、详情卡 padding>0 与 white-space: pre-wrap。
 * v1.2 截图反馈追加：详情图轮播（计数 1/2 → 点下一张 → 2/2、轨道真位移）、
 * 桌面右栏标题→作者紧邻（图片列不再在两者之间撑出大空白）。
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
  const inputFont = await s.evaluate(
    "getComputedStyle(document.querySelector('[data-test=note-title]')).fontSize",
  )
  s.check('文本输入框字号 ≥16px（防 iOS 聚焦自动缩放）', parseFloat(inputFont) >= 16, inputFont)

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
  // ---- 8.4 P13：此前详情卡从无 padding（文字贴着描边），这里钉死
  const detailPad = await s.evaluate(
    "getComputedStyle(document.querySelector('[data-test=note-detail]')).padding",
  )
  s.check('详情卡四周有内边距（文字不再贴描边）', parseFloat(detailPad) > 0, detailPad)
  const detailContent = await s.evaluate(`(() => {
    const cs = getComputedStyle(document.querySelector('[data-test=note-detail-content]'))
    return JSON.stringify({ font: cs.fontSize, ws: cs.whiteSpace })
  })()`)
  s.check(
    '详情正文 16px 且保留显式换行（white-space: pre-wrap）',
    detailContent === '{"font":"16px","ws":"pre-wrap"}',
    detailContent,
  )

  // ---- 8.5 桌面端两栏：1280 宽下图片独占左栏、标题在右栏；切回手机恢复单列
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  s.check(
    '桌面视口下详情主体切成两栏 grid',
    (await s.evaluate("getComputedStyle(document.querySelector('.detail-grid')).display")) === 'grid',
  )
  const twoCol = await s.evaluate(`(() => {
    const img = document.querySelector('[data-test=note-detail-images]').getBoundingClientRect()
    const title = document.querySelector('[data-test=note-detail-title]').getBoundingClientRect()
    return { imgLeft: Math.round(img.left), titleLeft: Math.round(title.left) }
  })()`)
  s.check('桌面视口下图片在左栏、标题在右栏', twoCol.imgLeft < twoCol.titleLeft, JSON.stringify(twoCol))
  // ---- 8.6 v1.2 截图反馈：右栏连续堆叠 + 多图轮播真的能切
  const stackGap = await s.evaluate(`(() => {
    const t = document.querySelector('[data-test=note-detail-title]').getBoundingClientRect()
    const w = document.querySelector('.who').getBoundingClientRect()
    return Math.round(w.top - t.bottom)
  })()`)
  s.check('桌面右栏标题与作者紧邻（图片列不再撑出大空白）',
    stackGap >= -8 && stackGap < 40, `gap=${stackGap}px`)
  const counter0 = await s.evaluate(
    "document.querySelector('[data-test=img-counter]')?.textContent?.trim()",
  )
  s.check('多图详情显示轮播计数 1/2', counter0 === '1/2', `counter=${counter0}`)
  const track0 = await s.evaluate(
    "getComputedStyle(document.querySelector('.van-swipe__track')).transform",
  )
  await s.evaluate("document.querySelector('[data-test=img-next]').click()")
  await s.waitFor(
    "document.querySelector('[data-test=img-counter]')?.textContent?.trim() === '2/2'",
    '轮播切到第 2 张', 5000,
  )
  s.check('点「下一张」切到第 2 张', true)
  const track1 = await s.evaluate(
    "getComputedStyle(document.querySelector('.van-swipe__track')).transform",
  )
  s.check('轮播轨道确实位移（换图真实发生）', track0 !== track1, `${track0} → ${track1}`)
  await s.send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)
  const singleCol = await s.evaluate(`(() => {
    const img = document.querySelector('[data-test=note-detail-images]').getBoundingClientRect()
    const title = document.querySelector('[data-test=note-detail-title]').getBoundingClientRect()
    return { imgLeft: Math.round(img.left), titleLeft: Math.round(title.left) }
  })()`)
  s.check('切回手机视口后恢复单列（图片与标题左边缘对齐）', singleCol.imgLeft === singleCol.titleLeft,
    JSON.stringify(singleCol))

  // ---- 9. 详情接口对不存在的 ID 返回可读提示
  const missing = await (await fetch(`${API}/api/note/123456789012345`, {
    headers: { Authorization: `Bearer ${await s.evaluate("localStorage.getItem('xk_token')")}` },
  })).json()
  s.check('查不存在的笔记返回 20001', missing.code === 20001, `code=${missing.code}`)

  // ---- 10. 作者操作区（P10 编辑器 UI 一直没做，P11 补齐）
  // 当前在「CDP 测试笔记」的详情页上，作者就是演示账号，三枚管理按钮应可见
  await s.waitFor("document.querySelector('[data-test=note-author-ops]')", '作者操作区渲染', 10000)
  s.check('作者自己的详情页显示编辑/上下架/删除按钮', true)
  const noteId = (await s.evaluate('location.hash')).split('/').pop()

  // ---- 11. 编辑：进编辑页、回填、改正文、保存回详情
  await s.evaluate("document.querySelector('[data-test=note-edit-btn]').click()")
  await s.waitFor(`location.hash === '#/edit/' + ${JSON.stringify(noteId)}`, '跳到编辑页', 20000)
  s.check('点「编辑」跳到 #/edit/{id}', true, await s.evaluate('location.hash'))
  await s.waitFor("document.querySelector('[data-test=note-edit-title]')", '编辑表单渲染')
  s.check(
    '编辑表单回填原标题',
    (await s.evaluate("document.querySelector('[data-test=note-edit-title]').value")) === 'CDP 测试笔记',
  )
  await s.evaluate(`
    (() => {
      const set = (el, v) => {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(document.querySelector('[data-test=note-edit-title]'), 'CDP 测试笔记（已编辑）')
      set(document.querySelector('[data-test=note-edit-content]'), '编辑后的正文内容，由 P11 CDP 改写。')
    })()
  `)
  await sleep(300)
  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor(`location.hash === '#/note/' + ${JSON.stringify(noteId)}`, '保存后回详情', 25000)
  s.check('保存后回到原笔记详情', true, await s.evaluate('location.hash'))
  await s.waitFor(
    "document.querySelector('[data-test=note-detail-title]')?.textContent?.trim() === 'CDP 测试笔记（已编辑）'",
    '详情标题更新为编辑值',
    10000,
  )
  s.check('编辑保存后详情页标题为新值', true)

  // ---- 12. 下架：作者仍可见，按钮切到「上架」
  await s.evaluate("document.querySelector('[data-test=note-status-btn]').click()")
  await s.waitFor(
    "document.querySelector('[data-test=note-status-btn]').textContent?.trim() === '上架'",
    '下架后按钮变上架',
    10000,
  )
  s.check('下架成功且按钮文案切换为「上架」', true)
  s.check('作者看已下架的笔记详情仍可访问', await s.evaluate("!!document.querySelector('[data-test=note-detail]')"))
  await s.evaluate("document.querySelector('[data-test=note-status-btn]').click()")
  await s.waitFor(
    "document.querySelector('[data-test=note-status-btn]').textContent?.trim() === '下架'",
    '上架后按钮切回下架',
    10000,
  )

  // ---- 13. 删除：确认弹窗 -> 回首页 -> 详情 20001
  await s.evaluate("document.querySelector('[data-test=note-delete-btn]').click()")
  await s.waitFor("document.querySelector('.van-dialog')", '删除确认弹窗', 10000)
  s.check('删除前先弹确认框，不静默删', true)
  await s.evaluate("document.querySelector('.van-dialog__confirm').click()")
  await s.waitFor("location.hash === '#/'", '删除后回首页', 20000)
  s.check('删除成功并回到首页', true, await s.evaluate('location.hash'))
  const deleted = await (await fetch(`${API}/api/note/${noteId}`, {
    headers: { Authorization: `Bearer ${await s.evaluate("localStorage.getItem('xk_token')")}` },
  })).json()
  s.check('删除后详情接口返回 20001', deleted.code === 20001, `code=${deleted.code}`)

  // ---- 14. 纯文字发布：无图合法，自动生成 3:4 文字卡片（小红书同款做法）
  await s.waitFor("document.querySelector('[data-test=go-publish]')", '回首页准备纯文字发布', 10000)
  await s.evaluate("document.querySelector('[data-test=go-publish]').click()")
  await s.waitFor("location.hash === '#/publish'", '跳发布页', 20000)
  await s.waitFor("document.querySelector('[data-test=note-title]')", '标题输入框')
  await s.evaluate(`
    (() => {
      const set = (el, v) => {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(document.querySelector('[data-test=note-title]'), '纯文字也能发')
      set(document.querySelector('[data-test=note-content]'), '不选图片也能发布，前端自动生成一张 3:4 文字卡片。')
    })()
  `)
  await sleep(400)
  s.check(
    '未选图出现纯文字模式提示',
    (await s.evaluate("document.querySelector('[data-test=text-mode-tip]')?.textContent?.trim() ?? ''")).includes('文字卡片'),
  )
  await s.waitFor("document.querySelector('[data-test=text-card-preview]')", '文字卡片预览渲染', 10000)
  s.check('未选图时出现文字卡片实时预览', true)
  s.check(
    '预览是真实 PNG dataURL',
    (await s.evaluate("document.querySelector('[data-test=text-card-preview]').src")).startsWith('data:image/png;base64,'),
  )

  // ---- 14.5 P13：模板选择 + 显式换行切段 + 长文分页预览
  const tplCount = await s.evaluate("document.querySelectorAll('[data-test=tpl-list] .tpl').length")
  s.check('纯文字模式展示 6 套文字卡模板', tplCount === 6, `count=${tplCount}`)
  const src0 = await s.evaluate("document.querySelector('[data-test=text-card-preview]').src")
  await s.evaluate("document.querySelector('[data-test=tpl-mint]').click()")
  await sleep(150)
  const src1 = await s.evaluate("document.querySelector('[data-test=text-card-preview]').src")
  s.check('切换模板后实时预览跟着换图', src0 !== src1, `${src0.length} -> ${src1.length}`)
  s.check(
    '切中的模板按钮进入选中态',
    await s.evaluate("document.querySelector('[data-test=tpl-mint]').classList.contains('on')"),
  )

  const nlLines = await s.evaluate(`(async () => {
    const m = await import('/src/utils/textCard.ts')
    const ps = m.buildTextPages('换行测试', '第一段\\n第二段\\n\\n第四段')
    return JSON.stringify(ps[0].contentLines)
  })()`)
  s.check(
    '正文显式换行按行切分、空行保留（旧 bug：\\n 被画成空格）',
    nlLines === JSON.stringify(['第一段', '第二段', '', '第四段']),
    nlLines,
  )

  await s.evaluate(`
    (() => {
      const el = document.querySelector('[data-test=note-content]')
      const lines = []
      for (let i = 1; i <= 15; i++) lines.push('第' + i + '段')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, lines.join('\\n'))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)
  await sleep(450)
  await s.waitFor("!!document.querySelector('[data-test=text-card-pager]')", '长文预览出现分页器', 10000)
  const pg0 = await s.evaluate("document.querySelector('[data-test=pager-index]').textContent.trim()")
  s.check('长文自动分页且预览显示 1/2', /^1\/[2-9]$/.test(pg0), pg0)
  const psrc0 = await s.evaluate("document.querySelector('[data-test=text-card-preview]').src")
  await s.evaluate("document.querySelector('[data-test=pager-next]').click()")
  await sleep(150)
  const pg1 = await s.evaluate("document.querySelector('[data-test=pager-index]')?.textContent?.trim()")
  const psrc1 = await s.evaluate("document.querySelector('[data-test=text-card-preview]').src")
  s.check('点「下一页」翻页且预览同步换页', !!pg1 && pg1.startsWith('2/') && psrc1 !== psrc0, `${pg0} -> ${pg1}`)

  // 收回短文：发布仍应只生成 1 张卡（后面的 length===1 断言依赖它）
  await s.evaluate(`
    (() => {
      const el = document.querySelector('[data-test=note-content]')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '不选图片也能发布，前端自动生成一张 3:4 文字卡片。')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)
  await sleep(450)
  s.check(
    '正文缩回单页后分页器收起',
    (await s.evaluate("!!document.querySelector('[data-test=text-card-pager]')")) === false,
  )

  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '纯文字发布后跳详情', 25000)
  s.check('纯文字笔记发布成功', true, await s.evaluate('location.hash'))
  await s.waitFor(
    "[...document.querySelectorAll('[data-test=note-detail-images] img')].length === 1 && [...document.querySelectorAll('[data-test=note-detail-images] img')].every(i => i.complete && i.naturalWidth > 0)",
    '文字卡片图真实解码',
    25000,
  )
  s.check('详情页正好一张自动生成的文字卡片且解码成功', true)

  // ---- 15. 清理：删掉这条纯文字笔记，保持本组自清（demo 账号不留新常驻数据）
  const textNoteId = (await s.evaluate('location.hash')).split('/').pop()
  await s.evaluate("document.querySelector('[data-test=note-delete-btn]').click()")
  await s.waitFor("document.querySelector('.van-dialog')", '删除确认弹窗', 10000)
  await s.evaluate("document.querySelector('.van-dialog__confirm').click()")
  await s.waitFor("location.hash === '#/'", '删除后回首页', 20000)
  const cleaned = await (await fetch(`${API}/api/note/${textNoteId}`, {
    headers: { Authorization: `Bearer ${await s.evaluate("localStorage.getItem('xk_token')")}` },
  })).json()
  s.check('纯文字笔记删除后详情返回 20001', cleaned.code === 20001, `code=${cleaned.code}`)
} catch (e) {
  s.check('用例执行到底', false, String(e.message))
} finally {
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
