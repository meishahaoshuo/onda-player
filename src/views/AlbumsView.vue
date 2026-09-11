<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { beginAlbumEnter, clearTransitionState } from '@/services/pageTransition'
import { paletteCache } from '@/services/paletteCache'
import { useMagneticGrid } from '@/composables/useMagneticGrid'
import { formatTotalDuration } from '@/utils/format'

const library = useLibraryStore()
const player = usePlayerStore()

const gridEl = ref<HTMLElement | null>(null)
const magnet = useMagneticGrid(gridEl, '.album-card')

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

/** 当前播放的曲目是否属于这张专辑（专辑按专辑名分组，直接按名比对） */
function isPlayingAlbum(album: { key: string; name: string }) {
  const c = player.current
  if (!c) return false
  return c.album ? c.album === album.name : album.key === `meta:${c.albumArtist}`
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
  magnet.refreshRects()
}

/** hover 视为"用户可能要点"，插队优先取色 */
function onHover(e: MouseEvent) {
  const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('.album-card')
  paletteCache.primeNow(card?.dataset.coverId)
}

/* 浏览位置记忆已上收到 App.vue 的统一机制（key = view:albums|<detailKey>） */
watch(
  () => sortedAlbums.value.length,
  (n) => {
    if (n > 0) magnet.refreshRects()
  },
  { flush: 'post' },
)

onMounted(() => {
  scrollEl = (gridEl.value?.closest('.view-body') as HTMLElement | null) ?? null
  scrollEl?.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
  const idle = () => onSettled()
  if (ric) ric(idle)
  else window.setTimeout(idle, 300)
})

onBeforeUnmount(() => {
  scrollEl?.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  window.clearTimeout(scrollTimer)
  // 网格被卸载（切到别的视图）时无条件清理过渡遗留：
  // 动画引用即将指向已销毁的 DOM，且不能让旧记录污染下一个视图的过渡
  clearTransitionState()
})
</script>

<template>
  <div ref="gridEl" class="album-grid" @mouseover="onHover" @mousemove="magnet.onMouseMove" @mouseleave="magnet.onMouseLeave">
    <button
      v-for="album in sortedAlbums"
      :key="album.key"
      class="album-card"
      :class="{ playing: isPlayingAlbum(album) }"
      :data-cover-id="album.coverId ?? ''"
      @click="openAlbum(album, $event)"
    >
      <span class="cover-wrap">
        <CoverImage :cover-id="album.coverId" :size="256" class="album-cover" />
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
  /* 封面等比例放大后卡片随之变大（封面撑满卡片宽度） */
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
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
  /* 封面撑满卡片内容宽，等比例放大（ aspect-ratio 锁正方形） */
  width: 100%;
  aspect-ratio: 1;
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

/* 关键：class="album-cover" 直接落在 CoverImage 的根元素上（img 自身就是 .album-cover），
   后代选择器（.album-cover img）永远不命中——必须以 .cover-wrap 为祖先起手。
   .cover-wrap .album-cover (0,3,0) 恒胜 CoverImage 内部的 .cover-img[data-v] (0,2,0)，
   不依赖打包顺序。
   尺寸交给 .cover-wrap（width/height 属性只是默认表现）；
   contain 完整显示非正方封面（竖版/横版不再被裁切），空出的边由底色填充；
   display:block 消除 inline 图片的基线行盒空隙。 */
.cover-wrap .album-cover {
  display: block;
  width: 100% !important; /* fallback 是行内样式，必须 !important */
  height: 100% !important;
  object-fit: contain;
  background: var(--bg-hover);
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
