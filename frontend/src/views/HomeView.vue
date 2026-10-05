<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BizError } from '@/api/request'
import { followUser, unfollowUser } from '@/api/follow'
import { getDiscoverFeed, getFollowFeed } from '@/api/feed'
import { ErrorCode } from '@/api/types'
import type { NoteListItemVO } from '@/api/types'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()
const userStore = useUserStore()

/* ---------------- 搜索入口 ---------------- */

const keyword = ref('')

function goSearch() {
  const kw = keyword.value.trim()
  if (!kw) return
  void router.push({ name: 'search', query: { keyword: kw } })
}

/* ---------------- 关注流 / 发现流 ---------------- */

/**
 * 首页两个 tab：**默认「发现」**。
 *
 * <p>默认发现而不是关注，理由是关注流对「一条关注都没有的新用户」永远是空的，
 * 首页会一片空白（这正是加发现流要解决的问题）。
 */
type FeedTab = 'discover' | 'follow'

const activeTab = ref<FeedTab>('discover')

const feed = ref<NoteListItemVO[]>([])
const feedLoading = ref(true)
const feedError = ref('')
/** 正在处理「关注/取关」的笔记作者 id —— 挡住连点 */
const toggling = ref(new Set<string>())

function isToggling(id: string) {
  return toggling.value.has(id)
}

async function loadFeed() {
  // 记下这次请求是给哪个 tab 发的：请求在飞的时候用户可能又切了 tab，
  // 过期响应**不能**写进列表，否则「关注」tab 下会显示发现流的内容
  // （这机器冷启动首个请求能到 9s，很容易撞上慢响应）
  const tab = activeTab.value
  feedLoading.value = true
  feedError.value = ''
  try {
    const page = tab === 'discover'
      ? await getDiscoverFeed(1, 20)
      : await getFollowFeed(1, 20)
    if (tab !== activeTab.value) return
    feed.value = page.list
  } catch (e) {
    if (tab !== activeTab.value) return
    if (e instanceof BizError) {
      feedError.value = e.message
    } else {
      feedError.value = '加载失败，请稍后重试'
    }
  } finally {
    // 同理：过期的请求不能把「加载中」提前关掉，那会让新请求还在飞的时候
    // 露出上一份数据的空档
    if (tab === activeTab.value) feedLoading.value = false
  }
}

function switchTab(tab: FeedTab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  void loadFeed()
}

/**
 * 卡片上的关注/取关按钮。
 *
 * <p>状态判断只看 item.authorFollowed 这一个后端给的值，请求成功后再用响应
 * 覆盖回同一个字段——和详情页的点赞一致，永远是后端权威值。
 * 取关成功后 <b>不</b> 从列表里移除这条：用户可能只是手滑，或者想先看内容再取关。
 */
async function toggleFollowAuthor(item: NoteListItemVO) {
  if (!item.authorId || isToggling(item.authorId)) return
  toggling.value = new Set(toggling.value).add(item.authorId)
  try {
    const res = item.authorFollowed
      ? await unfollowUser(item.authorId)
      : await followUser(item.authorId)
    item.authorFollowed = res.followed
    // 我的关注数变了，静默刷 store，别让「我的」页显示旧数字
    void userStore.loadProfile().catch(() => {})
  } catch (e) {
    if (e instanceof BizError) {
      // 40001/40002 说明本地状态和后端不一致（多标签页），静默重拉纠正
      if (e.code === ErrorCode.ALREADY_FOLLOWED || e.code === ErrorCode.NOT_FOLLOWED) {
        await loadFeed()
        return
      }
    }
    throw e
  } finally {
    toggling.value = new Set([...toggling.value].filter((id) => id !== item.authorId))
  }
}

async function logout() {
  userStore.logout()
  await router.replace('/login')
}

/* ---------------- 封面真实宽高比（瀑布卡片高度自适应） ---------------- */

/**
 * 封面高度按图片**真实**宽高比自适应，而不是一律裁成 3/4 或方块。
 *
 * <p>VO 里没有图片尺寸，加载前也不知道，所以：未加载时先用 3/4 占位（避免 CLS），
 * `@load` 拿到 naturalWidth/naturalHeight 后改写成真实比例。值写进
 * `coverRatio[id]`，模板上以 `--r` 内联变量喂给 `.cover` 的 `aspect-ratio`。
 *
 * <p>刻意**不用**给 `<img>` 写 width/height 属性：真实比例只有解码后才知道，
 * 写死的值必然是错的（详情页封面同理，见 AGENTS.md）。
 */
const coverRatio = ref<Record<string, string>>({})

