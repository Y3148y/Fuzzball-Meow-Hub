<script setup lang="ts">
// ⚠️ P38 把编辑表单整体搬到 ProfileEditView.vue 之后，这里只剩「展示 + 我的笔记」。
//    搬走时顺带清掉了随之无用的 import（computed/onMounted/showSuccessToast/
//    BizError/ErrorCode/getAvatarPresets/updateProfile/uploadImage/ProfilePatch）——
//    留着会让 typecheck 报 TS6133，而且它们暗示「这页还能编辑」，
//    下一个人会照着找错地方。
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getMyCollections, getMyLiked, getUserNotes } from '@/api/feed'
import type { NoteListItemVO } from '@/api/types'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useUnreadCount } from '@/composables/useUnreadCount'
import { useMessageUnread } from '@/composables/useMessageUnread'

const router = useRouter()
const userStore = useUserStore()
const { unread } = useUnreadCount()
const { unread: messageUnread } = useMessageUnread()

/*
 * P38：三个 tab 的列表。**每个 tab 独立缓存**，切回来不用重新拉 ——
 * 用户在「笔记 → 赞过 → 笔记」之间来回看是常态，每次重拉会明显卡一下，
 * 而这三个列表都是「我自己的」数据，不存在被别人改掉的场景。
 */
type TabKey = 'notes' | 'collected' | 'liked'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'notes', label: '笔记' },
  { key: 'collected', label: '收藏' },
  { key: 'liked', label: '赞过' },
]

const EMPTY_TEXT: Record<TabKey, string> = {
  notes: '还没有笔记，去发一篇吧',
  collected: '还没有收藏，看到喜欢的点个收藏',
  liked: '还没有赞过，看到喜欢的点个赞',
}

const tab = ref<TabKey>('notes')
const lists = ref<Record<TabKey, NoteListItemVO[]>>({ notes: [], collected: [], liked: [] })
const loading = ref<Record<TabKey, boolean>>({ notes: false, collected: false, liked: false })
/** 已经拉过的 tab，用来避免重复请求 */
const loaded = ref<Record<TabKey, boolean>>({ notes: false, collected: false, liked: false })

const list = computed(() => lists.value[tab.value])
const listLoading = computed(() => loading.value[tab.value])

async function loadTab(key: TabKey, force = false) {
  if (loaded.value[key] && !force) return
  loading.value[key] = true
  try {
    if (key === 'notes') {
      const id = userStore.userInfo?.id
      // ⚠️ 没有 id 就**不要**把 loaded 置 true —— 否则 userInfo 到位后
      // 不会再拉一次，笔记区会永远空着（这个坑在原 watch 里踩过）
      if (!id) return
      lists.value.notes = (await getUserNotes(id, 1, 24)).list
    } else if (key === 'collected') {
      lists.value.collected = (await getMyCollections(1, 24)).list
    } else {
      lists.value.liked = (await getMyLiked(1, 24)).list
    }
    loaded.value[key] = true
  } catch {
    // 已经有完整错误态了，这里静默清空即可，别把整个页面拖成失败
    lists.value[key] = []
    loaded.value[key] = true   // 失败也标记：否则每次切 tab 都会重试一次失败的请求
  } finally {
    loading.value[key] = false
  }
}

function switchTab(key: TabKey) {
  tab.value = key
  void loadTab(key)
}

/*
 * immediate: 必须有 —— 本视图没有 onMounted，登录时 userInfo 就已经填好，
 * 只 watch 变化的话这次挂载永远不会触发加载（笔记区会一直转圈）。
 *
 * ⚠️ 只 watch **id**：改昵称/换头像不该重新拉列表（列表内容跟资料无关），
 * 那样每次改资料都会让笔记区闪一下加载中。
 */
watch(() => userStore.userInfo?.id, (id) => {
  if (id) void loadTab('notes', true)
}, { immediate: true })

async function logout() {
  userStore.logout()
  await router.replace('/login')
}
</script>

