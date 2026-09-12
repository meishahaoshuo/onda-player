<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { paletteCache } from '@/services/paletteCache'
import type { SongRecord } from '@/types'

/**
 * 定位悬浮球「澜」系列：正在播放的行滚出滚动宿主可视区时浮现，
 * 点击滚动回中，行回到视野后自动隐藏。外观四形态由 settings.locateFabStyle
 * 驱动（罗盘 / 露珠 / 电木旋钮 / 迷你卡带），固定 26px（卡带 32×21），
 * fixed 定位在时长列左侧、播放条上方。凡用 SongList 的歌曲列表都通用。
 */
const props = defineProps<{ songs: SongRecord[]; currentPath?: string | null }>()
const player = usePlayerStore()
const settings = useSettingsStore()

const ROW = 56
/** 常驻锚点：球按需浮现、button 常不在 DOM，挂载期靠它向上找滚动宿主 */
const anchorEl = ref<HTMLElement | null>(null)
let hostEl: HTMLElement | null = null
const rowOffscreen = ref(false)

/** 正在播放的歌在本列表中的行号；不在本列表（播放上下文不同）为 -1 */
const playingIndex = computed(() => {
  const p = props.currentPath
  return p ? props.songs.findIndex((s) => s.path === p) : -1
})

/** 行顶边相对滚动宿主内容起点的绝对偏移；测不到返回 null */
function rowTopInHost(): number | null {
  const host = hostEl
  const list = anchorEl.value?.parentElement
  const idx = playingIndex.value
  if (!host || !list || idx < 0) return null
  const listTop = list.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop
  return listTop + idx * ROW
}

function measureLocate() {
  const host = hostEl
  const top = rowTopInHost()
  if (!host || top === null) {
    rowOffscreen.value = false
    return
  }
  rowOffscreen.value = top < host.scrollTop - 4 || top + ROW > host.scrollTop + host.clientHeight + 4
}

function locatePlaying() {
  const host = hostEl
  const top = rowTopInHost()
  if (!host || top === null) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  host.scrollTo({
    top: Math.max(0, top - host.clientHeight / 2 + ROW / 2),
    behavior: reduced ? 'auto' : 'smooth',
  })
}

watch([playingIndex, () => props.songs.length], () => nextTick(measureLocate))

onMounted(() => {
  hostEl = anchorEl.value?.closest<HTMLElement>('.scroll-host') ?? null
  hostEl?.addEventListener('scroll', measureLocate, { passive: true })
  window.addEventListener('resize', measureLocate)
  measureLocate()
})

onBeforeUnmount(() => {
  hostEl?.removeEventListener('scroll', measureLocate)
  window.removeEventListener('resize', measureLocate)
  hostEl = null
})

/* 光珠/磁针色：当前封面明亮色（取色失败回落主题主色） */
const haloColor = ref('')
let haloSeq = 0
watch(
  () => player.current?.coverId ?? null,
  async (coverId) => {
    const seq = ++haloSeq
    if (!coverId) {
      haloColor.value = ''
      return
    }
    paletteCache.primeNow(coverId)
    const colors = await paletteCache.brightColors(coverId).catch(() => [] as string[])
    if (seq === haloSeq) haloColor.value = colors[0] ?? ''
  },
  { immediate: true },
)

const show = computed(() => playingIndex.value >= 0 && rowOffscreen.value)
</script>

<template>
  <!-- 常驻锚点：本身不可见，只为挂载期就近找 .scroll-host 与 .song-list -->
  <span ref="anchorEl" class="lf-anchor" aria-hidden="true"></span>
  <Transition name="fab">
    <button
      v-if="show"
      class="locate-fab"
      :class="[`v-${settings.locateFabStyle}`, { light: settings.resolvedTheme === 'light' }]"
      :style="{ '--halo-c': haloColor || 'var(--accent)' }"
      title="定位到正在播放"
      @click="locatePlaying"
    >
      <template v-if="settings.locateFabStyle === 'compass'">
        <span class="tick" aria-hidden="true"></span>
        <span class="tick e" aria-hidden="true"></span>
        <span class="tick s" aria-hidden="true"></span>
        <span class="tick w" aria-hidden="true"></span>
        <span class="needle" aria-hidden="true"></span>
        <span class="cap" aria-hidden="true"></span>
      </template>
      <template v-else-if="settings.locateFabStyle === 'drop'">
        <span class="gleam" aria-hidden="true"></span>
      </template>
      <template v-else-if="settings.locateFabStyle === 'knob'">
        <span class="dot" aria-hidden="true"></span>
      </template>
      <template v-else>
        <span class="labelbar" aria-hidden="true"></span>
        <span class="window" aria-hidden="true"></span>
        <span class="reel l" aria-hidden="true"></span>
        <span class="reel r" aria-hidden="true"></span>
      </template>
    </button>
  </Transition>
