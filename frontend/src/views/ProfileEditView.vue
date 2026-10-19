<script setup lang="ts">
/**
 * 编辑资料 —— **独立成页**（P38）。
 *
 * <p><b>为什么从 ProfileView 里搬出来</b>：原来「编辑」是就地展开的 ——
 * 点一下，资料卡下面长出一个表单，取消再点一下收回去。两个问题：
 * <ul>
 *   <li>浏览器<b>后退键</b>不管用（不是一次导航，history 里没有这一页），
 *       用户按后退会直接离开「我的」而不是「退出编辑」</li>
 *   <li>表单和资料卡<b>挤在同一页</b>，桌面端尤其怪 —— 左栏的资料卡
 *       会被撑高，右栏笔记瀑布的位置整个跳一下</li>
 * </ul>
 * 小红书是「点编辑资料 → 单独一页 → 保存/返回」，跟着它做。
 *
 * <p>表单本身是从 ProfileView 原样搬过来的（data-test 一个没改），
 * 所以已���的 CDP 断言只需在开头多一次导航，不用重写断言。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showSuccessToast } from 'vant'
import { BizError } from '@/api/request'
import { ErrorCode } from '@/api/types'
import { getAvatarPresets, updateProfile } from '@/api/user'
import { uploadImage } from '@/api/note'
import type { ProfilePatch } from '@/api/types'
import { useUserStore } from '@/stores/user'
import UserAvatar from '@/components/UserAvatar.vue'

const router = useRouter()
const userStore = useUserStore()

const saving = ref(false)
const errorMsg = ref('')

const nickname = ref('')
const bio = ref('')
const gender = ref(0)
/** 本次编辑选中的头像（空串 = 清空） */
const avatar = ref('')
const uploading = ref(false)
const uploadErr = ref('')

/**
 * 预设头像列表，**从后端取**而不是写死在前端。
 * 单一数据源：后端 AvatarPresets.PRESETS 既是校验白名单也是这里的返回值，
 * 两边再各写一份就会出现「能选但提交 10008」或「能提交但图 404」。
 */
const presets = ref<string[]>([])
onMounted(async () => {
  try {
    presets.value = await getAvatarPresets()
  } catch {
    // 拿不到预设不该让整页不可用 —— 至少还能上传自定义头像
    presets.value = []
  }
})

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

/**
 * 表单回填。
 *
 * ⚠️ `dirty` 是搬出 ProfileView 时新增的：这一页**全程都是编辑态**，
 * 而原来只在 `editing === true` 的那几秒里挡 watch。现在后台刷新
 * （比如别处改了昵称）会在用户打字中途把输入框内容冲掉。
 */
const dirty = ref(false)
function syncFromStore() {
  if (dirty.value) return
  const u = userStore.userInfo
  nickname.value = u?.nickname ?? ''
  bio.value = u?.bio ?? ''
  gender.value = u?.gender ?? 0
  avatar.value = u?.avatar ?? ''
}
watch(() => userStore.userInfo, syncFromStore, { immediate: true })

async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // ⚠️ 无论成败都要把 value 清掉：同一个文件再选一次时
  //    不清空的话 change 事件**不会再次触发**（浏览器认为没变化），
  //    症状是「传错了想重传同一个文件，没反应」。
  input.value = ''
  if (!file) return
  uploadErr.value = ''
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    uploadErr.value = '只支持 PNG / JPEG / WebP 格式'
    return
  }
  uploading.value = true
  try {
    // ⚠️ uploadImage 的 TS 返回类型**已经解包过**（ImageUploadVO），
    //    所以直接取 res.url。裸 fetch 写脚本时才是 `{ json }` 包一层。
    const res = await uploadImage(file)
    avatar.value = res.url
    dirty.value = true
  } catch {
    uploadErr.value = '上传失败，请重试'
  } finally {
    uploading.value = false
  }
}

