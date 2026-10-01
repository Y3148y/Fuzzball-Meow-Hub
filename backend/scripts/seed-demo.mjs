/**
 * 演示种子数据（P12-C Track 0）。
 *
 * 为什么要有这个：库里原来那 113 篇「演示数据」其实是测试垃圾 ——
 * `xiaoku_demo` 53 篇的封面是 `makePng()` 生成的 **8×8 纯色 PNG**（74 字节），
 * 标题是「幂等CDP5gl1zC」「title222」。放进 3:4 的封面格里要放大 47 倍，
 * 任何设计摆在这一屏色块上都丑。本脚本用真实封面 + 自然口吻的正文换掉它们。
 *
 * 做法（全程零新依赖，全部走**真实 API**，后端一行不改）：
 *   1. 复用 `frontend/scripts/ui-cdp.mjs` 开一个 headless Chrome
 *   2. 在页面里 `import('/src/utils/textCard.ts')` 调 `brandCoverBlob`
 *      生成 1080×1440（真 3:4）的品牌封面 —— 让 Vite 来转译 TS，
 *      Node 侧就不需要 canvas / TS 编译器
 *   3. `POST /api/note/image` 上传 → `POST /api/note/publish` 发布
 *   4. 建关注关系，最后 `POST /api/search/reindex` 让 ES 跟上
 *
 * 限流（实测以后端 `@RateLimit` 为准）：image 30/min、publish 20/min 按 USER 计，
 * register 10/min 按 IP 计。每篇 1~3 张图、每个账号 3 篇，单账号峰值 9 次上传，
 * 都在额度内；仍然逐次 sleep 兜底 —— 打回 429 时先怀疑这里的节奏，不是后端。
 *
 * 幂等：按标题跳过已存在的笔记，可重复跑。
 *
 * 用法：
 *   node backend/scripts/seed-demo.mjs
 *   前置：前端 5180 + 后端 8088 都在跑
 */
import { createSession, preflight } from '../../frontend/scripts/ui-cdp.mjs'

const BASE = 'http://localhost:5180'
const PASSWORD = 'Xk@123456'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 七个账号。密码统一，方便手工复现（都是 `xk_seed_` / 演示号，不是真实用户）。
 *
 * 标题刻意避开「笔记 / 测试 / 关注」三个词：ui-search 断言
 * `搜索结果第一张卡 === 'P6 关注流测试笔记'`，种子内容要是吃了这些词，
 * ik_smart 切出来的 token 会跟它抢相关度。
 */
