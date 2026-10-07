<script setup lang="ts">
/*
 * 话题/提及的**预览**解析。
 *
 * <p>规则刻意与后端 TopicRelationServiceImpl 保持一致：
 * 话题 `#([^\\s#@]{1,20})`、提及 `@([a-zA-Z0-9_]{3,32})`。
 *
 * <p><b>为什么不写成一个共享包</b>：后端是 Java、前端是 TS，共享要靠
 * 「后端下发解析规则」或「改语言」，成本远大于收益。
 * 但**必须在这里写下「改一处要同步另一处」的注释**，否则两边会各自漂移，
 * 症状是「输入时看见话题、发布后详情页没有」。
 */
const TOPIC_RE = /#([^\s#@\uFF0C\u002C\u3002\u002E\u3001\uFF1B\u003B\uFF01\u0021\uFF1F\u003F\uFF1A\u003A]{1,20})/g
const MENTION_RE = /@([a-zA-Z0-9_]{3,32})/g
const MAX_TOPICS = 5

function detectTopics(text: string) {
  const out: string[] = []
  if (!text) return out
  TOPIC_RE.lastIndex = 0
  for (let m = TOPIC_RE.exec(text); m && out.length < MAX_TOPICS; m = TOPIC_RE.exec(text)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

function detectMentions(text: string) {
  const out: string[] = []
  if (!text) return out
  MENTION_RE.lastIndex = 0
  for (let m = MENTION_RE.exec(text); m; m = MENTION_RE.exec(text)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

const pickedTopics = computed(() => [
  ...detectTopics(title.value),
  ...detectTopics(content.value),
].filter((n, i, a) => a.indexOf(n) === i).slice(0, MAX_TOPICS))
const pickedMentions = computed(() => detectMentions(content.value))
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showSuccessToast } from 'vant'
import { publishNote, uploadImage } from '@/api/note'
import { BizError } from '@/api/request'
import { ErrorCode, NOTE_IMAGE_LIMIT } from '@/api/types'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import {
  CARD_TEMPLATES,
  defaultTemplateId,
  textCardBlobs,
  textCardPageCount,
  textCardPreview,
} from '@/utils/textCard'

const router = useRouter()

const title = ref('')
const content = ref('')
const files = ref<File[]>([])
const previews = ref<string[]>([])
const submitting = ref(false)
const errorMsg = ref('')
/** 纯文字模式的实时卡片预览（dataURL，只在没选图时生成） */
const previewUrl = ref('')
/** 选中的文字卡模板（模板只决定卡片外观，不跟 app 主题翻转） */
const tplId = ref(defaultTemplateId())
/** 预览分页：正文超过一页时能翻，避免看起来像「正文被吞了」 */
const previewPage = ref(0)
const previewPages = ref(1)

const titleLen = computed(() => title.value.length)
const contentLen = computed(() => content.value.length)
/** 没选任何图片 = 纯文字模式：发布时自动生成文字卡片图（小红书同款做法） */
const textMode = computed(() => files.value.length === 0)
/** 只看已选数量，还没传成功的不算——发布要提交的是 URL，不是 File */
const canSubmit = computed(
  () =>
    !submitting.value &&
    title.value.trim().length > 0 &&
    content.value.trim().length > 0 &&
    titleLen.value <= 64 &&
    contentLen.value <= 2000,
)

/* 打字时防抖刷新预览，别把每个 keydown 都变成一次 canvas 重绘 */
let previewTimer: number | undefined
function renderPreview() {
  if (textMode.value && title.value.trim() && content.value.trim()) {
    previewPages.value = Math.max(textCardPageCount(title.value.trim(), content.value.trim()), 1)
    if (previewPage.value >= previewPages.value) previewPage.value = 0
    previewUrl.value = textCardPreview(
      title.value.trim(),
      content.value.trim(),
      tplId.value,
      previewPage.value,
    )
  } else {
    previewUrl.value = ''
    previewPages.value = 1
    previewPage.value = 0
  }
}
function schedulePreview() {
  if (previewTimer !== undefined) window.clearTimeout(previewTimer)
  previewTimer = window.setTimeout(renderPreview, 200)
}
function pickTpl(id: string) {
  tplId.value = id
  previewPage.value = 0
  renderPreview()
}
function flipPage(d: number) {
  if (previewPages.value <= 1) return
  previewPage.value = (previewPage.value + d + previewPages.value) % previewPages.value
  renderPreview()
}
watch([title, content, () => files.value.length], schedulePreview)
onMounted(schedulePreview)

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
    if (files.value.length) {
      for (const f of files.value) {
        const { url } = await uploadImage(f)
        urls.push(url)
      }
    } else {
      // 纯文字模式：标题+正文渲成 3:4 文字卡片（最多几张）再走同一上传链。
      // 卡片 PNG 的 content-type 是 image/png，过得了后端的白名单检查，
      // 后端「图文必须带图」的规则在这里自然被满足。
      const blobs = await textCardBlobs(title.value.trim(), content.value.trim(), tplId.value)
      for (const b of blobs) {
        const file = new File([b], 'text-card.png', { type: 'image/png' })
        const { url } = await uploadImage(file)
        urls.push(url)
      }
    }

    const note = await publishNote({
      title: title.value.trim(),
      content: content.value.trim(),
      imageUrls: urls,
    })
    showSuccessToast('发布成功')
    // 已经存进库了，跳转前先清 dirty —— 否则这次跳转自己会把自己拦下
    markClean()
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

/*
 * 未保存提醒：标题/正文/图片任一非空就算「有改动」。
 * 提交成功那次跳转已在 submit() 里 markClean()，不会自己拦自己。
 */
const { markClean } = useUnsavedChanges(
  () => title.value.trim() !== '' || content.value.trim() !== '' || files.value.length > 0,
)
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

      <!--
        输入时的识别预览。**必须有**：否则用户打完 #咖啡 完全不知道
        「这算不算一个话题」，发出去才发现详情页没有 chip。
        预览是本地解析的（规则见文件头注释），发布后以后端回传的为准。
      -->
      <div
        v-if="pickedTopics.length || pickedMentions.length"
        class="pickrow"
        data-test="note-topics-preview"
      >
        <span v-if="pickedTopics.length" class="picklabel">话题</span>
        <RouterLink
          v-for="t in pickedTopics"
          :key="t"
          class="pickchip"
          data-test="preview-topic"
          :to="'/topic/' + encodeURIComponent(t)"
        >
          #{{ t }}
        </RouterLink>
        <span v-if="pickedMentions.length" class="picklabel">提到</span>
        <span
          v-for="m in pickedMentions"
          :key="m"
          class="pickchip mention"
          data-test="preview-mention"
        >@{{ m }}</span>
      </div>
    </section>

    <section class="card xk-card">
      <div class="pics-head">
        <h2>图片</h2>
        <span class="count" :class="{ over: files.length > NOTE_IMAGE_LIMIT }">
          {{ files.length }}/{{ NOTE_IMAGE_LIMIT }}
        </span>
      </div>

      <p v-if="textMode" class="text-tip" data-test="text-mode-tip">
        没选图片 = 纯文字笔记：发布时自动生成一张文字卡片（小红书同款做法）
      </p>

      <div v-if="textMode" class="tpls" role="group" aria-label="文字卡模板" data-test="tpl-list">
        <button
          v-for="t in CARD_TEMPLATES"
          :key="t.id"
          type="button"
          class="tpl"
          :class="{ on: tplId === t.id }"
          :data-test="`tpl-${t.id}`"
          :aria-pressed="tplId === t.id"
          @click="pickTpl(t.id)"
        >
          <span
            class="swatch"
            :style="{ background: t.palette.surface, borderColor: t.palette.stroke }"
            aria-hidden="true"
          >
            <i :style="{ background: t.palette.amber }"></i>
          </span>
          {{ t.name }}
        </button>
      </div>

      <img
        v-if="textMode && previewUrl"
        :src="previewUrl"
        class="card-preview"
        alt="文字卡片预览"
        data-test="text-card-preview"
      />
      <div v-if="textMode && previewUrl && previewPages > 1" class="pager" data-test="text-card-pager">
        <button type="button" data-test="pager-prev" aria-label="上一页" @click="flipPage(-1)">‹</button>
        <span data-test="pager-index">{{ previewPage + 1 }}/{{ previewPages }}</span>
        <button type="button" data-test="pager-next" aria-label="下一页" @click="flipPage(1)">›</button>
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
          aria-label="选择图片"
          data-test="note-file"
          @change="onFileChange"
        />
        <span>+ 添加图片</span>
      </label>

      <p v-if="errorMsg" class="err" role="alert" data-test="note-error">{{ errorMsg }}</p>
    </section>
  </main>
</template>

<style scoped>
/* 识别预览：贴在下���输入框下面，一行 chip。视觉权重刻意压得很低，
   它是「告诉你系统读到了什么」，不是内容本身 */
.pickrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
}

.picklabel {
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
}

.pickchip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 999px;
  color: var(--xk-amber-text);
  font-size: var(--xk-fs-12);
  text-decoration: none;
}

.pickchip.mention {
  color: var(--xk-text-2);
}
/* 骨架默认在 main.css（别再抄一遍以免压掉全局断点）；
 * 这里是**有意**覆盖：发布页桌面改两栏。 */

/*
 * 桌面端：左表单 + 右 380 实时预览（小红书桌面发布页的两栏排法）。
 * 之前只有 max-width:720px 的「居中变窄」，表单和图片挤在一条 688px 的
 * 单栏里，右边 400 多像素白白空着 —— 那正是放文字卡预览的地方。
 *
 * 三个子元素按 DOM 顺序显式摆位（header 跨两列、section 分左右），
 * 不加包裹节点，模板和 data-test 一个不动。
 */
@media (min-width: 1024px) {
  .page {
    max-width: 1100px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    column-gap: 32px;
    row-gap: 16px;
    align-items: start;
  }

  .top {
    grid-column: 1 / -1;
    grid-row: 1;
  }

  /* 标题 + 正文 */
  section:nth-of-type(1) {
    grid-column: 1;
    grid-row: 2;
  }

  /* 图片区 + 文字卡预览：sticky 跟着滚，改字时预览一直在视线里 */
  section:nth-of-type(2) {
    grid-column: 2;
    grid-row: 2;
    position: sticky;
    top: 68px;
    align-self: start;
  }

  /*
   * 3:4 文字卡在 380 栏里自然高 507px，加上标题正文会把右栏顶出首屏。
   * 预览限高 420（计划 Track 3-C）：auto 宽 + contain，按原比例缩放不裁切。
   */
  .card-preview {
    width: auto;
    max-width: 100%;
    max-height: 420px;
    object-fit: contain;
    margin-inline: auto;
  }

  /* 688px 单栏时 160px 正文太矮，两栏后给正文更多呼吸空间 */
  .area {
    height: 220px;
  }
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

.back {
  min-width: 40px;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: none;
  font-size: var(--xk-fs-24);
  line-height: 1;
  color: var(--xk-text-2);
  cursor: pointer;
  padding: 0;
}

.submit {
  padding: 6px 16px;
  border: 0;
  border-radius: 999px;
  /* 原来写的是 var(--xk-accent) —— 这个变量全站从来没定义过，
   * background 声明整条被丢弃，按钮变成「白字 + 透明底」，
   * 浅色主题下等于隐形。全站强调色只有 --xk-amber。 */
  background: var(--xk-amber);
  color: var(--xk-amber-ink);
  font-size: var(--xk-fs-14);
  font-weight: 600;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/*
 * 字数计数的摆位。
 *
 * 原来是 .count{position:absolute;right:10px;bottom:10px} 钉在 .field 右下角，
 * 而 .area 的底部 padding 只有 10px —— 正文最后一行必然被计数盖住
 * （CDP 实测重叠 34×15px，标题 22×15px，桌面和移动端都有）。
 *
 * 现在 .field 改两行 grid，把「在 DOM 里排在 input 之后」的 .count
 * 显式摆到标签那一行的右端。不动模板，也就不会影响 data-test 选择器。
 */
.field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: var(--xk-space-2);
  margin-bottom: var(--xk-space-5);
}

.label {
  grid-area: 1 / 1 / 2 / 2;
  margin-bottom: var(--xk-space-2);
  font-size: var(--xk-fs-13);
  color: var(--xk-text-3);
}

.input {
  grid-area: 2 / 1 / 3 / 3;
  width: 100%;
  box-sizing: border-box;
  padding: var(--xk-space-3) var(--xk-space-4);
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text);
  font-size: var(--xk-fs-16);
  font-family: inherit;
}

.area {
  height: 160px;
  resize: none;
  line-height: 1.6;
}

.count {
  grid-area: 1 / 2 / 2 / 3;
  align-self: start;
  justify-self: end;
  font-size: var(--xk-fs-12);
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
  font-size: var(--xk-fs-15);
}

.text-tip {
  margin: -4px 0 8px;
  font-size: var(--xk-fs-12);
  line-height: 1.5;
  color: var(--xk-text-3);
}

.card-preview {
  display: block;
  width: 100%;
  border-radius: var(--xk-radius-blob-sm);
  border: var(--xk-stroke-w) solid var(--xk-border);
  margin-bottom: var(--xk-space-3);
}

/* 文字卡模板选择器：色块直观预览，选中态用描边加重 */
.tpls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--xk-space-2);
  margin: 0 0 var(--xk-space-3);
}

