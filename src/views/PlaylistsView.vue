<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import CollageCover from '@/components/CollageCover.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import FrostedPanel from '@/components/FrostedPanel.vue'
import { beginAlbumEnter, playAlbumEnter, playAlbumExit } from '@/services/pageTransition'
import { extractBrightColors } from '@/services/palette'
import * as db from '@/services/db'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { usePlaylistStore, playlistManualCoverId } from '@/stores/playlist'
import { useFavoritesStore } from '@/stores/favorites'
import { useStatsStore } from '@/stores/stats'
import { useSongActions } from '@/composables/useSongActions'
import { useStaggerReveal } from '@/composables/useStaggerReveal'
import { flyToPlayerFromRow } from '@/services/coverFlight'
import { imageToCoverThumb } from '@/services/cover'
import { useUiStore } from '@/stores/ui'
import { formatDuration, formatTotalDuration } from '@/utils/format'
import type { SongRecord } from '@/types'

/**
 * 歌单页：歌单列表 / 歌单详情（播放、重命名、删除、添加歌曲、自定义排序）
 * 详情是覆盖层，列表网格常驻 —— 供「引力坍缩」过渡编排器做对称返回
 */
const library = useLibraryStore()
const player = usePlayerStore()
const playlistStore = usePlaylistStore()
const favorites = useFavoritesStore()
const stats = useStatsStore()
const { openSongMenu } = useSongActions()
const ui = useUiStore()

onMounted(() => {
  if (!playlistStore.loaded) playlistStore.load()
  consumeCreateRequest()
  // 数据早已就绪时 watcher 不会触发，挂载时补一次登记
  plReveal.refresh()
})

/* 歌单列表网格的错峰浮现 */
const plHomeEl = ref<HTMLElement | null>(null)
const plReveal = useStaggerReveal(() => plHomeEl.value, '.pl-card')
watch(
  () => playlistStore.playlists.length,
  () => plReveal.refresh(),
  { flush: 'post' },
)
onBeforeUnmount(() => {
  plReveal.disconnect()
})

// 侧边栏在其他页面点击「新建歌单」时也会置位请求标记
watch(
  () => ui.playlistCreateRequested,
  () => {
    consumeCreateRequest()
  },
)

// 歌单右键「设置封面」：详情打开后直接弹出封面选择
watch(
  () => ui.playlistEditCover,
  (id) => {
    if (!id) return
    ui.playlistEditCover = null
    if (current.value?.id === id) showCoverPicker.value = true
  },
  { flush: 'post' },
)

// 歌单右键「添加歌曲」：详情打开后弹出添加弹层（详情头部按钮已精简，入口收敛到右键菜单）
watch(
  () => ui.playlistAddSongs,
  (id) => {
    if (!id) return
    ui.playlistAddSongs = null
    if (current.value?.id === id) {
      openAdd()
      return
    }
    // 菜单已切 activeView/detailKey，等详情就位后补弹
    const stop = watch(
      current,
      (pl) => {
        if (pl?.id === id) {
          openAdd()
          stop()
        }
      },
      { flush: 'post' },
    )
    window.setTimeout(() => stop(), 2000)
  },
  { flush: 'post' },
)

function consumeCreateRequest() {
  if (ui.playlistCreateRequested) {
    ui.playlistCreateRequested = false
    newName.value = ''
    showCreate.value = true
  }
}

const current = computed(() => playlistStore.playlists.find((p) => p.id === ui.detailKey))

const currentSongs = computed<SongRecord[]>(() => {
  if (!current.value) return []
  const byPath = new Map(library.songs.map((s) => [s.path, s]))
  return current.value.songPaths
    .map((p) => byPath.get(p))
    .filter((s): s is SongRecord => s !== undefined)
})

/** 歌单内歌曲的封面 id 列表（拼贴封面用） */
const currentCoverIds = computed(() => currentSongs.value.map((s) => s.coverId))

/** 手动指定的封面：自定义导入图优先，其次 coverPath 指向的歌；都没有回退拼贴 */
const currentCoverId = computed<string | null>(() => {
  if (!current.value) return null
  const byPath = new Map(library.songs.map((s) => [s.path, s.coverId]))
  return playlistManualCoverId(current.value, byPath)
})