<template>
  <main class="page">
    <header class="top">
      <span class="brand">我的</span>
      <ThemeToggle />
    </header>

    <!--
      左栏容器。只加这一个包裹 div，里面两块的移动端顺序（资料卡 → 编辑表单/按钮）
      跟之前完全一致；桌面端要整列一起 sticky，散着的兄弟节点各自 sticky 是不行的
      —— 每个 sticky 元素只能在自己的 grid area 里动，而 area 只有一行高。
    -->
    <div class="side">
      <section class="card xk-card">
      <div class="who">
        <UserAvatar
          :avatar="userStore.userInfo?.avatar"
          :nickname="userStore.userInfo?.nickname"
          :size="62"
          test="me-avatar"
        />
        <div class="names">
          <h1 class="nickname" data-test="me-nickname">
            {{ userStore.userInfo?.nickname || '加载中…' }}
          </h1>
          <!-- P30：用户名不再展示给人看 —— 界面上只有昵称，用户不必记两个名字。 -->
        </div>
        <!--
          P38：「编辑资料」从**就地展开的表单**改成**独立页面**。
          它现在是 RouterLink 而不是 `<button @click>` —— 去另一个页面是**导航**，
          P21 的规矩「导航归 a、动作归 button」。顺带后退键也就管用了。
        -->
        <RouterLink class="edit" to="/profile/edit" data-test="me-edit">编辑资料</RouterLink>
      </div>

      <p v-if="userStore.userInfo?.bio" class="bio" data-test="me-bio">
        {{ userStore.userInfo.bio }}
      </p>

      <dl class="stats">
        <!--
          关注/粉丝是**导航**（去 /follow/:id 与 /fans/:id），所以是 RouterLink。
          首页资料卡在移动端已隐藏（display:none），这两个链接是移动端唯一能进
          关注/粉丝列表的入口 —— 去掉它们，移动端就彻底没路可走了。
          获赞没有对应列表，保持 <div>。
        -->
        <RouterLink
          v-if="userStore.userInfo"
          class="stat link"
          :to="`/follow/${userStore.userInfo.id}`"
          data-test="me-follow-link"
        >
          <dt>关注</dt>
          <dd data-test="me-follow">{{ userStore.userInfo.followCount ?? 0 }}</dd>
        </RouterLink>
        <RouterLink
          v-if="userStore.userInfo"
          class="stat link"
          :to="`/fans/${userStore.userInfo.id}`"
          data-test="me-fans-link"
        >
          <dt>粉丝</dt>
          <dd data-test="me-fans">{{ userStore.userInfo.fansCount ?? 0 }}</dd>
        </RouterLink>
        <div class="stat">
          <dt>获赞</dt>
          <dd data-test="me-like">{{ userStore.userInfo?.likeReceivedCount ?? 0 }}</dd>
        </div>
      </dl>
    </section>

    <!--
      ⚠️ 原来是 `v-else`（与编辑表单的 `v-if="editing"` 成对）。P38 把编辑表单
      搬到 ProfileEditView 之后 `v-if` 没了，只留 `v-else` 会编译失败 ——
      「v-else/v-else-if has no adjacent v-if」。
      而这一条 **vue-tsc 没抓到，是 `npm run build` 才报出来的**，所以别只跑 typecheck。
    -->
    <section class="card xk-card xk-card--flat">
      <!--
        通知入口放在「我」页里（小红书移动端就是这个位置），因为移动端页面
        顶栏右上角已经有主题切换/返回，再塞一个浮动铃铛会压上去（实测布局体检
        在三页各报 2 处重叠）。桌面端那个铃铛在 SiteNav 里，两处共用
        useUnreadCount 的未读数，不会出现两个数字不一致。
      -->
      <RouterLink class="link notify" to="/notification" data-test="me-notify-link">
        <span>通知</span>
        <span v-if="unread > 0" class="notify-badge" data-test="me-notify-unread">{{ unread }}</span>
      </RouterLink>
      <!--
        私信入口（P22）。与通知并列一行，但用**独立的** useMessageUnread ——
        两个数字来自两个接口、两个表、两种「未读」，合并会让两边都要传一个
        「这次刷的是哪个」的 flag。
      -->
      <RouterLink class="link notify" to="/message" data-test="me-message-link">
        <span>私信</span>
        <span v-if="messageUnread > 0" class="notify-badge" data-test="me-message-unread">
          {{ messageUnread > 99 ? '99+' : messageUnread }}
        </span>
      </RouterLink>
        <RouterLink class="link" to="/blocks" data-test="me-blocks-link">黑名单</RouterLink>
        <!--
          运营后台入口（P20）。按 role 隐藏**只是界面提示，不是权限** ——
          改 localStorage 就能让这一行出现，真权限在后端 AdminInterceptor。
          之所以还是加这个判断：让 99% 的普通用户在「我的」里看不到运营入口，
          比让每个人都看到一个点进去就报错的链接要好。
          判定写成 === 1 而不是真值判断：后端 role 可能是 undefined（老账号/被截断），
          那时必须当普通用户处理。
        -->
        <RouterLink
          v-if="userStore.userInfo?.role === 1"
          class="link admin"
          to="/admin"
          data-test="me-admin-link"
        >
          运营后台
        </RouterLink>
      <RouterLink class="link" to="/collections" data-test="me-collections-link">我的收藏</RouterLink>
      <RouterLink class="link" to="/publish" data-test="go-publish">发布新笔记</RouterLink>
      <button class="link" type="button" data-test="me-logout" @click="logout">退出登录</button>
    </section>
    </div><!-- /.side -->

