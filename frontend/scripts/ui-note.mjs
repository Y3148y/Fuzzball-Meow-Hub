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
import { createSession, loginDemo, preflight } from './ui-cdp.mjs'

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
    await loginDemo(s, BASE)
  s.check('演示账号登录成功', true)

  // ---- 3. 首页有发布入口
  await s.waitFor("document.querySelector('[data-test=tab-publish]')", '发布入口按钮')
  s.check('首页展示「发布笔记」入口', true)
  await s.evaluate("document.querySelector('[data-test=tab-publish]').click()")
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
﻿// ============ 8.8 P17 话题与提及：预览 → 详情 chip → 话题页 ============
//
// 放在这里是因为**发布流程已经跑完一次**（L158-160），可以复用同一篇笔记：
// 1) 空正文时没有预览行 —— 不能一进页面就冒出一堆空 chip
// 2) 打字后预览出现，#话题 与 @提及 都被识别
// 3) 发布后详情页出现话题 chip（后端回传的，不是前端自己扫的）
// 4) 点 chip 进话题页，页里有刚发的那篇
//
// ⚠️ 改值必须走原生 setter + 派发 input：直接 el.value = x 不会触发
// Vue 的 v-model，预览是 computed，界面不会更新。这条坑 P13 的计数断言踩过。
/**
 * 造一个最小 .mp4 交给 <input type=file>
 *
 * <p>内容是随便填的字节：**后端只按 content-type 白名单 + 大小校验，不校验魔数**，
 * 而浏览器给 File.type 又是按扩展名判的，所以「叫对扩展名」就够跑通这条链路。
 * 这里验的是「上传 → 落盘 → 播放器拿得到 src」，不是「视频真能解码」——
 * 后者需要真 mp4 文件与解码器，属于 headless 里验不动的部分。
 */
function makeFakeVideo(dir) {
  const p = join(dir, 'probe.mp4')
  // ftyp box 头，让它至少「看起来」像个 mp4
  const head = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])
  writeFileSync(p, Buffer.concat([head, Buffer.alloc(4096)]))
  return p
}

/** exists / text 两个小工具是视频段要用的，本文件原先没有 */
const exists = (test) => s.evaluate(`!!document.querySelector('[data-test=${test}]')`)
const click = (test) => s.evaluate(`document.querySelector('[data-test=${test}]')?.click()`)
const text = (test) => s.evaluate(`document.querySelector('[data-test=${test}]')?.textContent?.trim() ?? ''`)