/** 封面选择弹窗：歌单内歌曲按封面去重 */
const coverChoices = computed(() => {
  const seen = new Set<string>()
  const list: { path: string; coverId: string; title: string }[] = []
  for (const s of currentSongs.value) {
    if (!s.coverId || seen.has(s.coverId)) continue
    seen.add(s.coverId)
    list.push({ path: s.path, coverId: s.coverId, title: s.title })
  }
  return list
})

const showCoverPicker = ref(false)

function chooseCover(path: string | null) {
  if (current.value) playlistStore.setCover(current.value.id, path)
  showCoverPicker.value = false
}

/* ---------- 自定义封面导入：任意图片 → 256px 缩略图入 covers 库 ---------- */

const coverFileEl = ref<HTMLInputElement | null>(null)
const importingCover = ref(false)

async function onCoverFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 先还原：同一张图允许重复选择
  if (!file || !current.value) return
  importingCover.value = true
  try {
    const blob = await imageToCoverThumb(file)
    // coverId 带时间戳：重复导入生成新 id，绕开 coverUrl 对旧 id 的缓存
    const coverId = `plcover:${current.value.id}:${Date.now()}`
    await db.putCover(coverId, blob)
    playlistStore.setCustomCover(current.value.id, coverId)
  } catch {
    /* 图片解码失败：保持原封面不动 */
  } finally {
    importingCover.value = false
  }
}

/** 歌单列表页：id → 手动指定封面的 coverId（自定义导入图优先；未设置则不在 map 里） */
const cardCoverOverride = computed(() => {
  const byPath = new Map(library.songs.map((s) => [s.path, s.coverId]))
  const map = new Map<string, string | null>()
  for (const p of playlistStore.playlists) {
    const manual = playlistManualCoverId(p, byPath)
    if (manual) map.set(p.id, manual)
  }
  return map
})

/** 歌单列表页：id → 封面 id 列表（一次建索引，避免逐卡片全库扫描） */
const cardCoverIds = computed(() => {
  const byPath = new Map(library.songs.map((s) => [s.path, s.coverId]))
  const map = new Map<string, (string | null)[]>()
  for (const p of playlistStore.playlists) {
    map.set(p.id, p.songPaths.map((path) => byPath.get(path) ?? null))
  }
  return map
})

/* 「引力坍缩」过渡：进入由编排器接管（点击卡片时 beginAlbumEnter 记录原点），
   返回对称反向；内容波前浮现由编排器驱动，不再需要 CSS 错峰 */
const detailEl = ref<HTMLElement | null>(null)
/** 返回动画进行中：防重复触发导致收尾被打断 */
const closing = ref(false)

watch(
  current,
  async (pl, old) => {
    if (!pl) return
    // 歌单间直接切换：动向由内层 Transition（与板块切换同款）呈现，不跑引力坍缩编排
    if (old) {
      detailEl.value?.scrollTo({ top: 0 })
      return
    }
    await nextTick()
    await playAlbumEnter(detailEl.value)
  },
  { immediate: true, flush: 'post' },
)

async function closePlaylist() {
  if (!current.value || ui.dolly !== 'idle' || closing.value) return
  // 编排器负责收尾（clearTransitionState / closeDetail / endDolly）；
  // 无编排原点（如右键直接进入）时编排器内部走轻量路径
  closing.value = true
  try {
    ui.beginDollyExit()
    await playAlbumExit(detailEl.value)
  } finally {
    closing.value = false
  }
}

function openPlaylist(p: { id: string }, e: MouseEvent) {
  const card = e.currentTarget as HTMLElement
  const cover = card.querySelector<HTMLElement>('.pl-cover img, .pl-cover .cover-fallback, img')
  if (!cover) {
    ui.openDetail(p.id)
    return
  }
  beginAlbumEnter({
    cardEl: card,
    coverEl: cover,
    click: { x: e.clientX, y: e.clientY },
    albumKey: p.id,
    coverId: cardCoverOverride.value.get(p.id) ?? null,
    gridSel: '.pl-grid',
    cardSel: '.pl-card',
    waveInfo: '.pl-info',
    waveRows: '.drag-row',
  })
}

/* ---------- 新建 / 重命名 / 添加歌曲 ---------- */

const showCreate = ref(false)
const newName = ref('')

function confirmCreate() {
  // 右键「新建歌单并加入」会带种子歌曲
  const p = playlistStore.create(newName.value, ui.playlistCreateSeedPaths)
  ui.playlistCreateSeedPaths = []
  newName.value = ''
  showCreate.value = false
  ui.openDetail(p.id)
}

