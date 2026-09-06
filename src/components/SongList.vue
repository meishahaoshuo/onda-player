<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import VirtualList from '@/components/VirtualList.vue'
import CoverImage from '@/components/CoverImage.vue'
import QualityBadge from '@/components/QualityBadge.vue'
import AppIcon from '@/components/AppIcon.vue'
import { formatDuration } from '@/utils/format'
import { useSongActions } from '@/composables/useSongActions'
import { useFavoritesStore } from '@/stores/favorites'
import { flyToPlayerFromRow } from '@/services/coverFlight'
import type { SongRecord } from '@/types'

const props = defineProps<{ songs: SongRecord[]; currentPath?: string | null; persistKey?: string }>()
const emit = defineEmits<{ play: [song: SongRecord] }>()

const ROW_HEIGHT = 56

const { openSongMenu } = useSongActions()
const favorites = useFavoritesStore()

/** 首屏错峰浮现：只对挂载初期渲染的行生效。
    虚拟列表滚动时会持续回收/重建行，一旦窗口期结束，行直接显示，滚动不闪动。 */
const REVEAL_WINDOW_MS = 900
const MAX_REVEAL_ROWS = 14
const booting = ref(true)
const bootTimer = window.setTimeout(() => (booting.value = false), REVEAL_WINDOW_MS)
onBeforeUnmount(() => window.clearTimeout(bootTimer))

function onRowClick(song: SongRecord, e: MouseEvent) {
  flyToPlayerFromRow(e)
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
        <template #default="{ item, index }">
          <div
            class="song-row"
            :class="{
              playing: item.path === props.currentPath,
              'stagger-row': booting && index < MAX_REVEAL_ROWS,
            }"
            :style="{ height: `${ROW_HEIGHT}px`, '--reveal-i': index }"
            @click="onRowClick(item, $event)"
            @contextmenu.prevent="onRowMenu(item, $event)"
          >
            <span class="col-cover" data-flight-cover>
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
            <span class="col-duration">{{ formatDuration(item.durationSec) }}</span>
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
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* 悬停快捷操作：悬浮在专辑列与时长列之间的空白区（右侧让出 72px 时长列 + 12px 间距），
   玻璃小胶囊不遮挡时长；opacity + 位移过渡浮现 */
.row-actions {
  position: absolute;
  top: 50%;
  right: 84px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-1);
  opacity: 0;
  transform: translateY(-50%) translateX(6px);
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.song-row:hover .row-actions,
.song-row:focus-within .row-actions {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
  pointer-events: auto;
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

/* 首屏行错峰浮现：窗口期内渲染的行依次上浮淡入。
   用 backwards 而非 forwards：结束后不残留 fill，行上原有的 hover 位移不被压住 */
.song-row.stagger-row {
  animation: row-reveal 340ms var(--ease-out) backwards;
  animation-delay: calc(var(--reveal-i, 0) * 40ms);
}

@keyframes row-reveal {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .song-row.stagger-row {
    animation: none;
  }
}
</style>
