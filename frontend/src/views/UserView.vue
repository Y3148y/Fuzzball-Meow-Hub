<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showSuccessToast, showToast } from 'vant'
import { BizError } from '@/api/request'
import { followUser, getUserFollowStatus, unfollowUser } from '@/api/follow'
import { blockUser, unblockUser } from '@/api/report'
import type { ReportTarget } from '@/api/report'
import { getUserNotes } from '@/api/feed'
import { ErrorCode } from '@/api/types'
import type { FollowUserVO, NoteListItemVO } from '@/api/types'
import { useUserStore } from '@/stores/user'
import MoreSheet, { type MoreAction } from '@/components/MoreSheet.vue'
import ReportSheet from '@/components/ReportSheet.vue'
import { useReportSheet } from '@/composables/useReportSheet'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/** route.params 已是 string，不要 Number()：雪花 ID 会丢精度 */
const userId = String(route.params.id)

const author = ref<FollowUserVO | null>(null)
const notes = ref<NoteListItemVO[]>([])
const loading = ref(true)
const notFound = ref(false)
const errorMsg = ref('')
const following = ref(false)

/* ============ P18 拉黑与举报（P21 改了入口位置） ============ */

const blocking = ref(false)
const blocked = ref(false)
const reportSheet = useReportSheet()

/** 「⋯」浮层的动作项 */
const moreActions = computed<MoreAction[]>(() =>
  isSelf.value
    ? []
    : [
        { key: 'report', label: '举报', danger: true, subname: '举报 TA 的某条笔记' },
        {
          key: 'block',
          label: blocked.value ? '解除拉黑' : '拉黑',
          danger: !blocked.value,
          subname: blocked.value ? '解除后重新看到 TA 的内容' : 'TA 从你的世界里消失',
        },
      ],
)

function onMore(key: string) {
  if (key === 'report') {
    // 目标列表是本地从这个账号的笔记里拼的：后端只有「举报某条笔记」这一个入口。
    // 注意是「这个账号的」笔记而不是「TA 的全部」—— 一次给 10 条够了，
    // 再多就成翻页了，而举报本来也不是批量动作。
    void reportSheet.openReport(1, notes.value.slice(0, 10) as ReportTarget[], `举报「${author.value?.nickname}」`)
  } else if (key === 'block') {
    void toggleBlock()
  }
}

async function toggleBlock() {
  if (blocking.value) return
  blocking.value = true
  try {
    if (blocked.value) {
      await unblockUser(userId)
      blocked.value = false
      showSuccessToast('已解除拉黑')
    } else {
      await blockUser(userId)
      blocked.value = true
      showSuccessToast('已拉黑')
      // 拉黑之后这个主页本来就不该再看下去了：留在页面上会让用户以为
      // 「拉黑只是隐藏了内容」而不是「TA 从我的世界里消失了」
      router.back()
    }
  } catch (e) {
    showToast(e instanceof BizError ? e.message : '操作失败，请稍后重试')
  } finally {
    blocking.value = false
  }
}

const isSelf = computed(() => !!userStore.userInfo && userId === userStore.userInfo.id)