const ACCOUNTS = [
  {
    username: 'xk_seed_lulu',
    nickname: '露露',
    bio: '把日子过慢一点，周末都在公园长椅上',
    notes: [
      { title: '周末去了趟西郊公园，樱花只谢了一半', content: '下午三点到的，风一吹花瓣整片往下落。坐在长椅上发了半小时呆，什么都没干，反而觉得这一周值了。\n下次准备带块野餐垫，东门那片草坪人少。', images: 1, mascot: 0 },
      { title: '我家猫主子的三层猫爬架，装完它只爱最底下那层', content: '花三百多买的三层，装了两个小时。结果它视察了一圈，钻进最下面那层的纸箱里睡着了——纸箱是赠品。', images: 3, mascot: 2 },
      { title: '把工位收拾成了咖啡角', content: '一台手冲壶、一个分享壶、两只杯子，抽屉里塞三条挂耳。同事下午都往我这儿凑。\n预算三百，幸福感翻倍。', images: 1, mascot: 4 },
    ],
  },
  {
    username: 'xk_seed_meow',
    nickname: '喵酱',
    bio: '两只猫，一个阳台，四季都有光',
    notes: [
      { title: '阳台改造花了 480 块，值不值', content: '防腐木地板 260，花架 120，剩下的买了三盆绿萝。铺完那天猫直接趴上去不走了。\n雨天记得收垫子，我第一周就淋湿了一张。', images: 3, mascot: 1 },
      { title: '换季收纳：羽绒服这样压不跑绒', content: '别用真空袋压到极限，绒会被压断。折叠后卷起来放进收纳箱，留一点空气，来年拿出来还是蓬的。\n我这件已经第三个冬天了。', images: 1, mascot: 3 },
      { title: '我的猫一天睡 16 小时，剩下的时间在监工', content: '写它的时候它正坐在键盘旁边看着我，一动不动。\n养猫之后才知道，陪伴可以这么安静。', images: 1, mascot: 5 },
    ],
  },
  {
    username: 'xk_seed_vivi',
    nickname: '维维',
    bio: '158cm，踩过的穿搭坑比衣服还多',
    notes: [
      { title: '通勤穿搭：一周五天不重样', content: '周一衬衫加直筒裤，周二针织衫配半裙……核心是只留三个颜色，怎么搭都不出错。\n鞋只带两双，一黑一米白。', images: 1, mascot: 6 },
      { title: '小个子怎么挑阔腿裤，坑我都替你踩了', content: '裤长一定要在脚踝上方，拖地的会把人压矮。高腰、垂坠面料、无褶，这三点满足两条就能穿。\n我 158，这条 98 厘米的刚好。', images: 3, mascot: 7 },
      { title: '这件米色风衣我等了整整一季', content: '春天没舍得买，秋天降价立刻拿下。版型挺，肩线正，里面套薄毛衣也不鼓。\n脏了送干洗，别自己水洗。', images: 1, mascot: 8 },
    ],
  },
  {
    username: 'xk_seed_reader',
    nickname: '读书的阿囤',
    bio: '一年四十本，慢慢读',
    notes: [
      { title: '读完《置身事内》，终于懂了地方财政', content: '以前看新闻只觉得「又发债了」，看完这本书才知道钱从哪来、花到哪去。\n前两章偏制度，熬过去后面很好读。', images: 1, mascot: 9 },
      { title: '书桌上的三盏灯，护眼排序实测', content: '台灯放左边（我是右撇子）、屏幕挂灯开暖光、顶灯开最亮一档。三盏一起开，手影几乎消失。\n之前只开顶灯，下午眼睛发酸。', images: 3, mascot: 10 },
      { title: '一本被低估的短篇集，两天读完', content: '每篇都不长，适合睡前一篇。写的是小城里的普通人，没有大起大落，但读完心里发闷。\n最后一篇我重读了一遍。', images: 1, mascot: 2 },
    ],
  },
  {
    username: 'xk_seed_cook',
    nickname: '小锅',
    bio: '下班二十分钟能吃到的都算好菜',
    notes: [
      { title: '下班 20 分钟：番茄鸡蛋面的正确顺序', content: '鸡蛋先炒盛出，番茄炒到出沙再加水，水开下面，最后把鸡蛋回锅。\n顺序错了，汤就不是那个味。', images: 1, mascot: 0 },
      { title: '电饭煲做卤肉饭，不用看火', content: '五花肉焯水，跟调料一起丢进电饭煲，按煮饭键两次。第二次跳闸时肉已经软了。\n配米饭和焯过的小青菜，一个人吃得很满足。', images: 3, mascot: 3 },
      { title: '买菜 App 实测：哪家的叶菜最新鲜', content: '连续两周同一天下单对比，生菜和空心菜的损耗差别最大。远的那家次日达，叶尖会发蔫。\n现在固定在一家买，凑单免运费。', images: 1, mascot: 5 },
    ],
  },
  {
    username: 'xk_seed_travel',
    nickname: '远方',
    bio: '两天能来回的地方都叫附近',
    notes: [
      { title: '高铁两小时能到的海边，周末就够', content: '周五晚上出发，第二天早上到，光脚踩一圈水再回来。住宿选在车站附近，不用拖着箱子走很远。\n记得带拖鞋，沙滩边买要二十。', images: 1, mascot: 6 },
      { title: '民宿踩雷记：订之前一定看这三点', content: '一看差评有没有老板回复，二看卫生间实拍，三看位置是不是在山里。\n上一家网图好看，实际窗户对着墙。', images: 3, mascot: 8 },
      { title: '徒步鞋选了半年，这双最跟脚', content: '重点是后跟要锁得住，下坡脚趾才不顶。我脚背高，系带孔多两排的那款更舒服。\n新鞋先在家穿两天再上山。', images: 1, mascot: 10 },
    ],
  },
  {
    username: 'xiaoku_demo',
    nickname: '小哭猫',
    bio: '我是演示账号，随便看看～',
    notes: [
      { title: '第一次露营，装备清单和实际用上的', content: '买了一堆，真正用上的就五样：帐篷、地垫、睡袋、头灯、水壶。\n折叠桌可带可不带，我在石头上吃了饭。', images: 1, mascot: 4 },
      { title: '拍了三年街头，我最常用的两个焦段', content: '35 走近拍，55 站着等。定焦逼我挪脚，出片反而多了。\n阴天比晴天好拍，光不刺眼。', images: 3, mascot: 7 },
      { title: '纯文字：今天只想说三句话', content: '一、饭要趁热吃。二、觉要睡够。三、剩下的明天再说。', textCard: true },
      { title: '城市骑行 12 公里，风比想象里大', content: '沿河那条道，去的时候顶风，回来顺风。平均时速 18，屁股比腿先累。\n头盔和手套真的不能省。', images: 1, mascot: 9 },
    ],
  },
]

