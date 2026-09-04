<script setup lang="ts">
import { computed } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { usePlayerStore } from '@/stores/player'
import { capturePageTransition } from '@/services/pageTransition'
import { formatTotalDuration } from '@/utils/format'

const library = useLibraryStore()
const ui = useUiStore()
const player = usePlayerStore()

const sortedAlbums = computed(() =>
  [...library.albums].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
)

function openAlbum(album: { key: string }, e: MouseEvent) {
  const cover = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('img, .cover-fallback')
  capturePageTransition(cover, { x: e.clientX, y: e.clientY })
  ui.openDetail(album.key)
}

/** 当前播放的曲目是否属于这张专辑（专辑 key = album + \n + albumArtist） */
function isPlayingAlbum(album: { key: string }) {
  const c = player.current
  return c ? `${c.album}\n${c.albumArtist}` === album.key : false
}
</script>

<template>
  <div class="album-grid">
    <button
      v-for="album in sortedAlbums"
      :key="album.key"
      class="album-card"
      :class="{ playing: isPlayingAlbum(album) }"
      @click="openAlbum(album, $event)"
    >
      <span class="cover-wrap">
        <CoverImage :cover-id="album.coverId" :size="140" class="album-cover" />
        <span class="cover-ring" aria-hidden="true"></span>
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
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-med) var(--ease-spring),
    box-shadow var(--dur-med) var(--ease-out);
  position: relative;
  overflow: hidden;
}

/* 播放态：封面外圈缓慢旋转的光环（强调色 conic 高光，像「正在播放」）+ 标题转强调色 */
.cover-wrap {
  position: relative;
}

.cover-ring {
  position: absolute;
  inset: -3px;
  border-radius: 8px;
  padding: 3px;
  pointer-events: none;
  opacity: 0;
  background: conic-gradient(from 0deg, transparent, var(--accent), transparent 45%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  transition: opacity var(--dur-med) var(--ease-out);
}

.album-card.playing .cover-ring {
  opacity: 1;
  animation: cover-spin 3.2s linear infinite;
}

.album-card.playing .album-name {
  color: var(--accent);
}

@keyframes cover-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (hover: hover) and (pointer: fine) {
  .album-card:hover {
    background: var(--bg-hover);
    transform: translateY(-3px);
    box-shadow: var(--shadow-2);
  }
}

/* 光泽扫过 */
.album-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 60%;
  height: 100%;
  background: linear-gradient(105deg, transparent, var(--sheen), transparent);
  transform: translateX(-150%) skewX(-18deg);
  transition: transform 0.32s var(--ease-out);
  pointer-events: none;
}

@media (hover: hover) and (pointer: fine) {
  .album-card:hover::after {
    transform: translateX(250%) skewX(-18deg);
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
  transition: transform var(--dur-med) var(--ease-spring);
}

@media (hover: hover) and (pointer: fine) {
  .album-card:hover .album-cover :deep(img),
  .album-card:hover .album-cover :deep(.cover-fallback) {
    transform: scale(1.04);
  }
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
  .cover-ring {
    animation: none;
  }
  .album-card:hover {
    transform: none;
  }
  .album-card:hover .album-cover :deep(img),
  .album-card:hover .album-cover :deep(.cover-fallback) {
    transform: none;
  }
  .album-card::after {
    transition: none;
  }
}
</style>