</template>

<style scoped>
/* 常驻锚点：零尺寸、不参与布局与命中 */
.lf-anchor {
  display: block;
  width: 0;
  height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  pointer-events: none;
}

/* 公共底座：fixed 贴视口——横向 = 内容右缘(24) + 行右缘(12) + 时长列(72) + 8px 间隙，
   即停在时长列左侧不遮时长；纵向在播放条上方。封面色 --halo-c 行内注入 */
.locate-fab {
  position: fixed;
  right: 116px;
  bottom: 116px; /* 标准条 80px / 胶囊 16+66px 上方都留出间距 */
  z-index: 4; /* 内容之上、详情覆盖层(5)/播放条(6)/弹窗(100) 之下 */
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: transform var(--dur-fast) var(--ease-spring);
  -webkit-tap-highlight-color: transparent;
}

.locate-fab:hover {
  transform: scale(1.09);
}

/* ── 罗盘：金属包边 + 玻璃盘面 + 方位刻度 + 封面色磁针弹簧摆动归北 ── */
.locate-fab.v-compass {
  background:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.35), transparent 45%),
    radial-gradient(circle at 50% 55%, rgba(30, 32, 40, 0.92), rgba(12, 12, 16, 0.96) 75%);
  box-shadow:
    0 0 0 1.5px rgba(190, 195, 205, 0.35),
    inset 0 0 0 1px rgba(0, 0, 0, 0.5),
    inset 0 1px 1px rgba(255, 255, 255, 0.22),
    0 5px 12px rgba(0, 0, 0, 0.45);
}

.locate-fab.light.v-compass {
  background:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.7), transparent 45%),
    radial-gradient(circle at 50% 55%, rgba(245, 246, 250, 0.95), rgba(225, 228, 236, 0.98) 75%);
  box-shadow:
    0 0 0 1.5px rgba(140, 145, 158, 0.5),
    inset 0 0 0 1px rgba(0, 0, 0, 0.08),
    inset 0 1px 1px rgba(255, 255, 255, 0.9),
    0 5px 12px rgba(0, 0, 0, 0.18);
}

.locate-fab .tick {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1px;
  height: 22px;
  margin: -11px 0 0 -0.5px;
  pointer-events: none;
}

.locate-fab .tick::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 3px;
  background: var(--text-tertiary);
}

.locate-fab .tick.e { transform: rotate(90deg); }
.locate-fab .tick.s { transform: rotate(180deg); }
.locate-fab .tick.w { transform: rotate(270deg); }

.locate-fab .needle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  margin: -8px 0 0 -3px;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-bottom: 16px solid var(--halo-c, var(--accent));
  filter: drop-shadow(0 0 2.5px color-mix(in srgb, var(--halo-c, var(--accent)) 55%, transparent));
  transform-origin: 50% 50%;
  animation: fab-settle 3.6s var(--ease-out) infinite;
  pointer-events: none;
}

.locate-fab .needle::after {
  content: '';
  position: absolute;
  left: -3px;
  top: 16px;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-top: 6px solid rgba(140, 145, 158, 0.9);
}

.locate-fab .cap {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 4px;
  margin: -2px 0 0 -2px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff, #888);
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

@keyframes fab-settle {
  0% { transform: rotate(-38deg); }
  24% { transform: rotate(14deg); }
  46% { transform: rotate(-7deg); }
  66% { transform: rotate(4deg); }
  82%, 100% { transform: rotate(0deg); }
}

/* ── 露珠：品牌「澜」的水滴——三层折光 + 封面色内斑，轮廓表面张力呼吸 ── */
.locate-fab.v-drop {
  border-radius: 50% 50% 50% 50% / 58% 58% 42% 42%;
  background:
    radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.95) 0 9%, rgba(255, 255, 255, 0.28) 16%, transparent 36%),
    radial-gradient(circle at 62% 78%, color-mix(in srgb, var(--halo-c, var(--accent)) 75%, transparent) 0 20%, transparent 50%),
    radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.16), rgba(120, 150, 190, 0.22) 70%, rgba(70, 100, 150, 0.32) 100%);
  box-shadow:
    inset 0 1.5px 1.5px rgba(255, 255, 255, 0.6),
    inset 0 -2px 3px color-mix(in srgb, var(--halo-c, var(--accent)) 35%, rgba(0, 0, 40, 0.25)),
    0 5px 12px rgba(0, 0, 0, 0.4);
  animation: fab-quiver 3.8s ease-in-out infinite;
}

.locate-fab.light.v-drop {
  box-shadow:
    inset 0 1.5px 1.5px rgba(255, 255, 255, 0.95),
    inset 0 -2px 3px color-mix(in srgb, var(--halo-c, var(--accent)) 30%, rgba(0, 0, 60, 0.14)),
    0 5px 12px rgba(0, 0, 0, 0.16);
}

