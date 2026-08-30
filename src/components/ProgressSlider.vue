<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration } from '@/utils/format'

/**
 * 通用可拖拽进度条（主播放条 / 歌词页迷你条共用）。
 * pointerdown + setPointerCapture 全程跟手；拖拽中即时预览、松手才真正 seek，
 * 避免拖拽过程中被 timeupdate 反复拉回。悬停显示时间气泡。
 */
const props = defineProps<{ current: number; duration: number }>()
const emit = defineEmits<{ seek: [sec: number] }>()

const trackEl = ref<HTMLElement | null>(null)
const dragging = ref(false)
const hovering = ref(false)
const dragValue = ref(0)
const hoverRatio = ref(0)

const shownSec = computed(() => {
  if (dragging.value) return dragValue.value
  return Math.min(props.current, props.duration || props.current)
})

const pct = computed(() => (props.duration > 0 ? Math.min(100, (shownSec.value / props.duration) * 100) : 0))

function ratioFrom(clientX: number): number {
  const rect = trackEl.value!.getBoundingClientRect()
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
}

function onDown(e: PointerEvent) {
  if (props.duration <= 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragging.value = true
  dragValue.value = ratioFrom(e.clientX) * props.duration
}

function onMove(e: PointerEvent) {
  const ratio = ratioFrom(e.clientX)
  hovering.value = true
  hoverRatio.value = ratio
  if (dragging.value) dragValue.value = ratio * props.duration
}

function onUp() {
  if (!dragging.value) return
  emit('seek', dragValue.value)
  dragging.value = false
}

/* 气泡位置（跟随悬停/拖拽点，左右收边防溢出） */
const tipLeft = computed(() => `clamp(18px, ${hoverRatio.value * 100}%, calc(100% - 18px))`)
const tipSec = computed(() => hoverRatio.value * props.duration)
</script>

<template>
  <div
    class="pslider"
    :class="{ dragging }"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="hovering = false"
  >
    <div ref="trackEl" class="ps-track">
      <div class="ps-fill" :style="{ width: `${pct}%` }" />
      <div class="ps-thumb" :style="{ left: `${pct}%` }" />
    </div>
    <div v-if="hovering && duration > 0" class="ps-tip" :style="{ left: tipLeft }">
      {{ formatDuration(tipSec) }}
    </div>
  </div>
</template>

<style scoped>
.pslider {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none; /* 拖拽期间不触发页面手势 */
  user-select: none;
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

.pslider:hover .ps-track,
.pslider.dragging .ps-track {
  height: 6px;
}

.ps-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 120ms linear;
}

.pslider.dragging .ps-fill {
  transition: none; /* 拖拽时零延迟跟手 */
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

.pslider:hover .ps-thumb,
.pslider.dragging .ps-thumb {
  transform: translate(-50%, -50%) scale(1);
}

.ps-tip {
  position: absolute;
  bottom: calc(100% + 8px);
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
}
</style>
