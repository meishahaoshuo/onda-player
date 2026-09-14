<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import AppIcon from '@/components/AppIcon.vue'
import QualityBadge from '@/components/QualityBadge.vue'
import { extractBrightColors } from '@/services/palette'
import { playAlbumEnter, playAlbumExit } from '@/services/pageTransition'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { useFavoritesStore } from '@/stores/favorites'
import { usePlaylistStore } from '@/stores/playlist'
import { useSongActions } from '@/composables/useSongActions'
import { popPlayerCover } from '@/services/coverFlight'
import { formatDuration, formatTotalDuration } from '@/utils/format'
import type { SongRecord } from '@/types'

/** 头部右侧信息栏的一行（对齐歌单页头部的「小标签 + 值」形式） */
interface MetaRow {
  key: string
  label: string
  value: string
}

/**
 * 专辑详情页（对照截图 3）：大封面头部 + 取色环境光晕 + 统计 + 播放/随机 + 碟片分组曲目
 */
const props = defineProps<{ albumKey: string }>()

const library = useLibraryStore()
const player = usePlayerStore()
const ui = useUiStore()
const favorites = useFavoritesStore()
const playlistStore = usePlaylistStore()
const { openSongMenu } = useSongActions()

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

/* 顶栏返回钮（App.vue）派发的事件：关闭要走「引力坍缩」反向过渡，
   那套收尾只有本组件知道怎么跑，故由这里接住并调用自己的 close() */
function onDetailBack() {
  void close()
}
onMounted(() => window.addEventListener('onda:detail-back', onDetailBack))
onBeforeUnmount(() => window.removeEventListener('onda:detail-back', onDetailBack))

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

/** 播放全部：固定切到列表循环再从第 1 首播（沿用改前「列表循环」按钮的行为，2026-09-14 用户确认） */
function playAll() {
  if (!album.value) return
  player.setPlayMode('loop')
  const songs = album.value.songs
  void player.playSong(songs[0], songs)
}

function playSong(song: SongRecord, e?: MouseEvent) {
  if (!album.value) return
  // 曲目行没有小封面，仅做播放栏封面弹跳
  if (e) popPlayerCover()
  void player.playSong(song, album.value.songs)
}

function onRowMenu(song: SongRecord, e: MouseEvent) {
  if (!album.value) return
  openSongMenu(e, song, { context: album.value.songs })
}

/** 行点击：选择态下切换勾选，否则播放（批量操作的入口交互） */
function onRowClick(song: SongRecord, e: MouseEvent) {
  if (selecting.value) {
    toggleSelect(song.path)
    return
  }
  playSong(song, e)
}

/* ---------- 批量操作（多选）----------
   头部「批量操作」进入选择态：行左侧出现勾选框、点击行变为勾选，列表上方出现工具条
   （已选 N 首 / 全选 / 反选 + 收藏 / 添加到歌单）。选中集只属于当前专辑，换专辑即清空。 */
const selecting = ref(false)
const selected = ref(new Set<string>())
/** 「添加到歌单」的二级面板 */
const addOpen = ref(false)

const selectedPaths = computed(
  () => album.value?.songs.filter((s) => selected.value.has(s.path)).map((s) => s.path) ?? [],
)

/** 选中的歌已全部收藏时，收藏按钮变为「取消收藏」（与右键菜单同款语义） */
const allSelectedFavorited = computed(() => {
  const paths = selectedPaths.value
  return paths.length > 0 && paths.every((p) => favorites.has(p))
})

function exitSelecting() {
  selecting.value = false
  addOpen.value = false
  selected.value.clear()
}

function toggleSelecting() {
  if (selecting.value) exitSelecting()
  else {
    selected.value.clear()
    selecting.value = true
  }
}

function toggleSelect(path: string) {
  if (selected.value.has(path)) selected.value.delete(path)
  else selected.value.add(path)
}

function selectAll() {
  selected.value = new Set(album.value?.songs.map((s) => s.path) ?? [])
}

/** 反选：全选与已选之差 */
function invertSelection() {
  const next = new Set<string>()
  for (const s of album.value?.songs ?? []) if (!selected.value.has(s.path)) next.add(s.path)
  selected.value = next
}