const showAdd = ref(false)
const addFilter = ref('')
const addOnlyNew = ref(false)
/** 多选批量添加的选中集 */
const addSelected = ref<Set<string>>(new Set())

function openAdd() {
  addSelected.value = new Set()
  addFilter.value = ''
  addOnlyNew.value = false
  showAdd.value = true
}

const addCandidates = computed(() =>
  library.sortedSongs.filter((s) => {
    if (addOnlyNew.value && inPlaylist(s.path)) return false
    if (
      addFilter.value &&
      !(s.title + s.artist + s.album).toLowerCase().includes(addFilter.value.toLowerCase())
    )
      return false
    return true
  }),
)

function inPlaylist(path: string) {
  return current.value?.songPaths.includes(path) ?? false
}

function toggleAddSelect(path: string) {
  const next = new Set(addSelected.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  addSelected.value = next
}

/** 全选：把列表内所有可添加（未在歌单）的歌曲加入选中集 */
function selectAllAdd() {
  const next = new Set(addSelected.value)
  for (const s of addCandidates.value) if (!inPlaylist(s.path)) next.add(s.path)
  addSelected.value = next
}

/** 反选：对列表内可添加的歌曲取反 */
function invertAdd() {
  const next = new Set(addSelected.value)
  for (const s of addCandidates.value) {
    if (inPlaylist(s.path)) continue
    if (next.has(s.path)) next.delete(s.path)
    else next.add(s.path)
  }
  addSelected.value = next
}

function clearAdd() {
  addSelected.value = new Set()
}

function confirmAddSelected() {
  if (!current.value || addSelected.value.size === 0) return
  playlistStore.addSongs(current.value.id, [...addSelected.value])
  addSelected.value = new Set()
}

/* ---------- 右键菜单 ---------- */

function onRowMenu(song: SongRecord, e: MouseEvent) {
  if (!current.value) return
  openSongMenu(e, song, { playlistId: current.value.id, context: currentSongs.value })
}

/* ---------- 自定义排序：显示顺序与播放队列分离，排序选择持久化到 kv ---------- */

type PlaylistSort = 'custom' | 'title' | 'artist' | 'album' | 'plays' | 'duration'
const SORT_KEY = 'playlists.songSort'
const SORT_OPTIONS: { id: PlaylistSort; label: string }[] = [
  { id: 'custom', label: '自定义顺序' },
  { id: 'title', label: '歌曲名' },
  { id: 'artist', label: '艺术家' },
  { id: 'album', label: '专辑' },
  { id: 'plays', label: '播放次数' },
  { id: 'duration', label: '时长' },
]
const sortId = ref<PlaylistSort>('custom')
const sortOpen = ref(false)
const sortLabel = computed(() => SORT_OPTIONS.find((o) => o.id === sortId.value)?.label ?? '')

onMounted(() => {
  void db.kvGet<PlaylistSort>(SORT_KEY).then((v) => {
    if (v && SORT_OPTIONS.some((o) => o.id === v)) sortId.value = v
  })
})

function setSort(id: PlaylistSort) {
  sortId.value = id
  sortOpen.value = false
  void db.kvSet(SORT_KEY, id)
}

/** 详情列表的显示顺序：custom 即底层存储（添加）顺序 */
const displaySongs = computed<SongRecord[]>(() => {
  const songs = currentSongs.value
  if (sortId.value === 'custom') return songs
  const zh = 'zh-Hans-CN'
  const arr = [...songs]
  switch (sortId.value) {
    case 'plays':
      return arr.sort(
        (a, b) => (stats.counts[b.path] ?? 0) - (stats.counts[a.path] ?? 0) || a.title.localeCompare(b.title, zh),
      )
    case 'duration':
      return arr.sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0))
    default: {
      const key = (s: SongRecord) =>
        sortId.value === 'artist' ? s.artist : sortId.value === 'album' ? s.album : s.title
      return arr.sort((a, b) => key(a).localeCompare(key(b), zh) || a.title.localeCompare(b.title, zh))
    }
  }
})

/* ---------- 播放 ---------- */


function onPlay(song: SongRecord, e?: MouseEvent) {
  if (e) flyToPlayerFromRow(e)
  if (!currentSongs.value) return
  void player.playSong(song, currentSongs.value)
}

