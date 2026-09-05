<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { usePlayerStore } from '@/stores/player'
import { beginAlbumEnter, clearTransitionState } from '@/services/pageTransition'
import { paletteCache } from '@/services/paletteCache'
import { formatTotalDuration } from '@/utils/format'

const library = useLibraryStore()
const ui = useUiStore()
const player = usePlayerStore()

const gridEl = ref<HTMLElement | null>(null)

const sortedAlbums = computed(() =>
  [...library.albums].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
)

function openAlbum(album: { key: string; coverId: string | null }, e: MouseEvent) {
  const cardEl = e.currentTarget as HTMLElement
  const cover = cardEl.querySelector<HTMLElement>('img, .cover-fallback')
  if (!cover) return
  beginAlbumEnter({
    cardEl,
    coverEl: cover,
    click: { x: e.clientX, y: e.clientY },
    albumKey: album.key,
    coverId: album.coverId,
  })
}

/** 当前播放的曲目是否属于这张专辑（有封面按封面比对，无封面回退元数据 key） */
function isPlayingAlbum(album: { key: string; coverId: string | null }) {
  const c = player.current
  if (!c) return false
  if (album.coverId) return c.coverId === album.coverId
  return `${c.album}\n${c.albumArtist}` === album.key
}

/* ---------- 封面主色预取 ----------
   详情页的环境光晕原本是挂载后才异步取色，颜色必然迟到半拍。
   这里提前把可视区封面的主色算好，点击瞬间过渡就能直接用上。 */
let scrollEl: HTMLElement | null = null
let scrollTimer = 0

function primeVisible() {
  const cards = gridEl.value?.querySelectorAll<HTMLElement>('.album-card')
  if (cards) paletteCache.prime(cards)
}

function onScroll() {
  window.clearTimeout(scrollTimer)
  scrollTimer = window.setTimeout(onSettled, 200)
}

/** 滚动/尺寸稳定后：预取可视区封面主色 + 刷新磁吸矩形缓存 */
function onSettled() {
  primeVisible()
  refreshRects()
}

/** hover 视为"用户可能要点"，插队优先取色 */
function onHover(e: MouseEvent) {
  const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('.album-card')
  paletteCache.primeNow(card?.dataset.coverId)
}

/* ---------- 磁吸引力场 ----------
   与进入详情的「引力坍缩」同一套叙事：平时封面就有微弱的引力，
   光标靠近（240px 内）被轻轻吸过来（≤4px，按距离衰减），离开即弹回。
   性能护栏：矩形缓存 + rAF 节流，只写半径内卡片的 transform。 */
const MAGNET_RADIUS = 240
const MAGNET_STRENGTH = 0.05
const cardRects = new Map<HTMLElement, { cx: number; cy: number }>()
const magnetActive = new Set<HTMLElement>()
let magnetRaf = 0
let magnetEvt: MouseEvent | null = null

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function refreshRects() {
  cardRects.clear()
  for (const c of gridEl.value?.querySelectorAll<HTMLElement>('.album-card') ?? []) {
    const r = c.getBoundingClientRect()
    cardRects.set(c, { cx: r.left + r.width / 2, cy: r.top + r.height / 2 })
  }
}

function magnetFrame() {
  magnetRaf = 0
  const e = magnetEvt
  if (!e) return
  const next = new Set<HTMLElement>()
  cardRects.forEach((p, c) => {
    const dx = e.clientX - p.cx
    const dy = e.clientY - p.cy
    const d = Math.hypot(dx, dy)
    if (d >= MAGNET_RADIUS) return
    const pull = 1 - d / MAGNET_RADIUS
    next.add(c)
    c.style.transform = `translate(${(dx * pull * MAGNET_STRENGTH).toFixed(1)}px, ${(dy * pull * MAGNET_STRENGTH).toFixed(1)}px)`
  })
  magnetActive.forEach((c) => {
    if (!next.has(c)) {
      c.style.transform = ''
      magnetActive.delete(c)
    }
  })
  next.forEach((c) => magnetActive.add(c))
}

function onGridMouseMove(e: MouseEvent) {
  if (reducedMotion() || ui.dolly !== 'idle') return
  if (cardRects.size === 0) refreshRects()
  magnetEvt = e
  if (!magnetRaf) magnetRaf = requestAnimationFrame(magnetFrame)
}

function clearMagnet() {
  if (magnetRaf) {
    cancelAnimationFrame(magnetRaf)
    magnetRaf = 0
  }
  magnetActive.forEach((c) => (c.style.transform = ''))
  magnetActive.clear()
}

