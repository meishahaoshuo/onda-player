<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { capturePageTransition, playPageTransition } from '@/services/legacyFlip'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { SongRecord } from '@/types'

const library = useLibraryStore()
const ui = useUiStore()
const player = usePlayerStore()

const currentArtist = computed(() =>
  library.artists.find((a) => a.name === ui.detailKey),
)

/* 共享元素过渡 + 内容错峰浮现 + 返回轻淡出 */
const artistRevealed = ref(false)
const artistClosing = ref(false)

watch(
  currentArtist,
  async (artist) => {
    artistRevealed.value = false
    artistClosing.value = false
    if (!artist) return
    await nextTick()
    await playPageTransition(document.querySelector<HTMLElement>('.artist-detail .header-cover'))
    artistRevealed.value = true
  },
  { immediate: true, flush: 'post' },
)

function closeArtist() {
  if (artistClosing.value || !currentArtist.value) return
  artistClosing.value = true
  window.setTimeout(() => {
    ui.closeDetail()
    artistClosing.value = false
  }, 180)
}

function openArtist(artist: { name: string }, e: MouseEvent) {
  const cover = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('img, .cover-fallback')
  capturePageTransition(cover, { x: e.clientX, y: e.clientY })
  ui.openDetail(artist.name)
}

function onPlay(song: SongRecord) {
  if (!currentArtist.value) return
  void player.playSong(song, currentArtist.value.songs)
}

/** 当前播放的曲目是否属于这位艺术家（艺术家 key = artist） */
function isPlayingArtist(artist: { name: string }) {
  return player.current?.artist === artist.name
}
</script>

<template>
  <div v-if="currentArtist" class="artist-detail" :class="{ revealed: artistRevealed, closing: artistClosing }">
    <button class="back-btn" @click="closeArtist">
      <AppIcon name="close" :size="14" /> 返回艺术家列表
    </button>
    <header class="artist-header">
      <CoverImage :cover-id="currentArtist.coverId" :size="120" class="header-cover" />
      <div>
        <h1 class="artist-name">{{ currentArtist.name }}</h1>
        <div class="artist-sub">{{ currentArtist.songs.length }} 首歌曲</div>
      </div>
    </header>
    <SongList class="list" :songs="currentArtist.songs" :current-path="player.currentPath" @play="onPlay" />
  </div>

  <div v-else class="artist-grid">
    <button
      v-for="artist in library.artists"
      :key="artist.name"
      class="artist-card"
      :class="{ playing: isPlayingArtist(artist) }"
      @click="openArtist(artist, $event)"
    >
      <span class="cover-wrap">
        <CoverImage :cover-id="artist.coverId" :size="120" class="artist-cover" />
      </span>
      <div class="artist-name" :title="artist.name">{{ artist.name }}</div>
      <div class="artist-sub">{{ artist.songs.length }} 首</div>
    </button>
    <div v-if="library.artists.length === 0" class="empty-hint">暂无艺术家数据</div>
  </div>
</template>

<style scoped>
.artist-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: 6px;
}

.back-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.artist-header {
  display: flex;
  align-items: center;
  gap: 20px;
}

.artist-name {
  font-size: 24px;
  font-weight: 600;
}

.artist-sub {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.list {
  flex: 1;
  min-height: 0;
}

.artist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
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
  transition: background 0.15s;
}

.cover-wrap {
  position: relative;
}

.artist-card.playing .artist-name {
  color: var(--accent);
}

@media (hover: hover) and (pointer: fine) {
  .artist-card:hover {
    background: var(--bg-hover);
    transform: translateY(-3px);
    box-shadow: var(--shadow-2);
  }
  .artist-card:hover .artist-cover :deep(img),
  .artist-card:hover .artist-cover :deep(.cover-fallback) {
    transform: scale(1.05);
  }
}

.artist-card :deep(img),
.artist-card :deep(.cover-fallback) {
  border-radius: 50%;
  transition: transform var(--dur-med) var(--ease-spring);
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
  .artist-card:hover {
    transform: none;
  }
  .artist-card:hover .artist-cover :deep(img),
  .artist-card:hover .artist-cover :deep(.cover-fallback) {
    transform: none;
  }
}

/* 共享元素过渡落定后的错峰浮现 + 返回轻淡出 */
.artist-detail {
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
}

.artist-detail.closing {
  opacity: 0;
  transform: translateY(8px);
}

.artist-detail .back-btn,
.artist-detail .artist-header,
.artist-detail .list {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 320ms var(--ease-out), transform 320ms var(--ease-out);
}

.artist-detail.revealed .back-btn {
  transition-delay: 40ms;
}

.artist-detail.revealed .artist-header {
  transition-delay: 80ms;
}

.artist-detail.revealed .list {
  transition-delay: 120ms;
}

.artist-detail.revealed .back-btn,
.artist-detail.revealed .artist-header,
.artist-detail.revealed .list {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .artist-detail {
    transition: none;
  }
  .artist-detail.closing {
    transform: none;
  }
  .artist-detail .back-btn,
  .artist-detail .artist-header,
  .artist-detail .list {
    opacity: 1;
    transform: none;
    transition: none;
    transition-delay: 0ms;
  }
}
</style>
