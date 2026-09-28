<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showSuccessToast } from 'vant'
import { BizError } from '@/api/request'
import { ErrorCode } from '@/api/types'
import { updateProfile } from '@/api/user'
import type { ProfilePatch } from '@/api/types'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()
const userStore = useUserStore()

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

    <section class="card xk-card">
      <div class="who">
        <img class="avatar" src="/mascot/m02.webp" alt="" />
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
        <div class="stat">
          <dt>关注</dt>
          <dd data-test="me-follow">{{ userStore.userInfo?.followCount ?? 0 }}</dd>
        </div>
        <div class="stat">
          <dt>粉丝</dt>
          <dd data-test="me-fans">{{ userStore.userInfo?.fansCount ?? 0 }}</dd>
        </div>
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
          placeholder="介绍一下自己"
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

      <p v-if="errorMsg" class="err" data-test="me-error">{{ errorMsg }}</p>

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
      <button class="link" type="button" data-test="go-publish" @click="router.push('/publish')">
        发布新笔记
      </button>
      <button class="link" type="button" data-test="me-logout" @click="logout">退出登录</button>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100%;
  padding: calc(16px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: 15px;
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

.edit {
  flex-shrink: 0;
  padding: 6px 14px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: 13px;
  cursor: pointer;
}

.bio {
  margin: 14px 0 0;
  color: var(--xk-text-2);
  font-size: 14px;
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
  font-size: 12px;
}

.stat dd {
  margin: 4px 0 0;
  font-size: 18px;
  font-weight: 700;
}

.field {
  position: relative;
  display: block;
  margin-bottom: 16px;
}

.label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--xk-text-3);
}

.xk-input {
  width: 100%;
  box-sizing: border-box;
  padding-right: 60px;
}

.area {
  height: 90px;
  resize: none;
  line-height: 1.6;
  font-family: inherit;
}

.count {
  position: absolute;
  right: 10px;
  bottom: 10px;
  font-size: 11px;
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
  font-size: 13px;
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
  font-size: 13px;
  line-height: 1.5;
}

.link {
  display: block;
  width: 100%;
  padding: 12px 0;
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}

.link + .link {
  border-top: var(--xk-stroke-w) solid var(--xk-border);
}
</style>
