<script setup lang="ts">
import { computed } from 'vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useFavoritesStore } from '@/stores/favorites'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { SongRecord } from '@/types'

/** 我喜欢的音乐：收藏时间倒序，与歌曲列表同款交互 */
const favorites = useFavoritesStore()
const library = useLibraryStore()
const player = usePlayerStore()
const ui = useUiStore()

const songs = computed<SongRecord[]>(() => {
  const byPath = new Map(library.songs.map((s) => [s.path, s]))
  return favorites.paths.map((p) => byPath.get(p)).filter((s): s is SongRecord => s !== undefined)
})

function onPlay(song: SongRecord) {
  player.playSong(song, songs.value)
}

function goSongs() {
  ui.navigate('songs')
}
</script>

<template>
  <div class="favorites-view">
    <SongList
      v-if="songs.length > 0"
      :songs="songs"
      :current-path="player.currentPath"
      persist-key="list:favorites"
      @play="onPlay"
      class="list"
    />
    <div v-else class="empty">
      <AppIcon name="heart" :size="48" class="empty-icon" />
      <p class="empty-title">还没有收藏的歌曲</p>
      <p class="empty-hint">在歌曲、专辑等列表中点击歌曲右侧的爱心，即可收藏到这里</p>
      <button class="primary-btn" @click="goSongs">去歌曲列表看看</button>
    </div>
  </div>
</template>

<style scoped>
.favorites-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
}

.list {
  flex: 1;
  min-height: 0;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.empty-icon {
  color: var(--text-tertiary);
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
}

.empty-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.primary-btn {
  margin-top: 8px;
  padding: 10px 24px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 14px;
  font-weight: 500;
  transition: opacity 0.15s;
}

.primary-btn:hover {
  opacity: 0.9;
}
</style>
