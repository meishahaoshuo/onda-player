<script setup lang="ts">
import VirtualList from '@/components/VirtualList.vue'
import CoverImage from '@/components/CoverImage.vue'
import QualityBadge from '@/components/QualityBadge.vue'
import { formatDuration } from '@/utils/format'
import type { SongRecord } from '@/types'

const props = defineProps<{ songs: SongRecord[]; currentPath?: string | null }>()
const emit = defineEmits<{ play: [song: SongRecord] }>()

const ROW_HEIGHT = 56

function onRowClick(song: SongRecord) {
  emit('play', song)
}
</script>

<template>
  <div class="song-list">
    <!-- 表头 -->
    <div class="list-header">
      <span class="col-title">标题</span>
      <span class="col-artist">艺术家</span>
      <span class="col-album">专辑</span>
      <span class="col-duration">时长</span>
    </div>

    <div class="list-body">
      <VirtualList :items="props.songs" :item-height="ROW_HEIGHT">
        <template #default="{ item }">
          <div
            class="song-row"
            :class="{ playing: item.path === props.currentPath }"
            :style="{ height: `${ROW_HEIGHT}px` }"
            @click="onRowClick(item)"
          >
            <span class="col-cover">
              <CoverImage :cover-id="item.coverId" :size="40" />
            </span>
            <span class="col-title">
              <span class="title-line">
                <QualityBadge
                  :container="item.container"
                  :sample-rate-hz="item.sampleRateHz"
                  :bits-per-sample="item.bitsPerSample"
                  :bitrate-kbps="item.bitrateKbps"
                />
                <span class="title-text">{{ item.title }}</span>
              </span>
              <span class="subtitle-text">{{ item.artist }}</span>
            </span>
            <span class="col-artist" :title="item.artist">{{ item.artist }}</span>
            <span class="col-album" :title="item.album">{{ item.album }}</span>
            <span class="col-duration">
              <span v-if="item.path === props.currentPath" class="eq" aria-hidden="true"><i /><i /><i /></span>
              {{ formatDuration(item.durationSec) }}
            </span>
          </div>
        </template>
      </VirtualList>
    </div>
  </div>
</template>

<style scoped>
.song-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.list-header {
  display: grid;
  grid-template-columns: 56px minmax(200px, 2.2fr) minmax(100px, 1fr) minmax(120px, 1.2fr) 72px;
  gap: 12px;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
}

.list-body {
  flex: 1;
  min-height: 0;
}

.song-row {
  display: grid;
  grid-template-columns: 56px minmax(200px, 2.2fr) minmax(100px, 1fr) minmax(120px, 1.2fr) 72px;
  gap: 12px;
  align-items: center;
  padding: 0 12px;
  border-radius: var(--radius-item);
  cursor: default;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.song-row:hover {
  background: var(--bg-hover);
  transform: translateX(2px);
}

.song-row.playing {
  background: var(--bg-active);
}

.song-row.playing .title-text {
  color: var(--accent);
}

.song-row:hover :deep(.cover-img),
.song-row:hover :deep(.cover-fallback) {
  transform: scale(1.08);
}

.song-row :deep(.cover-img),
.song-row :deep(.cover-fallback) {
  transition: transform var(--dur-med) var(--ease-spring);
}

.col-cover {
  display: flex;
}

.col-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.title-text {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subtitle-text {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-artist,
.col-album {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-duration {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