.tpl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 4px 10px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-12);
  cursor: pointer;
}

.tpl.on {
  border-color: var(--xk-stroke);
  background: var(--xk-surface);
  color: var(--xk-text);
  font-weight: 700;
  box-shadow: var(--xk-shadow-hard-sm);
}

.tpl .swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 2px solid;
  border-radius: 7px;
}

.tpl .swatch i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* 预览分页：正文 >1 页时翻页，别让用户以为超长正文被吞了 */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--xk-space-4);
  margin: calc(-1 * var(--xk-space-2)) 0 var(--xk-space-3);
}

.pager button {
  min-width: 40px;
  min-height: 40px;
  border: var(--xk-stroke-w) solid var(--xk-border);
  border-radius: 50%;
  background: var(--xk-surface-2);
  color: var(--xk-text);
  font-size: var(--xk-fs-20);
  line-height: 1;
  cursor: pointer;
}

.pager span {
  font-size: var(--xk-fs-13);
  color: var(--xk-text-2);
  font-variant-numeric: tabular-nums;
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
  font-size: var(--xk-fs-14);
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
  font-size: var(--xk-fs-14);
  cursor: pointer;
}

.picker input {
  display: none;
}

.err {
  margin: 12px 0 0;
  color: #e5484d;
  font-size: var(--xk-fs-13);
  line-height: 1.5;
}
</style>
