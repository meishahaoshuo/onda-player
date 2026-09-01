<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration } from '@/utils/format'

/**
 * 通用可拖拽进度条。
 *
 * 状态模型（hover 与 drag 完全分离，避免互相污染）：
 *  - `hovering`：仅指针在轨道上方时为真，用于显示时间气泡与加粗轨道
 *  - `dragging`：仅按下后为真，期间显示 dragValue（松手才真正 seek）
 *  - `settling`：松手后到 currentTime 追上 dragValue 之前为真。
 *    旧实现缺这一态：松手瞬间 fill 会从拖动位置跳回还没更新的 current，
 *    视觉上就是"回弹抖一下"。
 *
 * 指针事件用 setPointerCapture 全程跟手，结束时显式 release，
 * 避免指针移出元素后丢失 up 事件导致 dragging 卡死。
 */
const props = defineProps<{ current: number; duration: number }>()
const emit = defineEmits<{ seek: [sec: number] }>()

const trackEl = ref<HTMLElement | null>(null)
const dragging = ref(false)
const hovering = ref(false)
const settling = ref(false)
const dragValue = ref(0)
const hoverRatio = ref(0)

/** 当前应显示的秒数：拖拽中预览 dragValue，否则跟随真实进度 */
const shownSec = computed(() => {
  if (dragging.value) return dragValue.value
  if (props.duration <= 0) return 0
  return Math.min(props.current, props.duration)
})

const pct = computed(() => (props.duration > 0 ? Math.min(100, (shownSec.value / props.duration) * 100) : 0))

function ratioFrom(clientX: number): number {
  const el = trackEl.value
  // ref 未挂载或宽度为 0（隐藏时）退化到 0，不抛错
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return 0
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
}

function onDown(e: PointerEvent) {
  if (props.duration <= 0) return
  // 阻止默认的文本选择 / 原生拖拽手势
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  dragging.value = true
  settling.value = false
  dragValue.value = ratioFrom(e.clientX) * props.duration
}

function onMove(e: PointerEvent) {
  const ratio = ratioFrom(e.clientX)
  // 只在跨越边界时置位，避免每次 pointermove 都触发一次多余的响应式更新
  if (!hovering.value) hovering.value = true
  hoverRatio.value = ratio
  if (dragging.value) dragValue.value = ratio * props.duration
}

function onUp(e: PointerEvent) {
  // 显式释放捕获：不依赖浏览器隐式释放，跨浏览器行为一致
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  if (!dragging.value) return
  dragging.value = false
  emit('seek', dragValue.value)
  // settling 期间继续显示 dragValue 的颜色与宽度，等 current 追上后再交还
  settling.value = true
  window.setTimeout(() => {
    settling.value = false
  }, 260)
}

function onLeave() {
  hovering.value = false
}

/** 键盘微调：←/→ 各 5 秒，Home/End 到头尾 */
function onKey(e: KeyboardEvent) {
  if (props.duration <= 0) return
  let next: number | null = null
  if (e.key === 'ArrowLeft') next = Math.max(0, shownSec.value - 5)
  else if (e.key === 'ArrowRight') next = Math.min(props.duration, shownSec.value + 5)
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = props.duration
  if (next === null) return
  e.preventDefault()
  emit('seek', next)
}

/* 气泡位置（跟随悬停/拖拽点，左右收边防溢出） */
const tipLeft = computed(() => `clamp(18px, ${hoverRatio.value * 100}%, calc(100% - 18px))`)
const tipSec = computed(() => hoverRatio.value * props.duration)
/** 拖拽中气泡高亮，与静置态区分 */
const interactive = computed(() => dragging.value || settling.value)
</script>

<template>
  <div
    class="pslider"
    :class="{ dragging, settling }"
    role="slider"
    tabindex="0"
    :aria-valuemin="0"
    :aria-valuemax="Math.round(duration)"
    :aria-valuenow="Math.round(shownSec)"
    :aria-valuetext="formatDuration(shownSec)"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onLeave"
    @keydown="onKey"
  >
    <div ref="trackEl" class="ps-track">
      <div class="ps-fill" :style="{ width: `${pct}%` }" />
      <div class="ps-thumb" :style="{ left: `${pct}%` }" />
    </div>
    <div v-if="hovering && duration > 0" class="ps-tip" :class="{ active: interactive }" :style="{ left: tipLeft }">
      {{ formatDuration(tipSec) }}
    </div>
  </div>
</template>

<style scoped>
.pslider {
  position: relative;
  display: flex;
  align-items: center;
  height: 16px; /* 固定热区：轨道只有 4px 时太难点中 */
  cursor: pointer;
  touch-action: none; /* 拖拽期间不触发页面手势 */
  user-select: none;
  outline: none;
}

.ps-track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 3px;
  background: var(--bg-hover);
  transition: height var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
  overflow: visible;
}

/* 单一来源：hover / dragging / settling / 键盘聚焦都加粗轨道（旧实现有两处重复规则） */
.pslider:hover .ps-track,
.pslider.dragging .ps-track,
.pslider.settling .ps-track,
.pslider:focus-visible .ps-track {
  height: 6px;
}

.ps-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 120ms linear, background var(--dur-fast) var(--ease-out);
}

/* 拖拽中零宽度延迟跟手；settling 保持拖拽色，交接时不闪 */
.pslider.dragging .ps-fill,
.pslider.settling .ps-fill {
  transition: background var(--dur-fast) var(--ease-out);
  background: var(--accent-strong);
}

.ps-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-primary);
  box-shadow: var(--shadow-1);
  transform: translate(-50%, -50%) scale(0);
  transition: transform var(--dur-fast) var(--ease-spring);
  pointer-events: none;
}

/* 同样单一来源，四种状态共用一条规则 */
.pslider:hover .ps-thumb,
.pslider.dragging .ps-thumb,
.pslider.settling .ps-thumb,
.pslider:focus-visible .ps-thumb {
  transform: translate(-50%, -50%) scale(1);
}

.pslider.dragging .ps-thumb {
  transform: translate(-50%, -50%) scale(1.25);
}

.ps-tip {
  position: absolute;
  bottom: calc(100% + 4px);
  transform: translateX(-50%);
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-1);
  pointer-events: none;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease-out);
}

.ps-tip.active {
  color: var(--accent);
}

.pslider:focus-visible .ps-track {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