/* ---------- 头部流光光斑：取色自当前封面（手动封面优先，否则拼贴首图），带缓存 ---------- */
const flowColors = ref<string[]>([])
const flowCache = new Map<string, string[]>()

watch(
  () => [current.value?.id, currentCoverId.value] as const,
  async ([plId, coverId]) => {
    flowColors.value = (plId ? flowCache.get(plId) : undefined) ?? []
    if (!plId) return
    const cid =
      coverId ?? currentCoverIds.value.find((c): c is string => !!c) ?? null
    if (!cid) return
    try {
      const url = await library.coverUrl(cid)
      if (!url) return
      const blob = await (await fetch(url)).blob()
      const colors = await extractBrightColors(blob).catch(() => [] as string[])
      flowCache.set(plId, colors)
      if (current.value?.id === plId) flowColors.value = colors
    } catch {
      /* 取色失败则保留中性底 */
    }
  },
  { immediate: true },
)

/** 歌单总时长（统计行展示） */
const totalDurationLabel = computed(() =>
  formatTotalDuration(currentSongs.value.reduce((sum, s) => sum + (s.durationSec ?? 0), 0)),
)

/* ---------- 拖拽排序已移除：改为列表工具栏的自定义排序 ---------- */

</script>

<template>
  <div class="playlists-root">
  <!-- 歌单详情：覆盖层，网格常驻其下 -->
  <div v-if="current" ref="detailEl" class="playlist-detail">
    <!-- 歌单间切换的过渡：与顶部板块切换同款动向（key 变化触发 out-in）；
         打开/关闭由外层 v-if 走引力坍缩编排，初始挂载不播 enter，不会双重动画 -->
    <Transition name="view" mode="out-in">
      <div :key="current.id" class="detail-inner">
    <header class="pl-header">
      <!-- 返回歌单列表：悬停头部浮现 -->
      <button class="header-close" title="返回歌单列表" aria-label="返回歌单列表" @click="closePlaylist">
        <AppIcon name="close" :size="15" />
      </button>
      <!-- 流光呼吸光斑（对齐专辑详情页头部） -->
      <div
        v-for="(c, i) in flowColors.slice(0, 2)"
        :key="i"
        class="blob"
        :class="`hb-${i}`"
        :style="{ '--fc': c }"
      />
      <div class="header-cover">
        <CoverImage v-if="currentCoverId" :cover-id="currentCoverId" :size="176" />
        <CollageCover v-else :cover-ids="currentCoverIds" :size="176" />
        <button
          class="cover-edit"
          :disabled="currentSongs.length === 0"
          title="从歌单歌曲的封面中选择"
          @click="showCoverPicker = true"
        >
          <AppIcon name="image" :size="13" /> 设置封面
        </button>
      </div>
      <div class="pl-info">
        <h1 class="pl-name">{{ current.name }}</h1>
        <div class="pl-stats">
          <span>{{ currentSongs.length }}</span><span class="stat-label">歌曲</span>
          <span>{{ totalDurationLabel }}</span><span class="stat-label">时长</span>
        </div>
      </div>
    </header>

    <div v-if="currentSongs.length === 0" class="empty-hint">歌单还是空的，右键歌单选择「添加歌曲」吧</div>
    <template v-else>
      <!-- 列表工具栏：排序方式（持久化，全局生效） -->
      <div class="list-toolbar">
        <span class="list-count">{{ currentSongs.length }} 首</span>
        <div class="sort-drop">
          <button class="sort-btn" @click="sortOpen = !sortOpen">
            <AppIcon name="order" :size="14" /> {{ sortLabel }}
            <AppIcon name="expand" :size="11" class="sort-caret" />
          </button>
          <div v-if="sortOpen" class="sort-menu glass">
            <button
              v-for="o in SORT_OPTIONS"
              :key="o.id"
              class="sort-item"
              :class="{ active: sortId === o.id }"
              @click="setSort(o.id)"
            >
              <span class="sort-check"><AppIcon v-if="sortId === o.id" name="check" :size="13" /></span>
              {{ o.label }}
            </button>
          </div>
        </div>
      </div>
      <div v-if="sortOpen" class="sort-mask" @click="sortOpen = false" />

      <div class="drag-list">
        <div
          v-for="song in displaySongs"
          :key="song.path"
          class="drag-row"
          :class="{ playing: song.path === player.currentPath }"
          @click="onPlay(song, $event)"
          @contextmenu.prevent="onRowMenu(song, $event)"
        >
          <CoverImage :cover-id="song.coverId" :size="36" data-flight-cover />
        <span class="drag-title">{{ song.title }}</span>
        <span class="drag-artist">{{ song.artist }}</span>
        <span class="row-actions" @pointerdown.stop @click.stop>
          <button
            class="row-act"
            :class="{ active: favorites.has(song.path) }"
            :title="favorites.has(song.path) ? '取消收藏' : '收藏'"
            @click="favorites.toggle(song.path)"
          >
            <AppIcon name="heart" :size="14" :class="{ filled: favorites.has(song.path) }" />
          </button>
          <button class="row-act" title="更多操作" @click="onRowMenu(song, $event)">
            <AppIcon name="more" :size="14" />
          </button>
          <button class="row-act" title="从歌单移除" @click="playlistStore.removeSong(current!.id, song.path)">
            <AppIcon name="close" :size="14" />
          </button>
        </span>
      </div>
      </div>
    </template>
      </div>
    </Transition>

    <!-- 添加歌曲：大号二级弹层（多选批量添加：全选/反选/仅看未添加） -->
    <teleport to="body">
      <Transition name="modal"><div v-if="showAdd" class="modal-mask" @click.self="showAdd = false">
        <FrostedPanel class="modal add-modal" radius="14px">
          <div class="add-head">
            <div>
              <h3 class="modal-title">添加歌曲</h3>
              <p class="add-sub">添加到「{{ current.name }}」</p>
            </div>
            <button class="add-close" title="关闭" @click="showAdd = false">
              <AppIcon name="close" :size="15" />
            </button>
          </div>
          <div class="add-toolbar">
            <div class="add-search">
              <AppIcon name="search" :size="15" />
              <input
                v-model="addFilter"
                class="add-search-input"
                type="text"
                placeholder="搜索标题 / 艺术家 / 专辑"
              />
            </div>
            <label class="add-onlynew" title="隐藏已在歌单中的歌曲">
              <AppSwitch v-model="addOnlyNew" />
              <span>仅看未添加</span>
            </label>
          </div>
          <div class="add-select-row">
            <span class="add-selected-count">已选 {{ addSelected.size }} 首</span>
            <span class="add-select-btns">
              <button class="mini-link" @click="selectAllAdd">全选</button>
              <button class="mini-link" @click="invertAdd">反选</button>
              <button class="mini-link" :disabled="addSelected.size === 0" @click="clearAdd">清除</button>
            </span>
          </div>
          <div class="add-list">
            <label
              v-for="song in addCandidates"
              :key="song.path"
              class="add-row"
              :class="{ added: inPlaylist(song.path), checked: addSelected.has(song.path) }"
            >
              <input
                type="checkbox"
                class="add-check"
                :checked="addSelected.has(song.path)"
                :disabled="inPlaylist(song.path)"
                @change="toggleAddSelect(song.path)"
              />
              <CoverImage :cover-id="song.coverId" :size="44" class="add-cover" />
              <span class="add-meta">
                <span class="add-title">{{ song.title }}</span>
                <span class="add-subline">{{ song.artist }} · {{ song.album }}</span>
              </span>
              <span class="add-dur">{{ formatDuration(song.durationSec) }}</span>
              <span v-if="inPlaylist(song.path)" class="add-state">已在歌单</span>
            </label>
            <div v-if="addCandidates.length === 0" class="add-empty">没有匹配的歌曲</div>
          </div>
          <div class="add-footer">
            <button class="action-btn" @click="showAdd = false">取消</button>
            <button
              class="action-btn primary"
              :disabled="addSelected.size === 0"
              @click="confirmAddSelected(); showAdd = false"
            >
              添加{{ addSelected.size > 0 ? ` ${addSelected.size} 首` : '' }}
            </button>
          </div>
        </FrostedPanel>
      </div></Transition>
    </teleport>
    <!-- 封面选择弹层：从歌单内歌曲封面中挑一张，或导入自定义图片 -->
    <teleport to="body">
      <Transition name="modal"><div v-if="showCoverPicker" class="modal-mask" @click.self="showCoverPicker = false">
        <FrostedPanel class="modal wide" radius="12px">
          <h3 class="modal-title">设置「{{ current.name }}」的封面</h3>
          <div class="cover-grid">
            <button
              class="cover-choice"
              :class="{ active: !!current?.customCoverId }"
              :disabled="importingCover"
              @click="coverFileEl?.click()"
            >
              <CoverImage
                v-if="current?.customCoverId"
                :cover-id="current.customCoverId"
                :size="72"
              />
              <span v-else class="cover-import-ph"><AppIcon name="plus" :size="20" /></span>
              <span class="cover-choice-name">{{ importingCover ? '导入中…' : '导入图片' }}</span>
            </button>
            <button
              v-for="c in coverChoices"
              :key="c.path"
              class="cover-choice"
              :class="{ active: current.coverPath === c.path }"
              :title="c.title"
              @click="chooseCover(c.path)"
            >
              <CoverImage :cover-id="c.coverId" :size="72" />
              <span class="cover-choice-name">{{ c.title }}</span>
            </button>
          </div>
          <div v-if="coverChoices.length === 0" class="empty-hint">歌单里的歌曲都没有封面，可导入图片作为封面</div>
          <div class="modal-actions">
            <button class="action-btn" :disabled="importingCover" @click="chooseCover(null)">恢复默认</button>
          </div>
          <!-- 隐藏的图片选择入口：点「导入图片」触发 -->
          <input
            ref="coverFileEl"
            type="file"
            accept="image/*"
            class="cover-file-input"
            @change="onCoverFile"
          />
        </FrostedPanel>
      </div></Transition>
    </teleport>
  </div>

  <!-- 歌单列表：永久渲染（详情覆盖层以不透明底盖住），返回动画收尾时网格喷回可见 -->
  <div ref="plHomeEl" class="playlist-home">
    <div class="toolbar">
      <button class="primary-btn" @click="showCreate = true">
        <AppIcon name="plus" :size="16" /> 新建歌单
      </button>
    </div>

    <div v-if="playlistStore.playlists.length === 0" class="empty-hint">还没有歌单</div>
    <div v-else class="pl-grid">
      <button
        v-for="p in playlistStore.playlists"
        :key="p.id"
        class="pl-card"
        @click="openPlaylist(p, $event)"
      >
        <CoverImage
          v-if="cardCoverOverride.get(p.id)"
          :cover-id="cardCoverOverride.get(p.id)!"
          :size="120"
          class="card-cover"
        />
        <CollageCover v-else :cover-ids="cardCoverIds.get(p.id) ?? []" :size="120" />
        <div class="pl-card-name" :title="p.name">{{ p.name }}</div>
        <div class="pl-card-sub">{{ p.songPaths.length }} 首</div>
      </button>
    </div>

    <!-- 新建弹层 -->
    <teleport to="body">
      <Transition name="modal"><div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
        <FrostedPanel class="modal" radius="12px">
          <h3 class="modal-title">新建歌单</h3>
          <input
            v-model="newName"
            class="text-input"
            type="text"
            placeholder="歌单名称"
            @keyup.enter="confirmCreate"
          />
          <div class="modal-actions">
            <button class="action-btn" @click="showCreate = false">取消</button>
            <button class="action-btn primary" @click="confirmCreate">创建</button>
          </div>
        </FrostedPanel>
      </div></Transition>
    </teleport>
  </div>
