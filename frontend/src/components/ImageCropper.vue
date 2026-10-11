<script setup lang="ts">
/**
 * 图片裁剪器（P25）
 *
 * <p>裁剪在本机完成（canvas → Blob），**不上传原图再让服务端裁**：
 * 原图可能 10MB，裁完通常 1~2MB，走本机既省流量也省服务端 CPU。
 * 而且「上传前能改」和「上传后能改」是两种体验 —— 用户在发布页就已经
 * 知道自己要发什么，不该发出去再回来改。
 *
 * <p>支持的操作刻意只做**两个**：自由裁剪框 + 旋转 90°。
 * 缩放/滤镜是另一类东西（要的是「渲染管线」而不是「取景框」），
 * 一起做会让这个弹窗变成一个半成品的图片编辑器 —— 与其做半成品，
 * 不如把裁剪这件事做扎实。
 *
 * <p>⚠️ **EXIF 方向**：手机拍的竖图在部分浏览器里 `Image` 宽高与显示的
 * 相反（`<img>` 会按 EXIF 自动旋正，但 canvas 读到的原始像素是躺着的）。
 * 少处理这一步 = 用户按「竖着」裁，出来是横的。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { applyFilterToPixels, cssFilter, FILTERS } from '@/utils/filters'

const props = defineProps<{
  /** 待裁剪的图片（原始 File） */
  file: File | null
}>()
const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'apply', payload: { blob: Blob; previewUrl: string }): void
}>()

/* ---------------- 裁剪 / 滤镜（P26：同一个编辑器两个 tab） ---------------- */

/**
 * 当前 tab。
 *
 * <p>「裁剪」与「滤镜」放**同一个**弹窗而不是两个入口：它们改的是同一张图的
 * 同一份像素，分成两个弹窗意味着「裁完想再调个滤镜」要退出重进一次。
 */
const tab = ref<'crop' | 'filter'>('crop')

/**
 * 裁剪框**是否被用户动过**。
 *
 * <p>⚠️ 这条是 P26 里最容易被忽略的一处：不跟踪它，「只想加个滤镜」的用户
 * 会被静默裁掉一圈 —— 因为确定按钮走的是同一条渲染路径。
 * 症状极隐蔽：图看起来「就是小了一圈」，而用户根本不知道自己裁过。
 * 所以只有「用户真的调过取景框 / 选过比例 / 转过图」才裁。
 */
const cropTouched = ref(false)

const filterId = ref('none')

/** 预览用的 CSS filter（滤镜 tab 下贴在 img 上，实时且零像素开销） */
const previewFilter = computed(() => (tab.value === 'filter' ? cssFilter(filterId.value) : 'none'))

function pickFilter(id: string) {
  filterId.value = id
}
const box = ref({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
const rotate = ref(0)
const working = ref(false)
const error = ref('')

/** 输出长边上限。与后端 10MB 上限配合：原图可能 6K，导出按面积限制更稳 */
const OUT_MAX = 1600

const img = new Image()
const imgLoaded = ref(false)
/**
 * 预览用的 object URL。
 *
 * <p>刻意**在脚本里生成一次**而不是在模板里写 `URL.createObjectURL(file)`：
 * 模板表达式在**每次重渲染时都会重新求值**，等于每帧新建一个 object URL 而
 * 旧的永不 revoke —— 打开裁剪框几秒内存就涨上去了（对象 URL 的经典泄漏，
 * 肉眼完全看不出来）。
 */
const cropSrc = ref('')

/** 图片在容器里的实际显示区域（居中 + contain 后的矩形） */
const disp = ref({ left: 0, top: 0, w: 0, h: 0 })

const stageRef = ref<HTMLElement | null>(null)

const RATIOS = [
  { label: '自由', value: 0 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
]
const ratio = ref(0)

/**
 * 读 EXIF orientation 并按它预处理。
 *
 * <p>值 6/8 = 需要顺时针/逆时针转 90°，3/4 = 转 180°。
 * 做法是**画进 canvas 再转**，而不是去改 EXIF 标记 ——
 * 浏览器对 `createImageBitmap` 的 imageOrientation 支持并不一致，靠不住。
 */
async function loadImage(file: File): Promise<void> {
  imgLoaded.value = false
  error.value = ''
  if (cropSrc.value) URL.revokeObjectURL(cropSrc.value)
  cropSrc.value = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode'))
      img.src = cropSrc.value
    })
    const oriented = await applyExif(file, img)
    if (oriented !== img.src) {
      img.src = oriented
      await new Promise<void>((resolve) => {
        img.onload = () => resolve()
        img.onerror = () => resolve()
      })
    }
    imgLoaded.value = true
    // 换图才重置（同图内旋转是用户的既有选择，见 resetBox 的注释）
    rotate.value = 0
    // 新图 = 新的起点，之前那张动过框不算数
    cropTouched.value = false
    filterId.value = 'none'
    resetBox()
    await nextTick()
    measure()
  } catch {
    error.value = '这张图读不出来，换一张试试'
    imgLoaded.value = false
  }
}

