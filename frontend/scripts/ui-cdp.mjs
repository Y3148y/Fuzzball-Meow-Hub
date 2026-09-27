/**
 * UI 冒烟测试用的最小 CDP 封装。
 *
 * 为什么自己写而不是上 Playwright：Node 22 自带全局 WebSocket，直接说
 * DevTools 协议就够用了，为几条断言拉一套浏览器依赖（几十 MB）不划算。
 * 这里只做「开浏览器 → 连上 → 跑表达式 → 等条件」四件事。
 *
 * 用法：
 *   const s = await createSession({ name: 'smoke' })
 *   await s.goto('http://localhost:5180/#/login')
 *   await s.waitFor("location.hash.includes('login')", '登录页')
 *   const v = await s.evaluate("document.title")
 *   await s.close()
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEV_ORIGIN = 'http://localhost:5180'

/** 按候选顺序找一个可用浏览器，XK_CHROME 环境变量可覆盖 */
function findChrome() {
  const candidates = [
    process.env.XK_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p))
}

/** 找一个空闲端口，避免上一次冒烟没退干净导致端口被占 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 起服务的前提检查，比让 CDP 连接超时的报错友好得多 */
export async function preflight() {
  try {
    const res = await fetch(DEV_ORIGIN, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    throw new Error(
      `开发服务器没起来（${DEV_ORIGIN}，${e.message}）。\n` +
        `  先在 frontend 目录跑： npm run dev\n` +
        `  另外这个测试要打后端，确认 8088 端口的服务也在跑。`,
    )
  }
}

export async function createSession({ name = 'ui', port } = {}) {
  const chromeBin = findChrome()
  if (!chromeBin) {
    throw new Error('找不到 Chrome/Edge，可用 XK_CHROME 环境变量指定可执行文件路径')
  }

  const debugPort = port ?? (await freePort())
  const profile = mkdtempSync(join(tmpdir(), `xk-${name}-`))
  const chrome = spawn(
    chromeBin,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=430,900',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  // 等 DevTools 端口就绪（Chrome 冷启动可能要一秒）
  let ver = null
  for (let i = 0; i < 60; i++) {
    try {
      ver = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: AbortSignal.timeout(1500),
      })).json()
      break
    } catch {
      await sleep(250)
    }
  }
  if (!ver) {
    chrome.kill()
    rmSync(profile, { recursive: true, force: true })
    throw new Error(`Chrome DevTools 端口没起来（${debugPort}）`)
  }

  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  const pending = new Map()
  const consoleErrors = []
  let msgId = 0

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      return
    }
    // 只收集 error 级别：注入的控制台警告不属于被测代码的问题
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description || '未捕获异常')
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  }

  function send(method, params = {}) {
    const id = ++msgId
    ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }

  await send('Page.enable')
  await send('Runtime.enable')

  /** 在页面里求值。表达式自带 awaitPromise，所以支持直接 await 页面里的 Promise */
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'evaluate 抛异常')
    }
    return r.result.value
  }

  /** 轮询等条件为真，超时抛错并带上标签，方便定位是哪一步卡住 */
  async function waitFor(expression, label, timeout = 20000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(`!!(${expression})`)) return true
      await sleep(150)
    }
    throw new Error(`超时：${label}`)
  }

  /**
   * 导航 + 等 Vue 挂载 + 等路由守卫跑完。
   *
   * 关键是第一步：Page.navigate 到「和当前完全相同的 URL」只是一次 hash 片段
   * 跳转，不会重新执行文档。一旦脚本想靠改 localStorage 来制造冷启动状态，
   * 就会得到一个假通过 —— 这里先跳 about:blank 断开同文档关系再跳回来。
   * 次关键是不写固定 sleep：Vite dev 要按需编译模块，冷启动可能好几秒。
   */
  async function goto(url, { fresh = true } = {}) {
    if (fresh) {
      await send('Page.navigate', { url: 'about:blank' })
      await sleep(150)
    }
    await send('Page.navigate', { url })
    await waitFor("document.querySelector('#app')?.children.length > 0", `app 挂载 @ ${url}`)
    await sleep(400)
  }

  const results = []
  const check = (label, ok, extra = '') => {
    results.push({ label, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
  }
  /** 只打印、不计入断言的说明性文字 */
  const log = (msg) => console.log(`  ·  ${msg}`)

  async function close() {
    try {
      ws.close()
    } catch {
      /* 已经断了就算了 */
    }

    // 必须等 Chrome 真正退出再删 profile：Windows 下进程没退出时文件还被锁着，
    // kill 之后立刻 rmSync 会静默失败，结果每次跑完都漏一个几十 MB 的临时目录。
    await new Promise((resolve) => {
      if (chrome.exitCode !== null) return resolve()
      chrome.once('exit', resolve)
      setTimeout(resolve, 5000) // 兜底：清理不该拖住测试结论
      chrome.kill()
    })

    for (let i = 0; i < 5; i++) {
      try {
        rmSync(profile, { recursive: true, force: true })
        break
      } catch {
        await new Promise((r) => setTimeout(r, 300))
      }
    }

    const failed = results.filter((r) => !r.ok).length
    console.log(`\n控制台错误 ${consoleErrors.length} 条`)
    consoleErrors.slice(0, 8).forEach((e) => console.log('  - ' + String(e).split('\n')[0]))
    if (consoleErrors.length === 0) check('运行期无控制台错误', true)
    else check('运行期无控制台错误', false, `${consoleErrors.length} 条`)
    console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`)
    return failed === 0
  }

  return { evaluate, waitFor, goto, send, check, log, results, consoleErrors, close }
}
