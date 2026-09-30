/**
 * P5 互动全链路（CDP）：点赞 / 收藏 / 评论。
 *
 * 覆盖：点赞与收藏的开关往返、两者互不影响、跨账号评论、回复嵌套与被回复者昵称、
 * 删根评论时的确认弹窗、子树一起消失、评论总数与详情页计数同步。
 *
 * <b>为什么用固定账号 xk_ui_interact 而不是每次新建？</b>
 * 和 xk_ui_smoke 同一个理由：后端没有删号接口，每次运行新建一个就等于
 * 往库里永久扔一个垃圾账号，要靠 SQL 定期清。固定账号撞 10003（已存在）
 * 就当注册通过，这样这个脚本可以反复跑而不留残留。
 *
 * <b>为什么要第二个账号？</b>后端禁止评论自己的笔记（30007）。
 * 点赞收藏没这个限制。所以前一半用演示账号测互动，后一半切固定账号测评论。
 * 切号走真登录页而不是往 localStorage 塞 token——塞 token 骗得过后端，
 * 骗不过 userStore 初始化，页面会进入"已登录但昵称为空"的半吊子状态。
 *
 * <b>P11 起作者可以评论自己的笔记</b>，30007 语义已放开（契约里有专门断言），
 * 这里依然用双账号是因为「跨账号互动」才覆盖完整：点赞者 ≠ 笔记作者、
 * 被回复者 ≠ 回复者。互相独立，不冲突。
 *
 * 跑法：npm run test:ui
 */
import { createSession, preflight } from './ui-cdp.mjs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

const BASE = 'http://localhost:5180'
const API = 'http://localhost:8088'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 演示账号，P0 建好的常驻 fixture。
 *
 * <p>这里<b>没有</b>真的用它登录——登录是点页面上的「使用演示账号」按钮填表单，
 * 口令以后端/前端配置为准，写死在这里只会和真实口令漂移然后在某天静默失效。
 * 保留常量是为了让「这个测试依赖哪个账号」在代码里一目了然。
 */
const DEMO_USERNAME = 'xiaoku_demo'
/** 常驻评论者 fixture，撞 10003 视为已存在 */
const PEER = { username: 'xk_ui_interact', password: 'Xk@2026peer', nickname: '互动搭子' }

try {
  await preflight()
} catch (e) {
  console.error(String(e.message))
  process.exit(2)
}

/** 造一个 8x8 纯色 PNG 给 <input type=file> 用（DOM.setFileInputFiles 要真实文件路径） */
function makePng(dir, name, r, g, b) {
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

const pngDir = mkdtempSync(join(tmpdir(), 'xk-interact-'))
const pngA = makePng(pngDir, 'a.png', 240, 120, 60)

const s = await createSession({ name: 'interaction' })

/** 通过 CDP 给 input[type=file] 注入文件列表（P11 起图文发布必须带图） */
async function setFiles(selector, files) {
  const doc = await s.send('DOM.getDocument')
  const { nodeId } = await s.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector,
  })
  if (!nodeId) throw new Error(`找不到文件输入框 ${selector}`)
  await s.send('DOM.setFileInputFiles', { nodeId, files })
}

/**
 * 给 Vue 绑定的 input / textarea 赋值。
 *
 * <p>不能直接 `el.value = x`：那绕过了 setter，v-model 收不到变化，
 * 输入框看着有字但组件状态没变。必须拿原生 value 的 setter 调用，
 * 再手动派发 input 事件让 v-model 更新。
 */
async function setValue(selector, value, index) {
  await s.evaluate(`
    (() => {
      const proto = el => el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(proto(el), 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const el = ${index === undefined ? `document.querySelector(${JSON.stringify(selector)})` : `document.querySelectorAll(${JSON.stringify(selector)})[${index}]`}
      if (!el) throw new Error('找不到元素 ' + ${JSON.stringify(selector)})
      set(el, ${JSON.stringify(value)})
    })()
  `)
  await sleep(150)
}

