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
  /** method -> Set<handler>：给「要看请求实际发了什么」这类用例用 */
  const listeners = new Map()
  let msgId = 0

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      return
    }
    // 协议事件：比如 Network.requestWillBeSent。
    // 断言「请求头里到底有没有某个字段」只能在协议这一层看 ——
    // 页面上 evaluate 拿到的都是 axios 加工之后的对象，
    // 封装层把头写错/漏写时它照样是对的，看它等于什么都没验。
    const handlers = listeners.get(m.method)
    if (handlers) {
      for (const h of handlers) h(m.params)
    }
    // 只收集 error 级别：注入的控制台警告不属于被测代码的问题
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description || '未捕获异常')
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
    }
    /*
     * 自动接受原生对话框（beforeunload / alert / confirm）。
     *
     * 为什么必须有：发布/编辑页注册了「未保存提醒」，CDP 的 Page.navigate
     * 遇到未处理的原生对话框会**一直等**（headless 里没人去点它），
     * 表现就是测试卡在 goto 上直到超时。
     * 这段只处理 beforeunload/alert/confirm —— Vant 的确认框是 DOM 元素，
     * 走正常路径点击即可，不会误伤 ui-note 里「点弹窗确认删除」那些用例。
     */
    if (m.method === 'Page.javascriptDialogOpening') {
      console.log(`    [cdp] 自动接受原生对话框：${m.params.message || m.params.type}`)
      ws.send(
        JSON.stringify({
          id: ++msgId,
          method: 'Page.handleJavaScriptDialog',
          params: { accept: true },
        }),
      )
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

  /**
   * 订阅协议事件，返回退订函数。
   *
   * 必须先 {@code Network.enable} 才会收到 Network.* 事件。
   */
  function on(method, handler) {
    if (!listeners.has(method)) listeners.set(method, new Set())
    listeners.get(method).add(handler)
    return () => listeners.get(method)?.delete(handler)
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

  return { evaluate, waitFor, goto, send, check, log, on, results, consoleErrors, close }
}

/**
 * 走 UI 真实点击登录演示账号，**带限流重试**。
 *
 * 为什么要抽成公共函数：这段「goto #/login → 点 .demo → 点 .xk-btn → 等 hash」
 * 原本在 8 个测试文件里各抄了一份，于是同一个坑要踩 8 次：
 * 登录按 IP 限流 60 次/分钟（契约 16.1 节），全量连跑时前面几组刚把桶用掉，
 * 后面那组就吃到 429 —— 表现是「超时：登录成功」，因为登录请求返回了错误、
 * 页面根本没跳走。
 *
 * 重试里有个关键判断：**先看是不是已经在首页**。首次尝试可能服务端已登录成功、
 * 只是 SPA 跳转慢；此时再 goto('#/login') 会被 guestOnly 守卫弹回 '#/'，
 * `.demo` 按钮永远不出现 —— 重试反而制造新失败（踩过）。
 *
 * @param base 前端 origin（各组的 BASE 常量）
 * @param attempts 最多尝试次数
 */
/**
 * @param onFilled 点「用演示账号填充」之后、点提交之前的钩子。
 *   ui-smoke 要在这里断言「表单确实被填了」——那个时刻在提交之后就看不到表单了，
 *   所以只能由 helper 暴露一个插入点，而不是让 smoke 自己重写一遍登录流程。
 */
export async function loginDemo(s, base, { attempts = 3, onFilled } = {}) {
  for (let attempt = 1; ; attempt++) {
    if ((await s.evaluate('location.hash')) === '#/') return true
    await s.goto(`${base}/#/login`)
    await s.waitFor("document.querySelector('.demo')", '演示账号按钮', 20000)
    await s.evaluate("document.querySelector('.demo').click()")
    await new Promise((r) => setTimeout(r, 250))
    if (onFilled) await onFilled()
    await s.evaluate("document.querySelector('.xk-btn').click()")
    const ok = await s
      .waitFor("location.hash === '#/'", '演示账号登录', 15000)
      .then(() => true)
      .catch(() => false)
    if (ok) return true
    if (attempt >= attempts) {
      throw new Error(
        `演示账号登录连续 ${attempts} 次失败（多半是撞 login 60/min 限流，脚本节奏太密）`,
      )
    }
    console.log(`    登录未成功（可能撞 login 60/min 限流），20s 后重试 第${attempt + 1}次`)
    await new Promise((r) => setTimeout(r, 20000))
  }
}