async function load() {
  loading.value = true
  notFound.value = false
  errorMsg.value = ''
  try {
    const [card, page] = await Promise.all([
      getUserFollowStatus(userId),
      getUserNotes(userId, 1, 20),
    ])
    author.value = card
    notes.value = page.list
  } catch (e) {
    if (e instanceof BizError) {
      if (e.code === ErrorCode.USER_NOT_FOUND) {
        notFound.value = true
        errorMsg.value = '用户不存在'
      } else if (e.code === ErrorCode.UNAUTHORIZED || e.code === ErrorCode.TOKEN_INVALID) {
        errorMsg.value = '登录已过期，请重新登录'
      } else {
        errorMsg.value = e.message
      }
    } else {
      errorMsg.value = '加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

async function toggleFollow() {
  if (!author.value || following.value) return
  following.value = true
  try {
    const res = author.value.followed
      ? await unfollowUser(author.value.id)
      : await followUser(author.value.id)
    author.value.followed = res.followed
    void userStore.loadProfile().catch(() => {})
  } catch (e) {
    if (e instanceof BizError) {
      if (e.code === ErrorCode.ALREADY_FOLLOWED || e.code === ErrorCode.NOT_FOLLOWED) {
        await load()
        return
      }
    }
    throw e
  } finally {
    following.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <span class="brand">TA 的主页</span>
      <!--
        「⋯」放**顶栏**而不是头部那一行（对齐小红书：它的「⋯」在页面右上角）。
        放头部的话，240px 的侧栏要塞下 头像62 + 昵称 + 用户名 + 关注75 + ⋯40
        + 两个 gap28 = 205px，而可用只有 190px —— 用户名被压成负宽度后溢出
        （P21 手测实测 overflow=27px）。而且「⋯」本来就不属于那一行。
      -->
      <MoreSheet
        v-if="!isSelf"
        :actions="moreActions"
        label="TA 的操作"
        testid="user-more"
        @select="onMore"
      />
    </header>

    <p v-if="loading" class="hint" data-test="user-loading">加载中…</p>
    <p v-else-if="errorMsg" class="hint err" role="alert" data-test="user-error">{{ errorMsg }}</p>

    <template v-else-if="author">
      <section class="card xk-card">
        <div class="who">
          <img class="avatar" src="/mascot/m02.webp" alt="" width="62" height="62" />
          <div class="names">
            <h1 class="nickname" data-test="user-nickname">{{ author.nickname }}</h1>
            <p class="username" data-test="user-username">@{{ author.username }}</p>
          </div>
          <button
            v-if="!isSelf"
            class="follow"
            :class="{ on: author.followed }"
            type="button"
            :disabled="following"
            data-test="user-follow"
            @click="toggleFollow"
          >
            {{ author.followed ? '已关注' : '关注' }}
          </button>

          <!--
            拉黑。刻意做成**文字链接**而不是第二个实心按钮：
            关注是社交动作、拉黑是私人屏蔽，两者放在同一个视觉层级上
            会让人以为「拉黑」是「关注」的一部分。
          -->
          <!--
            P21：拉黑与举报**移出头部**，收进右上角「⋯」浮层。

            原来是两个 .blockbtn 文字链接平铺在这一行 flex 里，头部要塞下
            「62px 头像 + 昵称 + 用户名 + 关注钮 + 拉黑 + 举报」六个元素 ——
            430px 下 .names 被压到接近 0 宽，@xk_ui_follow（13 字符）直接压在
            「已关注」钮下面，而「拉黑」「举报」被压扁后 CJK 逐字折行
            （截图里变成上下两个「拉」「黑」并被卡片裁掉）。

            查证小红书的做法（2026-10-08）：头部**只有「关注」**，
            拉黑与举报都在右上角「⋯」的浮层里。所以这里是**删掉**而不是修 CSS。
          -->
        </div>

        <!-- 举报弹窗（三个入口共用：这里 / 笔记详情页 / 评论项） -->
        <ReportSheet />

        <p v-if="author.bio" class="bio" data-test="user-bio">{{ author.bio }}</p>

        <dl class="stats">
          <div class="stat">
            <dt>关注</dt>
            <dd data-test="user-follow-count">{{ author.followCount ?? 0 }}</dd>
          </div>
          <div class="stat">
            <dt>粉丝</dt>
            <dd data-test="user-fans-count">{{ author.fansCount ?? 0 }}</dd>
          </div>
          <div class="stat">
            <dt>获赞</dt>
            <dd data-test="user-like-count">{{ author.likeReceivedCount ?? 0 }}</dd>
          </div>
        </dl>
      </section>

      <section class="card xk-card xk-card--flat feed">
        <h2 class="feed-title">TA 的笔记</h2>
        <p v-if="!notes.length" class="hint" data-test="user-notes-empty">还没有发过笔记</p>
        <ul v-else class="items" data-test="user-notes">
          <li v-for="item in notes" :key="item.id" class="item" data-test="user-note">
            <RouterLink class="main" :to="`/note/${item.id}`">
              <img class="cover" :src="item.cover ?? '/mascot/m02.webp'" alt="" loading="lazy" />
              <div class="body">
                <p class="title">{{ item.title }}</p>
                <p class="meta">
                  ♥ {{ item.likeCount }} · ★ {{ item.collectCount }} · 评论 {{ item.commentCount }}
                </p>
              </div>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style scoped>

/* .page 骨架统一在 main.css，这里重复写会用 0,2,0 特异性压掉全局断点 */

.top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back {
  width: 40px;
  height: 40px;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-20);
  line-height: 1;
  cursor: pointer;
  padding: 0 0 2px;
}

.brand {
  font-size: var(--xk-fs-15);
  font-weight: 700;
}

.card {
  padding: var(--xk-card-pad);
}

.hint {
  margin: 40px 0 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-13);
}

.hint.err {
  color: var(--xk-danger);
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
  flex: 1;
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
  /* ⚠️ P21 补的。ProfileView 同一段样式在 P13 就有了（那次是桌面侧栏被
     全局 padding 从 112 压到 64px，@xiaoku_demo 溢出压掉了「编辑」按钮），
     但 UserView 是同一套组件模式、元素还更多，当时**只修了一处**。
     少了这三行，@xk_ui_follow（13 字符）会直接压在「关注」钮下面。 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.follow {
  flex-shrink: 0;
  padding: 6px 16px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
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

.bio {
  margin: 14px 0 0;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-14);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
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

.feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feed-title {
  margin: 0;
  font-size: var(--xk-fs-15);
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
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
  font-size: var(--xk-fs-15);
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
  font-size: var(--xk-fs-12);
}

/*
 * 桌面端：左 240 作者卡（吸顶）+ 右三列笔记瀑布，跟首页同一套骨架。
 * 之前这里只改了 .items 的列数 —— 页面本身还是 1200px 单栏，
 * 作者卡横在最上面占满整行，瀑布再压在底下，跟「只是把尺寸拉大」没区别。
 */
@media (min-width: 1024px) {
  .page {
    display: grid;
    /* 300px 而不是 240px：与 ProfileView 对齐（P13 那次就是因为 240 太窄，
   * @xiaoku_demo 溢出压掉了「编辑」按钮）。UserView 是同一套头部结构，
   * 元素还更多 —— 头像62 + 昵称 + 用户名 + 关注钮75 + 两个 gap28 = 165px，
   * 240 减去左右 padding 各 18 + 边框 2 只剩 202px，昵称与用户名会被挤没。
   */
  grid-template-columns: 300px minmax(0, 1fr);
    grid-template-areas:
      'top   top'
      'who   feed';
    column-gap: 24px;
    row-gap: 20px;
    align-items: start;
  }

  .top {
    grid-area: top;
  }

  /* 加载中 / 出错提示是 .page 的直接子节点，跨满两列，别去抢侧栏格子 */
  .hint {
    grid-column: 1 / -1;
  }

  /* 作者卡（section:not(.feed) —— 本页只有这两块 section） */
  .page > section:not(.feed) {
    grid-area: who;
    position: sticky;
    top: 68px;
  }

  .feed {
    grid-area: feed;
  }

  /* 笔记墙走三列瀑布，与首页保持同一套卡片语言 */
  .items {
    display: block;
    columns: 3;
    column-gap: 16px;
  }

  .item,
  .item:first-child {
    break-inside: avoid;
    margin: 0 0 16px;
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
    padding: 12px;
  }
}
</style>