async function applyExif(file: File, src: HTMLImageElement): Promise<string> {
  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer()
    const orientation = readExifOrientation(buf)
    if (!orientation || orientation === 1) return src.src
    const c = document.createElement('canvas')
    const swap = orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8
    c.width = swap ? src.naturalHeight : src.naturalWidth
    c.height = swap ? src.naturalWidth : src.naturalHeight
    const g = c.getContext('2d')
    if (!g) return src.src
    const deg = orientation === 3 || orientation === 8 ? 180
      : orientation === 6 || orientation === 7 ? 90
      : -90
    g.translate(c.width / 2, c.height / 2)
    g.rotate((deg * Math.PI) / 180)
    g.drawImage(src, -src.naturalWidth / 2, -src.naturalHeight / 2)
    return c.toDataURL('image/jpeg', 0.92)
  } catch {
    // 解析失败就按原图走 —— 少转一次不会丢内容，转错了才会
    return src.src
  }
}

/** 只扫 APP1 段的前 128KB：EXIF 在文件头，而 APP1 之后还有缩略图/JPEG 数据 */
function readExifOrientation(buf: ArrayBuffer): number {
  const v = new DataView(buf)
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return 1 // 不是 JPEG
  let off = 2
  while (off + 4 < v.byteLength) {
    if (v.getUint8(off) !== 0xFF) return 1
    const marker = v.getUint8(off + 1)
    const len = v.getUint16(off + 2)
    if (marker === 0xE1) {
      const base = off + 4
      if (v.getUint32(base) === 0x45786966) {
        const tiff = base + 6
        const le = v.getUint16(tiff) === 0x4949
        const u16 = (p: number) => v.getUint16(p)
        const u32 = (p: number) => (le ? v.getUint32(p) : v.getUint32(p))
        const ifd = tiff + u32(tiff + 4)
        const count = u16(ifd)
        for (let i = 0; i < count; i++) {
          const e = ifd + 2 + i * 12
          if (u16(e) === 0x0112) return u16(e + 8)
        }
      }
      return 1
    }
    if (marker === 0xDA) return 1 // 到了图像数据，后面不会有 EXIF
    off += 2 + len
  }
  return 1
}

/* ---------------- 显示区域测量 ---------------- */

/**
 * 算出图片在舞台里**实际渲染出来的**矩形。
 *
 * <p>⚠️ **不能用 `img.clientWidth/clientHeight`**：`.pic` 上是
 * `width:100%; height:100%` + `object-fit:contain`，于是 clientWidth 返回的是
 * **元素盒子**（= 舞台大小），而不是视觉内容占的那一块。拿元素盒子当显示区，
 * 裁剪框的像素映射就整体错了 —— 症状是「1:1 裁剪出来是竖的」。
 *
 * <p>正确做法是按 contain 的规则自己算：
 * {@code scale = min(舞台宽/图宽, 舞台高/图高)}，再居中。
 */
function measure() {
  const st = stageRef.value
  if (!st || !imgLoaded.value) return
  const sw = st.clientWidth
  const sh = st.clientHeight
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!sw || !sh || !nw || !nh) return
  // 旋转 90/270 后画面长宽互换，显示区也要跟着换 ——
  // 否则取景框仍按未旋转的尺寸定位，拖到右下角就会超出画面
  const swap = rotate.value === 90 || rotate.value === 270
  const dw = swap ? nh : nw
  const dh = swap ? nw : nh
  const scale = Math.min(sw / dw, sh / dh)
  const iw = dw * scale
  const ih = dh * scale
  disp.value = { left: (sw - iw) / 2, top: (sh - ih) / 2, w: iw, h: ih }
}