const text = (test) => s.evaluate(`document.querySelector('[data-test=${test}]')?.textContent?.trim()`)
const num = async (test) => Number(await text(test))
const pressed = (test) =>
  s.evaluate(`document.querySelector('[data-test=${test}]')?.getAttribute('aria-pressed') === 'true'`)
const exists = (test) => s.evaluate(`!!document.querySelector('[data-test=${test}]')`)
const click = (test) => s.evaluate(`document.querySelector('[data-test=${test}]')?.click()`)
const disabled = (test) => s.evaluate(`document.querySelector('[data-test=${test}]')?.disabled === true`)
const lengthOf = (test) => s.evaluate(`document.querySelectorAll('[data-test=${test}]').length`)

try {
  /* ============ 第一段：演示账号，点赞 / 收藏 ============ */

  await s.goto(`${BASE}/#/login`)
  await s.waitFor("document.querySelector('.demo')", '演示账号按钮')
  s.check('登录页展示演示账号入口', true)
  await s.evaluate("document.querySelector('.demo').click()")
  await sleep(250)
  await s.evaluate("document.querySelector('.xk-btn').click()")
  await s.waitFor("location.hash === '#/'", '演示账号登录', 20000)
  s.check(`演示账号 ${DEMO_USERNAME} 登录成功`, true)

  // 发一篇笔记当素材。选自己的笔记是因为没有别人的可用，
  // 而点赞/收藏接口不限制作者
  await s.goto(`${BASE}/#/publish`)
  await s.waitFor("document.querySelector('[data-test=note-title]')", '发布页')
  await setValue('[data-test=note-title]', 'P5 互动测试笔记')
  await setValue('[data-test=note-content]', '这篇笔记专门用来测点赞、收藏和评论。')
  await setFiles('[data-test=note-file]', [pngA])
  await sleep(600)
  await s.evaluate("document.querySelector('.submit').click()")
  await s.waitFor("location.hash.startsWith('#/note/')", '发布并跳详情', 25000)
  const noteId = (await s.evaluate('location.hash')).split('/').pop()
  s.check('拿到测试笔记 ID', /^\d+$/.test(noteId), noteId)

  await s.waitFor("document.querySelector('[data-test=note-detail]')", '详情渲染')

  s.check('初始点赞数为 0', (await num('note-like-count')) === 0)
  s.check('初始收藏数为 0', (await num('note-collect-count')) === 0)
  s.check('初始未处于已赞状态', (await pressed('note-like-btn')) === false)

  // 点一次：计数 +1，按钮进入高亮
  await click('note-like-btn')
  await s.waitFor("document.querySelector('[data-test=note-like-count]').textContent.trim() === '1'", '点赞后计数变 1')
  s.check('点赞后计数为 1', (await num('note-like-count')) === 1)
  s.check('点赞后按钮进入已赞状态（aria-pressed=true）', (await pressed('note-like-btn')) === true)

  // 再点一次：回到 0，说明它是开关而不是单向累加
  await click('note-like-btn')
  await s.waitFor("document.querySelector('[data-test=note-like-count]').textContent.trim() === '0'", '取消点赞后计数回 0')
  s.check('再点一次取消点赞，计数回到 0', (await num('note-like-count')) === 0)
  s.check('取消后按钮回到未赞状态', (await pressed('note-like-btn')) === false)

  // 收藏
  await click('note-collect-btn')
  await s.waitFor("document.querySelector('[data-test=note-collect-count]').textContent.trim() === '1'", '收藏后计数变 1')
  s.check('收藏后计数为 1', (await num('note-collect-count')) === 1)
  s.check('收藏按钮进入已收藏状态', (await pressed('note-collect-btn')) === true)

  // 关键一条：收藏之后点赞，点赞数要涨，收藏数必须纹丝不动。
  // 如果两边共用了同一个字段或自增语句，这里就会变成 0 或 2
  await click('note-like-btn')
  await s.waitFor("document.querySelector('[data-test=note-like-count]').textContent.trim() === '1'", '点赞计数变 1')
  s.check('点赞不影响收藏计数（仍是 1）', (await num('note-collect-count')) === 1)
  s.check('点赞计数独立变化为 1', (await num('note-like-count')) === 1)
  s.check(
    '两个按钮的激活状态互不干扰',
    (await pressed('note-like-btn')) === true && (await pressed('note-collect-btn')) === true,
  )

  // 复位，给评论测试留个干净的计数基线
  await click('note-like-btn')
  await click('note-collect-btn')
  await s.waitFor(
    "document.querySelector('[data-test=note-like-count]').textContent.trim() === '0' && document.querySelector('[data-test=note-collect-count]').textContent.trim() === '0'",
    '互动复位',
  )
  s.check('取消赞与取消收藏都归零', true)

  /* ============ 第二段：常驻搭子账号，评论 ============ */

  const reg = await (
    await fetch(`${API}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PEER),
    })
  ).json()
  // 10003 = 用户名已存在。固定账号第二次跑必然撞上，视为通过
  s.check('评论账号就绪（已存在或新建成功）', reg.code === 0 || reg.code === 10003, `code=${reg.code}`)

  // 清登录态后走真登录页
  await s.evaluate('localStorage.clear()')
  await s.goto(`${BASE}/#/login`)
  await s.waitFor("document.querySelectorAll('.form .xk-input').length >= 2", '登录表单')
  await setValue('.form .xk-input', PEER.username, 0)
  await setValue('.form .xk-input', PEER.password, 1)
  await s.evaluate("document.querySelector('.xk-btn').click()")
  await s.waitFor("location.hash === '#/'", '搭子账号登录', 20000)
  s.check('搭子账号登录成功', true)

  await s.goto(`${BASE}/#/note/${noteId}`)
  await s.waitFor("document.querySelector('[data-test=comment-section]')", '评论区渲染')
  await s.waitFor("document.querySelector('[data-test=comment-empty]')", '空评论提示')
  s.check('他人笔记下评论区初始为空', true)
  s.check('他人笔记的评论计数初始为 0', (await num('note-comment-count')) === 0)

  // 发表一级评论
  await setValue('[data-test=comment-input]', '写得很棒，学到了。')
  s.check('输入内容后「发表」按钮解禁', (await disabled('comment-submit')) === false)
  await click('comment-submit')
  await s.waitFor("document.querySelectorAll('[data-test=comment-item]').length === 1", '评论出现在列表', 20000)
  s.check('发表后评论立刻出现在列表里', true)
  s.check('评论内容回显正确', (await text('comment-content')) === '写得很棒，学到了。')
  s.check('详情页评论计数同步为 1', (await num('note-comment-count')) === 1)
  s.check('一级评论总数显示为 1', (await text('comment-total')) === '1')
  s.check('自己发的评论带删除按钮', (await exists('comment-delete-btn')) === true)

  // 空白内容不该发得出去
  await setValue('[data-test=comment-input]', '   ')
  s.check('只有空白时「发表」按钮禁用', (await disabled('comment-submit')) === true)

  // 回复
  await s.evaluate("document.querySelector('[data-test=comment-reply-btn]').click()")
  await s.waitFor("document.querySelector('[data-test=comment-replying]')", '进入回复态')
  s.check('点回复后出现「回复 @某人」提示条', (await text('comment-replying'))?.includes('回复 @') === true)
  s.check(
    '输入框占位文案切到回复态',
    (await s.evaluate("document.querySelector('[data-test=comment-input]')?.getAttribute('placeholder')"))?.startsWith('回复 @') === true,
  )

  await setValue('[data-test=comment-input]', '同意你的看法。')
  await click('comment-submit')
  await s.waitFor("document.querySelectorAll('[data-test=comment-reply]').length === 1", '回复出现在嵌套层', 20000)
  s.check('回复挂在根评论下，不会变成新的顶层评论', (await lengthOf('comment-item')) === 1)
  s.check('顶层评论仍是原来那一条', (await text('comment-content')) === '写得很棒，学到了。')
  s.check('回复内容回显正确', (await text('comment-reply'))?.includes('同意你的看法。') === true)
  s.check('回复里标注了被回复者昵称', (await s.evaluate("document.querySelector('[data-test=comment-reply] .c-nick')?.textContent?.includes('@')")) === true)
  s.check('评论总数（一级）不会被回复撑大，仍是 1', (await text('comment-total')) === '1')
  s.check('详情页评论计数变成 2（1 条评论 + 1 条回复）', (await num('note-comment-count')) === 2)
  s.check('发完自动退出回复态', (await exists('comment-replying')) === false)

  // 不足 3 条子回复时不该出现「共 N 条回复」
  s.check('子回复没超上限时不显示「共 N 条回复」', (await exists('comment-more-replies')) === false)

  /* ============ 评论点赞 ============ */
  s.check('根评论初始未点赞', (await pressed('comment-like-btn')) === false)
  s.check('根评论初始点赞数为 0', (await num('comment-like-count')) === 0)

  await click('comment-like-btn')
  await s.waitFor(
    "document.querySelector('[data-test=comment-like-count]').textContent.trim() === '1'",
    '评论点赞后计数变 1',
  )
  s.check('评论点赞后计数为 1', (await num('comment-like-count')) === 1)
  s.check('评论点赞后按钮进入已赞状态（aria-pressed=true）', (await pressed('comment-like-btn')) === true)

  // 再来一下取消，验证它是开关而不是单向累加
  await click('comment-like-btn')
  await s.waitFor(
    "document.querySelector('[data-test=comment-like-count]').textContent.trim() === '0'",
    '评论取消点赞后计数回 0',
  )
  s.check('再点一下取消评论点赞，计数回到 0', (await num('comment-like-count')) === 0)
  s.check('取消后评论按钮回到未赞状态', (await pressed('comment-like-btn')) === false)

  // 回复同样可以点赞（i 是回复自己的 liked/likeCount，跟根评论互不影响）
  s.check('回复初始点赞数为 0', (await num('comment-reply-like-count')) === 0)
  await s.evaluate("document.querySelector('[data-test=comment-reply-like-btn]').click()")
  await s.waitFor(
    "document.querySelector('[data-test=comment-reply-like-count]').textContent.trim() === '1'",
    '回复点赞后计数变 1',
  )
  s.check('回复点赞后计数为 1', (await num('comment-reply-like-count')) === 1)
  s.check('回复点赞不影响根评论计数（仍是 0）', (await num('comment-like-count')) === 0)
  s.check(
    '回复点赞后按钮进入已赞状态（aria-pressed=true）',
    (await s.evaluate("document.querySelector('[data-test=comment-reply-like-btn]').getAttribute('aria-pressed')")) === 'true',
  )
  // 复位，给删除用例留干净基线
  await s.evaluate("document.querySelector('[data-test=comment-reply-like-btn]').click()")
  await s.waitFor(
    "document.querySelector('[data-test=comment-reply-like-count]').textContent.trim() === '0'",
    '回复取消点赞后计数回 0',
  )
  s.check('回复取消点赞后计数回到 0', (await num('comment-reply-like-count')) === 0)

  // 删除根评论：Vant 确认弹窗
  await s.evaluate("document.querySelector('[data-test=comment-delete-btn]').click()")
  await s.waitFor("document.querySelector('.van-dialog')", '删除确认弹窗', 10000)
  s.check('删除前先弹确认框，不静默删', true)
  await s.evaluate("document.querySelector('.van-dialog__confirm').click()")
  await s.waitFor("document.querySelector('[data-test=comment-empty]')", '删除后回到空态', 20000)
  s.check('删除根评论后列表回到空态', true)
  // 计数合并是再拉一次详情的异步结果，等它落定再断言，别在同拍短读
  await s
    .waitFor("document.querySelector('[data-test=note-comment-count]').textContent.trim() === '0'", '详情评论计数归零', 20000)
    .catch(() => false)
  s.check('删除后详情页评论计数归零（子树一起退掉）', (await num('note-comment-count')) === 0)
} catch (e) {
  s.check('用例执行到底', false, String(e.message))
} finally {
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
