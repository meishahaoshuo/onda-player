<script setup lang="ts">
import { computed, ref } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import AppIcon from '@/components/AppIcon.vue'
import { formatDuration } from '@/utils/format'
import { useStatsStore } from '@/stores/stats'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import type { SongRecord } from '@/types'

/** 排行榜：按播放次数降序，默认 Top 50，可展开全部 */
const stats = useStatsStore()
const library = useLibraryStore()
const player = usePlayerStore()

const expanded = ref(false)
const DEFAULT_LIMIT = 50

/** 次数降序、同次数按标题；rank 从 1 起 */
const ranked = computed(() => {
  const counts = stats.counts
  const rows: { song: SongRecord; count: number; rank: number }[] = []
  for (const s of library.sortedSongs) {
    const c = counts[s.path] ?? 0
    if (c > 0) rows.push({ song: s, count: c, rank: 0 })
  }
  rows.sort((a, b) => b.count - a.count || a.song.title.localeCompare(b.song.title, 'zh-Hans-CN'))
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
})

const visible = computed(() =>
  expanded.value ? ranked.value : ranked.value.slice(0, DEFAULT_LIMIT),
)

const MEDAL: Record<number, string> = { 1: 'gold', 2: 'silver', 3: 'bronze' }

function onPlay(song: SongRecord) {
  player.playSong(song, ranked.value.map((r) => r.song))
}
</script>

<template>
  <div class="charts-view">
    <template v-if="ranked.length > 0">
      <div class="list-header">
        <span class="col-rank">名次</span>
        <span class="col-title">标题</span>
        <span class="col-artist">艺术家</span>
        <span class="col-album">专辑</span>
        <span class="col-count">播放次数</span>
        <span class="col-duration">时长</span>
      </div>
      <div class="list-body">
        <div
          v-for="row in visible"
          :key="row.song.path"
          class="chart-row"
          :class="{ playing: row.song.path === player.currentPath }"
          @click="onPlay(row.song)"
        >
          <span class="col-rank">
            <span class="rank-badge" :class="MEDAL[row.rank]">{{ row.rank }}</span>
          </span>
          <span class="col-title">
            <span class="title-line">
              <CoverImage :cover-id="row.song.coverId" :size="40" class="row-cover" />
              <span class="title-text">{{ row.song.title }}</span>
            </span>
          </span>
          <span class="col-artist" :title="row.song.artist">{{ row.song.artist }}</span>
          <span class="col-album" :title="row.song.album">{{ row.song.album }}</span>
          <span class="col-count">{{ row.count }} 次</span>
          <span class="col-duration">{{ formatDuration(row.song.durationSec) }}</span>
        </div>
      </div>
      <button
        v-if="!expanded && ranked.length > DEFAULT_LIMIT"
        class="expand-btn"
        @click="expanded = true"
      >
        <AppIcon name="expand" :size="14" /> 展开全部（{{ ranked.length }} 首）
      </button>
    </template>
    <div v-else class="empty">
      <AppIcon name="chart" :size="48" class="empty-icon" />
      <p class="empty-title">排行榜还没有数据</p>
      <p class="empty-hint">听满 30 秒或一半进度的歌曲会计入播放次数，榜单随播放自动更新</p>
    </div>
  </div>
</template>

<style scoped>
.charts-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-x: hidden;
}

.list-header,
.chart-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1.2fr) 88px 72px;
  gap: 12px;
  align-items: center;
  padding: 0 12px;
}

.list-header {
  height: 36px;
  font-size: 12px;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
}

.list-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.chart-row {
  height: 56px;
  border-radius: var(--radius-item);
  cursor: default;
  transition: background var(--dur-fast) var(--ease-out);
}

.chart-row:hover {
  background: var(--bg-hover);
}

.chart-row.playing {
  background: var(--bg-active);
}

.chart-row.playing .title-text {
  color: var(--accent);
}

.col-rank {
  display: flex;
  justify-content: center;
}

.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.rank-badge.gold {
  color: #fff;
  background: linear-gradient(135deg, #e8b64c, #c9932a);
}

.rank-badge.silver {
  color: #fff;
  background: linear-gradient(135deg, #b8bec9, #8e95a3);
}

.rank-badge.bronze {
  color: #fff;
  background: linear-gradient(135deg, #c99268, #a86e44);
}

.col-title {
  min-width: 0;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.row-cover {
  flex-shrink: 0;
}

.title-text {
  font-size: 13px;
  color: var(--text-primary);
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

.col-count {
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.col-duration {
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.expand-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: center;
  padding: 8px 20px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  transition: background 0.15s, color 0.15s;
}

.expand-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
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
