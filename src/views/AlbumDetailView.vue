<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import AppIcon from '@/components/AppIcon.vue'
import QualityBadge from '@/components/QualityBadge.vue'
import { paletteCache } from '@/services/paletteCache'
import { playAlbumEnter, playAlbumExit } from '@/services/pageTransition'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { formatDuration, formatTotalDuration } from '@/utils/format'
import type { SongRecord } from '@/types'

/**
 * 专辑详情页（对照截图 3）：大封面头部 + 取色环境光晕 + 统计 + 播放/随机 + 碟片分组曲目
 */
const props = defineProps<{ albumKey: string }>()

const library = useLibraryStore()
const player = usePlayerStore()
const ui = useUiStore()

/* 相机推进过渡：进入由编排器接管，返回对称反向 */
const rootEl = ref<HTMLElement | null>(null)
const revealed = ref(false)
const closing = ref(false)
/** 环境光晕在开场就随推进晕开（不等封面落定） */
const blooming = ref(false)

watch(
  () => props.albumKey,
  async () => {
    revealed.value = false
    closing.value = false
    blooming.value = false
    await nextTick()
    blooming.value = true
    await playAlbumEnter(rootEl.value)
    revealed.value = true
  },
  { immediate: true, flush: 'post' },
)

async function close() {
  if (closing.value || ui.dolly !== 'idle') return
  closing.value = true
  blooming.value = false
  ui.beginDollyExit()
  await playAlbumExit(rootEl.value)
  ui.closeDetail()
  ui.endDolly()
  closing.value = false
}

/* 头部玻璃面板的色调渲染：取封面主色，低透明度融进磨砂玻璃 */
const ambientBase = ref<string>('transparent')

watch(
  () => props.albumKey,
  (key) => {
    const album = library.albums.find((a) => a.key === key)
    ambientBase.value = paletteCache.colorOf(album?.coverId)
  },
  { immediate: true },
)

const album = computed(() => library.albums.find((a) => a.key === props.albumKey))

const discGroups = computed(() => {
  if (!album.value) return []
  const groups = new Map<number, typeof album.value.songs>()
  for (const s of album.value.songs) {
    const disc = s.discNo ?? 1
    const list = groups.get(disc)
    if (list) list.push(s)
    else groups.set(disc, [s])
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0])
})

function playAll(shuffle = false) {
  if (!album.value) return
  player.setPlayMode(shuffle ? 'shuffle' : 'loop')
  const songs = album.value.songs
  const first = shuffle ? (songs[Math.floor(Math.random() * songs.length)] ?? songs[0]) : songs[0]
  void player.playSong(first, songs)
}

function playSong(song: SongRecord) {
  if (!album.value) return
  void player.playSong(song, album.value.songs)
}
</script>

<template>
  <div v-if="album" ref="rootEl" class="album-detail" :class="{ revealed, blooming }">
    <button class="back-btn" @click="close">
      <AppIcon name="close" :size="14" /> 返回专辑列表
    </button>

    <header class="album-header">
      <!-- 磨砂玻璃面板：内含封面主色的淡色调渲染 -->
      <div class="glass" aria-hidden="true" :style="{ '--tint': ambientBase }">
        <div class="glass-tint"></div>
      </div>
      <CoverImage :cover-id="album.coverId" :size="192" class="header-cover" hires />
      <div class="header-info">
        <h1 class="album-title">{{ album.name }}</h1>
        <div class="album-artist">{{ album.artist }}</div>
        <div class="album-stats">
          <span>{{ album.songs.length }}</span><span class="stat-label">歌曲</span>
          <span>{{ formatTotalDuration(album.totalDuration) }}</span><span class="stat-label">时长</span>
          <template v-if="album.year">
            <span>{{ album.year }}</span><span class="stat-label">年份</span>
          </template>
        </div>
        <div class="album-actions">
          <button class="action-btn primary" @click="playAll(false)">
            <AppIcon name="repeat" :size="15" /> 列表循环
          </button>
          <button class="action-btn" @click="playAll(true)">
            <AppIcon name="shuffle" :size="15" /> 随机播放
          </button>
        </div>
      </div>
    </header>

    <section v-for="[disc, songs] in discGroups" :key="disc" class="disc-group">
      <div v-if="discGroups.length > 1" class="disc-title">光盘 {{ disc }}</div>
      <div
        v-for="song in songs"
        :key="song.path"
        class="track-row"
        :class="{ playing: song.path === player.currentPath }"
        @click="playSong(song)"
      >
        <span class="track-no">{{ song.trackNo ?? '–' }}</span>
        <span class="track-main">
          <span class="track-title-line">
            <QualityBadge
              :container="song.container"
              :sample-rate-hz="song.sampleRateHz"
              :bits-per-sample="song.bitsPerSample"
              :bitrate-kbps="song.bitrateKbps"
            />
            <span class="track-title">{{ song.title }}</span>
          </span>
          <span class="track-artist">{{ song.artist }}</span>
        </span>
        <span class="track-duration">
          <AppIcon v-if="song.path === player.currentPath" name="check" :size="14" class="playing-check" />
          {{ formatDuration(song.durationSec) }}
        </span>
      </div>
    </section>
  </div>
  <div v-else class="empty-hint">专辑不存在</div>