</div>
</template>

<style scoped>
.playlists-root {
  position: relative;
  height: 100%;
}

.playlist-home {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 详情覆盖层：负 inset 扩到滚动宿主（.view-body）的 padding 区外——
   滚动条贴视口右缘、底部无隔断（与专辑/艺术家详情 .detail-layer 一致的外层滚动观感）。
   -24px 与 App.vue .view-body / .detail-layer 的 padding: 0 24px 96px 联动，改那边要同步这边。
   底部 96px 是播放条（悬浮玻璃条）的安全空间，两形态恒定。
   必须完全不透明：覆盖层与 body 之间夹着常驻的列表网格/封面，半透明就会穿透出来 */
.playlist-detail {
  position: absolute;
  top: 0;
  right: -24px;
  bottom: -96px;
  left: -24px;
  z-index: 2;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 24px 96px;
}

/* 固定高度的纵向 flex 滚动容器里，子项默认可被压缩；
   头部带 overflow:hidden 会让 min-height 归零，歌曲一多整个头部被挤成一条
   （专辑详情页踩过的同一个坑），必须禁止收缩 */
.playlist-detail > * {
  flex-shrink: 0;
}

/* 歌单间切换的内层过渡容器：接管原详情的纵向布局 */
.detail-inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 返回歌单列表：头部卡片右上角的隐藏式关闭钮，悬停/聚焦时浮现 */
.header-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--text-secondary);
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.pl-header:hover .header-close,
.header-close:focus-visible {
  opacity: 1;
  transform: translateY(0);
}

