<script setup lang="ts">
/**
 * 自定义视频播放器（P48：多码率 + 进度条）。
 *
 * <p><b>为什么要一个专门的组件而不用原生 controls</b>：原生的
 * 只有「能播」，清晰度切换做不进原生控件里；进度条也无法显示已缓冲段落。
 * 两页（详情/沉浸流）各写一份迟早漂移 —— 把「取景框」这一件事做扎实，一处收口。
 *
 * <p><b>清晰度切换保播放位置</b>：换 src 会打断播放与会话，先把
 * currentTime / 播放中状态记下来，新文件的 loadedmetadata 里恢复 ——
 * 否则用户的体感是「点了一下清晰度，视频从头开始」。
 *
 * <p><b>active 驱动暂停</b>（沉浸流滑动消费）：滑走的卡继续下载/播放
 * 既费流量又搅乱下一屏的手感。刻意不用 IntersectionObserver ——
 * 沉浸流本身就维护 active 下标，同一份事实传进 props 就够了。
 *
 * <p><b>duration 未知（预加载 metadata 没完成）时显示 0:00、忽略 seek</b>：
 * 拖一个还没量出来的进度条等于瞎猜，等元数据到了再放开。
 */
import { computed, ref, watch } from 'vue'
import type { VideoQualityVO } from '@/api/types'

const props = withDefaults(defineProps<{
  /** 当前播放文件的站点路径（默认档 = qualities[0].url） */
  src: string
  /** 全部清晰度档位（undefined / 长度不足 2 = 单码率，不渲染切换菜单） */
  qualities?: VideoQualityVO[] | null
  /** 封面（视频抽帧图），元数据加载前的占位画 */
  poster?: string | null
  /** 沉浸流：false 时暂停（组件自己不会去管「在不在视口」） */
  active?: boolean
  /** 静音自动播（浏览器规则：有声自动播必被拦，见 AGENTS P19） */
  autoplay?: boolean
  /** 初始静音 */
  startMuted?: boolean
  /** 空间紧张的紧凑控制条（沉浸流） */
  compact?: boolean
  /** 填满容器（沉浸流全屏卡），不按比例占位（详情页左栏） */
  fill?: boolean
}>(), {
  qualities: undefined,
  poster: undefined,
  active: true,
  autoplay: false,
  startMuted: false,
  compact: false,
  fill: false,
})

/** 上报真实宽高比，详情页用它把 --img-ratio 换成视频自己的形状 */
const emit = defineEmits<{ ratio: [w: number, h: number] }>()

const root = ref<HTMLDivElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const trackEl = ref<HTMLDivElement | null>(null)

/** 当前播放文件；清晰度切换只改它，props.src 变化（换卡）时重置 */
const currentUrl = ref(props.src)
const muted = ref(props.startMuted)
const playing = ref(false)
/** 没到元数据时是 0 —— 一切基于时长的交互（seek/进度条）都按未知处理 */
const duration = ref(0)
const cur = ref(0)
const buffered = ref(0)
const qMenu = ref(false)

/** 只有多于 1 档才有「切换」可言 */
const qualities = computed(() =>
  (props.qualities && props.qualities.length > 1 ? props.qualities : null))

/** 当前档位名（菜单按钮上直接展示，自解释） */
const qualityLabel = computed(() => {
  const qs = qualities.value
  if (!qs) return ''
  return (qs.find((q) => q.url === currentUrl.value) ?? qs[0]).label
})

/*
 * 清晰度切换的「断点续播」配套：
 * pickQuality 记下时间与播放态，loadedmetadata 里恢复。
 * pendingSeek = -1 表示没有待恢复。
 */
let pendingSeek = -1
let pendingPlay = false

function pickQuality(q: VideoQualityVO) {
  qMenu.value = false
  if (q.url === currentUrl.value) return
  const v = video.value
  pendingSeek = v?.currentTime ?? 0
  pendingPlay = v ? !v.paused : false
  currentUrl.value = q.url
}

/* 换卡（沉浸流 next/prev 时 src 变化）：从头开始，清掉档位切换的遗留 */
watch(() => props.src, (s) => {
  currentUrl.value = s
  pendingSeek = -1
  pendingPlay = false
  duration.value = 0
  cur.value = 0
  buffered.value = 0
})

watch(muted, (m) => {
  if (video.value) video.value.muted = m
})

/* 滑走就暂停；滑回来且带 autoplay 时恢复静音自动播 */
watch(() => props.active, (on) => {
  const v = video.value
  if (!on) {
    if (v && !v.paused) v.pause()
    return
  }
  if (props.autoplay) void tryPlay()
})

async function tryPlay() {
  const v = video.value
  if (!v) return
  if (props.autoplay) muted.value = true
  try {
    await v.play()
  } catch {
    /* 播放被浏览器策略拒绝时静默放弃：用户按中央播放键仍可手动开播 */
  }
}

