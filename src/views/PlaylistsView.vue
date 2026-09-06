<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import CollageCover from '@/components/CollageCover.vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import FrostedPanel from '@/components/FrostedPanel.vue'
import { capturePageTransition, playPageTransition } from '@/services/legacyFlip'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { usePlaylistStore } from '@/stores/playlist'
import { useFavoritesStore } from '@/stores/favorites'
import { useSongActions } from '@/composables/useSongActions'
import { useStaggerReveal } from '@/composables/useStaggerReveal'
import { flyToPlayerFromRow } from '@/services/coverFlight'
import { useUiStore } from '@/stores/ui'
import type { SongRecord } from '@/types'

/**
 * 歌单页：歌单列表 / 歌单详情（播放、重命名、删除、添加歌曲、拖拽排序）
 */
const library = useLibraryStore()
const player = usePlayerStore()
const playlistStore = usePlaylistStore()
const favorites = useFavoritesStore()
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
onBeforeUnmount(() => plReveal.disconnect())

// 侧边栏在其他页面点击「新建歌单」时也会置位请求标记
watch(
  () => ui.playlistCreateRequested,
  () => {
    consumeCreateRequest()
  },
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

/** 手动指定的封面：coverPath 指向的歌还在库中就用它的封面，否则回退拼贴 */
const currentCoverId = computed<string | null>(() => {
  const path = current.value?.coverPath
  if (!path) return null
  return library.songs.find((s) => s.path === path)?.coverId ?? null
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

/** 歌单列表页：id → 手动指定封面的 coverId（未设置则不在 map 里） */
const cardCoverOverride = computed(() => {
  const byPath = new Map(library.songs.map((s) => [s.path, s.coverId]))
  const map = new Map<string, string | null>()
  for (const p of playlistStore.playlists) {
    if (p.coverPath) map.set(p.id, byPath.get(p.coverPath) ?? null)
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

/* 共享元素过渡 + 内容错峰浮现 + 返回轻淡出 */
const plRevealed = ref(false)
const plClosing = ref(false)

watch(
  current,
  async (pl) => {
    plRevealed.value = false
    plClosing.value = false
    if (!pl) return
    await nextTick()
    await playPageTransition(document.querySelector<HTMLElement>('.playlist-detail .header-cover'))
    plRevealed.value = true
  },
  { immediate: true, flush: 'post' },
)

function closePlaylist() {
  if (plClosing.value || !current.value) return
  plClosing.value = true
  window.setTimeout(() => {
    ui.closeDetail()
    plClosing.value = false
  }, 180)
}

function openPlaylist(p: { id: string }, e: MouseEvent) {
  const cover = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('img, .cover-fallback')
  capturePageTransition(cover, { x: e.clientX, y: e.clientY })
  ui.openDetail(p.id)
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

const showRename = ref(false)
const renameText = ref('')

function confirmRename() {
  if (current.value) playlistStore.rename(current.value.id, renameText.value)
  showRename.value = false
}

const showAdd = ref(false)
const addFilter = ref('')
/** 多选批量添加的选中集 */
const addSelected = ref<Set<string>>(new Set())

function openAdd() {
  addSelected.value = new Set()
  addFilter.value = ''
  showAdd.value = true
}

const addCandidates = computed(() =>
  addFilter.value
    ? library.sortedSongs.filter((s) =>
        (s.title + s.artist + s.album).toLowerCase().includes(addFilter.value.toLowerCase()),
      )
    : library.sortedSongs,
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

/* ---------- 播放 ---------- */

function playAll(shuffle = false) {
  if (!current.value || currentSongs.value.length === 0) return
  player.setPlayMode(shuffle ? 'shuffle' : 'loop')
  const songs = currentSongs.value
  const first = shuffle ? (songs[Math.floor(Math.random() * songs.length)] ?? songs[0]) : songs[0]
  void player.playSong(first, songs)
}

function onPlay(song: SongRecord, e?: MouseEvent) {
  if (e) flyToPlayerFromRow(e)
  if (!currentSongs.value) return
  void player.playSong(song, currentSongs.value)
}

/* ---------- 拖拽排序 ---------- */

const dragIndex = ref<number | null>(null)
/** 当前悬停的目标行（用于画插入指示线） */
const dragOverIndex = ref<number | null>(null)
/** 插入到目标行的上方还是下方：由指针在行内的纵向位置决定 */
const dropAfter = ref(false)

function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  // 让拖拽影像半透明，并告诉浏览器这是一次"移动"
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // 部分浏览器要求设置了 data 才会触发 drop
    e.dataTransfer.setData('text/plain', String(i))
  }
}

function onDragOver(i: number, e: DragEvent) {
  if (dragIndex.value === null) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const row = e.currentTarget as HTMLElement
  const rect = row.getBoundingClientRect()
  // 指针过半 → 插到该行下方，否则插到上方
  dropAfter.value = e.clientY - rect.top > rect.height / 2
  dragOverIndex.value = i
}

function onDrop(i: number, e: DragEvent) {
  e.preventDefault()
  const from = dragIndex.value
  if (current.value && from !== null && from !== i) {
    // 计算真实落点：往上插就是 i，往下插就是 i+1；
    // moveSong 内部按"先摘除再插入"处理，from < target 时索引要左移一位。
    const target = dropAfter.value ? i + 1 : i
    const adjusted = from < target ? target - 1 : target
    if (adjusted !== from) playlistStore.moveSong(current.value.id, from, adjusted)
  }
  resetDrag()
}

/**
 * 关键：dragend 在"松手但没落在有效放置区"时也会触发，
 * 而 drop 不会。少了它，行会永久卡在半透明的拖拽态。
 */
function onDragEnd() {
  resetDrag()
}

function resetDrag() {
  dragIndex.value = null
  dragOverIndex.value = null
  dropAfter.value = false
}

function confirmRemove() {
  if (!current.value) return
  playlistStore.remove(current.value.id)
  ui.closeDetail()
}
</script>

<template>
  <!-- 歌单详情 -->
  <div v-if="current" class="playlist-detail" :class="{ revealed: plRevealed, closing: plClosing }">
    <button class="back-btn" @click="closePlaylist">
      <AppIcon name="close" :size="14" /> 返回歌单列表
    </button>

    <header class="pl-header">
      <div class="header-cover">
        <CoverImage v-if="currentCoverId" :cover-id="currentCoverId" :size="120" />
        <CollageCover v-else :cover-ids="currentCoverIds" :size="120" />
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
        <div class="pl-sub">{{ currentSongs.length }} 首歌曲</div>
        <div class="pl-actions">
          <button class="action-btn primary" :disabled="currentSongs.length === 0" @click="playAll(false)">
            <AppIcon name="play" :size="14" /> 播放全部
          </button>
          <button class="action-btn" :disabled="currentSongs.length === 0" @click="playAll(true)">
            <AppIcon name="shuffle" :size="15" /> 随机
          </button>
          <button class="action-btn" @click="openAdd">
            <AppIcon name="plus" :size="15" /> 添加歌曲
          </button>
          <button
            class="action-btn"
            @click="
              renameText = current.name;
              showRename = true
            "
          >
            重命名
          </button>
          <button class="action-btn danger" @click="confirmRemove">删除歌单</button>
        </div>
      </div>
    </header>

    <div v-if="currentSongs.length === 0" class="empty-hint">歌单还是空的，点击「添加歌曲」吧</div>
    <div v-else class="drag-list">
      <div
        v-for="(song, i) in currentSongs"
        :key="song.path"
        class="drag-row"
        :class="{
          playing: song.path === player.currentPath,
          dragging: dragIndex === i,
          'drop-before': dragOverIndex === i && !dropAfter && dragIndex !== i,
          'drop-after': dragOverIndex === i && dropAfter && dragIndex !== i,
        }"
        draggable="true"
        @dragstart="onDragStart(i, $event)"
        @dragover="onDragOver(i, $event)"
        @drop="onDrop(i, $event)"
        @dragend="onDragEnd"
        @click="onPlay(song, $event)"
        @contextmenu.prevent="onRowMenu(song, $event)"
      >
        <span class="drag-handle">⋮⋮</span>
        <CoverImage :cover-id="song.coverId" :size="36" data-flight-cover />
        <span class="drag-title">{{ song.title }}</span>
        <span class="drag-artist">{{ song.artist }}</span>
        <span class="row-actions" @click.stop>
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

    <!-- 重命名弹层 -->
    <teleport to="body">
      <Transition name="modal"><div v-if="showRename" class="modal-mask" @click.self="showRename = false">
        <FrostedPanel class="modal" radius="12px">
          <h3 class="modal-title">重命名歌单</h3>
          <input v-model="renameText" class="text-input" type="text" @keyup.enter="confirmRename" />
          <div class="modal-actions">
            <button class="action-btn" @click="showRename = false">取消</button>
            <button class="action-btn primary" @click="confirmRename">确定</button>
          </div>
        </FrostedPanel>
      </div></Transition>
    </teleport>

    <!-- 添加歌曲弹层（多选批量添加） -->
    <teleport to="body">
      <Transition name="modal"><div v-if="showAdd" class="modal-mask" @click.self="showAdd = false">
        <FrostedPanel class="modal wide" radius="12px">
          <h3 class="modal-title">添加歌曲到「{{ current.name }}」</h3>
          <input v-model="addFilter" class="text-input" type="text" placeholder="搜索标题 / 艺术家 / 专辑" />
          <div class="add-list">
            <label
              v-for="song in addCandidates"
              :key="song.path"
              class="add-row"
              :class="{ added: inPlaylist(song.path) }"
            >
              <input
                type="checkbox"
                class="add-check"
                :checked="addSelected.has(song.path)"
                :disabled="inPlaylist(song.path)"
                @change="toggleAddSelect(song.path)"
              />
              <span class="drag-title">{{ song.title }}</span>
              <span class="drag-artist">{{ song.artist }}</span>
              <span class="add-state">{{ inPlaylist(song.path) ? '已在歌单' : '' }}</span>
            </label>
          </div>
          <div class="modal-actions">
            <button class="action-btn" @click="showAdd = false">取消</button>
            <button class="action-btn primary" :disabled="addSelected.size === 0" @click="confirmAddSelected(); showAdd = false">
              添加{{ addSelected.size > 0 ? ` ${addSelected.size} 首` : '' }}
            </button>
          </div>
        </FrostedPanel>
      </div></Transition>
    </teleport>
    <!-- 封面选择弹层：从歌单内歌曲封面中挑一张 -->
    <teleport to="body">
      <Transition name="modal"><div v-if="showCoverPicker" class="modal-mask" @click.self="showCoverPicker = false">
        <FrostedPanel class="modal wide" radius="12px">
          <h3 class="modal-title">设置「{{ current.name }}」的封面</h3>
          <div class="cover-grid">
            <button class="cover-choice" :class="{ active: !currentCoverId }" @click="chooseCover(null)">
              <CollageCover :cover-ids="currentCoverIds" :size="72" />
              <span class="cover-choice-name">自动拼贴</span>
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
          <div v-if="coverChoices.length === 0" class="empty-hint">歌单里的歌曲都没有封面</div>
        </FrostedPanel>
      </div></Transition>
    </teleport>
  </div>

  <!-- 歌单列表 -->
  <div v-else ref="plHomeEl" class="playlist-home">
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
</template>

<style scoped>
.playlist-detail,
.playlist-home {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.playlist-detail {
  height: 100%;
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

.pl-header {
  display: flex;
  align-items: center;
  gap: 20px;
}

/* 头部封面容器：悬停浮现「设置封面」入口 */
.header-cover {
  position: relative;
  width: 120px;
  height: 120px;
  flex-shrink: 0;
  border-radius: 8px;
  box-shadow: var(--shadow-1);
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

.pl-name {
  font-size: 24px;
  font-weight: 600;
}

.pl-sub {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 4px 0 10px;
}

.pl-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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

/* 拖拽排序列表 */
.drag-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.drag-row {
  position: relative;
  display: grid;
  grid-template-columns: 24px 36px 1fr 1fr 32px;
  gap: 12px;
  align-items: center;
  height: 52px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: grab;
  transition: background 0.12s var(--ease-out), opacity 0.12s var(--ease-out);
}

.drag-row:active {
  cursor: grabbing;
}

.drag-row:hover {
  background: var(--bg-hover);
}

.drag-row.playing {
  background: var(--bg-active);
}

.drag-row.dragging {
  opacity: 0.4;
}

/* 插入指示线：2px 品牌红贴在目标行的上/下边缘 */
.drag-row.drop-before::before,
.drag-row.drop-after::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
  pointer-events: none;
}

.drag-row.drop-before::before {
  top: -1px;
}

.drag-row.drop-after::after {
  bottom: -1px;
}

.drag-handle {
  color: var(--text-tertiary);
  text-align: center;
  letter-spacing: -2px;
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

.drag-remove,
.row-act {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--text-tertiary);
}

.drag-remove:hover {
  background: var(--bg-hover);
  color: var(--danger);
}

/* 悬停快捷操作（收藏/更多/移除）：玻璃小胶囊浮出行尾空白区，过渡浮现 */
.row-actions {
  position: absolute;
  right: 8px;
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

.add-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.add-row {
  display: grid;
  grid-template-columns: 20px 1fr 1fr auto;
  gap: 12px;
  align-items: center;
  height: 40px;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;
}

.add-row:hover {
  background: var(--bg-hover);
}

.add-row.added {
  opacity: 0.55;
  cursor: default;
}

.add-check {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  cursor: pointer;
}

.add-state {
  font-size: 12px;
  color: var(--text-tertiary);
}

/* 共享元素过渡落定后的错峰浮现 + 返回轻淡出 */
.playlist-detail {
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
}

.playlist-detail.closing {
  opacity: 0;
  transform: translateY(8px);
}

.playlist-detail .back-btn,
.playlist-detail .pl-header,
.playlist-detail .drag-list,
.playlist-detail .empty-hint {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 320ms var(--ease-out), transform 320ms var(--ease-out);
}

.playlist-detail.revealed .back-btn {
  transition-delay: 40ms;
}

.playlist-detail.revealed .pl-header {
  transition-delay: 80ms;
}

.playlist-detail.revealed .drag-list,
.playlist-detail.revealed .empty-hint {
  transition-delay: 120ms;
}

.playlist-detail.revealed .back-btn,
.playlist-detail.revealed .pl-header,
.playlist-detail.revealed .drag-list,
.playlist-detail.revealed .empty-hint {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .playlist-detail {
    transition: none;
  }
  .playlist-detail.closing {
    transform: none;
  }
  .playlist-detail .back-btn,
  .playlist-detail .pl-header,
  .playlist-detail .drag-list,
  .playlist-detail .empty-hint {
    opacity: 1;
    transform: none;
    transition: none;
    transition-delay: 0ms;
  }
}
</style>
