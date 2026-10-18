/**
 * P4「我的」页面（CDP）。
 *
 * 覆盖：守卫拦住未登录访问、首页入口跳转、资料回填、昵称超长时保存按钮禁用、
 * 改资料后**回查后端**确认真的落库（不是只改了内存里的 store）、
 * 取消不写库、最后把演示账号的昵称改回原值。
 *
 * 为什么要回查：改完立刻断言页面显示对不对是没意义的 ——
 * UI 显示的就是刚 set 进去的那个对象，页面怎么都"对"。
 * 只有重新 GET /user/me 才说明数据真的进了 MySQL。
 *
 * 跑法：npm run test:ui
 */
import { createSession, loginDemo, preflight } from './ui-cdp.mjs'

const BASE = 'http://localhost:5180'
const API = 'http://localhost:8088'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 昵称是 ASCII 之外的字符，控制台回显会花，所以只拿来做长度/落库断言的参照 */
const ORIG_NICK = '小哭猫'

try {
  await preflight()
} catch (e) {
  console.error(String(e.message))
  process.exit(2)
}

const s = await createSession({ name: 'profile' })

/** 直接问后端要当前资料，用于验证"真的落库了" */
async function fetchMe(token) {
  const res = await fetch(`${API}/api/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()).data
}

try {
  // ---- 1. 守卫：未登录访问被弹回登录
  await s.goto(`${BASE}/#/profile`)
  await s.waitFor("location.hash.startsWith('#/login')", '未登录访问我的页被守卫拦截', 20000)
  s.check('未登录访问 #/profile 被守卫重定向到 #/login', true, await s.evaluate('location.hash'))

  // ---- 2. 登录
    await loginDemo(s, BASE)

  const token = await s.evaluate("localStorage.getItem('xk_token')")
  const orig = await fetchMe(token)

  // ---- 3. 底部导航有「我的」入口
  // 走 TabBar 的我的钮：首页资料卡在移动端已隐藏（go-profile 不可见）
  await s.waitFor("document.querySelector('[data-test=tab-profile]')", 'TabBar 我的按钮')
  s.check('底部导航展示「我的」入口', true)
  await s.evaluate("document.querySelector('[data-test=tab-profile]').click()")
  await s.waitFor("location.hash === '#/profile'", '跳到我的页', 20000)
  s.check('点击入口跳转到 #/profile', true)

  // ---- 4. 资料回填
  await s.waitFor(
    "document.querySelector('[data-test=me-nickname]')?.textContent?.trim() === '小哭猫'",
    '昵称加载完成',
  )
  s.check('显示昵称', (await s.evaluate("document.querySelector('[data-test=me-nickname]').textContent.trim()")) === ORIG_NICK)
  s.check('显示昵称', (await s.evaluate("document.querySelector('[data-test=me-nickname]').textContent.trim()")) === ORIG_NICK)
  // P30：用户名不再展示给人看（退回为纯登录标识）。
  // 旧版这里断言的是「我的页面上能看到用户名」，
  // 现在要钉的是**不要再看到它**。
  s.check('「我的」页不再展示用户名（P30）',
    (await s.evaluate("!document.querySelector('[data-test=me-username]')")) === true)
  const stats = await s.evaluate(
    "[...document.querySelectorAll('.stats .stat dd')].map(e=>e.textContent.trim()).join(',')",
  )
  s.check('三个计数都有值（0 也是有效值，不能因为 falsy 就当没渲染）',
    /^\d+,\d+,\d+$/.test(stats), stats)

  // ---- 5. 进入编辑，表单回填当前值
  await s.evaluate("document.querySelector('[data-test=me-edit]').click()")
  await s.waitFor("document.querySelector('[data-test=me-nickname-input]')", '编辑表单')
  s.check('编辑表单回填昵称',
    (await s.evaluate("document.querySelector('[data-test=me-nickname-input]').value")) === orig.nickname)
  // 断言「库里那个值对应的选项被选中」，而不是写死「保密」：
  // 有人给演示账号设了性别，这条还会继续有意义
  s.check('性别选中项与库里一致',
    await s.evaluate(`document.querySelector('[data-test=me-gender-${orig.gender}]').classList.contains('on')`),
    `库里 gender=${orig.gender}`)

  // ---- 6. 昵称超长：前端先拦，按钮禁用（不等 400 才反应）
  const long = '长'.repeat(33)
  await s.evaluate(`
    (() => {
      const el = document.querySelector('[data-test=me-nickname-input]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, ${JSON.stringify(long)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)
  await sleep(200)
  s.check('昵称超 32 字时计数标红',
    await s.evaluate("document.querySelector('.count').classList.contains('over')"),
    await s.evaluate("document.querySelector('.count').textContent.trim()"))
  s.check('昵称超长时保存按钮禁用',
    await s.evaluate("document.querySelector('[data-test=me-save]').disabled"))

  // ---- 7. 清空昵称也不能保存
  await s.evaluate(`
    (() => {
      const el = document.querySelector('[data-test=me-nickname-input]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, '')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)
  await sleep(200)
  s.check('昵称为空时保存按钮禁用',
    await s.evaluate("document.querySelector('[data-test=me-save]').disabled"))

  // ---- 8. 合法修改
  const NEW_NICK = '小哭猫改名'
  const NEW_BIO = 'CDP 改的资料'
  await s.evaluate(`
    (() => {
      const set = (sel, val) => {
        const el = document.querySelector(sel)
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
        Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, val)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set('[data-test=me-nickname-input]', ${JSON.stringify(NEW_NICK)})
      set('[data-test=me-bio-input]', ${JSON.stringify(NEW_BIO)})
      document.querySelector('[data-test=me-gender-2]').click()
      document.querySelector('[data-test="me-avatar-06.png"]').click()
    })()
  `)
  await sleep(250)
  s.check('填完合法值后保存按钮解禁',
    !(await s.evaluate("document.querySelector('[data-test=me-save]').disabled")))
  await s.evaluate("document.querySelector('[data-test=me-save]').click()")

  // ---- 9. 回查后端：这一步才是"真的存进去了"的证据
  await s.waitFor(
    `!document.querySelector('[data-test=me-form]')`,
    '保存后表单收起',
  )
  s.check('保存后表单收起',
    !(await s.evaluate("!!document.querySelector('[data-test=me-form]')")))
  s.check('页头昵称同步更新',
    (await s.evaluate("document.querySelector('[data-test=me-nickname]').textContent.trim()")) === NEW_NICK)
  s.check('简介展示出来',
    (await s.evaluate("document.querySelector('[data-test=me-bio]')?.textContent?.trim()")) === NEW_BIO)

  const me1 = await fetchMe(token)
  s.check('落库：nickname 真的变了', me1?.nickname === NEW_NICK, `实际 ${me1?.nickname}`)
  s.check('落库：bio 真的变了', me1?.bio === NEW_BIO, `实际 ${me1?.bio}`)
  s.check('落库：gender 真的变了', me1?.gender === 2, `实际 ${me1?.gender}`)
  // 头像：必须是**库里那个值**，不能只断言「页面上有个图」
  // —— 页头头像曾经是写死的吉祥物（三个视图都写死），那种情况下这条断言恒真。
  s.check('落库：avatar 真的变成了选中的预设', me1?.avatar === '/avatars/06.png',
    `实际 ${me1?.avatar}`)
  s.check('页头头像跟着换成了新预设（不是吉祥物）',
    (await s.evaluate(`(document.querySelector('[data-test=me-avatar]')?.getAttribute('src') || '')
      === '/avatars/06.png'`)),
    await s.evaluate(`document.querySelector('[data-test=me-avatar]')?.getAttribute('src')`))
  s.check('页头头像真的解码出来了（naturalWidth>0，不是裂图）',
    await s.evaluate(`(() => { const i = document.querySelector('[data-test=me-avatar]')
      return !!i && i.complete && i.naturalWidth > 0 })()`))

  // ---- 10. 取消不写库
  await s.evaluate("document.querySelector('[data-test=me-edit]').click()")
  await s.waitFor("document.querySelector('[data-test=me-nickname-input]')", '再次进入编辑')

  // ---- 10-bis. 头像选择器本身
  // ⚠️ 预设列表来自 /api/user/avatar-presets，**不在前端硬编码** ——
  //    所以断言只断「数量与格式」，不断具体是哪 8 个（后端加图不必改这里）。
  const picker = await s.evaluate(`(() => {
    const ps = [...document.querySelectorAll('[data-test^=me-avatar-0]')]
    return {
      n: ps.length,
      allPng: ps.every((p) => /^\\/avatars\\/0[1-8]\\.png$/.test(
        p.getAttribute('data-test').replace('me-avatar-', '/avatars/'))),
      decoded: ps.every((p) => { const i = p.querySelector('img')
        return i && i.complete && i.naturalWidth > 0 }),
      pressed: ps.filter((p) => p.getAttribute('aria-pressed') === 'true')
        .map((p) => p.getAttribute('data-test')),
      gridCols: (() => { const g = document.querySelector('[data-test=me-avatar-picker]')
        return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0 })(),
    }
  })()`)
  s.check('头像选择器列出 8 个预设', picker.n === 8, JSON.stringify(picker))
  s.check('每个预设都是合法的 /avatars/0N.png', picker.allPng, JSON.stringify(picker))
  s.check('8 张预设图全部解码成功（不是 404 占位）', picker.decoded, JSON.stringify(picker))
  s.check('当前头像对应的预设处于选中态（回填正确）',
    picker.pressed.length === 1, JSON.stringify(picker))
  s.check('预设排成 4 列两行（手机一屏放得下）', picker.gridCols === 4, JSON.stringify(picker))

  // 点另一个预设：只改本地选中，**不立即发请求**（否则连点 3 个就发 3 次）
  await s.evaluate(`document.querySelector('[data-test="me-avatar-03.png"]').click()`)
  await sleep(200)
  s.check('点预设后选中态跟着换',
    (await s.evaluate(`document.querySelector('[data-test="me-avatar-03.png"]')
      .getAttribute('aria-pressed')`)) === 'true')
  s.check('点预设不会立刻写库（要连同表单一起保存）',
    (await fetchMe(token))?.avatar === '/avatars/06.png',
    `实际 ${(await fetchMe(token))?.avatar}`)

  // 上传：非图片要在前端就拦下（不能等 415 再报错）
  const badFile = await s.evaluate(`(() => {
    const i = document.querySelector('[data-test=me-avatar-file]')
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'a.txt', { type: 'text/plain' }))
    i.files = dt.files
    i.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(400)
  s.check('上传非图片被前端拦下并给出提示',
    (await s.evaluate(`!!document.querySelector('[data-test=me-avatar-error]')`)))
  s.check('上传失败后没有把脏地址写进头像',
    (await s.evaluate(`document.querySelector('[data-test="me-avatar-03.png"]')
      .getAttribute('aria-pressed')`)) === 'true')
  await s.evaluate(`
    (() => {
      const el = document.querySelector('[data-test=me-nickname-input]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        .call(el, '这个不该被保存')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)
  await sleep(200)
  await s.evaluate("document.querySelector('[data-test=me-cancel]').click()")
  await sleep(400)
  s.check('取消后表单收起',
    !(await s.evaluate("!!document.querySelector('[data-test=me-form]')")))
  const me2 = await fetchMe(token)
  s.check('取消后昵称没被改（没发请求）', me2?.nickname === NEW_NICK, `实际 ${me2?.nickname}`)
  s.check('取消后表单回填的是库里的值',
    (await s.evaluate("document.querySelector('[data-test=me-nickname]').textContent.trim()")) === NEW_NICK)

  // ---- 11. 还原演示账号，否则 ui-smoke 的「小哭猫」断言会挂
  //
  // 刻意**用接口还原而不是再驱动一遍表单**：清理动作不该依赖被测对象本身。
  // 万一保存按钮坏了、或者哪天改坏改坏保存逻辑，用 UI 清理就会一起失败，
  // 留下一条昵称被改坏的 fixture 污染后续所有测试。
  //
  // 另外 bio 还原不到 NULL：MyBatis-Plus 的 update-strategy 是 not_null，
  // 传 null 会被从 UPDATE 里去掉。所以一旦被写成 ''，就只能一直是 ''。
  // UI 上两者都 falsy，不影响显示，这里按原值还原成 '' 即可。
  const restoreRes = await fetch(`${API}/api/user/profile`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      nickname: orig.nickname,
      gender: orig.gender,
      bio: orig.bio ?? '',
    }),
  })
  s.check('还原接口返回成功', (await restoreRes.json()).code === 0)

  const me3 = await fetchMe(token)
  s.check('演示账号昵称已还原（ui-smoke 依赖这个值）',
    me3?.nickname === orig.nickname, `实际 ${me3?.nickname}`)
  s.check('演示账号性别已还原', me3?.gender === orig.gender, `实际 ${me3?.gender}`)
  s.check('演示账号简介已还原', (me3?.bio ?? '') === (orig.bio ?? ''), `实际 ${me3?.bio ?? '(空)'}`)
} catch (e) {
  s.check('用例执行到底', false, String(e.message))
} finally {
  // 控制台错误由 close() 统一断言，别自己再 check 一次，会重复计数
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