/**
 * 重置裁剪框。
 *
 * <p>⚠️ 刻意**不动 rotate**：它只归位裁剪框，而旋转是用户在**当前这张图**上
 * 已经做过的选择 —— 「换张图」不该把它悄悄清掉。之前 rotate 清零写在这里，
 * 结果 `rotate90()` 里「先转、再 resetBox、再补转」连写三行，
 * 第二次点旋转永远得到 90° 而不是 180°。
 * 换图时那一次重置由 {@link loadImage} 显式调用。
 */
function resetBox() {
  box.value = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
  ratio.value = 0
}

/* ---------------- 拖拽 ---------------- */

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'
const drag = ref<{ mode: DragMode; sx: number; sy: number; start: typeof box.value } | null>(null)

/** 归一化坐标 → 舞台像素坐标（供 CSS 绝对定位用） */
const boxStyle = computed(() => {
  const d = disp.value
  if (!d.w || !d.h) return { display: 'none' }
  return {
    left: d.left + box.value.x * d.w + 'px',
    top: d.top + box.value.y * d.h + 'px',
    width: box.value.w * d.w + 'px',
    height: box.value.h * d.h + 'px',
  }
})

function onDown(ev: PointerEvent, mode: DragMode) {
  ev.preventDefault()
  // 拖框 = 真的要裁（而「点一下选比例」也算，见 pickRatio）
  cropTouched.value = true
  drag.value = { mode, sx: ev.clientX, sy: ev.clientY, start: { ...box.value } }
  ;(ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId)
}

function onMove(ev: PointerEvent) {
  const g = drag.value
  const d = disp.value
  if (!g || !d.w || !d.h) return
  const dx = (ev.clientX - g.sx) / d.w
  const dy = (ev.clientY - g.sy) / d.h
  const s = g.start
  const MIN = 0.12

  if (g.mode === 'move') {
    box.value = {
      x: clamp(s.x + dx, 0, 1 - s.w),
      y: clamp(s.y + dy, 0, 1 - s.h),
      w: s.w,
      h: s.h,
    }
    return
  }
  // 四角拖拽：只改对应的那两条边
  let { x, y, w, h } = s
  if (g.mode === 'se' || g.mode === 'ne') w = clamp(s.w + dx, MIN, 1 - x)
  if (g.mode === 'se' || g.mode === 'sw') h = clamp(s.h + dy, MIN, 1 - y)
  if (g.mode === 'nw' || g.mode === 'sw') {
    const nw = clamp(s.w - dx, MIN, 1 - (s.x + dx))
    x = s.x + (s.w - nw)
    w = nw
  }
  if (g.mode === 'nw' || g.mode === 'ne') {
    const nh = clamp(s.h - dy, MIN, 1 - (s.y + dy))
    y = s.y + (s.h - nh)
    h = nh
  }
  box.value = { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h }
}

function onUp() {
  drag.value = null
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi)
}

/**
 * 切比例时保持「中心不动」，否则框会往一个角跑。
 *
 * <p>⚠️ 关键：**比例是「屏幕上的比例」**，不是「图像坐标里的比例」。
 * 直接按 `w = h / r` 去改归一化的 box，屏幕上框的长宽比会等于**图像的**
 * 长宽比 —— 用户选 1:1，看到的却是个 220:120 的扁框（实测 384×209）。
 *
 * <p>所以要先算出目标**屏幕尺寸**，再反推归一化坐标：
 * {@code 屏幕高 = min(显示区高, 显示区宽 / r)}，{@code 屏幕宽 = 屏幕高 * r}，
 * 然后各自除以显示区的宽高变回归一化值。
 */
function applyRatio() {
  const r = ratio.value
  const d = disp.value
  if (!r || !d.w || !d.h) return
  const b = box.value
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  // 目标屏幕尺寸：尽量大但不超出显示区
  let bh = Math.min(d.h, d.w / r)
  let bw = bh * r
  if (bw > d.w) {
    bw = d.w
    bh = bw / r
  }
  const nw = bw / d.w
  const nh = bh / d.h
  box.value = { x: clamp(cx - nw / 2, 0, 1 - nw), y: clamp(cy - nh / 2, 0, 1 - nh), w: nw, h: nh }
}