function back() {
  router.back()
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  errorMsg.value = ''
  try {
    // ⚠️ 区分两种「没填」（P3 踩过的坑）：
    // MyBatis-Plus 配的是 update-strategy: not_null，只有 null 才会被剔除，
    // 所以「不传」与「传空串」语义完全不同：
    //   - 不传 nickname = 保持原昵称
    //   - bio: ''      = **清空**简介
    // 之前对 bio 也做了 if (trimmed) 判断，结果用户永远清不掉简介。
    const patch: ProfilePatch = { bio: bio.value.trim(), gender: gender.value }
    const trimmedNick = nickname.value.trim()
    if (trimmedNick) patch.nickname = trimmedNick
    // ⚠️ 头像与昵称/简介不同：**空串是有意义的取值**（清空），
    // 所以不能写 `if (avatar.value) patch.avatar = ...` —— 那样用户永远清不掉头像。
    patch.avatar = avatar.value

    const updated = await updateProfile(patch)
    userStore.userInfo = updated
    dirty.value = false
    showSuccessToast('已保存')
    router.replace('/profile')
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
</script>

<template>
  <main class="page edit-page">
    <div class="top">
      <button class="back" type="button" aria-label="返回" data-test="edit-back" @click="back">
        <van-icon name="arrow-left" />
      </button>
      <h1>编辑资料</h1>
    </div>

    <div class="preview">
      <UserAvatar
        :avatar="userStore.userInfo?.avatar"
        :nickname="userStore.userInfo?.nickname"
        :size="62"
        test="edit-avatar-preview"
      />
      <p class="preview-hint">下面改的是你的公开资料，所有人都能看到</p>
    </div>

    <section class="card xk-card" data-test="me-form">
      <!--
        头像选择：8 个预设 + 上传自定义。
        ⚠️ **点预设只是本地选中，不立即提交** —— 与同表单里的昵称/简介一起
        点「保存」才写库。头像换一个就发一次 PUT 的话，用户连着试 3 个预设
        就打满 3 次请求，而且中途点「取消」时界面和库里已经不一致了。
      -->
      <div class="av-field">
        <span class="label">头像</span>
        <div class="avatar-pick" data-test="me-avatar-picker">
          <button
            v-for="p in presets"
            :key="p"
            class="preset"
            :class="{ on: avatar === p }"
            type="button"
            :aria-label="'使用预设头像 ' + p"
            :aria-pressed="avatar === p"
            :data-test="'me-avatar-' + p.split('/').pop()"
            @click="((avatar = p), (dirty = true))"
          >
            <img :src="p" alt="" width="44" height="44">
          </button>
        </div>
        <label class="upload">
          <!--
            label 包 input：点「上传自定义头像」等价于点文件选择框，
            而 input 本身 opacity:0 隐藏后仍可被脚本点击。
            ⚠️ 不能用 @change 直接绑 <label>，键盘用户到不了。
          -->
          <input
            class="file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            data-test="me-avatar-file"
            @change="onPickFile"
          >
          <span class="upload-btn" data-test="me-avatar-upload">
            {{ uploading ? '上传中…' : '上传自定义头像' }}
          </span>
        </label>
        <p v-if="uploadErr" class="err" role="alert" data-test="me-avatar-error">{{ uploadErr }}</p>
      </div>

      <label class="field">
        <span class="label">昵称</span>
        <input
          v-model="nickname"
          class="xk-input"
          type="text"
          maxlength="40"
          aria-label="昵称"
          data-test="me-nickname-input"
          @input="dirty = true"
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
          @input="dirty = true"
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
            @click="((gender = g.v), (dirty = true))"
          >
            {{ g.t }}
          </button>
        </div>
      </div>

      <p v-if="errorMsg" class="err" role="alert" data-test="me-error">{{ errorMsg }}</p>

      <div class="row">
        <button class="xk-btn xk-btn--ghost" type="button" data-test="me-cancel" @click="back">
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
  </main>
</template>

<style scoped>
/* 这一页是「顶栏 + 预览 + 一张表单卡」，单列居中，宽度比内容需要的多余留白去掉 */
.edit-page {
  padding-bottom: var(--xk-space-8);
}

.top {
  display: flex;
  align-items: center;
  gap: var(--xk-space-2);
  margin-bottom: var(--xk-space-4);
}
.top h1 {
  margin: 0;
  font-size: var(--xk-fs-18);
  font-weight: 700;
}
.back {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--xk-radius-md, 10px);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  cursor: pointer;
  flex: none;
}
.back:hover { background: var(--xk-bg-soft); }

.preview {
  display: flex;
  align-items: center;
  gap: var(--xk-space-3);
  margin-bottom: var(--xk-space-4);
}
.preview-hint {
  margin: 0;
  font-size: var(--xk-fs-13);
  color: var(--xk-text-3);
}

/* 以下 field / av-field / preset / upload / genders / chip / row 从 ProfileView 原样搬来，
   那边删掉后这里是唯一宿主 —— 别在两边各留一份（AGENTS P35 的死 CSS 教训） */

/* ⚠️ 这里**不能复用 ProfileView 的 .field**（它是两列栅格 + .field >
   :not(.label):not(.count) { grid-column: 1/-1 } 的兜底），
   三个并排元素塞进去会被挤到重叠。理由写在 ProfileView 那边的同名注释里。 */
.av-field {
  display: flex;
  flex-direction: column;
  gap: var(--xk-space-2);
  margin-bottom: 16px;
}

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
/* 表单控件一律第 2 行跨两列。不写这条的话「性别」那组（没有 .count 占位）
   会自动落进第 1 行第 2 列，变成按钮跟标签并排。 */
.field > :not(.label):not(.count) {
  grid-column: 1 / -1;
  grid-row: 2;
}
.count {
  grid-column: 2;
  grid-row: 1;
  justify-self: end;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
  align-self: center;
}
.count.over {
  color: var(--xk-danger, #d54941);
  font-weight: 600;
}

.avatar-pick {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--xk-space-2);
}
.preset {
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  line-height: 0;
  transition: border-color 0.15s, transform 0.1s;
}
.preset img {
  width: 100%;
  height: 100%;
  aspect-ratio: 1;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}
.preset:hover { transform: scale(1.05); }
/* 选中态 = 外侧留白 3px + 外侧琥珀环 2px，而不是在头像本身上描边 ——
   实测选中金色底那张时琥珀环压在金色底上几乎看不出选中。
   双信号（颜色 + 形状）也是 a11y 要求：不能只靠单一感官通道。 */
.preset.on {
  box-shadow: 0 0 0 3px var(--xk-surface), 0 0 0 5px var(--xk-amber-text);
}
.preset:focus-visible { outline: 2px solid var(--xk-amber-text); outline-offset: 2px }

.upload { display: block; margin-top: var(--xk-space-3); }
/* input 隐藏但**仍可被脚本/label 点击** —— 用 display:none 会让键盘用户彻底到不了 */
.file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.upload-btn {
  display: inline-block;
  padding: var(--xk-space-2) var(--xk-space-4);
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-13);
  cursor: pointer;
  min-height: 40px;
  line-height: 24px;
}
.upload-btn:hover { border-color: var(--xk-amber); color: var(--xk-amber-text); }
.upload:focus-within .upload-btn { outline: 2px solid var(--xk-amber-text); outline-offset: 2px }

.genders { display: flex; gap: 8px; }
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

.err {
  margin: 0 0 var(--xk-space-3);
  font-size: var(--xk-fs-13);
  color: var(--xk-danger, #d54941);
}

.row {
  display: flex;
  gap: var(--xk-space-3);
  margin-top: var(--xk-space-2);
}
.row .xk-btn { flex: 1; }
</style>