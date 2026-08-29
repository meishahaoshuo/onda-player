<script setup lang="ts">
import { computed } from 'vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { SongRecord } from '@/types'

const library = useLibraryStore()
const ui = useUiStore()
const player = usePlayerStore()

const currentGenre = computed(() =>
  library.genres.find((g) => g.name === ui.detailKey),
)

function onPlay(song: SongRecord) {
  if (!currentGenre.value) return
  void player.playSong(song, currentGenre.value.songs)
}
</script>

<template>
  <div v-if="currentGenre" class="genre-detail">
    <button class="back-btn" @click="ui.closeDetail()">
      <AppIcon name="close" :size="14" /> 返回曲风列表
    </button>
    <h1 class="genre-name">{{ currentGenre.name }}</h1>
    <SongList class="list" :songs="currentGenre.songs" :current-path="player.currentPath" @play="onPlay" />
  </div>

  <div v-else class="genre-list">
    <button
      v-for="genre in library.genres"
      :key="genre.name"
      class="genre-row"
      @click="ui.openDetail(genre.name)"
    >
      <AppIcon name="genre" :size="20" class="genre-icon" />
      <span class="genre-name">{{ genre.name }}</span>
      <span class="genre-count">{{ genre.songs.length }} 首</span>
    </button>
    <div v-if="library.genres.length === 0" class="empty-hint">暂无曲风数据</div>
  </div>
</template>

<style scoped>
.genre-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.genre-name {
  font-size: 24px;
  font-weight: 600;
}

.list {
  flex: 1;
  min-height: 0;
}

.genre-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.genre-row {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 52px;
  padding: 0 16px;
  border-radius: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  text-align: left;
  transition: background 0.15s;
}

.genre-row:hover {
  background: var(--bg-hover);
}

.genre-icon {
  color: var(--text-secondary);
}

.genre-row .genre-name {
  flex: 1;
  font-size: 14px;
}

.genre-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.empty-hint {
  color: var(--text-tertiary);
  padding: 48px 0;
  text-align: center;
}
</style>