function onCoverLoad(item: NoteListItemVO, ev: Event) {
  const img = ev.target as HTMLImageElement
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h || coverRatio.value[item.id]) return
  coverRatio.value = { ...coverRatio.value, [item.id]: `${w} / ${h}` }
}

// 进来先把用户信息拉齐（守卫只校验 token 有没有，资料还是要后端给）
void userStore.loadProfile().catch(() => {
  // token 失效时拦截器已经跳登录页
})

onMounted(loadFeed)
</script>

<template>
  <main class="page">
    <header class="top">
      <span class="brand">毛球喵社</span>
      <ThemeToggle />
    </header>

    <!--
      个人信息卡片：**只在桌面出现**（≥1024 作左栏资料栏，sticky）。
      移动端整块 display:none —— display:none 会同时把它从无障碍树和 Tab 序里
      摘掉，所以读屏不会念、键盘也 tab 不到，这正是要的。
      卡片上的功能在移动端都有别的入口：发布/我的在 TabBar，关注/粉丝/退出在「我的」页。
      ⚠️ 断点归 CSS 媒体查询管，组件不要监听 resize（见 AGENTS.md）。
    -->
    <section class="card xk-card who-card">
      <div class="who">
        <img class="avatar" src="/mascot/m02.webp" alt="" width="62" height="62" />
        <div class="names">
          <h1 class="nickname">{{ userStore.displayName || '加载中…' }}</h1>
          <p class="username">@{{ userStore.userInfo?.username }}</p>
        </div>
      </div>

      <p v-if="userStore.userInfo?.bio" class="bio">{{ userStore.userInfo.bio }}</p>

      <dl class="stats">
        <RouterLink
          v-if="userStore.userInfo"
          class="stat"
          :to="`/follow/${userStore.userInfo.id}`"
          data-test="home-follow"
        >
          <dt>关注</dt>
          <dd>{{ userStore.userInfo.followCount ?? 0 }}</dd>
        </RouterLink>
        <RouterLink
          v-if="userStore.userInfo"
          class="stat"
          :to="`/fans/${userStore.userInfo.id}`"
          data-test="home-fans"
        >
          <dt>粉丝</dt>
          <dd>{{ userStore.userInfo.fansCount ?? 0 }}</dd>
        </RouterLink>
        <div v-if="userStore.userInfo" class="stat plain">
          <dt>获赞</dt>
          <dd>{{ userStore.userInfo.likeReceivedCount ?? 0 }}</dd>
        </div>
      </dl>

      <div class="acts">
        <RouterLink class="xk-btn" to="/publish" data-test="go-publish">
          发布笔记
        </RouterLink>
        <RouterLink class="xk-btn xk-btn--ghost" to="/profile" data-test="go-profile">
          我的
        </RouterLink>
      </div>

      <button class="logout" type="button" data-test="home-logout" @click="logout">
        退出登录
      </button>
    </section>

    <form class="search-row" role="search" data-test="home-search" @submit.prevent="goSearch">
      <input
        v-model="keyword"
        class="search-input"
