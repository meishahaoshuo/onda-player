<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import AppIcon from '@/components/AppIcon.vue'
import QualityBadge from '@/components/QualityBadge.vue'
import { extractBrightColors } from '@/services/palette'
import { playAlbumEnter, playAlbumExit } from '@/services/pageTransition'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { formatDuration, formatTotalDuration, formatFileSize, formatSampleRate } from '@/utils/format'
import type { SongRecord } from '@/types'

/** 信息面板音质行的代表曲目 */
interface MetaRow {
  key: string
  label: string
  value: string
  qualityOf?: SongRecord
}

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
  // 收尾（clearTransitionState / closeDetail / endDolly）由编排器完成；
  // 若期间被导航抢断，编排器会移交收尾权，这里不再碰状态
  await playAlbumExit(rootEl.value)
  closing.value = false
}

/* 头部背景（方案 B · 流光呼吸增强版）：
   2 个加大变柔的明亮色光斑做呼吸式起伏（缩放+透明度同步），叠胶片噪点提质感 */
const flowColors = ref<string[]>([])
const flowCache = new Map<string, string[]>()

watch(
  () => props.albumKey,
  async (key) => {
    flowColors.value = flowCache.get(key) ?? []
    const album = library.albums.find((a) => a.key === key)
    if (!album?.coverId) return
    try {
      const url = await library.coverUrl(album.coverId)
      if (!url) return
      const blob = await (await fetch(url)).blob()
      const colors = await extractBrightColors(blob).catch(() => [] as string[])
      flowCache.set(key, colors)
      if (props.albumKey === key) flowColors.value = colors
    } catch {
      /* 取色失败则保留中性底 */
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
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([disc, songs]) => {
    // 音轨号缺失的专辑（常见于网络来源）按显示顺序自动编号，避免整列"–"占位符
    const anyTrackNo = songs.some((s) => s.trackNo != null)
    const rows = songs.map((s, i) => ({
      song: s,
      no: s.trackNo ?? (anyTrackNo ? '' : i + 1),
    }))
    return { disc, rows }
  })
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

/* 信息面板：全部来自扫描已有的字段，缺数据的行自动隐藏 */
const metaRows = computed<MetaRow[]>(() => {
  const a = album.value
  if (!a) return []
  const songs = a.songs
  const rows: MetaRow[] = []

  const genres = [...new Set(songs.map((s) => s.genre).filter(Boolean))]
  if (genres.length > 0) rows.push({ key: 'genre', label: '流派', value: genres.join(' / ') })

  const best = [...songs].sort(
    (x, y) =>
      (y.sampleRateHz ?? 0) - (x.sampleRateHz ?? 0) ||
      (y.bitsPerSample ?? 0) - (x.bitsPerSample ?? 0),
  )[0]
  if (best && (best.sampleRateHz || best.bitsPerSample)) {
    const parts: string[] = []
    if (best.bitsPerSample) parts.push(`${best.bitsPerSample}bit`)
    const rate = best.sampleRateHz ? formatSampleRate(best.sampleRateHz) : ''
    if (rate) parts.push(rate)
    rows.push({ key: 'quality', label: '音质', value: parts.join(' / '), qualityOf: best })
  }

  const counts = new Map<string, number>()
  for (const s of songs) {
    const c = (s.container || '未知').toUpperCase()
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const fmt = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([c, n]) => `${c} × ${n}`).join(' · ')
  if (fmt) rows.push({ key: 'format', label: '格式', value: fmt })

  const discs = new Set(songs.map((s) => s.discNo ?? 1)).size
  if (discs > 1) rows.push({ key: 'discs', label: '碟片', value: `${discs} 张` })

  const size = songs.reduce((n, s) => n + (s.fileSize || 0), 0)
  if (size > 0) rows.push({ key: 'size', label: '总大小', value: formatFileSize(size) })

  const rates = songs.map((s) => s.bitrateKbps).filter((x): x is number => x != null && x > 0)
  if (rates.length > 0) {
    rows.push({ key: 'bitrate', label: '平均码率', value: `≈ ${Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)} kbps` })
  }

  return rows
})
</script>

<template>
  <div v-if="album" ref="rootEl" class="album-detail" :class="{ revealed, blooming }">
    <button class="back-btn" @click="close">
      <AppIcon name="close" :size="14" /> 返回专辑列表
    </button>

    <header class="album-header">
      <!-- 流光呼吸光斑 -->
      <div
        v-for="(c, i) in flowColors.slice(0, 2)"
        :key="i"
        class="blob"
        :class="`hb-${i}`"
        :style="{ '--fc': c }"
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
      <aside v-if="metaRows.length > 0" class="album-meta glass" aria-label="专辑信息">
        <div v-for="row in metaRows" :key="row.key" class="meta-row">
          <span class="meta-k">{{ row.label }}</span>
          <span class="meta-v">
            <template v-if="row.qualityOf">
              {{ row.value }}
              <QualityBadge
                :container="row.qualityOf.container"
                :sample-rate-hz="row.qualityOf.sampleRateHz"
                :bits-per-sample="row.qualityOf.bitsPerSample"
                :bitrate-kbps="row.qualityOf.bitrateKbps"
              />
            </template>
            <template v-else>{{ row.value }}</template>
          </span>
        </div>
      </aside>
    </header>

    <section v-for="g in discGroups" :key="g.disc" class="disc-group">
      <div v-if="discGroups.length > 1" class="disc-title">光盘 {{ g.disc }}</div>
      <div
        v-for="row in g.rows"
        :key="row.song.path"
        class="track-row"
        :class="{ playing: row.song.path === player.currentPath }"
        @click="playSong(row.song)"
      >
        <span class="track-no">{{ row.no }}</span>
        <span class="track-main">
          <span class="track-title-line">
            <QualityBadge
              :container="row.song.container"
              :sample-rate-hz="row.song.sampleRateHz"
              :bits-per-sample="row.song.bitsPerSample"
              :bitrate-kbps="row.song.bitrateKbps"
            />
            <span class="track-title">{{ row.song.title }}</span>
          </span>
          <span class="track-artist">{{ row.song.artist }}</span>
        </span>
        <span class="track-duration">
          <AppIcon v-if="row.song.path === player.currentPath" name="check" :size="14" class="playing-check" />
          {{ formatDuration(row.song.durationSec) }}
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

/* 头部背景：中性浅色渐变（主题自适应），光斑与噪点提供质感 */
.album-header {
  background: linear-gradient(120deg, var(--bg-hover) 0%, var(--bg-base) 70%);
}

/* 呼吸光斑：缩放与透明度同步起伏，周期 10-12s 交错 */
.blob {
  position: absolute;
  width: clamp(300px, 32vw, 460px);
  height: clamp(300px, 32vw, 460px);
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(closest-side, var(--fc), transparent 70%);
  will-change: transform, opacity;
  z-index: 0;
}

.blob.hb-0 {
  top: -46%;
  left: -4%;
  animation: hb-0 10s ease-in-out infinite alternate;
}

.blob.hb-1 {
  top: -18%;
  right: -5%;
  animation: hb-1 12s ease-in-out infinite alternate;
}

@keyframes hb-0 {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.2; }
  50% { transform: translate(2vw, 1.5vh) scale(1.1); opacity: 0.3; }
}

@keyframes hb-1 {
  0%, 100% { transform: translate(0, 0) scale(1.04); opacity: 0.14; }
  50% { transform: translate(-2vw, 2vh) scale(0.94); opacity: 0.22; }
}

/* 胶片噪点：一层 4% 的细颗粒，flat 渐变的"塑料感"就靠它破掉 */
.album-header::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0.04;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px 160px;
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

/* 信息面板：玻璃材质（.glass 全局类）透出头部呼吸光斑，细行分隔 + 右对齐数值 */
.album-meta {
  position: relative;
  z-index: 2;
  margin-left: auto;
  align-self: center;
  flex-shrink: 0;
  max-width: 340px;
  padding: 4px 20px;
  border-radius: 14px;
}

.meta-row {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 20px;
  align-items: baseline;
  padding: 9px 0;
}

.meta-row + .meta-row {
  border-top: 1px solid var(--border-subtle);
}

.meta-k {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.meta-v {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 中等宽度以下头部放不下第三列，整体隐藏不换行 */
@media (max-width: 1100px) {
  .album-meta {
    display: none;
  }
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
.album-detail .album-meta,
.album-detail .disc-title,
.album-detail .track-row {
  opacity: 0;
}

.album-detail.revealed .back-btn,
.album-detail.revealed .header-info,
.album-detail.revealed .album-meta,
.album-detail.revealed .disc-title,
.album-detail.revealed .track-row {
  opacity: 1;
}

/* 背景层随推进淡入 */
.album-detail .blob,
.album-detail .album-header::after {
  opacity: 0;
}

.album-detail.blooming .blob {
  opacity: 0.2;
}

.album-detail.blooming .album-header::after {
  opacity: 0.04;
}

@media (prefers-reduced-motion: reduce) {
  .album-detail .back-btn,
  .album-detail .header-info,
  .album-detail .album-meta,
  .album-detail .disc-title,
  .album-detail .track-row {
    opacity: 1;
    transform: none;
    transition: none;
  }
  .album-detail .blob {
    opacity: 0.2;
    animation: none;
    transition: none;
  }
  .album-detail .album-header::after {
    opacity: 0.04;
    transition: none;
  }
}
</style>