async function setVal(sel, value) {
  await s.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(sel)})
      if (!el) throw new Error('setVal: 找不到 ' + ${JSON.stringify(sel)})
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
      setter.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()`,
  )
}

{
  // ⚠️ 必须先回发布页：这段插在「详情页渲染」之后，那时页面上根本没有
  // note-title / note-content 两个输入框，el 是 null →
  // setter.call(null, ...) 抛 Illegal invocation（错误信息与「找不到输入框」
  // 毫无关系，排查时容易以为是自己 new 的 setter 写错了）
  await s.goto(`${BASE}/#/publish`)
  await s.waitFor("document.querySelector('[data-test=note-title]')", '回到发布页', 20000)
  await sleep(400)
  s.check(
    '正文为空时不显示识别预览（不能一进页面就冒出一堆空 chip）',
    (await s.evaluate("!!document.querySelector('[data-test=note-topics-preview]')")) === false,
  )

  const TOPIC = 'cdpt' + Date.now().toString(36).slice(2, 7)
  await setVal('[data-test=note-title]', `话题验证 #${TOPIC}`)
  await setVal('[data-test=note-content]', `正文提到 @xk_ui_follow 也在 #${TOPIC}`)
  await s.waitFor(
    "!!document.querySelector('[data-test=note-topics-preview]')",
    '识别预览出现',
    10000,
  )
  const pv = await s.evaluate(`JSON.stringify({
    topics: [...document.querySelectorAll('[data-test=preview-topic]')].map((e) => e.textContent.trim()),
    mentions: [...document.querySelectorAll('[data-test=preview-mention]')].map((e) => e.textContent.trim()),
  })`)
  const pvd = JSON.parse(pv)
  s.check('预览识别出了 #话题', pvd.topics.some((x) => x.includes(TOPIC)), pv)
  s.check('预览识别出了 @提及', pvd.mentions.some((x) => x.includes('xk_ui_follow')), pv)
  s.check(
    '同一个 #话题 标题与正文各写一次，只显示一个 chip（预览去重了）',
    pvd.topics.filter((x) => x.includes(TOPIC)).length === 1,
    pv,
  )

  // 发布这篇带话题的（沿用 L142 的 pngA，重新选一次因为上一步清空没动图）
  await setFiles('[data-test=note-file]', [pngA])
  await s.waitFor("document.querySelectorAll('[data-test=note-previews] .cell').length === 1", '预览出现')
  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '带话题的笔记发布成功', 25000)
  const topicNoteId = (await s.evaluate('location.hash')).split('/').pop()

  await s.waitFor("!!document.querySelector('[data-test=note-topics]')", '详情页出现话题 chip', 15000)
  const chipTxt = await s.evaluate(
    "[...document.querySelectorAll('[data-test=note-topic]')].map(e=>e.textContent.trim()).join(' | ')",
  )
  s.check('详情页出现话题 chip 且内容正确', chipTxt.includes(TOPIC), chipTxt)
  s.check('话题 chip 带 # 前缀（和正文里写的样子一致）', chipTxt.includes('#'), chipTxt)

  // @提及渲染成可点链接，且跳到那个人的主页
  // ⚠️ 正则必须同时匹配**用户名**和**昵称**：正文里写的是 @xk_ui_follow，
  // 而 mentionNodes 是拿「昵称 → 用户」建表去正文里找的（返回的昵称是「关注搭子」）。
  // 只匹配中文昵称会找不到 —— 这条断言钉的正是「两边能对上」这件事本身
  const mentionHref = await s.evaluate(
    "document.querySelector('[data-test=note-mention]')?.getAttribute('href')",
  )
  // ⚠️ RouterLink 渲染出的 href 是 **hash 路由**（#/user/123）而不是 /user/123，
  // 断言别写成 /^\/user\// —— 那是纯路径路由的形状。
  s.check(
    '@提及渲染成 RouterLink（可点的，不是纯文本）',
    typeof mentionHref === 'string' && /^#?\/user\/\d+$/.test(mentionHref),
    `href=${mentionHref}`,
  )
  await s.evaluate("document.querySelector('[data-test=note-mention]').click()")
  await s.waitFor(
    `location.hash === '${mentionHref.startsWith('#') ? mentionHref : '#' + mentionHref}'`,
    '点 @提及 跳到作者主页',
    10000,
  )
  s.check('点 @提及 跳到被提到那个人的主页', true, await s.evaluate('location.hash'))

  // 点话题 chip → 话题页，页里有刚发的那篇
  await s.goto(`${BASE}/#/note/${topicNoteId}`)
  await s.waitFor("!!document.querySelector('[data-test=note-topic]')", '回到详情')
  await s.evaluate("document.querySelector('[data-test=note-topic]').click()")
  await s.waitFor("location.hash.startsWith('#/topic/')", '进话题页', 10000)
  await s.waitFor(
    "!!document.querySelector('[data-test=topic-loading]') || !!document.querySelector('[data-test=topic-list]') || !!document.querySelector('[data-test=topic-error]')",
    '话题页进入终态',
    20000,
  )
  await sleep(600)
  const tp = await s.evaluate(`JSON.stringify({
    hash: location.hash,
    err: document.querySelector('[data-test=topic-error]')?.textContent?.trim() ?? null,
    count: document.querySelectorAll('[data-test=topic-item]').length,
    hrefs: [...document.querySelectorAll('[data-test=topic-item] .main')].map(a => a.getAttribute('href')),
  })`)
  const tpd = JSON.parse(tp)
  s.check('话题页加载成功（没有 70001 的错误文案）', tpd.err === null, tp)
  // ⚠️ 同上：RouterLink 的 href 带 # 前缀（hash 路由），不能拿它跟裸路径比
  s.check(
    '话题页里有刚发的这篇',
    tpd.hrefs.some((h) => h && h.replace(/^#/, '') === `/note/${topicNoteId}`),
    tp,
  )

  // 清理这篇。走裸接口而不是点详情页的删除按钮：这段结束时人正在话题页上
  // ⚠️ xk_token 存的是**裸 JWT 字符串**，不是 {accessToken} 对象 ——
  // JSON.parse 一个以 eyJ 开头的字符串会抛「Unexpected token 'e'」，
  // 症状是清理没做（库里多一篇笔记）而报的是解析错误，跟清理八竿子打不着
  const cleanupTok = await s.evaluate("localStorage.getItem('xk_token')")
  if (cleanupTok) {
    await fetch(`${API}/api/note/${topicNoteId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cleanupTok}` },
    })
  }

  // 话题段不能删掉这篇就完事：8.4 之后的几十条断言全都量**这篇笔记的详情页**
  // （note-detail-content / col-media / .actionbar 的 --bar-h ...）。
  // 直接删掉，后面每一条 waitFor 都会超时，最终报出来的是
  // 「getComputedStyle: parameter 1 is not of type Element」——
  // 与「话题用例把笔记删了」这个真因隔了一整屏。
  // 所以重新发一篇**普通笔记**（无话题），把浏览器停回它的详情页。
  await s.goto(`${BASE}/#/publish`)
  await s.waitFor("document.querySelector('[data-test=note-title]')", '回到发布页', 20000)
  await setVal('[data-test=note-title]', '这是由 ui-note.mjs 发布的正文内容。')
  await setVal('[data-test=note-content]', '这是由 ui-note.mjs 发布的正文内容。')
  await setFiles('[data-test=note-file]', [pngA, pngB])
  await s.waitFor(
    "document.querySelectorAll('[data-test=note-previews] .cell').length === 2",
    '图片就绪',
    20000,
  )
  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '补发笔记成功', 25000)
  await s.waitFor("document.querySelector('[data-test=note-detail]')", '补发的笔记详情渲染')
  s.check('话题段之后补发了一篇笔记，把浏览器停回详情页（后续断言都量这里）', true)
}