function toggle() {
  const v = video.value
  if (!v) return
  if (v.paused) void tryPlay()
  else v.pause()
}

function onLoaded() {
  const v = video.value
  if (!v) return
  duration.value = Number.isFinite(v.duration) ? v.duration : 0
  cur.value = v.currentTime
  if (pendingSeek >= 0) {
    v.currentTime = pendingSeek
    pendingSeek = -1
  }
  if (pendingPlay) {
    pendingPlay = false
    void tryPlay()
  } else if (props.autoplay && props.active) {
    void tryPlay()
  }
  if (v.videoWidth > 0 && v.videoHeight > 0) {
    emit('ratio', v.videoWidth, v.videoHeight)
  }
}

function onTime() {
  const v = video.value
  if (v) cur.value = v.currentTime
}

/** buffered 的最后一段 end：主流浏览器都至少有 0..x 一段 */
function onBuf() {
  const v = video.value
  if (v && v.buffered.length) buffered.value = v.buffered.end(v.buffered.length - 1)
}

/* ---------------- 进度条（点击 + 拖动） ---------------- */

const pct = computed(() => (duration.value > 0 ? (cur.value / duration.value) * 100 : 0))
const bufPct = computed(() =>
  (duration.value > 0 && buffered.value > 0 ? (buffered.value / duration.value) * 100 : 0))
/** aria-valuemax 是整数秒；没元数据时给 1（避免 0/0） */
const vmax = computed(() => Math.max(Math.round(duration.value), 1))
const vnow = computed(() => Math.round(cur.value))

function seekRatio(r: number) {
  const v = video.value
  if (!v || duration.value <= 0) return
  v.currentTime = Math.min(Math.max(r, 0), 1) * duration.value
  cur.value = v.currentTime
}

const dragging = ref(false)

function trackPctOf(e: PointerEvent) {
  const el = trackEl.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  return (e.clientX - rect.left) / Math.max(rect.width, 1)
}

function onTrackDown(e: PointerEvent) {
  if (duration.value <= 0) return
  dragging.value = true
  const el = e.currentTarget as Element | null
  el?.setPointerCapture?.(e.pointerId)
  seekRatio(trackPctOf(e))
}

function onTrackMove(e: PointerEvent) {
  if (dragging.value) seekRatio(trackPctOf(e))
}

function onTrackUp(e: PointerEvent) {
  dragging.value = false
  const el = e.currentTarget as Element | null
  el?.releasePointerCapture?.(e.pointerId)
}

/* ---------------- 键盘：←→ ±5s / 空格 / M ---------------- */

function nudge(t: number) {
  const v = video.value
  if (!v || duration.value <= 0) return
  v.currentTime = Math.min(Math.max(t, 0), duration.value)
  cur.value = v.currentTime
}

function onKey(e: KeyboardEvent) {
  if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggle() }
  else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(cur.value + 5) }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(cur.value - 5) }
  else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); muted.value = !muted.value }
}