function batchFavorite() {
  const paths = selectedPaths.value
  if (paths.length === 0) return
  const remove = allSelectedFavorited.value
  // 全已收藏 → 批量取消收藏；否则只补收未收藏的（不误伤已收藏的）
  for (const p of paths) {
    const has = favorites.has(p)
    if (remove ? has : !has) favorites.toggle(p)
  }
}

function addToPlaylist(id: string) {
  const paths = selectedPaths.value
  if (paths.length === 0) return
  playlistStore.addSongs(id, paths)
  // 本页没有可见变化（列表只按专辑分组），退出选择态当作收尾反馈
  exitSelecting()
}

function createPlaylistWithSelected() {
  const paths = selectedPaths.value
  if (paths.length === 0) return
  addOpen.value = false
  ui.requestPlaylistCreate(paths)
}

/* Esc 退出选择态（二级面板打开时先收面板）；歌词全屏页在最上层，不抢它的 Esc */
function onSelectKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !selecting.value || ui.lyricsOpen) return
  if (addOpen.value) addOpen.value = false
  else exitSelecting()
}
onMounted(() => window.addEventListener('keydown', onSelectKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onSelectKeydown))

/* 换专辑即退出选择态（选中集属于某一张专辑） */
watch(
  () => props.albumKey,
  () => exitSelecting(),
)

/* 头部右侧信息栏（对齐歌单页头部的 pl-sideinfo）：发行年份 / 歌手 / 歌曲 / 时长，
   缺数据的行自动隐藏（年份常见缺失，此时剩三行，与歌单页行数一致） */
const metaRows = computed<MetaRow[]>(() => {
  const a = album.value
  if (!a) return []
  const rows: MetaRow[] = []
  if (a.year) rows.push({ key: 'year', label: '发行年份', value: String(a.year) })
  if (a.artist) rows.push({ key: 'artist', label: '歌手', value: a.artist })
  rows.push({ key: 'count', label: '歌曲', value: `${a.songs.length} 首` })
  rows.push({ key: 'duration', label: '时长', value: formatTotalDuration(a.totalDuration) })
  return rows
})
</script>

<template>
  <div v-if="album" ref="rootEl" class="album-detail" :class="{ revealed, blooming }">
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
        <div class="album-actions">
          <button class="action-btn primary" @click="playAll()">
            <AppIcon name="play" :size="15" /> 播放全部
          </button>
          <button class="action-btn" :class="{ on: selecting }" @click="toggleSelecting">
            <AppIcon name="check" :size="15" /> {{ selecting ? '完成' : '批量操作' }}
          </button>
        </div>
      </div>
      <!-- 头部右侧信息栏：与歌单页头部同款（小标签在上、值在下 + 竖分隔线） -->
      <div v-if="metaRows.length > 0" class="album-sideinfo" aria-label="专辑信息">
        <div v-for="row in metaRows" :key="row.key" class="row">
          <span class="k">{{ row.label }}</span>
          <span class="v">{{ row.value }}</span>
        </div>
      </div>
    </header>

    <!-- 批量操作工具条：紧跟头部（不改变头部卡片几何），退出选择态即收起 -->
    <div v-if="selecting" class="batch-bar">
      <span class="batch-count">已选 {{ selected.size }} 首</span>
      <div class="batch-links">
        <button class="mini-link" @click="selectAll">全选</button>
        <button class="mini-link" @click="invertSelection">反选</button>
      </div>
      <div class="batch-actions">
        <button
          class="action-btn"
          :disabled="selected.size === 0"
          @click="batchFavorite"
        >
          <AppIcon name="heart" :size="14" :class="{ filled: allSelectedFavorited }" />
          {{ allSelectedFavorited ? '取消收藏' : '收藏' }}
        </button>
        <div class="batch-add">
          <button
            class="action-btn"
            :disabled="selected.size === 0"
            @click="addOpen = !addOpen"
          >
            <AppIcon name="playlistAdd" :size="14" /> 添加到歌单
          </button>
          <Transition name="menu">
            <div v-if="addOpen" class="add-menu panel-solid">
              <button
                v-for="p in playlistStore.playlists"
                :key="p.id"
                class="add-item"
                :title="p.name"
                @click="addToPlaylist(p.id)"
              >
                <AppIcon name="playlist" :size="14" /><span class="add-label">{{ p.name }}</span>
              </button>
              <button class="add-item accent" @click="createPlaylistWithSelected">
                <AppIcon name="plus" :size="14" /> 新建歌单并加入
              </button>
              <div v-if="playlistStore.playlists.length === 0" class="add-empty">
                还没有歌单，试试「新建歌单并加入」
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
    <div v-if="addOpen" class="add-mask" @click="addOpen = false" />

    <section v-for="g in discGroups" :key="g.disc" class="disc-group">
      <div v-if="discGroups.length > 1" class="disc-title">光盘 {{ g.disc }}</div>
      <div
        v-for="row in g.rows"
        :key="row.song.path"
        class="track-row"
        :class="{
          playing: row.song.path === player.currentPath,
          selecting,
          picked: selecting && selected.has(row.song.path),
        }"
        @click="onRowClick(row.song, $event)"
        @contextmenu.prevent="onRowMenu(row.song, $event)"
      >
        <span class="track-no">
          <span v-if="selecting" class="row-check" :class="{ on: selected.has(row.song.path) }">
            <AppIcon v-if="selected.has(row.song.path)" name="check" :size="12" />
          </span>
          <template v-else>{{ row.no }}</template>
        </span>
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
          <span class="row-actions" @click.stop>
            <button
              class="row-act"
              :class="{ active: favorites.has(row.song.path) }"
              :title="favorites.has(row.song.path) ? '取消收藏' : '收藏'"
              @click="favorites.toggle(row.song.path)"
            >
              <AppIcon name="heart" :size="15" :class="{ filled: favorites.has(row.song.path) }" />
            </button>
            <button class="row-act" title="更多操作" @click="onRowMenu(row.song, $event)">
              <AppIcon name="more" :size="15" />
            </button>
          </span>
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