<!--
      P38：个人主页 Tab 化（笔记 / 收藏 / 赞过）。
      ⚠️ Tab 用 `<button role=tab>` 而不是路由跳转 —— 切 Tab 是**动作**不是导航
      （P21 的「导航归 a、动作归 button」，与首页「发现/关注」那两个 tab 同款）。
      所以它不写进 URL，也就没有「后退键切回上一个 tab」这种体验 ——
      这和小红书一致（小红书切 Tab 也不改地址栏）。

      三个数据源：
        notes  → /api/note/user/{id}   （自己的作品）
        collected → /api/note/collections （收藏夹，P15）
        liked  → /api/note/liked       （P38 新增，同样不收 userId）
      ⚠️ **懒加载**：切到某个 tab 才第一次拉，不在 onMounted 里把三个都拉一遍 ——
      三个列表都拉会让主页首屏慢一倍，而用户多数只看第一个。
    -->
    <section class="card xk-card xk-card--flat notes" data-test="me-notes">
      <div class="tabs" role="tablist" aria-label="我的内容">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="tab"
          :class="{ on: tab === t.key }"
          type="button"
          role="tab"
          :aria-selected="tab === t.key"
          :data-test="'me-tab-' + t.key"
          @click="switchTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <!--
        ⚠️ 三个 data-test 都必须**跟着 tab 变**（`me-' + tab + '-…'`）。
        写死成 me-notes-loading 时，测试里 `[data-test=me-liked-loading]`
        这个选择器**永远不存在** → 「到达终态」那半边恒真，看起来在等加载、
        其实那半个条件根本没参与判断。AGENTS 反复强调「PASS 也要看它有没有可能恒真」。
      -->
      <p v-if="listLoading" class="hint" :data-test="'me-' + tab + '-loading'">加载中…</p>
      <p v-else-if="!list.length" class="hint" :data-test="'me-' + tab + '-empty'">
        {{ EMPTY_TEXT[tab] }}
      </p>

      <ul v-else class="items" :data-test="'me-' + tab + '-list'">
        <li v-for="item in list" :key="item.id" class="item" data-test="profile-note">
          <RouterLink class="main" :to="`/note/${item.id}`">
            <img class="cover" :src="item.cover ?? '/mascot/m02.webp'" alt="" loading="lazy">
            <div class="body">
              <p class="title">{{ item.title }}</p>
              <p class="meta">♥ {{ item.likeCount }} · ★ {{ item.collectCount }}</p>
            </div>
          </RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
