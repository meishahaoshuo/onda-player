<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import AppIcon from '@/components/AppIcon.vue'
import { formatDuration } from '@/utils/format'
import { useStatsStore } from '@/stores/stats'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useStaggerReveal } from '@/composables/useStaggerReveal'
import { flyToPlayerFromRow } from '@/services/coverFlight'
import type { SongRecord } from '@/types'

/** 排行榜：按播放次数降序；前三名领奖台展示，其余列表 */
const stats = useStatsStore()
const library = useLibraryStore()
const player = usePlayerStore()

const rootEl = ref<HTMLElement | null>(null)
const reveal = useStaggerReveal(() => rootEl.value, '.chart-row')

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

/** 领奖台视觉顺序：亚军在左、冠军居中最高、季军在右；不足三名时只出已有的 */
const podium = computed(() => {
  const at = (i: number) => ranked.value[i]
  return [
    { pos: 2, row: at(1) },
    { pos: 1, row: at(0) },
    { pos: 3, row: at(2) },
  ].filter((p): p is { pos: number; row: { song: SongRecord; count: number; rank: number } } => !!p.row)
})

/** 第 4 名起的列表 */
const rest = computed(() => ranked.value.slice(3))

/** 领奖台入场：挂载后触发一次自下而上的错峰升起 */
const podiumIn = ref(false)
const podiumTimer = window.setTimeout(() => (podiumIn.value = true), 30)

/* 第 4 名起的列表错峰浮现 */
watch(
  () => rest.value.length,
  () => reveal.refresh(),
  { flush: 'post' },
)

onMounted(() => reveal.refresh())
onBeforeUnmount(() => {
  reveal.disconnect()
  window.clearTimeout(podiumTimer)
})

function onPlay(song: SongRecord, e?: MouseEvent) {
  if (e) flyToPlayerFromRow(e)
  player.playSong(song, ranked.value.map((r) => r.song))
}
</script>

<template>
  <div ref="rootEl" class="charts-view">
    <template v-if="ranked.length > 0">
      <div class="list-body">
        <!-- 前三强：磨砂玻璃卡，随内容滚动；领奖台区不带表头 -->
        <div v-if="podium.length > 0" class="top3" :class="{ in: podiumIn }">
          <button
            v-for="p in podium"
            :key="p.row.song.path"
            class="top-card"
            :class="[`pos-${p.pos}`, { playing: p.row.song.path === player.currentPath }]"
            :style="{ '--rise-delay': `${(3 - p.pos) * 110}ms` }"
            @click="onPlay(p.row.song, $event)"
          >
            <div class="tc-cover" data-flight-cover>
              <CoverImage :cover-id="p.row.song.coverId" :size="76" />
            </div>
            <div class="tc-info">
              <div class="tc-title" :title="p.row.song.title">{{ p.row.song.title }}</div>
              <div class="tc-artist" :title="p.row.song.artist">{{ p.row.song.artist }}</div>
              <div class="tc-count">{{ p.row.count }} 次播放</div>
            </div>
            <span class="tc-rank">{{ p.row.rank }}</span>
          </button>
          <div v-if="rest.length === 0" class="list-end-hint">前三名就是全部上榜歌曲</div>
        </div>
        <!-- 表头只挂在第 4 名起的列表区上方，与行列严格同 grid 对齐 -->
        <template v-if="rest.length > 0">
          <div class="list-header">
            <span class="col-rank">名次</span>
            <span class="col-title">标题</span>
            <span class="col-artist">艺术家</span>
            <span class="col-album">专辑</span>
            <span class="col-count">播放次数</span>
            <span class="col-duration">时长</span>
          </div>
          <div
            v-for="row in rest"
            :key="row.song.path"
          class="chart-row"
          :class="{ playing: row.song.path === player.currentPath }"
          @click="onPlay(row.song, $event)"
        >
          <span class="col-rank">
            <span class="rank-badge">{{ row.rank }}</span>
          </span>
          <span class="col-title">
            <span class="title-line">
              <CoverImage :cover-id="row.song.coverId" :size="40" class="row-cover" data-flight-cover />
              <span class="title-text">{{ row.song.title }}</span>
            </span>
          </span>
          <span class="col-artist" :title="row.song.artist">{{ row.song.artist }}</span>
          <span class="col-album" :title="row.song.album">{{ row.song.album }}</span>
          <span class="col-count">{{ row.count }} 次</span>
          <span class="col-duration">{{ formatDuration(row.song.durationSec) }}</span>
        </div>
        </template>
      </div>
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
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-x: hidden;
}

/* ---------- 全息光柱领奖台 ---------- */
/* ---------- 前三强：磨砂玻璃卡 ---------- */

.top3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding: 4px 0 16px;
}

.top-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border-radius: var(--radius-panel);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-1);
  text-align: left;
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 420ms var(--ease-out), transform 480ms var(--ease-spring),
    border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-med) var(--ease-out);
  transition-delay: var(--rise-delay, 0ms);
}

.top3.in .top-card {
  opacity: 1;
  transform: translateY(0);
}

.top-card:hover {
  box-shadow: var(--shadow-2);
}

.top-card:hover :deep(.cover-img),
.top-card:hover :deep(.cover-fallback) {
  transform: scale(1.05);
}

.tc-cover :deep(.cover-img),
.tc-cover :deep(.cover-fallback) {
  transition: transform var(--dur-med) var(--ease-spring);
}

/* 冠军卡：品牌色描边 + 柔光 */
.top-card.pos-1 {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  box-shadow: 0 0 22px color-mix(in srgb, var(--accent) 14%, transparent), var(--shadow-1);
}

.top-card.playing .tc-title {
  color: var(--accent);
}

.tc-cover {
  flex-shrink: 0;
}

.tc-cover :deep(.cover-img),
.tc-cover :deep(.cover-fallback) {
  border-radius: 8px;
}

.tc-info {
  min-width: 0;
  flex: 1;
}

.tc-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 22px;
}

.tc-artist {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tc-count {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

/* 名次角标：冠军品牌色，其余中性 */
.tc-rank {
  position: absolute;
  top: 10px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.top-card.pos-1 .tc-rank {
  color: var(--accent-text);
  background: var(--accent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 40%, transparent);
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
  position: sticky;
  top: 0;
  z-index: 1;
  height: 36px;
  font-size: 12px;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-base);
}

.list-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.list-end-hint {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 20px 0;
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

@media (max-width: 900px) {
  .top3 {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .top-card {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
</style>