.album-header {
  position: relative;
  display: flex;
  gap: 24px;
  align-items: flex-end;
  /* 上下内边距与歌单页头部一致（20 + 192 封面 + 20 = 232 卡片高度），
     两个详情页的头部卡片几何完全相同 */
  padding: 20px 24px;
  /* 顶部留白：.detail-layer 滚动宿主不能带 padding-top（sticky 吸附边界 =
     滚动容器 padding 内缘，会挡住表头吸顶）；组件 padding-top 又会被
     App.vue 的 .detail-layer padding 简写同特异性覆盖，故用子元素 margin */
  margin-top: 20px;
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
  z-index: 2;
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}

/* 标题贴头部顶端、播放按钮贴封面底缘（与歌单页头部同款：
   拉伸到与封面同高 + space-between），标题位置因此「靠上」 */
.header-info {
  position: relative;
  z-index: 2;
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-self: stretch;
}

.album-title {
  font-size: 24px;
  font-weight: 600;
  /* 收紧行高：字面顶缘贴近块顶，与封面顶缘光学对齐 */
  line-height: 1.15;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.album-actions {
  display: flex;
  gap: 10px;
}

/* 选择态下的「完成」按钮：与主按钮同款描边高亮，表示当前处于该模式 */
.action-btn.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.action-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.action-btn:disabled:hover {
  background: none;
  color: var(--text-secondary);
}

/* ---------- 批量操作工具条 ---------- */
.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px;
}

.batch-count {
  font-size: 13px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.batch-links {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* 文字按钮：与歌单页「添加歌曲」弹层里的全选/反选同款 */
.mini-link {
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
  padding: 4px 10px;
  border-radius: 7px;
  transition: background var(--dur-fast) var(--ease-out);
}

.mini-link:hover {
  background: var(--accent-soft);
}

.batch-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 「添加到歌单」二级面板（与右键菜单的二级面板同款材质） */
.batch-add {
  position: relative;
}

.add-mask {
  position: fixed;
  inset: 0;
  z-index: 4;
}

.add-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 5;
  min-width: 180px;
  max-height: 260px;
  overflow-y: auto;
  padding: 5px;
  border-radius: 12px;
  /* 展开动画从右上角（贴着按钮）长出来 */
  transform-origin: top right;
  box-shadow: var(--shadow-2), var(--glass-highlight);
}

.add-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out);
}

.add-item:hover {
  background: var(--bg-hover);
}

.add-item svg {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.add-item.accent {
  color: var(--accent);
}

.add-item.accent svg {
  color: var(--accent);
}

.add-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.add-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-tertiary);
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
  /* CJK 文字默认可在任意字间断行，被挤窄时会变成「列表 / 循环」两行——禁止换行 */
  white-space: nowrap;
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

