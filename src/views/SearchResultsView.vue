<script setup lang="ts">
import { computed } from 'vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { useSearchScope } from '@/composables/useSearchScope'
import type { SongRecord } from '@/types'

/**
 * 搜索结果：在当前作用域内按标题/艺术家/专辑过滤。
 * 作用域由 useSearchScope 解析（歌单 / 专辑 / 艺术家 / 收藏 / 最近在听 / 排行榜 / 文件夹），
 * 无收窄语义的位置退化为全库，用户可手动切到全库。
 */
const player = usePlayerStore()
const ui = useUiStore()
const { scope, canNarrow } = useSearchScope()

const query = computed(() => ui.searchQuery.trim().toLowerCase())

const results = computed(() => {
  if (!query.value) return []
  return scope.value.songs.filter((s) =>
    (s.title + '\n' + s.artist + '\n' + s.album).toLowerCase().includes(query.value),
  )
})

function onPlay(song: SongRecord) {
  void player.playSong(song, results.value)
}
</script>

<template>
  <div class="search-view">
    <div v-if="query" class="scope-bar">
      <span class="scope-text">
        在<template v-if="scope.scoped">「{{ scope.label }}」</template>
        <template v-else>全部歌曲</template>中找到 {{ results.length }} 首
      </span>
      <div v-if="canNarrow" class="seg" role="group" aria-label="搜索范围">
        <button :class="{ on: !ui.searchAll }" @click="ui.searchAll = false">本范围</button>
        <button :class="{ on: ui.searchAll }" @click="ui.searchAll = true">全部歌曲</button>
      </div>
    </div>

    <SongList
      v-if="results.length > 0"
      class="results"
      :songs="results"
      :current-path="player.currentPath"
      :persist-key="`list:search:${scope.key}`"
      @play="onPlay"
    />

    <div v-else class="empty">
      <AppIcon name="search" :size="48" class="empty-icon" />
      <p class="empty-title">
        <template v-if="scope.scoped">「{{ scope.label }}」中没有找到「{{ ui.searchQuery.trim() }}」</template>
        <template v-else>没有找到「{{ ui.searchQuery.trim() }}」</template>
      </p>
      <p class="empty-hint">换个关键词试试，支持标题 / 艺术家 / 专辑</p>
      <button v-if="scope.scoped" class="empty-action" @click="ui.searchAll = true">
        在全部歌曲中搜索
      </button>
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

.scope-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px 12px;
  flex-shrink: 0;
}

.scope-text {
  font-size: 13px;
  color: var(--text-secondary);
}

/* 范围分段切换：与设置页分段同规格 */
.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-item);
  background: var(--bg-hover);
  flex-shrink: 0;
}

.seg button {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.18s var(--ease-out), color 0.18s var(--ease-out);
}

.seg button:hover {
  color: var(--text-primary);
}

.seg button.on {
  background: var(--bg-active);
  color: var(--accent-text, var(--text-primary));
  font-weight: 500;
}

.results {
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

.empty-action {
  margin-top: 4px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-primary);
  font-size: 13px;
  padding: 7px 16px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.18s var(--ease-out);
}

.empty-action:hover {
  background: var(--bg-hover);
}
</style>