type="search"
        placeholder="搜个关键词…"
        aria-label="搜索笔记"
        data-test="home-search-input"
      />
      <button class="xk-btn go-search" type="submit" data-test="home-search-btn">搜索</button>
    </form>

    <!--
      关注流不再套外层卡片：条目自己就是卡片（描边 + 硬阴影），
      卡片套卡片会显得又厚又乱（小红书的墙也是直接铺在页面底色上）。
      桌面这里只保留 grid-area 定位。
    -->
    <section class="feed" data-test="feed">
      <!--
        两个 tab 用 <button>：切 tab 是**动作**（要打接口、换数据），
        不是 URL 导航，所以不能是 RouterLink（规则：导航归 a，动作归 button）。
        role="tablist"/"tab" 是为了让读屏知道这是一组可切换的视图。
      -->
      <div class="feed-tabs" role="tablist" aria-label="首页信息流">
        <button
          class="feed-tab"
          :class="{ on: activeTab === 'discover' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'discover'"
          data-test="feed-tab-discover"
          @click="switchTab('discover')"
        >
          发现
        </button>
        <button
          class="feed-tab"
          :class="{ on: activeTab === 'follow' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'follow'"
          data-test="feed-tab-follow"
          @click="switchTab('follow')"
        >
          关注
        </button>
      </div>

      <p v-if="feedLoading" class="hint" data-test="feed-loading">加载中…</p>
      <p v-else-if="feedError" class="hint err" data-test="feed-error">{{ feedError }}</p>
      <p v-else-if="!feed.length" class="hint" data-test="feed-empty">
        {{
          activeTab === 'discover'
            ? '还没有人发布笔记，去发第一条吧'
            : '你还没有关注任何人，去别人主页逛逛吧'
        }}
      </p>

      <ul v-else class="items">
        <li v-for="item in feed" :key="item.id" class="item" data-test="feed-item">
          <!--
            卡片主体是「去详情页」= 导航，用 RouterLink 而不是 button：
            能 cmd/中键点击、能右键在新标签打开、浏览器状态栏能看到目标 URL，
            读屏也会把它念成链接而不是按钮。
            下面的「关注」是真动作（要打接口），仍必须是 button。
            两者是**兄弟节点**而不是嵌套 —— `<a><button>` 是非法嵌套。
          -->
          <RouterLink class="main" :to="`/note/${item.id}`">
            <img
              class="cover"
              :src="item.cover ?? '/mascot/m02.webp'"
              alt=""
              loading="lazy"
              :style="coverRatio[item.id] ? { '--r': coverRatio[item.id] } : undefined"
              @load="onCoverLoad(item, $event)"
            />
            <div class="body">
              <p class="title">{{ item.title }}</p>
              <p class="meta">
                ♥ {{ item.likeCount }} · ★ {{ item.collectCount }} · 评论
                {{ item.commentCount }}
              </p>
            </div>
          </RouterLink>

          <div class="who-line">
            <RouterLink class="author" :to="`/user/${item.authorId}`" data-test="feed-author">
              {{ item.authorNickname }}
            </RouterLink>
            <button
              class="follow"
              :class="{ on: item.authorFollowed }"
              type="button"
              :disabled="isToggling(item.authorId)"
              data-test="feed-follow"
              @click="toggleFollowAuthor(item)"
            >
              {{ item.authorFollowed ? '已关注' : '关注' }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
/* .page 的骨架（padding / gap / max-width / 桌面断点）统一在 main.css，
 * 这里不再重复一份 —— scoped 的 0,2,0 特异性会压过全局 0,1,0 的媒体查询。 */
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: var(--xk-fs-15);
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--xk-text-2);
}

.card {
  padding: var(--xk-card-pad);
}

.who {
  display: flex;
  align-items: center;
  gap: 14px;
}

.avatar {
  width: 62px;
  height: 62px;
  object-fit: contain;
  flex-shrink: 0;
}

.names {
  min-width: 0;
}

.nickname {
  margin: 0;
  font-size: var(--xk-fs-20);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.username {
  margin: 3px 0 0;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
}

.bio {
  margin: 14px 0 0;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-14);
  line-height: 1.6;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 18px 0 0;
  padding: 0;
}

/*
 * 这几格现在是 RouterLink（<a>）而不是 <button>：
 * 「关注/粉丝」是导航，链接语义能带出目标 URL，浏览器状态栏可见、
 * 也能在新标签打开。数字颜色由 .stat dt/dd 自己给，这里只兜底前景色
 * （<button> 默认 buttontext，<a> 由全局 a{color:inherit} 兜住）。
 */
.stat {
  padding: 10px 6px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.12s ease;
}

.stat:hover {
  border-color: var(--xk-amber);
}

.stat .plain {
  cursor: default;
}

.stat dt {
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
}

.stat dd {
  margin: 4px 0 0;
  font-size: var(--xk-fs-17);
  font-weight: 700;
}

.acts {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.acts .xk-btn {
  flex: 1;
}

.logout {
  display: block;
  width: 100%;
  margin-top: 14px;
  padding-top: 14px;
  border: 0;
  border-top: var(--xk-stroke-w) solid var(--xk-border);
  background: none;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
  cursor: pointer;
}

/* ---------------- 搜索入口 ---------------- */

.search-row {
  display: flex;
  gap: 10px;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 14px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text);
  font-size: var(--xk-fs-16);
}

.search-input:focus {
  outline: none;
  border-color: var(--xk-amber);
}

/* width:auto 见 SiteNav .go 的说明：.xk-btn 的 width:100% 会撑满整行并溢出 */
.go-search {
  width: auto;
  flex-shrink: 0;
  height: 42px;
  padding: 0 20px;
}

/* ---------------- 关注流 ---------------- */

.feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/*
  tab 条：两个按钮各 ≥40px 热区（P13 起全站标准），激活态只变字色。
  这不是导航（切 tab 不改 URL，只换接口与列表），所以是 <button> 不是 RouterLink。
*/
.feed-tabs {
  display: flex;
  gap: 8px;
}

.feed-tab {
  flex: 1;
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-15);
  font-weight: 600;
  cursor: pointer;
}

.feed-tab.on {
  color: var(--xk-amber-text);
  border-bottom-color: var(--xk-amber);
}

.feed-tab:hover {
  color: var(--xk-text);
}