</template>

<style scoped>
.album-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 本组件根同时是 App 传入的 .detail-layer 滚动层（纵向 flex + overflow-y:auto）。
   flex 子项默认 flex-shrink:1，歌曲很多、内容超高时头部会被压缩，
   再被 .album-header 自己的 overflow:hidden 裁掉封面顶部——必须禁止收缩。 */
.album-detail > * {
  flex-shrink: 0;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: 6px;
}

.back-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.album-header {
  position: relative;
  display: flex;
  gap: 24px;
  align-items: flex-end;
  padding: 28px 24px;
  border-radius: var(--radius-panel);
  overflow: hidden;
}

/* 磨砂玻璃面板：白色渐变玻璃 + 封面主色调渲染层 + rim 高光 + hover 扫光。
   主色融进玻璃而不是糊在底上 —— 有色调但不重。 */
.glass {
  position: absolute;
  inset: 10px;
  border-radius: calc(var(--radius-panel) - 6px);
  z-index: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.18));
  backdrop-filter: blur(12px) saturate(1.3);
  -webkit-backdrop-filter: blur(12px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.8),
    inset 0 -1px 0 rgba(255, 255, 255, 0.25),
    0 10px 30px rgba(30, 60, 60, 0.1);
  overflow: hidden;
  transition: opacity 380ms var(--ease-out);
}

/* 封面主色调渲染层：左低右高的径向淡色 */
.glass-tint {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 170% at 10% 30%, var(--tint), transparent 62%);
  opacity: 0.26;
  pointer-events: none;
}

.glass::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: linear-gradient(105deg, transparent 30%, rgba(255, 255, 255, 0.5) 48%, transparent 62%);
  transform: translateX(-60%);
  transition: transform 0.9s var(--ease-out);
}

.album-header:hover .glass::before {
  transform: translateX(60%);
}

:root[data-theme='dark'] .glass {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(255, 255, 255, 0.05),
    0 10px 30px rgba(0, 0, 0, 0.35);
}

:root[data-theme='dark'] .glass-tint {
  opacity: 0.2;
}

:root[data-theme='dark'] .glass::before {
  background: linear-gradient(105deg, transparent 30%, rgba(255, 255, 255, 0.14) 48%, transparent 62%);
}

.header-cover {
  position: relative;
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}

.header-info {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.album-title {
  font-size: 24px;
  font-weight: 600;
}

.album-artist {
  font-size: 14px;
  color: var(--text-secondary);
}

.album-stats {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-right: 10px;
}

.album-actions {
  display: flex;
  gap: 10px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  transition: background 0.15s, color 0.15s;
}

.action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.action-btn.primary {
  background: var(--accent);
  border-color: transparent;
  color: var(--accent-text);
}

.action-btn.primary:hover {
  opacity: 0.9;
  color: var(--accent-text);
}

.disc-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.disc-title {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 8px 0;
}

.track-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 12px;
  align-items: center;
  height: 56px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: default;
  transition: background 0.12s;
}

.track-row:hover {
  background: var(--bg-hover);
}

.track-row.playing {
  background: var(--bg-active);
}

.track-no {
  text-align: center;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.track-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.track-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.track-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-artist {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-duration {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.playing-check {
  color: var(--accent);
}

.empty-hint {
  color: var(--text-tertiary);
  padding: 48px 0;
}

/* 内容初始隐藏，由 pageTransition 的波前时序逐个接管（延迟按到点击点的距离算，
   不再写死 index × 常数；编排器失效时 .revealed 兜底直接显示）。 */
.album-detail .back-btn,
.album-detail .header-info,
.album-detail .disc-title,
.album-detail .track-row {
  opacity: 0;
}

.album-detail.revealed .back-btn,
.album-detail.revealed .header-info,
.album-detail.revealed .disc-title,
.album-detail.revealed .track-row {
  opacity: 1;
}

/* 玻璃面板随推进淡入 */
.album-detail .glass {
  opacity: 0;
}

.album-detail.blooming .glass {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .album-detail .back-btn,
  .album-detail .header-info,
  .album-detail .disc-title,
  .album-detail .track-row {
    opacity: 1;
    transform: none;
    transition: none;
  }
  .album-detail .glass {
    opacity: 1;
    transition: none;
  }
  .album-header:hover .glass::before,
  .glass::before {
    transition: none;
  }
}
</style>
