<script setup lang="ts">
import { computed } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
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

function onPlay(song: SongRecord) {
  if (!currentArtist.value) return
  void player.playSong(song, currentArtist.value.songs)
}
</script>

<template>
  <div v-if="currentArtist" class="artist-detail">
    <button class="back-btn" @click="ui.closeDetail()">
      <AppIcon name="close" :size="14" /> 返回艺术家列表
    </button>
    <header class="artist-header">
      <CoverImage :cover-id="currentArtist.coverId" :size="120" />
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
      @click="ui.openDetail(artist.name)"
    >
      <CoverImage :cover-id="artist.coverId" :size="120" />
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
  transition: background 0.15s;
}

.artist-card:hover {
  background: var(--bg-hover);
}

.artist-card :deep(img),
.artist-card :deep(.cover-fallback) {
  border-radius: 50%;
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
</style>
