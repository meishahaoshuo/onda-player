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
/** 正在播放的行相对当前视野的方位：false = 在上方（指针朝上），true = 在下方（朝下） */
const pointDown = ref(false)

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
  const above = top < host.scrollTop - 4
  const below = top + ROW > host.scrollTop + host.clientHeight + 4
  rowOffscreen.value = above || below
  pointDown.value = below
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

/** 拟物指向：灰色尾翼指向歌曲——行在下方 = 0deg（灰尾朝下），在上方 = 180deg（罗盘转半圈、灰尾朝上） */
const dirAngle = computed(() => (pointDown.value ? '0deg' : '180deg'))
/** 旋钮指示点本身是「指针」：直接指向歌曲（行在下方 = 180deg） */
const knobDirAngle = computed(() => (pointDown.value ? '180deg' : '0deg'))
</script>

<template>
  <!-- 常驻锚点：本身不可见，只为挂载期就近找 .scroll-host 与 .song-list -->
  <span ref="anchorEl" class="lf-anchor" aria-hidden="true"></span>
  <Transition name="fab">
    <button
      v-if="show"
      class="locate-fab"
      :class="[`v-${settings.locateFabStyle}`, { light: settings.resolvedTheme === 'light', down: pointDown }]"
      :style="{ '--halo-c': haloColor || 'var(--accent)', '--dir': dirAngle }"
      title="定位到正在播放"
      @click="locatePlaying"
    >
      <template v-if="settings.locateFabStyle === 'compass'">
        <span class="tick" aria-hidden="true"></span>
        <span class="tick e" aria-hidden="true"></span>
        <span class="tick s" aria-hidden="true"></span>
        <span class="tick w" aria-hidden="true"></span>
        <span class="needle-mount" aria-hidden="true"><span class="needle"></span></span>
        <span class="cap" aria-hidden="true"></span>
      </template>
      <template v-else-if="settings.locateFabStyle === 'drop'">
        <span class="gleam" aria-hidden="true"></span>
        <span class="orb" aria-hidden="true"></span>
      </template>
      <template v-else-if="settings.locateFabStyle === 'knob'">
        <span class="face" :style="{ transform: `rotate(${knobDirAngle})` }" aria-hidden="true"><span class="dot"></span></span>
      </template>
      <template v-else-if="settings.locateFabStyle === 'scale'">
        <span class="mount" aria-hidden="true"></span>
        <svg class="spring" viewBox="0 0 10 22" aria-hidden="true">
          <polyline points="5,0 0,3 10,6 0,9 10,12 0,15 10,18 5,21" />
        </svg>
        <span class="hook" aria-hidden="true"></span>
      </template>
      <template v-else-if="settings.locateFabStyle === 'yoyo'">
        <span class="string" aria-hidden="true"></span>
        <span class="disc" aria-hidden="true"></span>
      </template>
      <template v-else-if="settings.locateFabStyle === 'float'">
        <span class="water" aria-hidden="true"></span>
        <span class="ripple" aria-hidden="true"></span>
        <span class="floatbody" aria-hidden="true"></span>
      </template>
      <template v-else-if="settings.locateFabStyle === 'balloon'">
        <span class="env" aria-hidden="true"></span>
        <span class="flame" aria-hidden="true"></span>
        <span class="rope l" aria-hidden="true"></span>
        <span class="rope r" aria-hidden="true"></span>
        <span class="basket" aria-hidden="true"></span>
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

/* 磁针旋转座：随歌曲方位转（上方 0° / 下方 180°），弹簧过渡 + 常态 ±3° 微颤 */
/* 磁针旋转座：随歌曲方位转（上方 0° / 下方 180°），弹簧过渡；针身保持原版双锥外形 */
.locate-fab .needle-mount {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  transform: rotate(var(--dir, 0deg));
  transition: transform 0.9s var(--ease-spring);
  pointer-events: none;
}

