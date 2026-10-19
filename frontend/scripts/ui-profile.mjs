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

// ⚠️ `token` / `orig` 必须在 **try 外面**声明。
//    本轮第一版把它们写成 `const` 放在 try 内部，于是 finally 里引用时抛
//    ReferenceError（JS 的块级作用域）——而那个 catch 是空的，错误被静默吞掉，
//    结果「还原」看起来跑了、实际一次都没生效，fixture 一次次被改坏。
//    **空 catch 吞掉异常比不写更糟**：它让「清理失败」和「清理成功」看起来一样。
let token = null
let orig = null

try {
  // ---- 1. 守卫：未登录访问被弹回登录
  await s.goto(`${BASE}/#/profile`)
  await s.waitFor("location.hash.startsWith('#/login')", '未登录访问我的页被守卫拦截', 20000)
  s.check('未登录访问 #/profile 被守卫重定向到 #/login', true, await s.evaluate('location.hash'))

  // ⚠️ **新增路由的 `meta.requiresAuth` 必须单独钉一条**。
  //    P38 加 `/profile/edit` 时，插入式改动把 `/profile` 的
  //    `meta: { title: '我的', requiresAuth: true }` 顺手删掉了，
  //    新路由自己又没写 —— 结果未登录也能进编辑页。
  //    **整份测试全绿也照样漏**：后面每一条断言都在已登录状态里跑，
  //    守卫根本不会被触发，所以「未登录能不能进」这条永远测不到。
  //    这正是 AGENTS 反复强调的那一类：新增入口就得补它的**反例**。
  await s.goto(`${BASE}/#/profile/edit`)
  await s.waitFor("location.hash.startsWith('#/login')", '未登录访问编辑页被守卫拦截', 20000)
  s.check('未登录访问 #/profile/edit 也被守卫拦下（新增路由漏 meta 无从察觉，除非钉这条）',
    true, await s.evaluate('location.hash'))

  // ---- 2. 登录
  await loginDemo(s, BASE)

  token = await s.evaluate("localStorage.getItem('xk_token')")
  orig = await fetchMe(token)

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
    /^\d+,0,\d+/.test(stats) || /^\d+,\d+,\d+$/.test(stats), stats)

  // ---- 4-bis. 内容 Tab（笔记 / 收藏 / 赞过）
  //
  // ⚠️ Tab 用 `<button role=tab>`：切 Tab 是**动作**不是导航（P21），
  //    所以它**不该**改地址栏 —— 下面那条断 hash 不变的断言就是钉这一点，
  //    否则有人改成 RouterLink 时这条会红而没人知道为什么。
  const tabRow = await s.evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.tabs [role=tab]')]
    return {
      n: tabs.length,
      labels: tabs.map((t) => t.textContent.trim()),
      keys: tabs.map((t) => t.getAttribute('data-test')),
      selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true')
        .map((t) => t.getAttribute('data-test')),
      heights: tabs.map((t) => Math.round(t.getBoundingClientRect().height)),
      thirds: (() => { const box = document.querySelector('.tabs')
        if (!box) return 0
        const w = tabs.map((t) => t.getBoundingClientRect().width)
        return w.length === 3 && Math.abs(w[0] - w[1]) < 2 && Math.abs(w[1] - w[2]) < 2 })(),
      isButton: tabs.every((t) => t.tagName === 'BUTTON'),
    }
  })()`)
  s.check('主页有三个 Tab（笔记 / 收藏 / 赞过）', tabRow.n === 3, JSON.stringify(tabRow))
  s.check('Tab 标签文案正确', tabRow.labels.join(',') === '笔记,收藏,赞过', JSON.stringify(tabRow))
  s.check('Tab 用的是 <button>（切 Tab 是动作不是导航，P21）', tabRow.isButton, JSON.stringify(tabRow))
  s.check('默认激活「笔记」',
    tabRow.selected.join(',') === 'me-tab-notes', JSON.stringify(tabRow))
  s.check('Tab 三个等宽（否则窄屏右边会空一大片）', tabRow.thirds, JSON.stringify(tabRow))
  s.check('Tab 热区 ≥40px（P13 下限）',
    tabRow.heights.every((h) => h >= 40), JSON.stringify(tabRow))

  const hashBefore = await s.evaluate('location.hash')
  // 切到「赞过」
  await s.evaluate("document.querySelector('[data-test=me-tab-liked]').click()")
  await s.waitFor(`document.querySelector('[data-test=me-tab-liked]')
    .getAttribute('aria-selected') === 'true'`, '切到赞过', 10000)
  s.check('切 Tab 后激活态跟着换',
    (await s.evaluate(`document.querySelector('[data-test=me-tab-liked]')
      .getAttribute('aria-selected')`)) === 'true')
  s.check('切 Tab **不改地址栏**（它是动作不是导航）',
    (await s.evaluate('location.hash')) === hashBefore,
    `${hashBefore} → ${await s.evaluate('location.hash')}`)

  // ⚠️ 必须等**终态**，条件里不能带 `!!loading` ——
  //    「有加载态元素存在」在**组件刚挂载那一刻就是真的**，于是这个 waitFor
  //    会**瞬间通过**，「等加载完成」根本没等，紧接着的断言全在转圈页面上跑。
  //    （AGENTS P22 记过同形状的坑，当时是 `!loading` 元素还不存在。）
  //    ⚠️ 本条尤其隐蔽：模板里加载态的 data-test 之前**写死成 me-notes-loading**，
  //    `[data-test=me-liked-loading]` 永远选不到 → 这半个条件恒 false，
  //    整条靠另两个分支撑着才偶然是对的。模板改对之后它立刻变成「瞬间通过」。
  //    **两个错叠在一起时，一个修好会暴露另一个** —— 所以别把「现在是绿的」当「写对了」。
  await s.waitFor(`!document.querySelector('[data-test=me-liked-loading]') && (
      !!document.querySelector('[data-test=me-liked-list]')
      || !!document.querySelector('[data-test=me-liked-empty]'))`,
  '赞过列表到终态', 15000)
  const likedShape = await s.evaluate(`(() => ({
    list: !!document.querySelector('[data-test=me-liked-list]'),
    empty: !!document.querySelector('[data-test=me-liked-empty]'),
    n: document.querySelectorAll('[data-test=profile-note]').length,
    loading: !!document.querySelector('[data-test=me-liked-loading]'),
  }))()`)
  s.check('「赞过」到达终态（要么列表要么空态，不是永远转圈）',
    !likedShape.loading && (likedShape.list || likedShape.empty), JSON.stringify(likedShape))
  // ⚠️ 演示账号有没有赞过笔记**取决于库里状态**（P37 之后可能被别的测试改过），
  //    所以不断言具体条数，只断「列表存在时条目 ≥1」——
  //    写死条数每加一次测试数据就得重写断言。
  s.check('「赞过」要么有内容要么给空态提示',
    likedShape.empty || likedShape.n >= 1, JSON.stringify(likedShape))

  // 切回笔记
  await s.evaluate("document.querySelector('[data-test=me-tab-notes]').click()")
  await s.waitFor(`document.querySelector('[data-test=me-tab-notes]')
    .getAttribute('aria-selected') === 'true'`, '切回笔记', 10000)
  s.check('切回「笔记」正常',
    (await s.evaluate(`document.querySelector('[data-test=me-tab-notes]')
      .getAttribute('aria-selected')`)) === 'true')

  // ---- 5. 进入编辑，表单回填当前值
  //
  // ⚠️ **P38：编辑表单搬到独立页 `/profile/edit` 了**，「编辑资料」也相应从
  //    `<button @click>` 变成 `<RouterLink to="/profile/edit">`。
  //    所以这里的 `.click()` 仍然是有效的（RouterLink 也能 click），
  //    但**点击后落在另一个路由**，必须等那边的表单出现而不是本页的。
  //    断言一个没改：data-test 全是原样搬过去的（me-form / me-nickname-input /
  //    me-save / me-cancel / me-avatar-* / me-gender-*），只有导航路径变了。
  // ⚠️ **在点击之前**先断「它是个指向独立页的链接」。这条与导航时序无关：
  //    如果改成「点击之后再读 hash」，断言必须排在 waitFor 后面 ——
  //    而 waitFor 超时会**直接抛异常**，那条断言根本没跑到，
  //    失败形式变成「用例执行到底 超时：进入编辑页」，诊断信息比一条精确的
  //    FAIL 差得多（这是本轮做判别力验证时实际踩出来的）。
  const editLink = await s.evaluate(`(() => {
    const e = document.querySelector('[data-test=me-edit]')
    return e ? { tag: e.tagName, href: e.getAttribute('href'),
                 text: (e.textContent || '').trim() } : null
  })()`)
  s.check('「编辑资料」是 <a> 指向独立页（不是 button 就地展开）',
    !!editLink && editLink.tag === 'A' && editLink.href === '#/profile/edit',
    JSON.stringify(editLink))

  await s.evaluate("document.querySelector('[data-test=me-edit]').click()")
  // ⚠️ **必须先 waitFor 再断言**：RouterLink 的导航是**异步**的（push 之后还要
  //    等组件切换），`.click()` 返回那一刻 location.hash 还是旧的。
  //    这里第一次写成「click 完立刻读 hash」，直接读到 `#/profile` 假红 ——
  //    症状是「我明明点了编辑却没跳转」，真因是断言比导航快了一步。
  await s.waitFor(`location.hash === '#/profile/edit'`, '进入编辑页', 10000)
  s.check('「编辑资料」进的是独立页而不是就地展开',
    (await s.evaluate('location.hash')) === '#/profile/edit',
    await s.evaluate('location.hash'))
  await s.waitFor("document.querySelector('[data-test=me-nickname-input]')", '编辑页表单')
  s.check('编辑页有独立的返回键（后退键能退出编辑，P38 的主要动机）',
    await s.evaluate(`!!document.querySelector('[data-test=edit-back]')`))
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
  //
  // ⚠️ P38：保存后**不是「表单收起」而是「回到个人主页」** —— 编辑是独立页，
  //    保存走 router.replace('/profile')。断言跟着改成「回到 #/profile」，
  //    因为那才是现在真实发生的事（改断言不是改实现，理由写在这里）。
  await s.waitFor(`location.hash === '#/profile'`, '保存后回到个人主页', 15000)
  s.check('保存后回到个人主页',
    (await s.evaluate('location.hash')) === '#/profile',
    await s.evaluate('location.hash'))
  // ⚠️ 这里等的是**元素卸载**而不是 hash —— hash 先变、组件后换，
  //    两者之间有一个窗口期，此时 me-form 还在 DOM 里。
  await s.waitFor(`!document.querySelector('[data-test=me-form]')`, '编辑页卸载', 10000)
  s.check('保存后编辑页的表单确实卸载了',
    !(await s.evaluate("!!document.querySelector('[data-test=me-form]')")))
  // 页头昵称同样要等它真的渲染出来再读（hash 到了不等于组件挂好了）
  await s.waitFor("document.querySelector('[data-test=me-nickname]')", '主页昵称渲染', 10000)
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
  await s.waitFor("document.querySelector('[data-test=me-nickname-input]')", '再次进入编辑页')
  await s.waitFor(`location.hash === '#/profile/edit'`, '再次进入编辑页路由', 10000)
  // ⚠️ **必须等预设真的加载完再断言**。presets 是在 onMounted 里**异步**拉的，
  //    而「编辑表单出现」只说明组件挂载了 —— 两者之间有一个窗口期，
  //    那时读到的 `n` 是 0。本轮前几次跑能过纯属时序碰巧，
  //    加了注入测试之后时序一变就连续假红（第一次看到 41/44 还以为产品坏了）。
  await s.waitFor(
    `document.querySelectorAll('[data-test^=me-avatar-0]').length > 0`,
    '预设头像加载完成', 15000)

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
  // ⚠️ P38：取消 = router.back()，所以是**离开编辑页回到个人主页**，
  //    而不是原来那种「就地收起表单」。断言跟着改，理由同上。
  await s.waitFor(`location.hash === '#/profile'`, '取消后回到个人主页', 10000)
  await s.waitFor(`!document.querySelector('[data-test=me-form]')`, '编辑页卸载', 10000)
  await s.waitFor("document.querySelector('[data-test=me-nickname]')", '主页昵称渲染', 10000)
  s.check('取消后回到个人主页且表单卸载',
    (await s.evaluate('location.hash')) === '#/profile'
    && !(await s.evaluate("!!document.querySelector('[data-test=me-form]')")))
  const me2 = await fetchMe(token)
  s.check('取消后昵称没被改（没发请求）', me2?.nickname === NEW_NICK, `实际 ${me2?.nickname}`)
  s.check('取消后表单回填的是库里的值',
    (await s.evaluate("document.querySelector('[data-test=me-nickname]').textContent.trim()")) === NEW_NICK)

  // ---- 11. 还原演示账号 —— **挪到 finally 里了**，见下方注释
} catch (e) {
  s.check('用例执行到底', false, String(e.message))
} finally {
  // ---- 还原演示账号，否则 ui-smoke 的「小哭猫」断言会挂
  //
  // ⚠️⚠️ **这里原来在 try 的末尾，2026-10-18 挪进 finally**。
  // 本轮因为改「编辑资料独立成页」崩了好几次，每次都把演示账号的昵称改成
  // 「小哭猫改名了」留在库里，于是**下一次运行第一条断言就假红**
  // （「昵称加载完成」超时），症状与真正的失败点隔了三十多行，
  // 我为此手工还原了三次 fixture 才反应过来。
  //
  // 这正是 AGENTS P28 记的坑：**清理必须放进 finally** ——
  // 放在 happy path 上就等于「崩了就别还原」，而受害的不是本组，
  // 是后面每一组依赖这个 fixture 的测试。
  //
  // 刻意**用接口还原而不是再驱动一遍表单**：清理动作不该依赖被测对象本身。
  // 万一保存按钮坏了，用 UI 清理就会一起失败。
  // 另外 bio 还原不到 NULL（update-strategy: not_null 传 null 会被剔除），
  // 一旦被写成 '' 就只能一直是 ''；UI 上两者都 falsy，按原值还原即可。
  try {
    const tk = token || await s.evaluate("localStorage.getItem('xk_token')")
    if (!tk || !orig) throw new Error(`还原缺前置：token=${!!tk} orig=${!!orig}`)
    const origNow = await fetchMe(tk)
    if (origNow && origNow.nickname !== orig.nickname) {
      const r = await fetch(`${API}/api/user/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tk}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nickname: orig.nickname,
          gender: orig.gender,
          bio: orig.bio ?? '',
          avatar: orig.avatar ?? '',
        }),
      })
      const j = await r.json()
      if (j.code !== 0) console.warn(`  ⚠ 还原接口返回 code=${j.code} ${j.message}`)
    }
  } catch (e) {
    // ⚠️ **不能空 catch**：本轮就是空 catch 把 ReferenceError 吞了，
    //    表现为「还原跑了但没生效」，fixture 一次次被改坏却没人发现。
    //    打印出来至少下次能一眼看到「还原没生效」。
    console.error('  ✖ 还原演示账号失败：' + String(e.message || e))
  }

  // 控制台错误由 close() 统一断言，别自己再 check 一次，会重复计数
  const allOk = await s.close()
  process.exit(allOk ? 0 : 1)
}
