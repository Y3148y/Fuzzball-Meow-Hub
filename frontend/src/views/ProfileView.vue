<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showSuccessToast } from 'vant'
import { BizError } from '@/api/request'
import { ErrorCode } from '@/api/types'
import { updateProfile } from '@/api/user'
import { getUserNotes } from '@/api/feed'
import type { NoteListItemVO, ProfilePatch } from '@/api/types'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useUnreadCount } from '@/composables/useUnreadCount'
import { useMessageUnread } from '@/composables/useMessageUnread'

const router = useRouter()
const userStore = useUserStore()
const { unread } = useUnreadCount()
const { unread: messageUnread } = useMessageUnread()

/*
 * 「我的笔记」——桌面端右侧瀑布用的就是这份数据。
 * 走 /api/note/user/{id}（作者主页同一条接口），本人视角 status=1 的可见，
 * 所以草稿/下架不会出现在这里。
 */
const notes = ref<NoteListItemVO[]>([])
const notesLoading = ref(true)

async function loadNotes() {
  const id = userStore.userInfo?.id
  if (!id) return
  notesLoading.value = true
  try {
    const page = await getUserNotes(id, 1, 24)
    notes.value = page.list
  } catch {
    // 首页已经有完整错误态，这里静默清空即可，别把整个页面拖成失败
    notes.value = []
  } finally {
    notesLoading.value = false
  }
}

/*
 * immediate: 必须有 —— 本视图没有 onMounted，登录时 userInfo 就已经填好，
 * 只 watch 变化的话这次挂载永远不会触发加载（笔记区会一直转圈）。
 */
watch(() => userStore.userInfo?.id, (id) => { if (id) void loadNotes() }, { immediate: true })

const editing = ref(false)
const saving = ref(false)
const errorMsg = ref('')

const nickname = ref('')
const bio = ref('')
const gender = ref(0)

/** 与后端 UserProfileUpdateDTO 的校验保持一致：昵称 ≤32、简介 ≤255 */
const NICKNAME_MAX = 32
const BIO_MAX = 255

const nicknameLen = computed(() => nickname.value.length)
const bioLen = computed(() => bio.value.length)
const nicknameOver = computed(() => nicknameLen.value > NICKNAME_MAX)
const bioOver = computed(() => bioLen.value > BIO_MAX)

const canSave = computed(
  () =>
    !saving.value &&
    nickname.value.trim().length > 0 &&
    !nicknameOver.value &&
    !bioOver.value,
)

/** 表单从 store 回填；编辑中不覆盖，避免用户改到一半被后台刷新冲掉 */
function syncFromStore() {
  if (editing.value) return
  const u = userStore.userInfo
  nickname.value = u?.nickname ?? ''
  bio.value = u?.bio ?? ''
  gender.value = u?.gender ?? 0
}

watch(() => userStore.userInfo, syncFromStore, { immediate: true })

function startEdit() {
  syncFromStore()
  editing.value = true
  errorMsg.value = ''
}

function cancelEdit() {
  editing.value = false
  errorMsg.value = ''
  syncFromStore()
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  errorMsg.value = ''
  try {
    // 区分两种"没填"，这是踩过的坑：
    // 后端 MyBatis-Plus 配的是 update-strategy: not_null，只有 null 才会被
    // 从 UPDATE 语句里去掉。所以「不传」和「传空串」在语义上完全不同：
    //   - 不传 nickname = 保持原昵称（但昵称是必填的，这里本来就非空）
    //   - 不传 bio     = 保持原简介
    //   - bio: ''      = **清空**简介
    // 之前对 bio 也做了 if (trimmed) 判断，结果用户永远清不掉简介。
    const patch: ProfilePatch = { bio: bio.value.trim(), gender: gender.value }
    const trimmedNick = nickname.value.trim()
    if (trimmedNick) patch.nickname = trimmedNick

    const updated = await updateProfile(patch)
    userStore.userInfo = updated
    editing.value = false
    showSuccessToast('已保存')
  } catch (e) {
    if (e instanceof BizError) {
      errorMsg.value = e.message
      // 10005/10006 交给拦截器跳登录，这里不再重复提示
      if (e.code === ErrorCode.UNAUTHORIZED || e.code === ErrorCode.TOKEN_INVALID) {
        return
      }
    } else {
      errorMsg.value = '保存失败，请稍后重试'
    }
  } finally {
    saving.value = false
  }
}

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
        <img class="avatar" src="/mascot/m02.webp" alt="" width="62" height="62" />
        <div class="names">
          <h1 class="nickname" data-test="me-nickname">
            {{ userStore.userInfo?.nickname || '加载中…' }}
          </h1>
          <p class="username" data-test="me-username">@{{ userStore.userInfo?.username }}</p>
        </div>
        <button
          v-if="!editing"
          class="edit"
          type="button"
          data-test="me-edit"
          @click="startEdit"
        >
          编辑
        </button>
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

    <section v-if="editing" class="card xk-card" data-test="me-form">
      <label class="field">
        <span class="label">昵称</span>
        <input
          v-model="nickname"
          class="xk-input"
          type="text"
          maxlength="40"
          aria-label="昵称"
          data-test="me-nickname-input"
        />
        <span class="count" :class="{ over: nicknameOver }">{{ nicknameLen }}/{{ NICKNAME_MAX }}</span>
      </label>

      <label class="field">
        <span class="label">简介</span>
        <textarea
          v-model="bio"