.hint {
  margin: 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
  line-height: 1.6;
}

.hint.err {
  color: var(--xk-danger);
}

/*
  关注流 = 双列瀑布（移动端 2 列、桌面 4 列），卡片化描边 + 硬阴影。
  刻意抄小红书：**CSS `columns` 瀑布**而不是 grid —— grid 每行等高，横图会把
  竖图顶出空洞；columns 让每张卡按自己的内容高度落位。
  封面高度按图片**真实**宽高比走（`--r`，@load 时由 JS 写），不再一律裁 3/4。
*/
.items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: block;
  columns: 2;
  column-gap: 10px;
}

.item,
.item:first-child {
  break-inside: avoid;
  margin: 0 0 10px;
  padding: 0;
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: var(--xk-radius-blob);
  background: var(--xk-surface);
  box-shadow: var(--xk-shadow-hard-sm);
  overflow: hidden;
  transition: transform 0.12s ease;
}

.item:hover {
  transform: translate(-2px, -2px);
}

.main {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

/*
  封面：宽 100%、高按真实比例自适应。
  `aspect-ratio: var(--r, 3 / 4)` 里 3/4 只是**加载前**的占位（防 CLS），
  @load 拿到 naturalWidth/Height 后 --r 被改写成真实比例。
  不要写死 height，也不要给 <img> 加 width/height 属性（那是错的值）。
*/
.cover {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: var(--r, 3 / 4);
  object-fit: cover;
  background: var(--xk-surface-2);
}

.body {
  min-width: 0;
  padding: 8px 8px 0;
  display: flex;
  flex-direction: column;
}

.title {
  margin: 0;
  font-size: var(--xk-fs-14);
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* 瀑布列宽比原来窄，标题不换行会溢出 */
  overflow-wrap: anywhere;
}

.meta {
  margin: 4px 0 0;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
  font-variant-numeric: tabular-nums;
}

.who-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px 8px;
}

.author {
  padding: 0;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  cursor: pointer;
}

.follow {
  padding: 4px 14px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-12);
  cursor: pointer;
}

.follow.on {
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  border-color: transparent;
  font-weight: 700;
}

.follow:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ---------------- 移动端隐藏个人信息卡片（<1024） ---------------- */

/*
  资料卡只在桌面作左栏。移动端整块 display:none：它同时退出无障碍树和 Tab 序，
  所以读屏不会念、键盘也 tab 不到。功能入口在 TabBar（发布/我的）与「我的」页
  （关注/粉丝/退出），删掉不会丢功能。
  ⚠️ 断点归 CSS 管，组件不监听 resize（AGENTS.md）。
*/
@media (max-width: 1023px) {
  .who-card {
    display: none;
  }
}

/* ---------------- 桌面端（≥1024px，抄小红书：顶栏在 SiteNav，主体左栏 + 右瀑布） ---------------- */

@media (min-width: 1024px) {
  /*
   * 两栏布局。之前这里是「把手机横排卡片拉到 1160px」，stats 止于 625、
   * acts 起于 853，中间空 228px —— 这就是「只是把尺寸拉大」的实证。
   * 现在改 grid：左 240 资料栏吸顶，右 1fr 瀑布。
   *
   * 没有加任何包裹元素，所以移动端的 DOM 顺序（顶栏→搜索→瀑布）
   * 一个字节都没动；这里只是换掉 .page 在桌面的布局方式。
   */
  .page {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-areas:
      'top   top'
      'who   feed';
    align-items: start;
    column-gap: 24px;
    row-gap: 20px;
  }

  /* 品牌、主题切换与搜索都上移到 SiteNav，首页不再重复一条 */
  .top,
  .search-row {
    display: none;
  }

  .who-card {
    grid-area: who;
    position: sticky;
    top: 68px;
    display: flex;
    flex-direction: column;
    padding: 20px;
  }

  .feed {
    grid-area: feed;
  }

  /* 侧栏 200px 内容宽放不下并排的两个按钮，改成上下堆叠 */
  .acts {
    flex-direction: column;
    width: auto;
  }

  /* 瀑布列数 2 → 4，卡片样式已在基础规则里（移动端同款），这里只改列宽间距 */
  .items {
    columns: 4;
    column-gap: 20px;
  }

  .item,
  .item:first-child {
    margin: 0 0 20px;
  }

  .body {
    padding: 12px 12px 0;
  }

  .title {
    font-size: var(--xk-fs-15);
  }

  .who-line {
    padding: 0 12px 12px;
  }
}

.author:hover {
  color: var(--xk-amber);
}

.follow:hover:not(:disabled) {
  border-color: var(--xk-amber);
}
</style>