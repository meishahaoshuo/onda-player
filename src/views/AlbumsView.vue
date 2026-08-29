<script setup lang="ts">
import { computed } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { formatTotalDuration } from '@/utils/format'

const library = useLibraryStore()
const ui = useUiStore()

const sortedAlbums = computed(() =>
  [...library.albums].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
)

function openAlbum(key: string) {
  ui.openDetail(key)
}
</script>

<template>
  <div class="album-grid">
    <button v-for="album in sortedAlbums" :key="album.key" class="album-card" @click="openAlbum(album.key)">
      <CoverImage :cover-id="album.coverId" :size="140" class="album-cover" />
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
  border-radius: 10px;
  text-align: left;
  transition: background 0.15s;
}

.album-card:hover {
  background: var(--bg-hover);
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
</style>