.header-close:hover {
  color: var(--text-primary);
  background: var(--bg-active);
}

.pl-header {
  position: relative;
  display: flex;
  gap: 24px;
  align-items: flex-end;
  padding: 28px 24px;
  border-radius: var(--radius-panel);
  overflow: hidden;
  /* 头部背景：中性渐变（主题自适应），光斑与噪点提供质感（对齐专辑详情页） */
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

/* 胶片噪点：4% 细颗粒破掉 flat 渐变的塑料感 */
.pl-header::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0.04;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px 160px;
}

/* 头部封面容器：悬停浮现「设置封面」入口 */
.header-cover {
  position: relative;
  z-index: 2;
  width: 176px;
  height: 176px;
  flex-shrink: 0;
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.header-cover > :deep(.cover-img),
.header-cover > :deep(.cover-fallback) {
  border-radius: 8px;
}

.cover-edit {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 0;
  font-size: 12px;
  color: #fff;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0.45) 70%, transparent);
  border-radius: 0 0 8px 8px;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity var(--dur-med) var(--ease-out), transform var(--dur-med) var(--ease-out);
}

.header-cover:hover .cover-edit,
.cover-edit:focus-visible {
  opacity: 1;
  transform: translateY(0);
}

.cover-edit:disabled {
  opacity: 0;
  pointer-events: none;
}

/* 封面选择网格 */
.cover-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 10px;
  max-height: 380px;
  overflow-y: auto;
  padding: 2px;
}