function fullscreen() {
  const el = root.value
  if (!el) return
  if (document.fullscreenElement) {
    void document.exitFullscreen()
  } else if (el.requestFullscreen) {
    void el.requestFullscreen()
  } else {
    // Safari 旧版只有 webkit 前缀的那一个
    const w = el as HTMLElement & { webkitRequestFullscreen?: () => void }
    w.webkitRequestFullscreen?.()
  }
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${ss < 10 ? '0' : ''}${ss}`
}
const timeText = computed(() => `${fmt(cur.value)} / ${fmt(duration.value)}`)
</script>

<template>
  <div
    ref="root"
    class="vp"
    :class="{ compact, fill }"
    data-test="vp-root"
    @keydown="onKey"
  >
    <!--
      原生 controls 移除（P48）：进度条/清晰度/静音/全屏由自定义条接管，
      但 <video> 的 data-test 名保持 note-video-player（P19 测试锚点）。
      preload="metadata"：只拿时长与首帧，不预下载内容。
    -->
    <video
      ref="video"
      class="vp-video"
      :src="currentUrl"
      :poster="poster ?? undefined"
      preload="metadata"
      playsinline
      :muted="muted"
      data-test="note-video-player"
      @loadedmetadata="onLoaded"
      @play="playing = true"
      @pause="playing = false"
      @timeupdate="onTime"
      @progress="onBuf"
      @click="toggle"
    />

    <!-- 中央播放键：暂停态才露出，不挡画面 -->
    <button
      v-if="!playing"
      class="vp-big"
      type="button"
      data-test="vp-play"
      aria-label="播放"
      @click="toggle"
    >▶</button>

    <div class="vp-bar">
      <span class="vp-time" data-test="vp-time">{{ timeText }}</span>

      <div
        ref="trackEl"
        class="vp-track"
        role="slider"
        aria-label="播放进度"
        :aria-valuemin="0"
        :aria-valuemax="vmax"
        :aria-valuenow="vnow"
        tabindex="0"
        data-test="vp-track"
        @pointerdown="onTrackDown"
        @pointermove="onTrackMove"
        @pointerup="onTrackUp"
        @pointercancel="onTrackUp"
      >
        <div class="vp-buffered" data-test="vp-buffer" :style="{ width: bufPct + '%' }" />
        <div class="vp-cur" :style="{ width: pct + '%' }" />
        <div class="vp-knob" :style="{ left: pct + '%' }" />
      </div>

      <!-- 清晰度：只有多档才渲染。按钮直接写档位名，比一个小图标更好懂 -->
      <div v-if="qualities" class="vp-qwrap">
        <button
          class="vp-btn vp-q"
          type="button"
          data-test="vp-qualities"
          aria-haspopup="true"
          :aria-expanded="qMenu"
          @click="qMenu = !qMenu"
        >{{ qualityLabel }}</button>
        <div v-if="qMenu" class="vp-menu" role="menu">
          <button
            v-for="q in qualities"
            :key="q.url"
            class="vp-item"
            type="button"
            role="menuitemradio"
            :aria-checked="q.url === currentUrl"
            :data-label="q.label"
            data-test="vp-quality"
            @click="pickQuality(q)"
          >{{ q.label }}</button>
        </div>
      </div>

      <button
        class="vp-btn"
        type="button"
        data-test="vp-mute"
        :aria-label="muted ? '取消静音' : '静音'"
        @click="muted = !muted"
      >{{ muted ? '🔇' : '🔊' }}</button>

      <button
        class="vp-btn"
        type="button"
        data-test="vp-full"
        aria-label="全屏"
        @click="fullscreen"
      >⛶</button>
    </div>
  </div>
</template>

<style scoped>
/* 详情页形态：宽度跟左栏，比例用视频元数据上报的 --img-ratio（父组件写入），9/16 兜底 */
.vp {
  position: relative;
  overflow: hidden;
  background: #000;
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: var(--xk-radius-blob);
}
.vp-video {
  display: block;
  width: 100%;
  max-height: 72vh;
  aspect-ratio: var(--img-ratio, 9 / 16);
  object-fit: contain;
  background: #000;
}

/* 中央播放键 */
.vp-big {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 64px;
  height: 64px;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 22px;
  cursor: pointer;
}
.vp-big:active { background: rgba(0, 0, 0, 0.75); }

/* 控制条：贴底，渐变托底保证白字在浅色视频上可读 */
.vp-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.62));
}

.vp-time {
  color: #fff;
  font-size: var(--xk-fs-12);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 轨道本体 6px，但热区用 flex 撑满整行高度（≥40px 靠 bar 的 padding 补足） */
.vp-track {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 24px;
  cursor: pointer;
  touch-action: none;
}
.vp-track::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 5px;
  transform: translateY(-50%);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.28);
}
.vp-buffered, .vp-cur {
  position: absolute;
  left: 0;
  top: 50%;
  height: 5px;
  transform: translateY(-50%);
  border-radius: 3px;
}
.vp-buffered { background: rgba(255, 255, 255, 0.42); }
.vp-cur { background: var(--xk-amber, #f5a623); }

.vp-knob {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #fff;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.vp-btn {
  min-width: 40px;
  min-height: 40px;
  padding: 0;
  border: 0;
  background: none;
  color: #fff;
  font-size: var(--xk-fs-16);
  cursor: pointer;
}
.vp-btn:active { color: var(--xk-amber, #f5a623); }

/* 清晰度菜单：贴在按钮上方 */
.vp-qwrap { position: relative; }
.vp-q { font-variant-numeric: tabular-nums; }
.vp-menu {
  position: absolute;
  right: 0;
  bottom: 100%;
  margin-bottom: 6px;
  min-width: 88px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(20, 20, 24, 0.92);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.vp-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-radius: 7px;
  background: none;
  color: #fff;
  font-size: var(--xk-fs-13);
  text-align: left;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.vp-item[aria-checked='true'] { color: var(--xk-amber, #f5a623); }
.vp-item:active { background: rgba(255, 255, 255, 0.12); }

/* ---------- 沉浸流形态 ---------- */
.vp.fill {
  position: absolute;
  inset: 0;
  border: 0;
  border-radius: 0;
}
.vp.fill .vp-video {
  width: 100%;
  height: 100%;
  max-height: none;
  aspect-ratio: auto;
}

/* 紧凑条：小屏卡里控制条占的空间收一档 */
.vp.compact .vp-bar { padding: 4px 4px 8px; gap: 2px; }
.vp.compact .vp-btn { min-width: 34px; min-height: 34px; font-size: var(--xk-fs-14); }
.vp.compact .vp-track { height: 20px; }
.vp.compact .vp-big { width: 52px; height: 52px; }
</style>