/* ---------- 入场错峰浮现 ----------
   进入专辑页时前 24 张卡片按序轻轻浮现（一次性、不循环）；
   视口外的卡片不做动画（否则延迟会累积到数秒）。
   从列表中部恢复浏览位置时跳过——对看不见的卡片做动画只会显得像在加载。 */
let entrancePlayed = false

function playEntrance() {
  if (reducedMotion()) return
  if (ui.albumsScrollTop > 10) return
  const cards = gridEl.value?.querySelectorAll<HTMLElement>('.album-card')
  if (!cards?.length) return
  const n = Math.min(cards.length, 24)
  for (let i = 0; i < n; i++) {
    cards[i].animate(
      [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 340, delay: i * 30, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'backwards' },
    )
  }
}

/* ---------- 浏览位置记忆：切视图卸载前捕获，回来时恢复 ---------- */
function restoreScroll() {
  const el = scrollEl
  if (!el || ui.albumsScrollTop <= 0) return
  el.scrollTop = ui.albumsScrollTop
  requestAnimationFrame(refreshRects)
}

watch(
  () => sortedAlbums.value.length,
  (n, o) => {
    if (n > 0 && o === 0 && !entrancePlayed) {
      entrancePlayed = true
      playEntrance()
    }
    if (n > 0) restoreScroll()
  },
  { flush: 'post' },
)

/* 过渡结束（详情返回/进入落定）后矩形缓存可能过时，回到 idle 时刷新 */
watch(
  () => ui.dolly,
  (v) => {
    if (v === 'idle') refreshRects()
  },
)

onMounted(() => {
  scrollEl = (gridEl.value?.closest('.view-body') as HTMLElement | null) ?? null
  scrollEl?.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  restoreScroll()
  if (sortedAlbums.value.length && !entrancePlayed) {
    entrancePlayed = true
    playEntrance()
  }
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
  const idle = () => onSettled()
  if (ric) ric(idle)
  else window.setTimeout(idle, 300)
})

onBeforeUnmount(() => {
  ui.albumsScrollTop = scrollEl?.scrollTop ?? 0
  scrollEl?.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  window.clearTimeout(scrollTimer)
  clearMagnet()
  // 网格被卸载（切到别的视图）时清理过渡遗留，避免动画引用已销毁的 DOM
  if (ui.dolly === 'idle') clearTransitionState()
})
</script>

<template>
  <div ref="gridEl" class="album-grid" @mouseover="onHover" @mousemove="onGridMouseMove" @mouseleave="clearMagnet">
    <button
      v-for="album in sortedAlbums"
      :key="album.key"
      class="album-card"
      :class="{ playing: isPlayingAlbum(album) }"
      :data-cover-id="album.coverId ?? ''"
      @click="openAlbum(album, $event)"
    >
      <span class="cover-wrap">
        <CoverImage :cover-id="album.coverId" :size="140" class="album-cover" />
      </span>
      <div class="album-name" :title="album.name">{{ album.name }}</div>
      <div class="album-sub">
        {{ album.artist }} · {{ album.songs.length }} 首 · {{ formatTotalDuration(album.totalDuration) }}
      </div>
    </button>
    <div v-if="sortedAlbums.length === 0" class="empty-hint">暂无专辑数据</div>
  </div>
</template>

<style scoped>
.album-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 20px;
}

.album-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-panel);
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out), transform 200ms var(--ease-out),
    box-shadow var(--dur-med) var(--ease-out);
  position: relative;
  overflow: hidden;
}

/* 播放态：标题转强调色（封面外圈的旋转光环已按需求移除） */
.cover-wrap {
  position: relative;
}

.album-card.playing .album-name {
  color: var(--accent);
}

/* hover：只留背景变亮 + 投影，位移交给磁吸引力场 */
@media (hover: hover) and (pointer: fine) {
  .album-card:hover {
    background: var(--bg-hover);
    box-shadow: var(--shadow-2);
  }
}

.album-cover {
  width: 140px;
  height: 140px;
}

.album-cover :deep(img),
.album-cover :deep(.cover-fallback) {
  width: 140px;
  height: 140px;
  border-radius: 8px;
}

.album-name {
  width: 100%;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.album-sub {
  width: 100%;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-hint {
  color: var(--text-tertiary);
  padding: 48px 0;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .album-card {
    transition: none;
  }
}
</style>
