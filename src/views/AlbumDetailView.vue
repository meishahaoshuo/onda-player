<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import AppIcon from '@/components/AppIcon.vue'
import QualityBadge from '@/components/QualityBadge.vue'
import { renderAmbientUrl } from '@/services/palette'
import { playAlbumEnter, playAlbumExit } from '@/services/pageTransition'
import { paletteCache } from '@/services/paletteCache'
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

/* 封面取色环境光晕：先用列表页预取的主色铺底（开场即用），落定后换成预烘焙多焦点图 */
const ambientBase = ref<string>('transparent')
const ambientUrl = ref<string | null>(null)
const ambientCache = new Map<string, string>()

watch(
  () => props.albumKey,
  async (key) => {
    const album = library.albums.find((a) => a.key === key)
    ambientBase.value = paletteCache.colorOf(album?.coverId)
    ambientUrl.value = ambientCache.get(key) ?? null
    if (!album?.coverId || ambientCache.has(key)) return
    try {
      const url = await library.coverUrl(album.coverId)
      if (!url) return
      const blob = await (await fetch(url)).blob()
      const baked = await renderAmbientUrl(blob)
      ambientCache.set(key, baked)
      if (props.albumKey === key) ambientUrl.value = baked
    } catch {
      /* 取色失败则保留主色铺底 */
    }
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

    <header class="album-header" :class="{ ambient: ambientUrl }">
      <!-- 封面取色环境光晕 -->
      <div
        class="header-ambient"
        :style="{
          backgroundColor: ambientBase,
          backgroundImage: ambientUrl ? `url(${ambientUrl})` : 'none',
        }"
      />
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

/* 环境光晕：模糊已在 palette.renderAmbientUrl 里烘焙进图内，这里只做 cover 拉伸，
   不再叠一层全屏 blur(56px) 实时栅格化（多个全屏 blur 图层并行会拖垮过渡帧率）。 */
.header-ambient {
  position: absolute;
  inset: -40px;
  background-size: cover;
  background-position: center;
  opacity: 0;
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

/* 环境光晕随推进同步晕开（开场即用预取主色，不再等封面落定） */
.album-detail .header-ambient {
  transition: opacity 380ms var(--ease-out);
}

.album-detail.blooming .header-ambient {
  opacity: 0.55;
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
  .album-detail .header-ambient {
    opacity: 0.55;
    transition: none;
  }
}
</style>
