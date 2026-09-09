<script setup lang="ts">
import { computed } from 'vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useStatsStore } from '@/stores/stats'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'

/** 最近在听：按最近播放时间降序的歌曲 */
const stats = useStatsStore()
const library = useLibraryStore()
const player = usePlayerStore()

const recentSongs = computed(() => {
  const byPath = new Map(library.songs.map((s) => [s.path, s]))
  return stats.recentPaths
    .map((p) => byPath.get(p))
    .filter((s): s is NonNullable<typeof s> => !!s)
})

function onPlay(song: (typeof recentSongs.value)[number]) {
  void player.playSong(song, recentSongs.value)
}
</script>

<template>
  <div class="recent-view">
    <template v-if="recentSongs.length > 0">
      <SongList
        :songs="recentSongs"
        :current-path="player.currentPath"
        persist-key="list:recent"
        @play="onPlay"
      />
    </template>
    <div v-else class="empty">
      <AppIcon name="clock" :size="48" class="empty-icon" />
      <p class="empty-title">还没有最近在听</p>
      <p class="empty-hint">播放过的歌曲会按时间出现在这里</p>
    </div>
  </div>
</template>

<style scoped>
/* min-height 而非 height：内容走外层滚动（view-body），空态仍占满一屏居中 */
.recent-view {
  min-height: 100%;
  display: flex;
  flex-direction: column;
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