/**
 * 关注关系：演示号关注全部种子号（首页关注流要非空），种子号之间围一圈互关。
 *
 * <b>刻意不让任何种子号回关演示号</b>：`ui-follow` 有一条断言
 * 「没人关注演示账号 → 粉丝空态」，种子一旦回关，演示号就有 6 个粉丝，
 * 那条断言立刻挂。粉丝数这个口径只能为 0。
 */
function followPlan(ids) {
  const demo = ids.xiaoku_demo
  const seeds = ACCOUNTS.filter((a) => a.username.startsWith('xk_seed_')).map((a) => a.username)
  const edges = []
  for (const u of seeds) edges.push([demo, ids[u]]) // demo → 每个种子
  for (let i = 0; i < seeds.length; i++) {
    const a = ids[seeds[i]]
    const b = ids[seeds[(i + 1) % seeds.length]]
    edges.push([a, b]) // 种子之间围一圈，作者主页/关注页不至于只有一条
  }
  return edges
}

async function main() {
  await preflight()
  const s = await createSession({ name: 'seed' })
  const log = (m) => console.log(`  · ${m}`)

  try {
    await s.goto(`${BASE}/#/login`)
    await s.waitFor("document.querySelector('.demo')", '登录页挂载', 30000)

    /* ---- 页面侧工具：注册 / 登录 / 生成封面 / 上传 / 发布 ---- */
    await s.evaluate(`
      window.__xk = (() => {
        const json = async (method, path, body) => {
          const token = localStorage.getItem('xk_token')
          const headers = { 'Content-Type': 'application/json' }
          if (token) headers.Authorization = 'Bearer ' + token
          const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined })
          return r.json()
        }
        const b64 = async (blob) => {
          const buf = new Uint8Array(await blob.arrayBuffer())
          let s = ''
          for (let i = 0; i < buf.length; i += 0x8000) {
            s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
          }
          return btoa(s)
        }
        return {
          json,
          register: (u, p, nick) => json('POST', '/api/user/register', { username: u, password: p, nickname: nick }),
          login: async (u, p) => {
            const j = await json('POST', '/api/user/login', { username: u, password: p })
            if (j.code === 0 && j.data?.accessToken) {
              localStorage.setItem('xk_token', j.data.accessToken)
              if (j.data.refreshToken) localStorage.setItem('xk_refresh_token', j.data.refreshToken)
            }
            return j
          },
          /**
           * 换「谁在操作」，但不打登录接口 —— 登录限流 60 次/分钟（按 IP），
           * 这个脚本要切上百次身份，全走 login 一定撞墙。
           * 令牌在 Node 侧缓存，这里只改 localStorage，后续请求的
           * Authorization 头由 request 层自己从 xk_token 取。
           */
          setTok: (t) => localStorage.setItem('xk_token', t),
          me: () => json('GET', '/api/user/me'),
          myNotes: async () => {
            const me = await json('GET', '/api/user/me')
            if (me.code !== 0) return []
            const p = await json('GET', '/api/note/user/' + me.data.id + '?page=1&size=50')
            return (p.data && p.data.list ? p.data.list : []).map((n) => n.title)
          },
          follow: (id) => json('PUT', '/api/follow/' + id),
          like: (id) => json('PUT', '/api/note/' + id + '/like'),
          publish: (body) => json('POST', '/api/note/publish', body),
          reindex: () => json('POST', '/api/search/reindex'),

          /**
           * 生成封面 + 上传，一次调用做完。
           * specs: [{ mascot, variant, text }]
           *   - textCard:true 表示走 textCardBlobs（纯文字卡），不是品牌封面
           */
          makeImages: async (specs) => {
            const token = localStorage.getItem('xk_token')
            const mod = await import('/src/utils/textCard.ts')
            const urls = []
            for (const spec of specs) {
              let blob
              if (spec.textCard) {
                const blobs = await mod.textCardBlobs(spec.title, spec.content, 'light')
                blob = blobs[0]
              } else {
                blob = await mod.brandCoverBlob({
                  title: spec.title,
                  mascotUrl: '/mascot/m' + String((spec.mascot % 11) + 1).padStart(2, '0') + '.webp',
                  theme: 'light',
                  variant: spec.variant,
                })
              }
              const form = new FormData()
              form.append('file', new Blob([blob], { type: 'image/png' }), 'cover.png')
              const r = await fetch('/api/note/image', {
                method: 'POST',
                headers: token ? { Authorization: 'Bearer ' + token } : {},
                body: form,
              })
              const j = await r.json()
              if (j.code !== 0) throw new Error('上传失败 code=' + j.code + ' ' + (j.message || ''))
              urls.push(j.data.url)
              await new Promise((res) => setTimeout(res, 400))
            }
            return urls
          },
        }
      })()
    `)

    /* ---- 1. 账号：注册（已存在则登录），顺手收集 id 与令牌 ---- */
    const ids = {}
    const tokens = {}
    for (const acc of ACCOUNTS) {
      const reg = await s.evaluate(
        `window.__xk.register(${JSON.stringify(acc.username)}, ${JSON.stringify(PASSWORD)}, ${JSON.stringify(acc.nickname)})`,
      )
      if (reg.code !== 0 && reg.code !== 10003) {
        throw new Error(`注册 ${acc.username} 失败: ${reg.code} ${reg.message}`)
      }
      const login = await s.evaluate(`window.__xk.login(${JSON.stringify(acc.username)}, ${JSON.stringify(PASSWORD)})`)
      if (login.code !== 0) {
        throw new Error(
          `登录 ${acc.username} 失败: ${login.code} ${login.message}\n` +
            `  若是「用户名或密码错误」，说明这个账号是旧脚本建的、口令不同 —— ` +
            `先把 xk_seed_* / ct* / idem* 连同它们的笔记清掉再重跑。`,
        )
      }
      tokens[acc.username] = login.data.accessToken
      const me = await s.evaluate('window.__xk.me()')
      if (me.code !== 0) throw new Error(`取资料失败: ${me.code}`)
      ids[acc.username] = me.data.id
      log(`账号就绪 ${acc.username} (${acc.nickname}) id=${ids[acc.username]}`)
      await sleep(300)
    }

    /* ---- 2. 笔记：按标题跳过已存在的（幂等） ---- */
    let created = 0
    let skipped = 0
    for (const acc of ACCOUNTS) {
      await s.evaluate(`window.__xk.setTok(${JSON.stringify(tokens[acc.username])})`)
      const existing = await s.evaluate('window.__xk.myNotes()')

      for (const note of acc.notes) {
        if (existing.includes(note.title)) {
          skipped++
          continue
        }
        const specCount = note.textCard ? 1 : note.images
        const specs = []
        for (let i = 0; i < specCount; i++) {
          specs.push(
            note.textCard
              ? { textCard: true, title: note.title, content: note.content }
              : { title: note.title, mascot: (note.mascot ?? 0) + i, variant: (note.mascot ?? 0) % 3 },
          )
        }
        let urls
        try {
          urls = await s.evaluate(`window.__xk.makeImages(${JSON.stringify(specs)})`)
        } catch (e) {
          console.log(`  ! 封面生成/上传失败（${acc.username} / ${note.title}）: ${String(e.message).slice(0, 160)}`)
          await sleep(2000)
          continue
        }
        const pub = await s.evaluate(
          `window.__xk.publish(${JSON.stringify({ title: note.title, content: note.content, imageUrls: urls })})`,
        )
        if (pub.code !== 0) {
          console.log(`  ! 发布失败 ${acc.username} / ${note.title}: ${pub.code} ${pub.message}`)
        } else {
          created++
          log(`发布 ${acc.username}: ${note.title} (${urls.length} 图)`)
        }
        await sleep(600)
      }
      await sleep(400)
    }

    /* ---- 3. 关注关系（幂等：重复关注后端回 40003，忽略即可） ---- */
    const edges = followPlan(ids)
    let followed = 0
    for (const [from, to] of edges) {
      // 关注是「以 from 的身份」操作：换他的令牌（不打登录接口，见 setTok 注释）
      const fromUser = ACCOUNTS.find((a) => ids[a.username] === from)
      await s.evaluate(`window.__xk.setTok(${JSON.stringify(tokens[fromUser.username])})`)
      const r = await s.evaluate(`window.__xk.follow(${JSON.stringify(String(to))})`)
      if (r.code === 0) followed++
      await sleep(150)
    }
    log(`关注关系新增 ${followed} 条（已存在的被 40003 跳过）`)

    /* ---- 4. 点赞：让卡片上的数字不是清一色 0（like 无限流） ---- */
    const allNotes = []
    for (const acc of ACCOUNTS) {
      await s.evaluate(`window.__xk.setTok(${JSON.stringify(tokens[acc.username])})`)
      const p = await s.evaluate(
        `window.__xk.json('GET', '/api/note/user/' + ${JSON.stringify(String(ids[acc.username]))} + '?page=1&size=50')`,
      )
      for (const n of (p.data && p.data.list) || []) allNotes.push({ id: n.id, author: acc.username })
      await sleep(150)
    }

    let liked = 0
    for (let i = 0; i < allNotes.length; i++) {
      const note = allNotes[i]
      // 每篇找 3 个「不是作者」的账号来点赞
      const voters = ACCOUNTS.map((a) => a.username).filter((u) => u !== note.author).slice(i % 4, (i % 4) + 3)
      for (const v of voters) {
        await s.evaluate(`window.__xk.setTok(${JSON.stringify(tokens[v])})`)
        const r = await s.evaluate(`window.__xk.like(${JSON.stringify(String(note.id))})`)
        if (r.code === 0) liked++
        await sleep(160)
      }
    }
    log(`点赞 ${liked} 次`)

    /* ---- 5. ES 重建（删过测试笔记，索引里还有孤儿文档） ---- */
    await s.evaluate(`window.__xk.setTok(${JSON.stringify(tokens.xiaoku_demo)})`)
    const re = await s.evaluate('window.__xk.reindex()')
    log(`reindex: ${re.code === 0 ? 'ok, indexed=' + (re.data && re.data.indexed) : re.code + ' ' + re.message}`)

    console.log(`\n完成：新建 ${created} 篇、跳过已存在 ${skipped} 篇、关注新增 ${followed} 条`)
  } finally {
    await s.close()
  }
}

await main()