function pickRatio(r: number) {
  ratio.value = r
  // 点「自由」是**取消**比例约束，不等于想裁；但点具体比例（1:1 等）是明确要裁
  if (r !== 0) cropTouched.value = true
  applyRatio()
}

/**
 * 转 90°。
 *
 * <p>⚠️ **不重置比例**：用户刚选了 1:1，旋转一下比例就没了，是很难解释的行为。
 * 旋转改变的是**显示区的长宽**（见 measure 里的 swap），而比例是「屏幕比例」，
 * 所以正确的做法是重新按新显示区算一次框，而不是把它退化成自由框。
 *
 * <p>之前这里调 {@link resetBox}，它把 ratio 清零 —— 结果 1:1 的框变成
 * 「旋转后整张图的 80%」，裁出来 96×176 的竖图（实测）。
 */
function rotate90() {
  rotate.value = (rotate.value + 90) % 360
  measure()
  if (ratio.value) applyRatio()
  else resetBox()
}

/* ---------------- 输出 ---------------- */

async function apply(): Promise<void> {
  if (!imgLoaded.value || working.value) return
  working.value = true
  try {
    const blob = await render()
    emit('apply', { blob, previewUrl: URL.createObjectURL(blob) })
  } catch {
    error.value = '裁剪失败，换一张试试'
  } finally {
    working.value = false
  }
}

async function render(): Promise<Blob> {
  const natW = img.naturalWidth
  const natH = img.naturalHeight
  if (!natW || !natH) throw new Error('no image')

  const swap = rotate.value === 90 || rotate.value === 270
  const fullW = swap ? natH : natW
  const fullH = swap ? natW : natH

  // ⚠️ 裁剪框的像素位置（归一化 → 原图像素）
  // **没动过取景框时取整张**：见 cropTouched 的注释 ——
  // 「只想加个滤镜」的用户不该被静默裁掉一圈，而那个症状几乎无法自查。
  const doCrop = cropTouched.value || rotate.value !== 0
  const sx = doCrop ? Math.round(box.value.x * fullW) : 0
  const sy = doCrop ? Math.round(box.value.y * fullH) : 0
  const sw = doCrop ? Math.max(1, Math.round(box.value.w * fullW)) : fullW
  const sh = doCrop ? Math.max(1, Math.round(box.value.h * fullH)) : fullH

  const scale = Math.min(1, OUT_MAX / Math.max(sw, sh))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(sw * scale))
  c.height = Math.max(1, Math.round(sh * scale))
  const g = c.getContext('2d')
  if (!g) throw new Error('no ctx')
  // 先摆正旋转（绕中心），再从源图上取那一块
  g.translate(c.width / 2, c.height / 2)
  g.rotate((rotate.value * Math.PI) / 180)
  g.drawImage(
    img,
    sx - fullW / 2, sy - fullH / 2, sw, sh,
    (-sw * scale) / 2, (-sh * scale) / 2, sw * scale, sh * scale,
  )

  // 滤镜在裁剪**之后**施加：先裁出内容再调色，
  // 顺序反了的话边缘会带上取景框外被压暗的像素（比滤镜本身更难看）
  if (filterId.value !== 'none') {
    const data = g.getImageData(0, 0, c.width, c.height)
    applyFilterToPixels(data, filterId.value)
    g.putImageData(data, 0, 0)
  }
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92))
  if (!blob) throw new Error('toBlob failed')
  return blob
}

watch(() => props.file, (f) => {
  if (f) void loadImage(f)
}, { immediate: true })

onMounted(() => {
  window.addEventListener('resize', measure)
})

// object URL 不随组件卸载自动释放 —— 不 revoke 的话，每开一次裁剪框
// 就泄漏一份原图的内存（9 张图的笔记反复裁几轮就很可观）
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  if (cropSrc.value) URL.revokeObjectURL(cropSrc.value)
})
</script>

