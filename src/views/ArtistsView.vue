<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import { beginAlbumEnter } from '@/services/pageTransition'
import { paletteCache } from '@/services/paletteCache'
import { useMagneticGrid } from '@/composables/useMagneticGrid'
import { useStaggerReveal } from '@/composables/useStaggerReveal'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'

/**
 * 艺术家网格：与专辑页同一套「引力坍缩」过渡 + 磁吸引力场。
 * 详情渲染在覆盖层组件 ArtistDetailView（由 App.vue 挂载），网格常驻不卸载。
 */
const library = useLibraryStore()
const player = usePlayerStore()

const gridEl = ref<HTMLElement | null>(null)
const magnet = useMagneticGrid(gridEl, '.artist-card')
const reveal = useStaggerReveal(() => gridEl.value, '.artist-card')

function openArtist(artist: { name: string; coverId: string | null }, e: MouseEvent) {
  const cardEl = e.currentTarget as HTMLElement
  const cover = cardEl.querySelector<HTMLElement>('img, .cover-fallback')
  if (!cover) return
  beginAlbumEnter({
    cardEl,
    coverEl: cover,
    click: { x: e.clientX, y: e.clientY },
    albumKey: artist.name,
    coverId: artist.coverId,
  })
}

/** 当前播放的曲目是否属于这位艺术家 */
function isPlayingArtist(artist: { name: string }) {
  return player.current?.artist === artist.name
}

/* 封面主色预取：过渡涟漪与详情环境色的取色来源 */
let scrollEl: HTMLElement | null = null
let scrollTimer = 0

function primeVisible() {
  const cards = gridEl.value?.querySelectorAll<HTMLElement>('.artist-card')
  if (cards) paletteCache.prime(cards)
}

function onScroll() {
  window.clearTimeout(scrollTimer)
  scrollTimer = window.setTimeout(primeVisible, 200)
}

/** hover 视为"用户可能要点"，插队优先取色 */
function onHover(e: MouseEvent) {
  const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('.artist-card')
  paletteCache.primeNow(card?.dataset.coverId)
}

/* 条目错峰浮现：数据就绪/增长后重新登记 */
watch(
  () => library.artists.length,
  () => reveal.refresh(),
  { flush: 'post' },
)

onMounted(() => {
  reveal.refresh()
  scrollEl = (gridEl.value?.closest('.view-body') as HTMLElement | null) ?? null
  scrollEl?.addEventListener('scroll', onScroll, { passive: true })
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
  if (ric) ric(() => primeVisible())
  else window.setTimeout(primeVisible, 300)
})

onBeforeUnmount(() => {
  reveal.disconnect()
  scrollEl?.removeEventListener('scroll', onScroll)
  window.clearTimeout(scrollTimer)
})
</script>

<template>
  <div
    ref="gridEl"
    class="artist-grid"
    @mouseover="onHover"
    @mousemove="magnet.onMouseMove"
    @mouseleave="magnet.onMouseLeave"
  >
    <button
      v-for="artist in library.artists"
      :key="artist.name"
      class="artist-card"
      :class="{ playing: isPlayingArtist(artist) }"
      :data-cover-id="artist.coverId ?? ''"
      @click="openArtist(artist, $event)"
    >
      <span class="cover-wrap">
        <CoverImage :cover-id="artist.coverId" :size="256" class="artist-cover" />
      </span>
      <div class="artist-name" :title="artist.name">{{ artist.name }}</div>
      <div class="artist-sub">{{ artist.songs.length }} 首</div>
    </button>
    <div v-if="library.artists.length === 0" class="empty-hint">暂无艺术家数据</div>
  </div>
</template>

<style scoped>
.artist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 20px;
}

.artist-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-radius: 10px;
  text-align: center;
  position: relative;
  overflow: hidden;
  transition: background var(--dur-fast) var(--ease-out), transform 200ms var(--ease-out),
    box-shadow var(--dur-med) var(--ease-out);
}

.cover-wrap {
  position: relative;
}

.artist-card.playing .artist-name {
  color: var(--accent);
}

/* hover：背景变亮 + 投影，位移交给磁吸引力场 */
@media (hover: hover) and (pointer: fine) {
  .artist-card:hover {
    background: var(--bg-hover);
    box-shadow: var(--shadow-2);
  }
}

.artist-card :deep(img),
.artist-card :deep(.cover-fallback) {
  border-radius: 50%;
}

/* 封面随卡片宽度自适应放大（网格 minmax 150，卡片内容宽约 118-170px） */
.artist-cover {
  width: 100%;
  aspect-ratio: 1;
}

.artist-cover :deep(img),
.artist-cover :deep(.cover-fallback) {
  width: 100%;
  height: 100%;
}

.artist-name {
  width: 100%;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.artist-sub {
  font-size: 12px;
  color: var(--text-secondary);
}

.empty-hint {
  color: var(--text-tertiary);
  padding: 48px 0;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .artist-card {
    transition: none;
  }
}
</style>
