<script setup lang="ts">
import { computed } from 'vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

/** 搜索结果：按标题/艺术家/专辑过滤全库歌曲，结果列表式展示 */
const library = useLibraryStore()
const player = usePlayerStore()
const ui = useUiStore()

const query = computed(() => ui.searchQuery.trim().toLowerCase())

const results = computed(() => {
  if (!query.value) return []
  return library.sortedSongs.filter((s) =>
    (s.title + '\n' + s.artist + '\n' + s.album).toLowerCase().includes(query.value),
  )
})

function onPlay(song: (typeof results.value)[number]) {
  void player.playSong(song, results.value)
}
</script>

<template>
  <div class="search-view">
    <template v-if="results.length > 0">
      <SongList
        :songs="results"
        :current-path="player.currentPath"
        :persist-key="'list:search'"
        @play="onPlay"
      />
    </template>
    <div v-else class="empty">
      <AppIcon name="search" :size="48" class="empty-icon" />
      <p class="empty-title">没有找到「{{ ui.searchQuery.trim() }}」</p>
      <p class="empty-hint">换个关键词试试，支持标题 / 艺术家 / 专辑</p>
    </div>
  </div>
</template>

<style scoped>
.search-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
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
</style>
