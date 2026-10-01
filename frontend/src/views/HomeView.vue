<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BizError } from '@/api/request'
import { followUser, unfollowUser } from '@/api/follow'
import { getFollowFeed } from '@/api/feed'
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

/* ---------------- 关注流 ---------------- */

const feed = ref<NoteListItemVO[]>([])
const feedLoading = ref(true)
const feedError = ref('')
/** 正在处理「关注/取关」的笔记作者 id —— 挡住连点 */
const toggling = ref(new Set<string>())

function isToggling(id: string) {
  return toggling.value.has(id)
}

async function loadFeed() {
  feedLoading.value = true
  feedError.value = ''
  try {
    const page = await getFollowFeed(1, 20)
    feed.value = page.list
  } catch (e) {
    if (e instanceof BizError) {
      feedError.value = e.message
    } else {
      feedError.value = '加载失败，请稍后重试'
    }
  } finally {
    feedLoading.value = false
  }
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

function goAuthor(userId: string) {
  if (userId) void router.push(`/user/${userId}`)
}

function goNote(id: string) {
  void router.push(`/note/${id}`)
}

async function logout() {
  userStore.logout()
  await router.replace('/login')
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

    <section class="card xk-card who-card">
      <div class="who">
        <img class="avatar" src="/mascot/m02.webp" alt="" />
        <div class="names">
          <h1 class="nickname">{{ userStore.displayName || '加载中…' }}</h1>
          <p class="username">@{{ userStore.userInfo?.username }}</p>
        </div>
      </div>

      <p v-if="userStore.userInfo?.bio" class="bio">{{ userStore.userInfo.bio }}</p>

      <dl class="stats">
        <button
          v-if="userStore.userInfo"
          class="stat"
          type="button"
          data-test="home-follow"
          @click="router.push(`/follow/${userStore.userInfo!.id}`)"
        >
          <dt>关注</dt>
          <dd>{{ userStore.userInfo.followCount ?? 0 }}</dd>
        </button>
        <button
          v-if="userStore.userInfo"
          class="stat"
          type="button"
          data-test="home-fans"
          @click="router.push(`/fans/${userStore.userInfo!.id}`)"
        >
          <dt>粉丝</dt>
          <dd>{{ userStore.userInfo.fansCount ?? 0 }}</dd>
        </button>
        <div v-if="userStore.userInfo" class="stat plain">
          <dt>获赞</dt>
          <dd>{{ userStore.userInfo.likeReceivedCount ?? 0 }}</dd>
        </div>
      </dl>

      <div class="acts">
        <button class="xk-btn" type="button" data-test="go-publish" @click="router.push('/publish')">
          发布笔记
        </button>
        <button
          class="xk-btn xk-btn--ghost"
          type="button"
          data-test="go-profile"
          @click="router.push('/profile')"
        >
          我的
        </button>
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
        placeholder="搜索笔记…"
        data-test="home-search-input"
      />
      <button class="xk-btn go-search" type="submit" data-test="home-search-btn">搜索</button>
    </form>

    <section class="card xk-card xk-card--flat feed" data-test="feed" style="padding-top: 14px">
      <h2 class="feed-title">关注的人刚发的笔记</h2>

      <p v-if="feedLoading" class="hint" data-test="feed-loading">加载中…</p>
      <p v-else-if="feedError" class="hint err" data-test="feed-error">{{ feedError }}</p>
      <p v-else-if="!feed.length" class="hint" data-test="feed-empty">
        你还没有关注任何人，去别人主页逛逛吧
      </p>

      <ul v-else class="items">
        <li v-for="item in feed" :key="item.id" class="item" data-test="feed-item">
          <button class="main" type="button" @click="goNote(item.id)">
            <img class="cover" :src="item.cover ?? '/mascot/m02.webp'" alt="" loading="lazy" />
            <div class="body">
              <p class="title">{{ item.title }}</p>
              <p class="meta">
                ♥ {{ item.likeCount }} · ★ {{ item.collectCount }} · 评论
                {{ item.commentCount }}
              </p>
            </div>
          </button>

          <div class="who-line">
            <button class="author" type="button" data-test="feed-author" @click="goAuthor(item.authorId)">
              {{ item.authorNickname }}
            </button>
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
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--xk-text-2);
}

.card {
  padding: 18px;
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
  font-size: 21px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.username {
  margin: 3px 0 0;
  color: var(--xk-text-3);
  font-size: 13px;
}

.bio {
  margin: 14px 0 0;
  color: var(--xk-text-2);
  font-size: 14px;
  line-height: 1.6;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 18px 0 0;
  padding: 0;
}

.stat {
  padding: 10px 6px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  text-align: center;
  cursor: pointer;
}

.stat:hover {
  border-color: var(--xk-amber);
}

.stat .plain {
  cursor: default;
}

.stat dt {
  color: var(--xk-text-3);
  font-size: 12px;
}

.stat dd {
  margin: 4px 0 0;
  font-size: 18px;
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
  font-size: 13px;
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
  font-size: 14px;
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

.feed-title {
  margin: 0;
  font-size: 15px;
}

.hint {
  margin: 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: 13px;
  line-height: 1.6;
}

.hint.err {
  color: var(--xk-danger);
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.item {
  padding: 12px 0;
  border-top: var(--xk-stroke-w) solid var(--xk-border);
}

.item:first-child {
  border-top: 0;
}

.main {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.cover {
  width: 84px;
  height: 84px;
  object-fit: cover;
  border-radius: var(--xk-radius-blob-sm);
  flex-shrink: 0;
  background: var(--xk-surface-2);
}

.body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meta {
  margin: 0;
  color: var(--xk-text-3);
  font-size: 12px;
}

.who-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.author {
  padding: 0;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: 13px;
  cursor: pointer;
}

.follow {
  padding: 4px 14px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: 12px;
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

/* ---------------- 桌面端（≥1024px，抄小红书：顶栏在 SiteNav，主体左栏 + 右瀑布） ---------------- */

@media (min-width: 1024px) {
  /*
   * 两栏布局。之前这里是「把手机横排卡片拉到 1160px」，stats 止于 625、
   * acts 起于 853，中间空 228px —— 这就是「只是把尺寸拉大」的实证。
   * 现在改 grid：左 240 资料栏吸顶，右 1fr 瀑布。
   *
   * 没有加任何包裹元素，所以移动端的 DOM 顺序（顶栏→卡片→搜索→瀑布）
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

  /* 关注流改 CSS columns 瀑布（正是小红书的墙感），类名与 data-test 全部不动 */
  .items {
    display: block;
    columns: 4;
    column-gap: 20px;
  }

  .item,
  .item:first-child {
    break-inside: avoid;
    margin: 0 0 20px;
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
    flex-direction: column;
    gap: 0;
  }

  .cover {
    width: 100%;
    height: auto;
    aspect-ratio: 3 / 4;
    border-radius: 0;
  }

  .body {
    padding: 12px 12px 0;
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