// ============ 8.9 P19 视频：切视频模式 → 选文件 → 发布 → 详情页能播 ============
//
// 用「切换到视频模式」而不是同一个 input 里混选：一篇笔记要么图文要么视频，
// 混选会让用户传了图再选视频、最后只生效一半（PublishView 注释写了这层理由）。
{
  const vidPath = makeFakeVideo(dir)
  await s.goto(`${BASE}/#/publish`)
  await s.waitFor("document.querySelector('[data-test=note-video-mode]')", '视频模式按钮', 20000)
  s.check('发布页有「发视频」入口', await exists('note-video-mode'))

  await click('note-video-mode')
  await s.waitFor("!!document.querySelector('[data-test=note-video-file]')", '切到视频模式', 10000)
  s.check('切到视频模式后出现视频文件选择框', await exists('note-video-file'))
  s.check(
    '切到视频模式后图片选择框消失（两者互斥）',
    (await s.evaluate("!!document.querySelector('[data-test=note-file]')")) === false,
  )
  s.check(
    '切到视频模式后按钮变成「图文模式」（可切回）',
    (await text('note-video-mode')) === '图文模式',
    await text('note-video-mode'),
  )

  await setVal('[data-test=note-title]', 'CDP 视频笔记')
  await setVal('[data-test=note-content]', '播放器验证')
  await setFiles('[data-test=note-video-file]', [vidPath])
  await sleep(500)
  s.check(
    '选完视频后显示文件名',
    (await s.evaluate("document.querySelector('.picker')?.textContent || ''")).includes('probe.mp4'),
  )

  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '视频笔记发布成功', 40000)
  const videoNoteId = (await s.evaluate('location.hash')).split('/').pop()

  await s.waitFor(
    "!!document.querySelector('[data-test=note-video-player]')",
    '详情页播放器渲染',
    20000,
  )
  const vs = await s.evaluate(`(() => {
    const v = document.querySelector('[data-test=note-video-player]')
    return JSON.stringify({
      src: v?.getAttribute('src') ?? null,
      controls: v?.hasAttribute('controls'),
      preload: v?.getAttribute('preload'),
      w: Math.round(v?.getBoundingClientRect().width ?? 0),
    })
  })()`)
  const vd = JSON.parse(vs)
  s.check('详情页有 <video> 且 src 是上传后的路径（UUID 命名）',
    typeof vd.src === 'string' && /\/[0-9a-f]{32}\.mp4$/.test(vd.src), vs)
  s.check('播放器带 controls（移动端自动播会被拦，且有声自动播很烦人）', vd.controls === true)
  s.check('preload=metadata 而不是 auto（一进页面就下上百 MB 不可接受）',
    vd.preload === 'metadata', vs)
  s.check('播放器有实际宽度（不是 0 宽的隐藏元素）', vd.w > 100, `w=${vd.w}`)
  s.check('视频笔记不渲染图集（图文与视频互斥）',
    (await s.evaluate("!!document.querySelector('[data-test=note-detail-images]')")) === false)

  // 清理（走裸接口：这时人在详情页）
  const tok9 = await s.evaluate("localStorage.getItem('xk_token')")
  await fetch(`${API}/api/note/${videoNoteId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + tok9 },
  })

  // 复原：重新发一篇图文笔记，把浏览器停回普通详情页
  await s.goto(`${BASE}/#/publish`)
  await s.waitFor("document.querySelector('[data-test=note-title]')", '回到发布页', 20000)
  await setVal('[data-test=note-title]', '这是由 ui-note.mjs 发布的正文内容。')
  await setVal('[data-test=note-content]', '这是由 ui-note.mjs 发布的正文内容。')
  await setFiles('[data-test=note-file]', [pngA, pngB])
  await s.waitFor(
    "document.querySelectorAll('[data-test=note-previews] .cell').length === 2",
    '图片就绪',
    20000,
  )
  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '补发图文笔记成功', 25000)
  await s.waitFor("document.querySelector('[data-test=note-detail]')", '详情渲染')
}

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

  // ---- 8.4b 时间走 Intl 而不是手搓字符串（web-design-guidelines 明列这条）
  const timeText = await s.evaluate(
    "(document.querySelector('.who .time')?.textContent || '').trim()",
  )
  s.check(
    '笔记发布时间由 Intl 格式化（YYYY-MM-DD HH:mm）',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(timeText),
    `实际="${timeText}"`,
  )

  // ---- 8.4c 评论框要有可访问名（表单控件只有 placeholder 不算，见 a11y 规则）
  const commentAria = await s.evaluate(
    "document.querySelector('[data-test=comment-input]').getAttribute('aria-label') || ''",
  )
  s.check('评论输入框有 aria-label（读屏能念出这是什么框）',
    commentAria === '发表评论', `aria-label="${commentAria}"`)

  // ---- 8.7 截图反馈：点赞/收藏/评论降权成吸底操作栏（小红书式）
  const barMobile = await s.evaluate(`(() => {
    const bar = document.querySelector('[data-test=action-bar]')
    if (!bar) return JSON.stringify({ miss: true })
    const r = bar.getBoundingClientRect()
    const cs = getComputedStyle(bar)
    const keys = [...bar.querySelectorAll('.kbtn')]
    return JSON.stringify({
      pos: cs.position, bottom: Math.round(r.bottom), vh: innerHeight,
      border: parseFloat(cs.borderTopWidth) || 0,
      hasInput: !!bar.querySelector('[data-test=comment-input]'),
      n: keys.length,
      keys: keys.map(k => {
        const ks = getComputedStyle(k)
        const b = k.getBoundingClientRect()
        return {
          bw: parseFloat(ks.borderTopWidth) + parseFloat(ks.borderBottomWidth)
            + parseFloat(ks.borderLeftWidth) + parseFloat(ks.borderRightWidth),
          bg: ks.backgroundColor, txt: k.textContent.trim(),
          w: Math.round(b.width), h: Math.round(b.height),
        }
      }),
      pagePad: parseFloat(getComputedStyle(document.querySelector('main.page')).paddingBottom),
    })
  })()`)
  const bm = JSON.parse(barMobile)
  s.check('移动端操作栏吸底且贴住视口底',
    bm.pos === 'fixed' && Math.abs(bm.bottom - bm.vh) <= 2,
    `pos=${bm.pos} bottom=${bm.bottom} vh=${bm.vh}`)
  s.check('操作栏内含评论输入框 + 3 个键', bm.hasInput && bm.n === 3, `input=${bm.hasInput} keys=${bm.n}`)
  s.check('三键无边框、无底色、可见文字仅数字',
    bm.keys.every(k => k.bw === 0 && (k.bg === 'rgba(0, 0, 0, 0)' || k.bg === 'transparent')
      && /^\d+$/.test(k.txt)), JSON.stringify(bm.keys))
  s.check('三键热区 ≥40×40（P13）',
    bm.keys.every(k => k.w >= 40 && k.h >= 40), JSON.stringify(bm.keys.map(k => `${k.w}x${k.h}`)))
  s.check('吸底栏有顶部发丝线，且页面留出等高空白',
    bm.border > 0 && bm.pagePad >= 100, `border=${bm.border} pagePad=${bm.pagePad}px`)
  // 真实场景：滚到底，评论区尾部不能被吸底栏压住（等高留白是否真的够用）
  const clearBottom = await s.evaluate(`(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    const bar = document.querySelector('[data-test=action-bar]').getBoundingClientRect()
    const sec = document.querySelector('[data-test=comment-section]').getBoundingClientRect()
    return JSON.stringify({ secBottom: Math.round(sec.bottom), barTop: Math.round(bar.top) })
  })()`)
  const cb = JSON.parse(clearBottom)
  s.check('滚到底时评论区尾部不被吸底栏遮住', cb.secBottom <= cb.barTop, JSON.stringify(cb))

  // ---- 8.7b 两行吸底区（用户反馈"输入框只剩 170px、不好操作"的修复）
  // 旧版一行里挤「输入 + 三键」：430 视口下 pill 只剩 242px，减去给
  // 发表按钮让位的 56px 约等于 10 个汉字。现在行1 通栏、行2 动作行。
  const twoRow = await s.evaluate(`(() => {
    const bar = document.querySelector('[data-test=action-bar]')
    const input = bar.querySelector('[data-test=comment-input]').getBoundingClientRect()
    const send = bar.querySelector('[data-test=comment-submit]').getBoundingClientRect()
    const keys = bar.querySelector('.bar-keys').getBoundingClientRect()
    const br = bar.getBoundingClientRect()
    const cs = getComputedStyle(bar)
    const padL = parseFloat(cs.paddingLeft)
    const padR = parseFloat(cs.paddingRight)
    return JSON.stringify({
      flexDir: cs.flexDirection,
      inputW: Math.round(input.width),
      // 行1 通栏：输入框左右都顶到栏的内容边缘
      inputLeftGap: Math.round(input.left - (br.left + padL)),
      inputRightGap: Math.round((br.right - padR) - input.right),
      sendW: Math.round(send.width), sendH: Math.round(send.height),
      sendLeftGap: Math.round(send.left - (br.left + padL)),
      keysBelowInput: Math.round(keys.top - input.bottom),
      keysRightGap: Math.round((br.right - padR) - keys.right),
      // 栏高由 ResizeObserver 实测写进 --bar-h，.page 的 padding-bottom 靠它
      barH: Math.round(br.height),
      barVar: parseFloat(getComputedStyle(document.querySelector('main.page')).getPropertyValue('--bar-h')) || 0,
      pagePad: Math.round(parseFloat(getComputedStyle(document.querySelector('main.page')).paddingBottom)),
      sendText: bar.querySelector('[data-test=comment-submit]').textContent.trim(),
    })
  })()`)
  const tr = JSON.parse(twoRow)
  s.check('吸底栏是两行（行1 输入通栏 + 行2 动作行）',
    tr.flexDir === 'column', `flex-direction=${tr.flexDir}`)
  s.check('行1 输入框通栏（430 视口 ≥380px，旧版只有 ~170px）',
    tr.inputW >= 380 && Math.abs(tr.inputLeftGap) <= 2 && Math.abs(tr.inputRightGap) <= 2,
    `w=${tr.inputW}px Δleft=${tr.inputLeftGap} Δright=${tr.inputRightGap}`)
  s.check('行2 发表钮 44×44 且贴栏左缘',
    tr.sendW >= 44 && tr.sendH >= 44 && Math.abs(tr.sendLeftGap) <= 2,
    `${tr.sendW}x${tr.sendH} Δleft=${tr.sendLeftGap}`)
  s.check('行2 三键在输入框下方一行、右缘与输入框对齐',
    tr.keysBelowInput >= 0 && tr.keysBelowInput < 24 && Math.abs(tr.keysRightGap) <= 2,
    `below=${tr.keysBelowInput}px Δright=${tr.keysRightGap}px`)
  s.check('发表钮是纯图标钮（有 aria-label，不靠「发表」两个字占位）',
    tr.sendText === '' &&
      (await s.evaluate("!!document.querySelector('[data-test=comment-submit]').getAttribute('aria-label')")),
    `text="${tr.sendText}"`)
  s.check('--bar-h 与吸底栏实测高度一致，.page 留白跟着它（输入框长高也不遮挡）',
    Math.abs(tr.barH - tr.barVar) <= 2 && Math.abs(tr.pagePad - tr.barH) <= 2,
    `barH=${tr.barH} --bar-h=${tr.barVar} pagePad=${tr.pagePad}`)

  /*
    ---- 8.45 软键盘：headless 没有键盘，但可以**注入 --kb-inset** 验机制
    ----
    iOS Safari 弹键盘时 layout viewport 不收缩，所以 `useKeyboardInset` 读
    `innerHeight - visualViewport.height - offsetTop` 算出键盘高度写进 --kb-inset。
    「触发」验不了（那是浏览器行为），但**消费这个变量的机制必须验** ——
    2026-10-04 发现实现是错的：--kb-inset 原来被当吸底栏的**内边距**，
    于是 --bar-h（ResizeObserver 量的 offsetHeight）里已经含了键盘高度，
    .page 的 `calc(--bar-h + --kb-inset)` 又加一遍 → 末尾约 2 倍键盘高的死空白。
    下面几条把「键盘高度只用来抬栏、不进栏高、不双算」钉死。
  */
  const readKb = `(() => {
    const bar = document.querySelector('[data-test=action-bar]')
    const page = document.querySelector('main.page')
    const cs = getComputedStyle(bar)
    const r = bar.getBoundingClientRect()
    return JSON.stringify({
      bottom: Math.round(r.bottom), h: Math.round(r.height),
      padBottom: cs.paddingBottom, vh: innerHeight,
      barVar: parseFloat(getComputedStyle(page).getPropertyValue('--bar-h')) || 0,
      pagePad: Math.round(parseFloat(getComputedStyle(page).paddingBottom)),
    })
  })()`
  const kb0 = JSON.parse(await s.evaluate(readKb))
  const INSET = 300
  await s.evaluate(`document.querySelector('main.page').style.setProperty('--kb-inset', '${INSET}px')`)
  await sleep(400)
  const kb1 = JSON.parse(await s.evaluate(readKb))
  s.check(`软键盘抬起吸底栏（--kb-inset ${INSET}px 时底边升到视口底之上）`,
    Math.abs((kb0.vh - kb1.bottom) - INSET) <= 4,
    `键盘前 bottom=${kb0.bottom}（视口底 ${kb0.vh}）→ 键盘后 bottom=${kb1.bottom}`)
  s.check('键盘高度**不进栏高**（栏不因键盘变高，双算回归钉子）',
    Math.abs(kb1.h - kb0.h) <= 2 && Math.abs(kb1.barVar - kb0.barVar) <= 2,
    `栏高 ${kb0.h}→${kb1.h}  --bar-h ${kb0.barVar}→${kb1.barVar}`)
  s.check('.page 底 padding = 栏高 + 键盘高度（末尾让位，两处不重复）',
    Math.abs(kb1.pagePad - (kb1.barVar + INSET)) <= 4,
    `pagePad=${kb1.pagePad} barVar=${kb1.barVar} inset=${INSET}`)
  const kbTail = await s.evaluate(`(() => {
    // 这一节看的笔记还没有评论（「最后一条评论不被盖住」在 ui-interaction 里验，
    // 那里真的发了评论）—— 这里只确认键盘抬起后页面末尾还有让位空间。
    const page = document.querySelector('main.page')
    const bar = document.querySelector('[data-test=action-bar]')
    const b = bar.getBoundingClientRect()
    window.scrollTo(0, document.body.scrollHeight)
    const gap = Math.round(parseFloat(getComputedStyle(page).paddingBottom) - b.height)
    return JSON.stringify({ gap })
  })()`)
  s.check('键盘抬起后页面末尾的让位 = 栏高 + 键盘高度（滚到底不顶到栏下面）',
    JSON.parse(kbTail).gap >= INSET - 4, kbTail)
  await s.evaluate("document.querySelector('main.page').style.removeProperty('--kb-inset')")
  await sleep(300)
  // env() 在 computed style 里会被解析成实际值（headless 是 0px），所以必须读**规则文本**
  const barRule = await s.evaluate(`(() => {
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      for (const r of rules) {
        if (r.selectorText && r.selectorText.includes('.actionbar') &&
            /env\\(safe-area-inset-bottom/.test(r.style.padding || r.cssText)) {
          return r.cssText.replace(/\\s+/g, ' ').slice(0, 200)
        }
      }
    }
    return 'not-found'
  })()`)
  s.check('吸底栏 padding-bottom 带 env(safe-area-inset-bottom)（刘海屏 Home 条让位）',
    barRule !== 'not-found', barRule)

  // ---- 8.5 桌面两栏（用户要求：评论**放在照片下面**，展开长文不推动评论）
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  const gridHost = await s.evaluate(`(() => {
    const card = document.querySelector('[data-test=note-detail]')
    const media = document.querySelector('.col-media')
    const text = document.querySelector('.col-text')
    return JSON.stringify({
      cardDisplay: getComputedStyle(card).display,
      cols: getComputedStyle(card).gridTemplateColumns,
      mediaDisplay: getComputedStyle(media).display,
      mediaCol: getComputedStyle(media).gridColumnStart,
      textCol: getComputedStyle(text).gridColumnStart,
    })
  })()`)
  const gh = JSON.parse(gridHost)
  s.check('桌面视口下卡片是两栏网格，.col-media / .col-text 各占一列',
    gh.cardDisplay === 'grid' && gh.mediaDisplay === 'block'
      && gh.mediaCol === '1' && gh.textCol === '2',
    JSON.stringify(gh))

  const twoCol = await s.evaluate(`(() => {
    const img = document.querySelector('[data-test=note-detail-images]').getBoundingClientRect()
    const title = document.querySelector('[data-test=note-detail-title]').getBoundingClientRect()
    return { imgLeft: Math.round(img.left), titleLeft: Math.round(title.left) }
  })()`)
  s.check('桌面视口下图片在左栏、标题在右栏', twoCol.imgLeft < twoCol.titleLeft, JSON.stringify(twoCol))

  // ---- 评论紧贴照片下方，且与照片同在左栏
  const underPhoto = await s.evaluate(`(() => {
    const img = document.querySelector('[data-test=note-detail-images]').getBoundingClientRect()
    const sec = document.querySelector('[data-test=comment-section]').getBoundingClientRect()
    const content = document.querySelector('[data-test=note-detail-content]').getBoundingClientRect()
    return JSON.stringify({
      gapBelowPhoto: Math.round(sec.top - img.bottom),
      leftAlign: Math.round(sec.left - img.left),
      // 评论在正文列之外（正文列起点远在右边）
      contentLeft: Math.round(content.left),
      secLeft: Math.round(sec.left),
    })
  })()`)
  const up = JSON.parse(underPhoto)
  s.check('桌面评论区紧贴照片下方（同一栏，间距 <24px）',
    up.gapBelowPhoto >= -4 && up.gapBelowPhoto < 24, `gap=${up.gapBelowPhoto}px`)
  s.check('桌面评论区与照片左缘对齐、且不在正文那一栏',
    Math.abs(up.leftAlign) <= 2 && up.secLeft < up.contentLeft - 100, JSON.stringify(up))

  // ---- 用户要求：用户信息在最上面、标题和正文一起（作者别夹在标题与正文中间）
  const order3 = await s.evaluate(`(() => {
    const b = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) }
    }
    return JSON.stringify({
      who: b('.who'), title: b('[data-test=note-detail-title]'),
      content: b('[data-test=note-detail-content]'),
      img: b('[data-test=note-detail-images]'),
      authorName: (document.querySelector('[data-test=note-detail-author]')?.textContent || '').trim(),
    })
  })()`)
  const o3 = JSON.parse(order3)
  s.check('桌面右栏顺序：作者 → 标题 → 正文（作者在最上面，标题与正文相邻）',
    o3.who.bottom <= o3.title.top + 2 && o3.title.bottom <= o3.content.top + 2,
    `who.bottom=${o3.who.bottom} title.top=${o3.title.top} `
    + `title.bottom=${o3.title.bottom} content.top=${o3.content.top}`)
  s.check('作者区与正文同在右栏、且在图片那一栏之上',
    Math.abs(o3.who.left - o3.title.left) <= 2 && Math.abs(o3.who.left - o3.content.left) <= 2
      && o3.who.top <= o3.img.top + 2,
    `who.left=${o3.who.left} title.left=${o3.title.left} content.left=${o3.content.left} `
    + `who.top=${o3.who.top} img.top=${o3.img.top}`)

  // ---- 用户的核心诉求：展开长文**不能**把评论往下推
  // 这一节看的是短正文笔记，没有展开按钮可点；真正的检查在第 15 节
  //（那里发布了长正文笔记）用同一套几何断言做。
  const hasExpandBtn = await s.evaluate("!!document.querySelector('[data-test=note-expand]')")
  if (hasExpandBtn) {
    const beforeExpand = await s.evaluate(
      "Math.round(document.querySelector('[data-test=comment-section]').getBoundingClientRect().top)",
    )
    await s.evaluate("document.querySelector('[data-test=note-expand]').click()")
    await sleep(500)
    const afterExpand = await s.evaluate(
      "Math.round(document.querySelector('[data-test=comment-section]').getBoundingClientRect().top)",
    )
    s.check('展开长文后评论区位置不动（评论在照片下方，不受正文高度影响）',
      Math.abs(afterExpand - beforeExpand) <= 2,
      `展开前 top=${beforeExpand} 展开后 top=${afterExpand}`)
    await s.evaluate("document.querySelector('[data-test=note-expand]').click()")
    await sleep(300)
  } else {
    s.log('本节笔记是短正文（无展开按钮），"展开不动评论"在第 15 节的长正文笔记上验')
  }

  // ---- 操作栏在评论区下面（评论区的页脚），仍在左栏
  const deskBar = await s.evaluate(`(() => {
    const bar = document.querySelector('[data-test=action-bar]')
    const c = document.querySelector('[data-test=note-detail-content]')
    const sec = document.querySelector('[data-test=comment-section]')
    const img = document.querySelector('[data-test=note-detail-images]')
    const t = document.querySelector('[data-test=note-detail-title]')
    if (!bar || !c || !sec || !t || !img) return JSON.stringify({ miss: true })
    const br = bar.getBoundingClientRect(), sr = sec.getBoundingClientRect()
    const ir = img.getBoundingClientRect(), cr = c.getBoundingClientRect()
    const keys = bar.querySelector('.bar-keys').getBoundingClientRect()
    const input = bar.querySelector('[data-test=comment-input]').getBoundingClientRect()
    const send = bar.querySelector('[data-test=comment-submit]').getBoundingClientRect()
    const cs = getComputedStyle(bar)
    return JSON.stringify({
      pos: cs.position,
      shadow: cs.boxShadow,
      bg: cs.backgroundColor,
      belowComments: Math.round(br.top - sr.bottom),
      leftAlign: Math.round(br.left - sr.left),
      widthMatch: Math.abs(br.width - sr.width) <= 2,
      leftIsPhotoCol: Math.abs(br.left - ir.left) <= 2,
      notInTextCol: br.left < cr.left - 100,
      secWidth: Math.round(sr.width),
      flexDir: cs.flexDirection,
      inputFull: Math.abs(input.width - br.width) <= 2,
      keysBelowInput: Math.round(keys.top - input.bottom),
      sendW: Math.round(send.width), sendH: Math.round(send.height),
      keysRightOfSend: Math.round(keys.left - send.right),
      contentFont: parseFloat(getComputedStyle(c).fontSize),
      titleFont: parseFloat(getComputedStyle(t).fontSize),
    })
  })()`)
  const db = JSON.parse(deskBar)
  s.check('桌面操作栏静置流内（撤掉吸底壳：无底色无浮层阴影）',
    db.pos === 'static' && db.bg === 'rgba(0, 0, 0, 0)' && db.shadow === 'none', JSON.stringify(db))
  s.check('桌面操作栏在评论区之下、与评论区同宽同左缘',
    db.belowComments >= -4 && Math.abs(db.leftAlign) <= 2 && db.widthMatch === true,
    `below=${db.belowComments} Δleft=${db.leftAlign} sameWidth=${db.widthMatch}`)
  s.check('桌面评论区与操作栏都在左栏（照片那一栏），不在正文栏',
    db.leftIsPhotoCol === true && db.notInTextCol === true, `secW=${db.secWidth} ${JSON.stringify(db)}`)
  s.check('桌面操作栏也是两行：行1 输入通栏，行2 发表 + 三键',
    db.flexDir === 'column' && db.inputFull === true && db.keysBelowInput >= 0
      && db.keysBelowInput < 24 && db.sendW >= 44 && db.sendH >= 44 && db.keysRightOfSend > 0,
    `dir=${db.flexDir} inputFull=${db.inputFull} below=${db.keysBelowInput} send=${db.sendW}x${db.sendH} keys-send=${db.keysRightOfSend}`)
  s.check('桌面正文 17px / 标题 24px（注意力回到正文）',
    db.contentFont >= 17 && db.titleFont >= 24, `content=${db.contentFont} title=${db.titleFont}`)
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
    '计数器变 2/2', 5000,
  )
  s.check('点「下一张」切到第 2 张', true)
  /*
   * 轨道位移靠 rAF 驱动的 transition 落位。刚点完就量，机器忙（内存吃紧时
   * 帧调度会延后）可能量到还没起步的 matrix(1,0,0,1,0,0)，表现为偶发假红。
   * 所以这里轮询等它真的动起来，而不是同拍短读。
   */
  const track1 = await s.evaluate(`(async () => {
    const el = document.querySelector('.van-swipe__track')
    const read = () => getComputedStyle(el).transform
    const before = ${JSON.stringify('__TRACK0__')}
    for (let i = 0; i < 40; i++) {
      const t = read()
      if (t && t !== before) return t
      await new Promise(r => setTimeout(r, 100))
    }
    return read()
  })()`.replace('__TRACK0__', track0))
  s.check('轮播轨道确实位移（换图真实发生）', track0 !== track1, `${track0} → ${track1}`)
  await s.send('Emulation.clearDeviceMetricsOverride')
  await sleep(400)
  const singleCol = await s.evaluate(`(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom) }
    }
    return JSON.stringify({
      img: box('[data-test=note-detail-images]'),
      title: box('[data-test=note-detail-title]'),
      who: box('.who'),
      content: box('[data-test=note-detail-content]'),
      sec: box('[data-test=comment-section]'),
      cardDisplay: getComputedStyle(document.querySelector('[data-test=note-detail]')).display,
      mediaDisplay: getComputedStyle(document.querySelector('.col-media')).display,
    })
  })()`)
  const sc = JSON.parse(singleCol)
  s.check('切回手机视口后恢复单列（图片与标题左边缘对齐）',
    sc.cardDisplay === 'flex' && sc.mediaDisplay === 'contents'
      && sc.img.left === sc.title.left,
    JSON.stringify(sc))
  // 用户要求：移动端照片放在**全文上面**、作者在标题上方
  //（顺序是 图片 → 作者 → 标题 → 正文 → 评论）
  s.check('移动端顺序：图片 → 作者 → 标题 → 正文 → 评论',
    sc.img.bottom <= sc.who.top + 2
      && sc.who.bottom <= sc.title.top + 2
      && sc.title.bottom <= sc.content.top + 2
      && sc.content.bottom <= sc.sec.top + 2,
    `img.bottom=${sc.img.bottom} who.top=${sc.who.top} `
    + `title.top=${sc.title.top} content.top=${sc.content.top} sec.top=${sc.sec.top}`)

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
  // 「编辑」是导航，必须是真链接（<a> 带 href），不是 <button>：
  // 导航归 a、动作归 button 是语义 HTML 的基本分工。
  const editTag = await s.evaluate(`(() => {
    const el = document.querySelector('[data-test=note-edit-btn]')
    return JSON.stringify({ tag: el.tagName, href: el.getAttribute('href') })
  })()`)
  const et = JSON.parse(editTag)
  s.check('作者「编辑」是真链接（RouterLink，带 href），不是 button',
    et.tag === 'A' && typeof et.href === 'string' && et.href.includes('/edit/'),
    editTag)

  // 三个按钮的**文字要各自在自己盒子里垂直居中**。「编辑」是 <a>，另两个是
  // <button>：Chrome 只给 <button> 做内容居中，<a> 曾把行盒贴在 40px 盒子顶部
  // （上 2px / 下 22px，字往上飘，截图可见）。CSS 已改 inline-flex，这里钉死。
  const opCenters = await s.evaluate(`(() => {
    const r = document.createRange()
    return JSON.stringify([...document.querySelectorAll('[data-test=note-author-ops] .op')].map((el) => {
      r.selectNodeContents(el)
      const t = r.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      return {
        test: el.dataset.test,
        h: Math.round(b.height),
        top: Math.round(t.top - b.top),
        bottom: Math.round(b.bottom - t.bottom),
      }
    }))
  })()`)
  const opc = JSON.parse(opCenters)
  s.check('编辑/上下架/删除三个按钮的文字都垂直居中（上间距≈下间距）',
    opc.length === 3 && opc.every((o) => o.h >= 40 && Math.abs(o.top - o.bottom) <= 2),
    opCenters)
  // ⚠️ 标题必须在点「编辑」**之前**读：点了之后页面就换成编辑页，
  // 详情页那个 DOM 节点已经不存在了（querySelector 返回 null），
  // 于是「回填 == 详情标题」永远成立不了 —— 而报错说的是 undefined
  const detailTitleBeforeEdit = await s.evaluate(
    "document.querySelector('[data-test=note-detail-title]')?.textContent?.trim() ?? ''",
  )
  await s.evaluate("document.querySelector('[data-test=note-edit-btn]').click()")
  await s.waitFor(`location.hash === '#/edit/' + ${JSON.stringify(noteId)}`, '跳到编辑页', 20000)
  s.check('点「编辑」跳到 #/edit/{id}', true, await s.evaluate('location.hash'))
  await s.waitFor("document.querySelector('[data-test=note-edit-title]')", '编辑表单渲染')
  // ⚠️ 也不写死 'CDP 测试笔记'：改成与刚才读到的详情标题比。
  // 写死的话，哪天有人改了发布内容这里就红，而红的原因与回填功能无关
  const backfilledTitle = await s.evaluate(
    "document.querySelector('[data-test=note-edit-title]').value",
  )
  s.check(
    '编辑表单回填原标题（与详情页标题一致）',
    detailTitleBeforeEdit.length > 0 && backfilledTitle === detailTitleBeforeEdit,
    `详情=${detailTitleBeforeEdit} 回填=${backfilledTitle}`,
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
  await s.waitFor("document.querySelector('[data-test=tab-publish]')", '回首页准备纯文字发布', 10000)
  await s.evaluate("document.querySelector('[data-test=tab-publish]').click()")
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

  // 记下纯文字笔记的 id：第 15 节要跳去发长正文，最后再回来删它
  const textNoteId = (await s.evaluate('location.hash')).split('/').pop()

  // ---- 15. 长正文折叠 + 展开全文（用户反馈"正文一长就往下延长"）
  // 先在当前这条短正文（30 字）详情页上钉一句：不该出现展开按钮
  s.check(
    '短正文不出现「展开全文」按钮',
    (await s.evaluate("!document.querySelector('[data-test=note-expand]')")) === true,
  )

  // 用 goto 而不是点 ‹ 返回：这一串是 s.goto 直接跳进来的，
  // router.back() 的历史栈里未必有首页，等它回来会超时
  await s.goto(`${BASE}/#/`)
  await s.waitFor("location.hash === '#/'", '回首页', 20000)
  await s.waitFor("document.querySelector('[data-test=tab-publish]')", '首页准备按钮', 10000)
  await s.evaluate("document.querySelector('[data-test=tab-publish]').click()")
  await s.waitFor("location.hash === '#/publish'", '跳发布页', 20000)
  await s.waitFor("document.querySelector('[data-test=note-title]')", '标题输入框')
  // 12 段 × 约 30 字 ≈ 360 字：手机 8 行（约 176 字）必然截断，桌面 12 行也截断
  // 20 段：桌面折叠阈值是 12 行，正文必须**在桌面也溢出**，否则展开按钮
  // 不会出现（12 段刚好被 12 行装下，按钮合理地不渲染）
  const longText = Array.from({ length: 20 }, (_, i) => `第${i + 1}段` + '长正文折叠测试内容。'.repeat(2)).join('\n')
  await s.evaluate(`
    (() => {
      const set = (el, v) => {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(document.querySelector('[data-test=note-title]'), '长正文折叠')
      set(document.querySelector('[data-test=note-content]'), ${JSON.stringify(longText)})
    })()
  `)
  await sleep(300)
  await setFiles('[data-test=note-file]', [pngA])
  await s.waitFor("document.querySelectorAll('[data-test=note-previews] .cell').length === 1", '预览出现', 20000)
  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '长正文发布后跳详情', 25000)
  await s.waitFor("!!document.querySelector('[data-test=note-detail-content]')", '正文渲染', 20000)

  const clampInfo = await s.evaluate(`(() => {
    const c = document.querySelector('[data-test=note-detail-content]')
    const cs = getComputedStyle(c)
    const r = c.getBoundingClientRect()
    const btn = document.querySelector('[data-test=note-expand]')
    return JSON.stringify({
      // 刻意不看 display：Chrome 会把 display:-webkit-box 归一成 flow-root
      // （实测就是 flow-root），断 display 等于断浏览器实现细节
      clamp: cs.webkitLineClamp,
      lines: Math.round(r.height / parseFloat(cs.lineHeight)),
      btn: !!btn,
      label: btn ? btn.textContent.trim() : '',
      aria: btn ? btn.getAttribute('aria-expanded') : null,
      h: Math.round(r.height),
    })
  })()`)
  const ci = JSON.parse(clampInfo)
  s.check(
    '长正文折叠成 8 行（line-clamp）并出现「展开全文」',
    ci.clamp === '8' && ci.lines <= 8
      && ci.btn === true && ci.label === '展开全文' && ci.aria === 'false',
    clampInfo,
  )
  await s.evaluate("document.querySelector('[data-test=note-expand]').click()")
  await sleep(300)
  const expInfo = await s.evaluate(`(() => {
    const c = document.querySelector('[data-test=note-detail-content]')
    const cs = getComputedStyle(c)
    const r = c.getBoundingClientRect()
    const btn = document.querySelector('[data-test=note-expand]')
    return JSON.stringify({
      clamp: cs.webkitLineClamp,
      lines: Math.round(r.height / parseFloat(cs.lineHeight)),
      h: Math.round(r.height),
      label: btn ? btn.textContent.trim() : '',
      aria: btn ? btn.getAttribute('aria-expanded') : null,
    })
  })()`)
  const ex = JSON.parse(expInfo)
  s.check(
    '点「展开全文」后正文全展开（行数超折叠阈值）、按钮变「收起」',
    ex.clamp === 'none' && ex.lines > 8 && ex.h > ci.h && ex.label === '收起' && ex.aria === 'true',
    `${expInfo} collapsed=${clampInfo}`,
  )
  await s.evaluate("document.querySelector('[data-test=note-expand]').click()")
  await sleep(300)
  const backInfo = await s.evaluate(`(() => {
    const c = document.querySelector('[data-test=note-detail-content]')
    return JSON.stringify({
      clamp: getComputedStyle(c).webkitLineClamp,
      // 关键回归：展开后再量一次，展开状态下量会得到"没溢出"，
      // 按钮就会自己消失（measuring 强制折叠态量就是为了防这个）
      btn: !!document.querySelector('[data-test=note-expand]'),
    })
  })()`)
  const bk = JSON.parse(backInfo)
  s.check(
    '点「收起」回到折叠态，且按钮仍在（不能自己消失）',
    bk.clamp === '8' && bk.btn === true,
    backInfo,
  )
  // 桌面阈值不同：12 行
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  const deskClamp = await s.evaluate(
    "getComputedStyle(document.querySelector('[data-test=note-detail-content]')).webkitLineClamp",
  )
  s.check('桌面折叠阈值放宽到 12 行', deskClamp === '12', `clamp=${deskClamp}`)

  // 长正文笔记 + 桌面：展开正文不能让评论往下移（评论在照片下方那一栏）
  const stableTop = await s.evaluate("Math.round(document.querySelector('[data-test=comment-section]').getBoundingClientRect().top)")
  await s.waitFor("!!document.querySelector('[data-test=note-expand]')", '展开按钮（桌面仍溢出）', 5000)
    .catch(() => false)
  await s.evaluate("document.querySelector('[data-test=note-expand]')?.click()")
  await sleep(600)
  const movedTop = await s.evaluate(`(() => {
    const sec = document.querySelector('[data-test=comment-section]').getBoundingClientRect()
    const img = document.querySelector('[data-test=note-detail-images]').getBoundingClientRect()
    return JSON.stringify({
      top: Math.round(sec.top),
      gapBelowPhoto: Math.round(sec.top - img.bottom),
      sameLeft: Math.round(sec.left - img.left),
    })
  })()`)
  const mt = JSON.parse(movedTop)
  s.check('展开长文后评论区仍在照片正下方且位置不动（桌面）',
    Math.abs(mt.top - stableTop) <= 2 && mt.gapBelowPhoto >= -4 && mt.gapBelowPhoto < 24
      && Math.abs(mt.sameLeft) <= 2,
    `展开前=${stableTop} 展开后=${JSON.stringify(mt)}`)
  await s.evaluate("document.querySelector('[data-test=note-expand]').click()")
  await sleep(300)

  await s.send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)

  // ---- 16. 清理：删掉长正文笔记与纯文字笔记，本组自清
  const longNoteId = (await s.evaluate('location.hash')).split('/').pop()
  await s.evaluate("document.querySelector('[data-test=note-delete-btn]').click()")
  await s.waitFor("document.querySelector('.van-dialog')", '删除确认弹窗', 10000)
  await s.evaluate("document.querySelector('.van-dialog__confirm').click()")
  await s.waitFor("location.hash === '#/'", '删除后回首页', 20000)
  const longGone = await (await fetch(`${API}/api/note/${longNoteId}`, {
    headers: { Authorization: `Bearer ${await s.evaluate("localStorage.getItem('xk_token')")}` },
  })).json()
  s.check('长正文笔记删除后详情返回 20001', longGone.code === 20001, `code=${longGone.code}`)

  await s.goto(`${BASE}/#/note/${textNoteId}`)
  await s.waitFor("!!document.querySelector('[data-test=note-detail-content]')", '纯文字笔记详情', 20000)
  await s.evaluate("document.querySelector('[data-test=note-delete-btn]').click()")
  await s.waitFor("document.querySelector('.van-dialog')", '删除确认弹窗', 10000)
  await s.evaluate("document.querySelector('.van-dialog__confirm').click()")
  await s.waitFor("location.hash === '#/'", '删除后回首页', 20000)
  const cleaned = await (await fetch(`${API}/api/note/${textNoteId}`, {
    headers: { Authorization: `Bearer ${await s.evaluate("localStorage.getItem('xk_token')")}` },
  })).json()
  s.check('纯文字笔记删除后详情返回 20001', cleaned.code === 20001, `code=${cleaned.code}`)
} catch (e) {
  s.check('用例执行到底', false, String(e.message));
} finally {
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