<template>
  <div class="mask" data-test="crop-mask" @click.self="emit('cancel')">
    <div class="sheet" role="dialog" aria-label="编辑图片">
      <header class="bar">
        <button type="button" class="linkbtn" data-test="crop-cancel" @click="emit('cancel')">取消</button>
        <b>编辑</b>
        <button
          type="button"
          class="linkbtn primary"
          data-test="crop-apply"
          :disabled="!imgLoaded || working"
          @click="apply"
        >
          {{ working ? '处理中…' : '确定' }}
        </button>
      </header>

      <!--
        裁剪 / 滤镜 两个 tab。用 `role=tablist` + `aria-selected`：
        切 tab 是**切换内容**而不是导航，a11y 上要读成 tab 才不会被读屏
        当成「跳到另一个页面」。
      -->
      <div class="tabs" role="tablist" aria-label="编辑方式">
        <button
          type="button"
          role="tab"
          class="tab"
          :class="{ on: tab === 'crop' }"
          :aria-selected="tab === 'crop'"
          data-test="crop-tab-crop"
          @click="tab = 'crop'"
        >裁剪</button>
        <button
          type="button"
          role="tab"
          class="tab"
          :class="{ on: tab === 'filter' }"
          :aria-selected="tab === 'filter'"
          data-test="crop-tab-filter"
          @click="tab = 'filter'"
        >滤镜</button>
      </div>

      <div ref="stageRef" class="stage">
        <img v-show="imgLoaded" :src="cropSrc" :style="{ filter: previewFilter }" alt="" class="pic" />
        <div v-if="imgLoaded && tab === 'crop'" class="box" :style="boxStyle" data-test="crop-box">
          <span class="grid" aria-hidden="true" />
          <button class="mask-area" type="button" aria-label="移动裁剪框" @pointerdown="onDown($event, 'move')" @pointermove="onMove" @pointerup="onUp" />
          <button class="h nw" type="button" aria-label="左上角" @pointerdown="onDown($event, 'nw')" @pointermove="onMove" @pointerup="onUp" />
          <button class="h ne" type="button" aria-label="右上角" @pointerdown="onDown($event, 'ne')" @pointermove="onMove" @pointerup="onUp" />
          <button class="h sw" type="button" aria-label="左下角" @pointerdown="onDown($event, 'sw')" @pointermove="onMove" @pointerup="onUp" />
          <button class="h se" type="button" aria-label="右下角" @pointerdown="onDown($event, 'se')" @pointermove="onMove" @pointerup="onUp" />
        </div>
        <p v-else-if="error" class="err" role="alert">{{ error }}</p>
        <p v-else-if="!imgLoaded" class="hint">读取中…</p>
      </div>

      <!--
        滤镜 tab：**不显示取景框**。
        显示它会让用户以为「框外那圈也会被处理」，于是有人为了「不裁到脸」
        特意把框挪开 —— 结果框本身成了一个假的裁剪暗示。
        滤镜是对**整张**图生效的，界面上就不该出现取景框。
      -->
      <div v-if="tab === 'crop'" class="tools">
        <div class="ratios" role="group" aria-label="裁剪比例">
          <button
            v-for="r in RATIOS"
            :key="r.label"
            type="button"
            class="chip"
            :class="{ on: ratio === r.value }"
            :aria-pressed="ratio === r.value"
            :data-test="`crop-ratio-${r.label}`"
            @click="pickRatio(r.value)"
          >
            {{ r.label }}
          </button>
        </div>
        <button class="chip" type="button" data-test="crop-rotate" @click="rotate90">
          旋转
        </button>
      </div>

      <div v-else class="tools">
        <div class="filters" role="radiogroup" aria-label="滤镜">
          <button
            v-for="f in FILTERS"
            :key="f.id"
            type="button"
            class="fchip"
            :class="{ on: filterId === f.id }"
            role="radio"
            :aria-checked="filterId === f.id"
            :data-test="`filter-${f.id}`"
            @click="pickFilter(f.id)"
          >
            <!-- 缩略图用**同一张原图 + 各自的 CSS filter**，所见即所得 -->
            <img :src="cropSrc" :style="{ filter: f.css }" alt="" class="fthumb" />
            <span>{{ f.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.sheet {
  width: 100%;
  max-width: 640px;
  background: var(--xk-surface-1);
  border-radius: 16px 16px 0 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  overflow: hidden;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--xk-space-3) var(--xk-card-pad);
  border-bottom: 1px solid var(--xk-stroke);
}

/* 裁剪 / 滤镜 切换（P26）
 *
 * 刻意做成**分段控件**而不是普通 chip 行：它是「同一件事的两种方式」，
 * 视觉上要在同一组里，而普通 chip 会被读成「又一排可点的按钮」。
 */
.tabs {
  display: flex;
  gap: var(--xk-space-1);
  padding: var(--xk-space-2) var(--xk-card-pad) 0;
}

.tab {
  min-height: 40px;
  padding: 0 var(--xk-space-4);
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-15);
  cursor: pointer;
}

