<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showSuccessToast } from 'vant'
import { publishNote, uploadImage } from '@/api/note'
import { BizError } from '@/api/request'
import { ErrorCode, NOTE_IMAGE_LIMIT } from '@/api/types'

const router = useRouter()

const title = ref('')
const content = ref('')
const files = ref<File[]>([])
const previews = ref<string[]>([])
const submitting = ref(false)
const errorMsg = ref('')

const titleLen = computed(() => title.value.length)
const contentLen = computed(() => content.value.length)
/** 只看已选数量，还没传成功的不算——发布要提交的是 URL，不是 File */
const canSubmit = computed(
  () =>
    !submitting.value &&
    title.value.trim().length > 0 &&
    content.value.trim().length > 0 &&
    titleLen.value <= 64 &&
    contentLen.value <= 2000,
)

const TYPE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const MAX_SIZE = 10 * 1024 * 1024

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  // 重置 value：否则连续选同一张文件时 change 事件不再触发
  input.value = ''

  errorMsg.value = ''
  const room = NOTE_IMAGE_LIMIT - files.value.length
  if (picked.length > room) {
    errorMsg.value = `单篇笔记最多 ${NOTE_IMAGE_LIMIT} 张图片，还能再选 ${room} 张`
    return
  }

  for (const f of picked) {
    if (!TYPE_ACCEPT.split(',').includes(f.type)) {
      errorMsg.value = `「${f.name}」不是 jpg/png/webp/gif，已跳过`
      continue
    }
    if (f.size > MAX_SIZE) {
      errorMsg.value = `「${f.name}」超过 10MB，已跳过`
      continue
    }
    files.value.push(f)
    previews.value.push(URL.createObjectURL(f))
  }
}

function removeAt(i: number) {
  URL.revokeObjectURL(previews.value[i])
  files.value.splice(i, 1)
  previews.value.splice(i, 1)
  errorMsg.value = ''
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  errorMsg.value = ''

  try {
    // 先把图片换成 URL，再一次性发布。
    // 不合并成一次 multipart 是因为图片存到一半失败时无法回滚已落盘的文件。
    const urls: string[] = []
    for (const f of files.value) {
      const { url } = await uploadImage(f)
      urls.push(url)
    }

    const note = await publishNote({
      title: title.value.trim(),
      content: content.value.trim(),
      imageUrls: urls,
    })
    showSuccessToast('发布成功')
    // 详情页要用笔记 ID 跳转，id 是 string（雪花 ID 不能转 Number）
    await router.push(`/note/${note.id}`)
  } catch (e) {
    if (e instanceof BizError) {
      // 20004 已经在文案里说清了，单独提示更贴近用户预期
      if (e.code === ErrorCode.NOTE_IMAGE_LIMIT_EXCEED) {
        errorMsg.value = e.message
      } else {
        errorMsg.value = e.message
      }
    } else {
      errorMsg.value = '发布失败，请稍后重试'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <span class="brand">发布笔记</span>
      <button class="submit" type="button" :disabled="!canSubmit" @click="submit">
        {{ submitting ? '发布中…' : '发布' }}
      </button>
    </header>

    <section class="card xk-card">
      <label class="field">
        <span class="label">标题</span>
        <input
          v-model="title"
          class="input"
          type="text"
          placeholder="写个标题吧"
          maxlength="70"
          data-test="note-title"
        />
        <span class="count" :class="{ over: titleLen > 64 }">{{ titleLen }}/64</span>
      </label>

      <label class="field">
        <span class="label">正文</span>
        <textarea
          v-model="content"
          class="input area"
          placeholder="说点什么…"
          maxlength="2100"
          data-test="note-content"
        />
        <span class="count" :class="{ over: contentLen > 2000 }">{{ contentLen }}/2000</span>
      </label>
    </section>

    <section class="card xk-card">
      <div class="pics-head">
        <h2>图片</h2>
        <span class="count" :class="{ over: files.length > NOTE_IMAGE_LIMIT }">
          {{ files.length }}/{{ NOTE_IMAGE_LIMIT }}
        </span>
      </div>

      <ul v-if="previews.length" class="grid" data-test="note-previews">
        <li v-for="(src, i) in previews" :key="src" class="cell">
          <img :src="src" alt="待发布图片" />
          <button class="rm" type="button" aria-label="移除" @click="removeAt(i)">×</button>
        </li>
      </ul>

      <label v-if="files.length < NOTE_IMAGE_LIMIT" class="picker">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          data-test="note-file"
          @change="onFileChange"
        />
        <span>+ 添加图片</span>
      </label>

      <p v-if="errorMsg" class="err" data-test="note-error">{{ errorMsg }}</p>
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

.back {
  border: 0;
  background: none;
  font-size: 26px;
  line-height: 1;
  color: var(--xk-text-2);
  cursor: pointer;
  padding: 0 4px;
}

.submit {
  padding: 6px 16px;
  border: 0;
  border-radius: 999px;
  background: var(--xk-accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 56px 10px 12px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text-1);
  font-size: 15px;
  font-family: inherit;
}

.area {
  height: 160px;
  resize: none;
  line-height: 1.6;
}

.count {
  position: absolute;
  right: 10px;
  bottom: 10px;
  font-size: 11px;
  color: var(--xk-text-3);
}

.over {
  color: #e5484d;
  font-weight: 700;
}

.pics-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.pics-head h2 {
  margin: 0;
  font-size: 15px;
}

.grid {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--xk-radius-blob-sm);
  overflow: hidden;
  background: var(--xk-surface-2);
}

.cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.rm {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.picker {
  display: block;
  padding: 18px;
  border: var(--xk-stroke-w) dashed var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  text-align: center;
  color: var(--xk-text-3);
  font-size: 14px;
  cursor: pointer;
}

.picker input {
  display: none;
}

.err {
  margin: 12px 0 0;
  color: #e5484d;
  font-size: 13px;
  line-height: 1.5;
}
</style>