.locate-fab .needle {
  position: absolute;
  left: -3px;
  top: -8px;
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-bottom: 16px solid var(--halo-c, var(--accent));
  filter: drop-shadow(0 0 2.5px color-mix(in srgb, var(--halo-c, var(--accent)) 55%, transparent));
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

/* 滴内光斑：封面色小珠游向歌曲方位一侧（上方浮到上半、下方沉到底部） */
.locate-fab .orb {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, color-mix(in srgb, var(--halo-c, var(--accent)) 55%, #fff), var(--halo-c, var(--accent)) 72%);
  box-shadow: 0 0 6px color-mix(in srgb, var(--halo-c, var(--accent)) 55%, transparent);
  transform: translateY(-3.5px) scale(0.95);
  transition: transform 0.9s var(--ease-spring);
  animation: fab-orb-breathe 3.2s ease-in-out infinite alternate;
  pointer-events: none;
}

.locate-fab.down .orb {
  transform: translateY(4px) scale(1.03);
}

@keyframes fab-orb-breathe {
  from { filter: brightness(0.92); }
  to { filter: brightness(1.12); }
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

/* 旋钮刻度盘：指示点直接指向歌曲方位（行内样式注入旋转角），弹簧过渡 */
.locate-fab .face {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  transition: transform 0.9s var(--ease-spring);
  pointer-events: none;
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

/* ── 吊簧秤：歌曲的「份量」挂在弹簧上——行在下方弹簧真形变拉长、挂钩下沉 ── */
.locate-fab.v-scale {
  width: 26px;
  height: 40px;
  border-radius: 0;
}

.locate-fab .mount {
  position: absolute;
  top: 0;
  left: 50%;
  width: 14px;
  height: 4px;
  margin-left: -7px;
  border-radius: 2px 2px 1px 1px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(140, 145, 158, 0.6));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

.locate-fab svg.spring {
  position: absolute;
  top: 4px;
  left: 50%;
  margin-left: -5px;
  width: 10px;
  height: 22px;
  transform-origin: top center;
  transition: transform 0.9s var(--ease-spring);
  pointer-events: none;
}

.locate-fab.v-scale.down svg.spring {
  transform: scaleY(1.55);
}

.locate-fab svg.spring polyline {
  fill: none;
  stroke: rgba(180, 186, 198, 0.85);
  stroke-width: 1.4;
  stroke-linejoin: round;
}

.locate-fab .hook {
  position: absolute;
  left: 50%;
  width: 8px;
  height: 10px;
  margin-left: -4px;
  top: 25px;
  border-radius: 2px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--halo-c, var(--accent)) 70%, #fff), var(--halo-c, var(--accent)));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    0 2px 5px rgba(0, 0, 0, 0.4);
  transition: top 0.9s var(--ease-spring);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.locate-fab.v-scale.down .hook {
  top: 30px;
}

.locate-fab .hook::after {
  content: '';
  width: 2.5px;
  height: 2.5px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
}

/* ── 悠悠球：线头拴在播放行方向——行在上方球收上去、在下方线放长球滚下去 ── */
.locate-fab.v-yoyo {
  width: 30px;
  height: 44px;
  border-radius: 0;
}

.locate-fab .string {
  position: absolute;
  left: 50%;
  top: 0;
  width: 1.5px;
  height: 12px;
  margin-left: -0.75px;
  background: linear-gradient(180deg, rgba(200, 205, 215, 0.7), rgba(200, 205, 215, 0.35));
  transition: height 0.9s var(--ease-spring);
  pointer-events: none;
}

.locate-fab.v-yoyo.down .string {
  height: 30px;
}

.locate-fab .disc {
  position: absolute;
  left: 50%;
  margin-left: -7px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  top: 2px;
  transition: top 0.9s var(--ease-spring);
  background:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.5), transparent 42%),
    radial-gradient(
      circle,
      color-mix(in srgb, var(--halo-c, var(--accent)) 85%, #fff) 0 3px,
      var(--halo-c, var(--accent)) 3px 5px,
      color-mix(in srgb, var(--halo-c, var(--accent)) 60%, #000) 5px 6.5px,
      var(--halo-c, var(--accent)) 7px
    );
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.4),
    inset 0 -1px 2px rgba(0, 0, 0, 0.3),
    0 3px 7px rgba(0, 0, 0, 0.4);
  animation: fab-yy-spin 1.6s linear infinite;
  pointer-events: none;
}

.locate-fab.v-yoyo.down .disc {
  top: 26px;
}

.locate-fab .disc::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2px;
  height: 5px;
  margin: -2.5px 0 0 -1px;
  border-radius: 1px;
  background: rgba(0, 0, 0, 0.35);
}

@keyframes fab-yy-spin {
  to { transform: rotate(360deg); }
}

/* ── 钓鱼浮漂：行在上方浮漂上浮出水更多，在下方沉得只剩红头；涟漪荡开 ── */
.locate-fab.v-float {
  width: 30px;
  height: 44px;
  border-radius: 0;
}

.locate-fab .water {
  position: absolute;
  left: 0;
  right: 0;
  top: 22px;
  height: 20px;
  border-radius: 6px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent) 24%, transparent),
    color-mix(in srgb, var(--accent) 10%, transparent)
  );
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--accent) 35%, transparent);
  pointer-events: none;
}