/* ---------- 内容 Tab（移动端 = 单列列表，桌面端由下面的媒体查询改成瀑布） ---------- */

.notes {
  padding: var(--xk-card-pad);
}

/*
 * 三个 tab 横排。
 * ⚠️ 激活态用 border-bottom 而不是给每个 tab 加边框：那条下划线要**横贯整格**
 * 才像「选中」，两侧留白会让它看着像被截断。
 * ⚠️ flex:1 是为了三等分：否则窄屏上「笔记/收藏/赞过」挤在左边、右边一大片空白。
 */
.tabs {
  display: flex;
  gap: var(--xk-space-1);
  margin-bottom: var(--xk-space-3);
  border-bottom: var(--xk-stroke-w) solid var(--xk-border);
}

.tab {
  flex: 1;
  min-height: 44px;          /* P13 热区下限 */
  padding: var(--xk-space-2) 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-15);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: var(--xk-text-2); }
.tab.on {
  color: var(--xk-amber-text);
  border-bottom-color: var(--xk-amber);
  font-weight: 600;
}
.tab:focus-visible { outline: 2px solid var(--xk-amber-text); outline-offset: -2px }

.hint {
  margin: 8px 0;
  font-size: var(--xk-fs-13);
  color: var(--xk-text-3);
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
  gap: 4px;
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

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: var(--xk-fs-15);
  font-weight: 700;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit {
  flex-shrink: 0;
  padding: 6px 14px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  cursor: pointer;
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

/* 可点的那两格（关注/粉丝）：给出 hover / 指针，别让它看起来像纯数字 */
.stat.link {
  cursor: pointer;
  transition: border-color 0.12s ease;
}

.stat.link:hover {
  border-color: var(--xk-amber);
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

/* ⚠️ 这里原本有一整套表单样式（.field / .label / .count / .xk-input / .area /
   .genders / .chip / .av-field / .avatar-pick / .preset* / .upload* / .file / .row /
   .over / .err），P38 把编辑表单搬到 ProfileEditView.vue 之后**全部无宿主**，
   已随规则一起删除。
   留着就是 AGENTS P35 记的死 CSS：它不报错不警告，只在碰巧同名时静默改变布局。
   表单样式的唯一宿主现在是 ProfileEditView.vue。 */

.link {
  display: block;
  width: 100%;
  padding: 12px 0;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-15);
  text-align: left;
  cursor: pointer;
}

/* 通知行：右侧挂未读角标 */
.notify {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.notify-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #e5484d;
  color: #fff;
  font-size: var(--xk-fs-12);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.link + .link {
  border-top: var(--xk-stroke-w) solid var(--xk-border);
}

/* 骨架默认在 main.css；这里是有意覆盖：桌面改「左 300 资料栏 + 右 笔记瀑布」。
   300 不是拍的：卡片 padding 24×2 + 头像 62 + 双 gap 28 + 编辑按钮 56
   之后，`.names` 至少要留 ~106px 才装得下 13px 的 `@xiaoku_demo`（88px），
   260 时只剩 64px，用户名会溢出压到编辑按钮上（layout-audit 抓过）。 */
@media (min-width: 1024px) {
  .page {
    max-width: 1100px;
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    grid-template-areas:
      'top   top'
      'side  notes';
    column-gap: 24px;
    row-gap: 16px;
    align-items: start;
  }

  .top {
    grid-area: top;
  }

  /* 整列（资料卡 + 编辑表单/按钮）一起吸顶；`.side` 就是为此包的那一层 */
  .side {
    grid-area: side;
    position: sticky;
    top: 68px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .notes {
    grid-area: notes;
  }

  /* 右栏 3 列瀑布。多列格式只作用于 block 容器，所以必须先干掉 display:flex */
  .items {
    display: block;
    columns: 3;
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
    padding: 12px 12px 14px;
    gap: 8px;
  }
}

</style>
