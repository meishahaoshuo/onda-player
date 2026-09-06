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

const MEDAL: Record<number, string> = { 1: 'gold', 2: 'silver', 3: 'bronze' }

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

async function clearStats() {
  await stats.clear()
}

function onPlay(song: SongRecord, e?: MouseEvent) {
  if (e) flyToPlayerFromRow(e)
  player.playSong(song, ranked.value.map((r) => r.song))
}
</script>

<template>
  <div ref="rootEl" class="charts-view">
    <template v-if="ranked.length > 0">
      <!-- 领奖台 -->
      <div v-if="podium.length > 0" class="podium" :class="{ in: podiumIn }">
        <button
          v-for="p in podium"
          :key="p.row.song.path"
          class="podium-card"
          :class="[`pos-${p.pos}`, { playing: p.row.song.path === player.currentPath }]"
          :style="{ '--rise-delay': `${(3 - p.pos) * 110}ms` }"
          @click="onPlay(p.row.song, $event)"
        >
          <div class="podium-top" data-flight-cover>
            <div class="podium-cover">
              <CoverImage :cover-id="p.row.song.coverId" :size="p.pos === 1 ? 112 : 88" />
              <span class="podium-medal" :class="MEDAL[p.row.rank]">{{ p.row.rank }}</span>
            </div>
            <div class="podium-info">
              <div class="podium-title" :title="p.row.song.title">{{ p.row.song.title }}</div>
              <div class="podium-artist" :title="p.row.song.artist">{{ p.row.song.artist }}</div>
              <div class="podium-count">{{ p.row.count }} 次播放</div>
            </div>
          </div>
          <div class="podium-pillar" :class="MEDAL[p.row.rank]">
            <span class="pillar-rank">{{ p.row.rank }}</span>
            <span class="pillar-label">{{ p.pos === 1 ? '冠军' : p.pos === 2 ? '亚军' : '季军' }}</span>
          </div>
        </button>
      </div>

      <div class="list-header" :class="{ 'first-group': podium.length === 0 }">
        <span class="col-rank">名次</span>
        <span class="col-title">标题</span>
        <span class="col-artist">艺术家</span>
        <span class="col-album">专辑</span>
        <span class="col-count">播放次数</span>
        <span class="col-duration">时长</span>
      </div>
      <div class="list-body">
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
        <div v-if="rest.length === 0" class="list-end-hint">前三名就是全部上榜歌曲</div>
      </div>

      <button class="clear-btn" title="清空所有播放统计" @click="clearStats">
        <AppIcon name="trash" :size="13" /> 清空统计
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
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-x: hidden;
}

/* ---------- 领奖台 ---------- */

.podium {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 16px;
  padding: 8px 0 0;
}

.podium-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 240px;
  border-radius: var(--radius-panel);
  opacity: 0;
  transform: translateY(34px);
  transition: opacity 480ms var(--ease-out), transform 560ms var(--ease-spring);
  transition-delay: var(--rise-delay, 0ms);
}

/* 冠军的台柱更高，卡片内容整体上抬 */
.podium-card.pos-1 .podium-pillar {
  height: 92px;
}

.podium-card.pos-2 .podium-pillar {
  height: 60px;
}

.podium-card.pos-3 .podium-pillar {
  height: 44px;
}

.podium.in .podium-card {
  opacity: 1;
  transform: translateY(0);
}

.podium-card:hover {
  background: var(--bg-hover);
}

.podium-card.playing {
  background: var(--bg-active);
}

.podium-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 12px;
}

.podium-cover {
  position: relative;
  border-radius: 10px;
  box-shadow: var(--shadow-2);
  transition: transform var(--dur-med) var(--ease-spring);
}

.podium-card:hover .podium-cover {
  transform: scale(1.04) translateY(-2px);
}

.podium-cover :deep(.cover-img),
.podium-cover :deep(.cover-fallback) {
  border-radius: 10px;
}

/* 名次徽章：骑在封面上角 */
.podium-medal {
  position: absolute;
  top: -8px;
  left: -8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  box-shadow: var(--shadow-1);
}

.podium-medal.gold {
  background: linear-gradient(135deg, #e8b64c, #c9932a);
}

.podium-medal.silver {
  background: linear-gradient(135deg, #b8bec9, #8e95a3);
}

.podium-medal.bronze {
  background: linear-gradient(135deg, #c99268, #a86e44);
}

.podium-info {
  min-width: 0;
  width: 100%;
  text-align: center;
}

.podium-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.podium-artist {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.podium-count {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}

/* 台柱：金属渐变柱身 + 顶部高光 */
.podium-pillar {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 8px;
  border-radius: 10px 10px 0 0;
  overflow: hidden;
}

.podium-pillar::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 40%;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.22), transparent);
  pointer-events: none;
}

.podium-pillar.gold {
  background: linear-gradient(180deg, #e8b64c, #a87820);
}

.podium-pillar.silver {
  background: linear-gradient(180deg, #b8bec9, #7c8494);
}

.podium-pillar.bronze {
  background: linear-gradient(180deg, #c99268, #8e5c38);
}

.pillar-rank {
  font-size: 22px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.92);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.pillar-label {
  font-size: 10px;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  color: rgba(255, 255, 255, 0.75);
  margin-top: 4px;
}

/* ---------- 第 4 名起的列表 ---------- */

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

.list-header.first-group {
  margin-top: 8px;
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

/* 清空统计：角落小按钮 */
.clear-btn {
  position: absolute;
  top: 4px;
  right: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
  opacity: 0.7;
  transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.clear-btn:hover {
  opacity: 1;
  background: var(--bg-hover);
  color: var(--danger);
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

@media (max-width: 860px) {
  .podium {
    gap: 8px;
  }

  .podium-card {
    width: 200px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .podium-card {
    opacity: 1;
    transform: none;
    transition: none;
  }

  .podium-card:hover .podium-cover {
    transform: none;
  }
}
</style>