.locate-fab .floatbody {
  position: absolute;
  left: 50%;
  margin-left: -4px;
  width: 8px;
  height: 26px;
  top: 6px;
  border-radius: 4px 4px 2px 2px;
  background: linear-gradient(180deg, #e05656 0 9px, #f2f2f2 9px 17px, #2c2c30 17px);
  box-shadow:
    inset -1.5px 0 1.5px rgba(0, 0, 0, 0.25),
    inset 1px 0 1px rgba(255, 255, 255, 0.35),
    0 2px 6px rgba(0, 0, 0, 0.35);
  transition: top 0.9s var(--ease-spring);
  animation: fab-bob 2.8s ease-in-out infinite alternate;
  pointer-events: none;
}

.locate-fab.v-float.down .floatbody {
  top: 16px;
}

@keyframes fab-bob {
  from { transform: translateY(-1px) rotate(-2deg); }
  to { transform: translateY(1px) rotate(2deg); }
}

.locate-fab .ripple {
  position: absolute;
  left: 50%;
  top: 23px;
  width: 22px;
  height: 5px;
  margin-left: -11px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  animation: fab-rip2 2.6s var(--ease-out) infinite;
  pointer-events: none;
}

@keyframes fab-rip2 {
  from { transform: scale(0.6); opacity: 0.6; }
  to { transform: scale(1.5); opacity: 0; }
}

/* ── 热气球：行在上方整套上浮、在下方缓缓沉降，火焰用封面色烧着 ── */
.locate-fab.v-balloon {
  width: 30px;
  height: 46px;
  border-radius: 0;
}

.locate-fab .env {
  position: absolute;
  left: 50%;
  margin-left: -8px;
  width: 16px;
  height: 19px;
  top: 16px;
  border-radius: 50% 50% 46% 46%;
  transition: top 0.9s var(--ease-spring);
  background:
    radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.4), transparent 45%),
    repeating-conic-gradient(
      from 8deg at 50% 40%,
      color-mix(in srgb, var(--halo-c, var(--accent)) 85%, #fff) 0 14deg,
      var(--halo-c, var(--accent)) 14deg 28deg,
      color-mix(in srgb, var(--halo-c, var(--accent)) 62%, #3a2a18) 28deg 42deg
    );
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.18),
    0 3px 8px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.locate-fab.v-balloon.down .env {
  top: 22px;
}

.locate-fab .flame {
  position: absolute;
  left: 50%;
  margin-left: -1.5px;
  width: 3px;
  height: 4.5px;
  top: 34px;
  border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
  background: radial-gradient(circle at 50% 30%, #fff2c8, var(--halo-c, var(--accent)) 65%);
  box-shadow: 0 0 5px color-mix(in srgb, var(--halo-c, var(--accent)) 70%, transparent);
  animation: fab-flick 0.9s ease-in-out infinite alternate;
  transition: top 0.9s var(--ease-spring);
  pointer-events: none;
}

.locate-fab.v-balloon.down .flame {
  top: 40px;
}

@keyframes fab-flick {
  from { transform: scaleY(0.75); opacity: 0.8; }
  to { transform: scaleY(1.15); opacity: 1; }
}

.locate-fab .basket {
  position: absolute;
  left: 50%;
  margin-left: -3px;
  width: 6px;
  height: 4.5px;
  top: 39px;
  border-radius: 1.5px;
  background: linear-gradient(180deg, #9a744a, #6e5030);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transition: top 0.9s var(--ease-spring);
  pointer-events: none;
}

.locate-fab.v-balloon.down .basket {
  top: 45px;
}

.locate-fab .rope {
  position: absolute;
  left: 50%;
  width: 0.75px;
  height: 3px;
  background: rgba(160, 130, 90, 0.8);
  transition: top 0.9s var(--ease-spring);
  pointer-events: none;
}

.locate-fab .rope.l {
  margin-left: -2.5px;
  top: 35px;
}

.locate-fab .rope.r {
  margin-left: 2px;
  top: 35px;
}

.locate-fab.v-balloon.down .rope {
  top: 41px;
}

@media (prefers-reduced-motion: reduce) {
  .locate-fab .needle,
  .locate-fab .orb,
  .locate-fab.v-drop,
  .locate-fab .reel,
  .locate-fab .disc,
  .locate-fab .floatbody,
  .locate-fab .ripple,
  .locate-fab .flame {
    animation: none;
  }

  .locate-fab .needle-mount,
  .locate-fab .face,
  .locate-fab .orb,
  .locate-fab svg.spring,
  .locate-fab .hook,
  .locate-fab .string,
  .locate-fab .disc,
  .locate-fab .floatbody,
  .locate-fab .env,
  .locate-fab .flame,
  .locate-fab .basket,
  .locate-fab .rope {
    transition: none;
  }

  .fab-enter-active,
  .fab-leave-active {
    transition: none;
  }
}
</style>