.tab.on {
  border-bottom-color: var(--xk-amber);
  color: var(--xk-amber-text);
  font-weight: 600;
}

.linkbtn {
  min-height: 40px;
  padding: 0 var(--xk-space-2);
  border: 0;
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-16);
  cursor: pointer;
}

.linkbtn.primary { color: var(--xk-amber-text); font-weight: 600; }
.linkbtn:disabled { opacity: 0.4; }

.stage {
  position: relative;
  height: min(58vh, 420px);
  background: #14161f;
  overflow: hidden;
}

.pic {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.box {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #fff;
  border-radius: 2px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  touch-action: none;
}

.grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(to right, transparent 33.2%, rgba(255, 255, 255, 0.5) 33.2%, rgba(255, 255, 255, 0.5) 33.6%, transparent 33.6%, transparent 66.4%, rgba(255, 255, 255, 0.5) 66.4%, rgba(255, 255, 255, 0.5) 66.8%, transparent 66.8%),
    linear-gradient(to bottom, transparent 33.2%, rgba(255, 255, 255, 0.5) 33.2%, rgba(255, 255, 255, 0.5) 33.6%, transparent 33.6%, transparent 66.4%, rgba(255, 255, 255, 0.5) 66.4%, rgba(255, 255, 255, 0.5) 66.8%, transparent 66.8%);
}

.mask-area {
  position: absolute;
  inset: 0;
  border: 0;
  padding: 0;
  background: none;
  cursor: move;
  touch-action: none;
}

.h {
  position: absolute;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: none;
  touch-action: none;
}

.h::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border: 3px solid #fff;
  border-radius: 2px;
}

.h.nw { left: -14px; top: -14px; cursor: nwse-resize; }
.h.ne { right: -14px; top: -14px; cursor: nesw-resize; }
.h.sw { left: -14px; bottom: -14px; cursor: nesw-resize; }
.h.se { right: -14px; bottom: -14px; cursor: nwse-resize; }
.h.nw::after { right: 4px; bottom: 4px; border-right: 0; border-bottom: 0; }
.h.ne::after { left: 4px; bottom: 4px; border-left: 0; border-bottom: 0; }
.h.sw::after { right: 4px; top: 4px; border-right: 0; border-top: 0; }
.h.se::after { left: 4px; top: 4px; border-left: 0; border-top: 0; }

.hint, .err {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #cfd3e6;
  font-size: var(--xk-fs-15);
}

.err { color: #ff9a9a; }

.tools {
  display: flex;
  align-items: center;
  gap: var(--xk-space-2);
  padding: var(--xk-space-3) var(--xk-card-pad);
  border-top: 1px solid var(--xk-stroke);
}

.ratios { display: flex; gap: var(--xk-space-2); flex-wrap: wrap; }

/* 滤镜条（P26）：横向可滚，每项「缩略图 + 名字」 */
.filters {
  display: flex;
  gap: var(--xk-space-3);
  overflow-x: auto;
  padding-bottom: var(--xk-space-2);
  /* 滚动条不占布局高度，但 iOS 上仍需 momentum 滚动 */
  -webkit-overflow-scrolling: touch;
}

.fchip {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--xk-space-1);
  border: 2px solid transparent;
  border-radius: var(--xk-radius-blob-sm);
  background: none;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-12);
  cursor: pointer;
}

.fchip.on {
  border-color: var(--xk-amber);
  color: var(--xk-amber-text);
}

.fthumb {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--xk-surface-2);
  display: block;
}

.chip {
  min-height: 40px;
  padding: 0 var(--xk-space-3);
  border: 1px solid var(--xk-stroke);
  border-radius: 999px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-14);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.chip.on {
  border-color: var(--xk-amber);
  color: var(--xk-amber-text);
}
</style>