class="xk-input area"
          maxlength="300"
          placeholder="介绍一下自己…"
          aria-label="个人简介"
          data-test="me-bio-input"
        />
        <span class="count" :class="{ over: bioOver }">{{ bioLen }}/{{ BIO_MAX }}</span>
      </label>

      <div class="field">
        <span class="label">性别</span>
        <div class="genders">
          <button
            v-for="g in [
              { v: 0, t: '保密' },
              { v: 1, t: '男' },
              { v: 2, t: '女' },
            ]"
            :key="g.v"
            class="chip"
            :class="{ on: gender === g.v }"
            type="button"
            :data-test="`me-gender-${g.v}`"
            @click="gender = g.v"
          >
            {{ g.t }}
          </button>
        </div>
      </div>

      <p v-if="errorMsg" class="err" role="alert" data-test="me-error">{{ errorMsg }}</p>

      <div class="row">
        <button class="xk-btn xk-btn--ghost" type="button" data-test="me-cancel" @click="cancelEdit">
          取消
        </button>
        <button
          class="xk-btn"
          type="button"
          :disabled="!canSave"
          data-test="me-save"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </section>

    <section v-else class="card xk-card xk-card--flat">
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

    <!-- 我的笔记。移动端是单列列表，桌面端是右侧 3 列瀑布（布局在下面的媒体查询里） -->
    <section class="card xk-card xk-card--flat notes" data-test="me-notes">
      <h2 class="notes-title">我的笔记</h2>

      <p v-if="notesLoading" class="hint" data-test="me-notes-loading">加载中…</p>
      <p v-else-if="!notes.length" class="hint" data-test="me-notes-empty">
        还没有笔记，去发一篇吧
      </p>

      <ul v-else class="items" data-test="me-notes-list">
        <li v-for="item in notes" :key="item.id" class="item" data-test="profile-note">
          <RouterLink class="main" :to="`/note/${item.id}`">
            <img class="cover" :src="item.cover ?? '/mascot/m02.webp'" alt="" loading="lazy" />
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
/* ---------- 我的笔记（移动端 = 单列列表，桌面端由上面的媒体查询改成瀑布） ---------- */

.notes {
  padding: var(--xk-card-pad);
}

.notes-title {
  margin: 0 0 4px;
  font-size: var(--xk-fs-15);
}

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

/* 计数摆位：见 PublishView 同段注释（绝对定位的计数会压住正文最后一行）。
 * 性别那一组没有 .count，它的 .genders 会自动落进第 2 行。 */
.field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 8px;
  margin-bottom: 16px;
}

.label {
  grid-column: 1;
  grid-row: 1;
  margin-bottom: 6px;
  font-size: var(--xk-fs-13);
  color: var(--xk-text-3);
}

/* 表单控件一律第 2 行跨两列。
 * 不写这条的话「性别」那组（没有 .count 占位）会自动落进第 1 行第 2 列，
 * 变成按钮跟标签并排。 */
.field > :not(.label):not(.count) {
  grid-column: 1 / -1;
  grid-row: 2;
}

.xk-input {
  width: 100%;
  box-sizing: border-box;
}

.area {
  height: 90px;
  resize: none;
  line-height: 1.6;
  font-family: inherit;
}

.count {
  grid-column: 2;
  grid-row: 1;
  align-self: start;
  justify-self: end;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
}

.over {
  color: var(--xk-danger);
  font-weight: 700;
}

.genders {
  display: flex;
  gap: 8px;
}

.chip {
  padding: 7px 16px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  cursor: pointer;
}

.chip.on {
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  font-weight: 700;
}

.row {
  display: flex;
  gap: 10px;
}

.row .xk-btn {
  flex: 1;
}

.err {
  margin: 0 0 12px;
  color: var(--xk-danger);
  font-size: var(--xk-fs-13);
  line-height: 1.5;
}

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