.locate-fab .gleam {
  position: absolute;
  left: 30%;
  top: 18%;
  width: 4px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  transform: rotate(18deg);
  filter: blur(0.4px);
  pointer-events: none;
}

@keyframes fab-quiver {
  0%, 100% { border-radius: 50% 50% 50% 50% / 58% 58% 42% 42%; }
  30% { border-radius: 48% 52% 51% 49% / 56% 60% 40% 44%; }
  60% { border-radius: 52% 48% 49% 51% / 60% 56% 44% 40%; }
}

/* ── 电木旋钮：滚花外缘 + 拉丝面 + 封面色指示点，悬停拧过一个档位 ── */
.locate-fab.v-knob {
  background:
    radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.3), transparent 40%),
    radial-gradient(circle at 50% 50%, rgba(52, 54, 62, 0.95) 0 58%, transparent 60%),
    repeating-conic-gradient(from 0deg, rgba(255, 255, 255, 0.14) 0 5deg, rgba(0, 0, 0, 0.28) 5deg 10deg);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.45),
    inset 0 1px 1px rgba(255, 255, 255, 0.25),
    0 4px 10px rgba(0, 0, 0, 0.45);
}

.locate-fab.light.v-knob {
  background:
    radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.75), transparent 40%),
    radial-gradient(circle at 50% 50%, rgba(238, 240, 246, 0.98) 0 58%, transparent 60%),
    repeating-conic-gradient(from 0deg, rgba(255, 255, 255, 0.5) 0 5deg, rgba(0, 0, 0, 0.12) 5deg 10deg);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.1),
    inset 0 1px 1px rgba(255, 255, 255, 0.9),
    0 4px 10px rgba(0, 0, 0, 0.18);
}

.locate-fab .dot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3.5px;
  height: 3.5px;
  margin: -10.5px 0 0 -1.75px;
  border-radius: 50%;
  background: var(--halo-c, var(--accent));
  box-shadow: 0 0 4px color-mix(in srgb, var(--halo-c, var(--accent)) 65%, transparent);
  pointer-events: none;
}

.locate-fab.v-knob:hover {
  transform: rotate(32deg) scale(1.09);
}

.locate-fab.v-knob:hover .dot {
  box-shadow: 0 0 6px color-mix(in srgb, var(--halo-c, var(--accent)) 90%, transparent);
}

/* ── 迷你卡带：塑料壳 + 封面色标签条 + 观察窗双带轮异步慢转 ── */
.locate-fab.v-tape {
  width: 32px;
  height: 21px;
  border-radius: 4px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.14), transparent 40%),
    linear-gradient(180deg, #26262c, #17171b);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.1),
    inset 0 1px 1px rgba(255, 255, 255, 0.2),
    0 4px 10px rgba(0, 0, 0, 0.45);
}

.locate-fab.light.v-tape {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.5), transparent 40%),
    linear-gradient(180deg, #f2f2f5, #dcdce2);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.1),
    inset 0 1px 1px rgba(255, 255, 255, 0.9),
    0 4px 10px rgba(0, 0, 0, 0.16);
}

.locate-fab .labelbar {
  position: absolute;
  left: 3px;
  right: 3px;
  top: 2.5px;
  height: 6px;
  border-radius: 2px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--halo-c, var(--accent)) 80%, #fff), var(--halo-c, var(--accent)));
  box-shadow:
    inset 0 0.5px 0.5px rgba(255, 255, 255, 0.55),
    inset 0 -0.5px 0.5px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.locate-fab .window {
  position: absolute;
  left: 9px;
  right: 9px;
  top: 10.5px;
  height: 8px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.28);
  pointer-events: none;
}

.locate-fab.light .window {
  background: rgba(0, 0, 0, 0.08);
}

.locate-fab .reel {
  position: absolute;
  top: 11px;
  width: 6.5px;
  height: 6.5px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--bg-base) 0 1.5px, rgba(200, 205, 215, 0.75) 1.5px 2px, transparent 2.5px);
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow: inset 0 0 2px rgba(0, 0, 0, 0.5);
  animation: fab-reel 2.8s linear infinite;
  pointer-events: none;
}

.locate-fab .reel.l { left: 5px; }
.locate-fab .reel.r { right: 5px; animation-duration: 3.4s; }

@keyframes fab-reel {
  to { transform: rotate(360deg); }
}

/* 浮现 / 隐藏 */
.fab-enter-active,
.fab-leave-active {
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

@media (prefers-reduced-motion: reduce) {
  .locate-fab .needle,
  .locate-fab.v-drop,
  .locate-fab .reel {
    animation: none;
  }

  .fab-enter-active,
  .fab-leave-active {
    transition: none;
  }
}
</style>