.cover-choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-radius: var(--radius-item);
  border: 2px solid transparent;
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.cover-choice:hover {
  background: var(--bg-hover);
}

.cover-choice.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.cover-choice :deep(.cover-img),
.cover-choice :deep(.cover-fallback) {
  border-radius: 6px;
}

.cover-choice-name {
  max-width: 100%;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 「导入图片」磁贴的占位块：与 72px 封面同尺寸的虚线空位 */
.cover-import-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 6px;
  border: 1px dashed var(--border-subtle);
  color: var(--text-tertiary);
  background: var(--bg-hover);
}

.cover-choice:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 隐藏的图片选择 input（点「导入图片」磁贴触发） */
.cover-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.pl-info {
  position: relative;
  z-index: 2;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pl-name {
  font-size: 24px;
  font-weight: 600;
}

.pl-stats {
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


.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
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

.action-btn.danger:hover {
  color: var(--danger);
  border-color: var(--danger-border);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 列表工具栏：排序 */
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.list-count {
  font-size: 13px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.sort-drop {
  position: relative;
}

.sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.sort-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sort-caret {
  transform: rotate(90deg);
  color: var(--text-tertiary);
}

.sort-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 5;
  min-width: 148px;
  padding: 6px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-1);
}

.sort-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out);
}

.sort-item:hover {
  background: var(--bg-hover);
}

.sort-item.active {
  color: var(--accent);
}

.sort-check {
  display: inline-flex;
  width: 15px;
  justify-content: center;
}

/* 关闭排序菜单的透明遮罩（在菜单层之下） */
.sort-mask {
  position: fixed;
  inset: 0;
  z-index: 4;
}

/* 播放列表 */
.drag-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.drag-row {
  position: relative;
  display: grid;
  grid-template-columns: 36px 1fr 1fr 32px;
  gap: 12px;
  align-items: center;
  height: 52px;
  padding: 0 12px;
  border-radius: 8px;
  transition: background 0.12s var(--ease-out), opacity 0.12s var(--ease-out);
}

.drag-row:hover {
  background: var(--bg-hover);
}

.drag-row.playing {
  background: var(--bg-active);
}

.drag-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drag-artist {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-act {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--text-tertiary);
}

