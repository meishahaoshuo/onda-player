<script setup lang="ts">
import VirtualList from '@/components/VirtualList.vue'
import CoverImage from '@/components/CoverImage.vue'
import QualityBadge from '@/components/QualityBadge.vue'
import AppIcon from '@/components/AppIcon.vue'
import { formatDuration } from '@/utils/format'
import { useSongActions } from '@/composables/useSongActions'
import { useFavoritesStore } from '@/stores/favorites'
import type { SongRecord } from '@/types'

const props = defineProps<{ songs: SongRecord[]; currentPath?: string | null; persistKey?: string }>()
const emit = defineEmits<{ play: [song: SongRecord] }>()

const ROW_HEIGHT = 56

const { openSongMenu } = useSongActions()
const favorites = useFavoritesStore()

function onRowClick(song: SongRecord) {
  emit('play', song)
}

function onRowMenu(song: SongRecord, e: MouseEvent) {
  openSongMenu(e, song, { context: props.songs })
}
</script>

<template>
  <div class="song-list">
    <!-- 表头 -->
    <div class="list-header">
      <span class="col-cover" aria-hidden="true"></span>
      <span class="col-title">标题</span>
      <span class="col-artist">艺术家</span>
      <span class="col-album">专辑</span>
      <span class="col-duration">时长</span>
    </div>

    <div class="list-body">
      <VirtualList :items="props.songs" :item-height="ROW_HEIGHT" :persist-key="props.persistKey">
        <template #default="{ item }">
          <div
            class="song-row"
            :class="{ playing: item.path === props.currentPath }"
            :style="{ height: `${ROW_HEIGHT}px` }"
            @click="onRowClick(item)"
            @contextmenu.prevent="onRowMenu(item, $event)"
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
              <span class="duration-text">
                {{ formatDuration(item.durationSec) }}
              </span>
              <span class="row-actions" @click.stop>
                <button
                  class="row-act"
                  :class="{ active: favorites.has(item.path) }"
                  :title="favorites.has(item.path) ? '取消收藏' : '收藏'"
                  @click="favorites.toggle(item.path)"
                >
                  <AppIcon name="heart" :size="15" :class="{ filled: favorites.has(item.path) }" />
                </button>
                <button class="row-act" title="更多操作" @click="onRowMenu(item, $event)">
                  <AppIcon name="more" :size="15" />
                </button>
              </span>
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
  min-width: 0;
  overflow-x: hidden;
}

.list-header {
  display: grid;
  grid-template-columns: 56px minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1.2fr) 72px;
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
  overflow-x: hidden;
}

.song-row {
  position: relative;
  display: grid;
  grid-template-columns: 56px minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1.2fr) 72px;
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
  min-width: 0;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-duration {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* 悬停快捷操作：盖住时长位浮出（爱心/更多），带渐变底衬盖住时长文字 */
.row-actions {
  position: absolute;
  right: 0;
  display: none;
  align-items: center;
  gap: 2px;
  padding-left: 28px;
  background: linear-gradient(to right, transparent, var(--bg-base) 38%);
}

.song-row:hover .row-actions {
  display: flex;
}

.song-row.playing:hover .row-actions {
  background: linear-gradient(to right, transparent, var(--bg-active) 38%);
}

.row-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--text-secondary);
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.row-act:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.row-act.active {
  color: var(--accent);
}

.row-act :deep(svg.filled) {
  fill: currentColor;
}
</style>
