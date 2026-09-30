<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showSuccessToast } from 'vant'
import { getNoteDetail, updateNote, uploadImage } from '@/api/note'
import { BizError } from '@/api/request'
import { ErrorCode, NOTE_IMAGE_LIMIT } from '@/api/types'

const route = useRoute()
const router = useRouter()

const title = ref('')
const content = ref('')
/** 现存 URL + 新上传 URL 的混合列表（编辑是「整表重建」，不再持有的图要在提交前移除） */
const urls = ref<string[]>([])
const loading = ref(true)
const submitting = ref(false)
const errorMsg = ref('')
/** 编辑态只针对图文（发布只支持图文），下拉不用做 */
const noteType = ref(1)

const titleLen = computed(() => title.value.length)
const contentLen = computed(() => content.value.length)
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

/** 现有的图片是已有 URL，直接推列表；新选的文件在本函数内上传成 URL 再推 */
async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ''

  errorMsg.value = ''
  const room = NOTE_IMAGE_LIMIT - urls.value.length
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
    try {
      // 编辑没必要选完再统一传：图不多、失败可重试，选中即上传最直观
      const { url } = await uploadImage(f)
      urls.value.push(url)
    } catch {
      errorMsg.value = `「${f.name}」上传失败，请重试`
    }
  }
}

function removeAt(i: number) {
  urls.value.splice(i, 1)
  errorMsg.value = ''
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const note = await getNoteDetail(String(route.params.id))
    // 编辑入口只对作者开放，详情页按钮已隐藏；这里再兜一层防手输 URL
    title.value = note.title
    content.value = note.content
    noteType.value = note.type
    urls.value = [...note.images]
  } catch (e) {
    if (e instanceof BizError) {
      if (
        e.code === ErrorCode.NOTE_NOT_FOUND ||
        e.code === ErrorCode.NOTE_STATUS_ILLEGAL
      ) {
        errorMsg.value = '这篇笔记不存在或不可编辑'
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

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    const note = await updateNote(String(route.params.id), {
      title: title.value.trim(),
      content: content.value.trim(),
      type: noteType.value,
      // 编辑是全量覆盖：想清掉某张图就把它的 URL 从列表里移除，提交后后端整表重建
      imageUrls: urls.value,
    })
    showSuccessToast('保存成功')
    await router.replace(`/note/${note.id}`)
  } catch (e) {
    if (e instanceof BizError) {
      errorMsg.value = e.message
    } else {
      errorMsg.value = '保存失败，请稍后重试'
    }
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="top">
      <button class="back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <span class="brand">编辑笔记</span>
      <button class="submit" type="button" :disabled="!canSubmit || loading" @click="submit">
        {{ submitting ? '保存中…' : '保存' }}
      </button>
    </header>

    <p v-if="loading" class="hint">加载中…</p>

    <template v-else>
      <section class="card xk-card">
        <label class="field">
          <span class="label">标题</span>
          <input
            v-model="title"
            class="input"
            type="text"
            placeholder="写个标题吧"
            maxlength="70"
            data-test="note-edit-title"
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
            data-test="note-edit-content"
          />
          <span class="count" :class="{ over: contentLen > 2000 }">{{ contentLen }}/2000</span>
        </label>
      </section>

      <section class="card xk-card">
        <div class="pics-head">
          <h2>图片</h2>
          <span class="count" :class="{ over: urls.length > NOTE_IMAGE_LIMIT }">
            {{ urls.length }}/{{ NOTE_IMAGE_LIMIT }}
          </span>
        </div>

        <p class="tip">移除某张图即从列表删除；保存时以当前列表为准。</p>

        <ul v-if="urls.length" class="grid" data-test="note-edit-previews">
          <li v-for="(src, i) in urls" :key="src" class="cell">
            <img :src="src" alt="笔记图片" />
            <button class="rm" type="button" aria-label="移除" @click="removeAt(i)">×</button>
          </li>
        </ul>

        <label v-if="urls.length < NOTE_IMAGE_LIMIT" class="picker">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            data-test="note-edit-file"
            @change="onFileChange"
          />
          <span>+ 添加图片</span>
        </label>

        <p v-if="errorMsg" class="err" data-test="note-edit-error">{{ errorMsg }}</p>
      </section>
    </template>
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

.hint {
  color: var(--xk-text-3);
  font-size: 14px;
  text-align: center;
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
  margin-bottom: 6px;
}

.pics-head h2 {
  margin: 0;
  font-size: 15px;
}

.tip {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--xk-text-3);
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