/* 悬停快捷操作（收藏/更多/移除）：透明底浮出行尾空白区，过渡浮现 */
.row-actions {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transform: translateX(6px);
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.drag-row:hover .row-actions,
.drag-row:focus-within .row-actions {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

.row-act {
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

/* 歌单列表 */
.toolbar {
  display: flex;
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 13px;
}

.primary-btn:hover {
  opacity: 0.9;
}

.pl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 20px;
}

.pl-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-radius: 10px;
  transition: background 0.15s;
}

.pl-card:hover {
  background: var(--bg-hover);
}

/* 手动指定封面的卡片：与拼贴封面同样的圆角和投影 */
.pl-card :deep(.card-cover.cover-img),
.pl-card :deep(.card-cover.cover-fallback) {
  border-radius: 8px;
  box-shadow: var(--shadow-1);
}

.pl-card-name {
  max-width: 100%;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pl-card-sub {
  font-size: 12px;
  color: var(--text-secondary);
}

.empty-hint {
  color: var(--text-tertiary);
  padding: 40px 0;
  text-align: center;
}

/* 弹层 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

/* 弹层过渡：遮罩淡入 + 面板 spring 上浮 */
.modal-enter-active {
  transition: opacity var(--dur-med) var(--ease-out);
}

.modal-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}

.modal-enter-active :deep(.modal) {
  transition: transform var(--dur-med) var(--ease-spring), opacity var(--dur-med) var(--ease-out);
}

.modal-leave-active :deep(.modal) {
  transition: transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from :deep(.modal) {
  transform: translateY(14px) scale(0.96);
  opacity: 0;
}

.modal-leave-to :deep(.modal) {
  transform: translateY(6px) scale(0.98);
  opacity: 0;
}

.modal {
  width: 360px;
  max-width: 90vw;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.modal.wide {
  width: 520px;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
}

.text-input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-hover);
  color: var(--text-primary);
  outline: none;
}

.text-input:focus {
  border-color: var(--accent);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ---------- 添加歌曲大弹层 ---------- */
.modal.add-modal {
  width: min(900px, 92vw);
  height: min(640px, 86vh);
  padding: 26px 26px 20px;
  gap: 14px;
}

.add-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.add-head .modal-title {
  font-size: 19px;
  letter-spacing: 0.2px;
}

.add-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.add-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: 1px solid transparent;
  color: var(--text-tertiary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.add-close:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  color: var(--text-primary);
}

.add-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.add-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: var(--bg-panel);
  color: var(--text-tertiary);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.add-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.add-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
}

.add-search-input::placeholder {
  color: var(--text-tertiary);
}

.add-onlynew {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
}

.add-select-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 0 4px;
}

.add-selected-count {
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.add-select-btns {
  display: flex;
  gap: 4px;
}

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

.mini-link:disabled {
  opacity: 0.4;
  cursor: default;
  background: none;
}

.add-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 2px;
}

.add-row {
  display: grid;
  grid-template-columns: 20px 44px 1fr auto auto;
  gap: 14px;
  align-items: center;
  height: 60px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}

.add-row:hover {
  background: var(--bg-hover);
}

.add-row.checked {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 28%, transparent);
}

.add-row.added {
  opacity: 0.45;
  cursor: default;
}

/* 自定义勾选框：圆角方框，选中填充主题色并打出对勾 */
.add-check {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  margin: 0;
  border-radius: 6px;
  border: 1.5px solid var(--border-subtle);
  background: var(--bg-base);
  cursor: pointer;
  position: relative;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}

.add-check:hover {
  border-color: var(--accent);
}

.add-check:checked {
  background: var(--accent);
  border-color: var(--accent);
}

.add-check:checked::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 1.5px;
  width: 4px;
  height: 9px;
  border-right: 2px solid var(--accent-text);
  border-bottom: 2px solid var(--accent-text);
  transform: rotate(45deg);
}

.add-check:disabled {
  opacity: 0.35;
  cursor: default;
}

.add-cover :deep(.cover-img),
.add-cover :deep(.cover-fallback) {
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.add-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.add-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.add-subline {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.add-dur {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.add-state {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  white-space: nowrap;
  text-align: right;
}

.add-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
}

.add-footer .action-btn {
  padding: 8px 20px;
  border-radius: 9px;
}

.add-footer .action-btn.primary {
  box-shadow: 0 2px 10px color-mix(in srgb, var(--accent) 30%, transparent);
}

.add-empty {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
  padding: 30px 0;
}

/* 详情内容浮现由「引力坍缩」编排器驱动（波前 WAAPI），无 CSS 初始隐藏 */
</style>