/* 头部右侧信息栏：竖分隔线 + 若干行「小标签 / 值」（发行年份/歌手/歌曲/时长）。
   与歌单页头部的 .pl-sideinfo 完全同款——不再用玻璃卡片 */
.album-sideinfo {
  position: relative;
  z-index: 2;
  margin-left: auto;
  align-self: center;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 150px;
  max-width: 260px;
  border-left: 1px solid var(--border-subtle);
  padding-left: 26px;
}

.album-sideinfo .row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* 行间距比歌单页（9px）紧一档：专辑这里有 4 行，压到 5px 后面板总高
     （≈186）才稳稳落在 192 封面之内——面板一旦比封面高，flex 行高被顶大，
     .header-info 的 stretch 也跟着变高，标题就不再与封面顶缘对齐 */
  padding: 5px 0;
}

.album-sideinfo .row + .row {
  border-top: 1px solid var(--border-subtle);
}

.album-sideinfo .k {
  font-size: 11px;
  color: var(--text-tertiary);
}

.album-sideinfo .v {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* 长歌手名不换行：换行会让面板变高，进而顶偏标题的对齐基准 */
.album-sideinfo .k,
.album-sideinfo .v {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 窄窗口（不到 ~940 视口）三列排不下：信息栏整块折到下一行，
   而不是把中间一列挤窄——挤窄会让两个播放按钮变成两行文字 */
@media (max-width: 960px) {
  .album-header {
    flex-wrap: wrap;
  }
  .album-sideinfo {
    margin-left: 0;
    align-self: flex-start;
    border-left: 0;
    padding-left: 0;
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

/* 选择态：整行可点（切换勾选），已选行用强调色底——放在 :hover 之后，
   同特异性下后者胜出，悬停时不会把已选色冲掉 */
.track-row.selecting {
  cursor: pointer;
}

.track-row.picked {
  background: var(--accent-soft);
}

.track-no {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 选择态的勾选框：替掉行首的曲目号（列宽 40 不变，行几何不动） */
.row-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1.5px solid var(--text-tertiary);
  color: var(--accent-text);
  transition: background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.row-check.on {
  background: var(--accent);
  border-color: var(--accent);
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* 悬停快捷操作（与 SongList 同款）：悬浮在标题区与时长之间的空白区，
   透明底与行背景融为一体；opacity + 位移过渡浮现 */
.row-actions {
  position: absolute;
  right: calc(100% + 8px);
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transform: translateX(6px);
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.track-row:hover .row-actions,
.track-row:focus-within .row-actions {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

/* 选择态下不收行内快捷操作（收藏/更多）——批量动作统一在工具条上，
   特异性 (0,4,0) 高于上面的悬停规则，位置无关 */
.track-row.selecting:hover .row-actions,
.track-row.selecting:focus-within .row-actions {
  opacity: 0;
  pointer-events: none;
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

.playing-check {
  color: var(--accent);
}

.empty-hint {
  color: var(--text-tertiary);
  padding: 48px 0;
}

/* 内容初始隐藏，由 pageTransition 的波前时序逐个接管（延迟按到点击点的距离算，
   不再写死 index × 常数；编排器失效时 .revealed 兜底直接显示）。
   头部关闭钮不参与波前编排——它有自己的悬停浮现逻辑 */
.album-detail .header-info,
.album-detail .album-sideinfo,
.album-detail .disc-title,
.album-detail .track-row {
  opacity: 0;
}

.album-detail.revealed .header-info,
.album-detail.revealed .album-sideinfo,
.album-detail.revealed .disc-title,
.album-detail.revealed .track-row {
  opacity: 1;
}

/* 信息栏弹出：头部内容落定后带回弹放大弹出（回弹曲线末段过冲再收束）。
   时长与延迟按编排器的全局 SPEED（1.35×）同步放大，否则编排器慢了它没慢会抢跑 */
.album-detail.revealed .album-sideinfo {
  animation: meta-pop 650ms cubic-bezier(0.34, 1.56, 0.64, 1) 190ms backwards;
}

@keyframes meta-pop {
  from {
    opacity: 0;
    transform: scale(0.86) translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
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
  .album-detail .header-info,
  .album-detail .album-sideinfo,
  .album-detail .disc-title,
  .album-detail .track-row {
    opacity: 1;
    transform: none;
    transition: none;
  }
  .album-detail.revealed .album-sideinfo {
    animation: none;
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
