<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import FrostedPanel from '@/components/FrostedPanel.vue'
import { capturePageTransition, playPageTransition } from '@/services/pageTransition'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { usePlaylistStore } from '@/stores/playlist'
import { useUiStore } from '@/stores/ui'
import type { SongRecord } from '@/types'

/**
 * 歌单页：歌单列表 / 歌单详情（播放、重命名、删除、添加歌曲、拖拽排序）
 */
const library = useLibraryStore()
const player = usePlayerStore()
const playlistStore = usePlaylistStore()
const ui = useUiStore()

onMounted(() => {
  if (!playlistStore.loaded) playlistStore.load()
  if (ui.playlistCreateRequested) {
    ui.playlistCreateRequested = false
    showCreate.value = true
  }
})

// 侧边栏在其他页面点击「新建歌单」时也会置位请求标记
watch(
  () => ui.playlistCreateRequested,
  (requested) => {
    if (requested) {
      ui.playlistCreateRequested = false
      showCreate.value = true
    }
  },
)

const current = computed(() => playlistStore.playlists.find((p) => p.id === ui.detailKey))

const currentSongs = computed<SongRecord[]>(() => {
  if (!current.value) return []
  const byPath = new Map(library.songs.map((s) => [s.path, s]))
  return current.value.songPaths
    .map((p) => byPath.get(p))
    .filter((s): s is SongRecord => s !== undefined)
})

const coverId = computed(() => currentSongs.value.find((s) => s.coverId)?.coverId ?? null)

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
  const p = playlistStore.create(newName.value)
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

/* ---------- 播放 ---------- */

function playAll(shuffle = false) {
  if (!current.value || currentSongs.value.length === 0) return
  player.setPlayMode(shuffle ? 'shuffle' : 'loop')
  const songs = currentSongs.value
  const first = shuffle ? (songs[Math.floor(Math.random() * songs.length)] ?? songs[0]) : songs[0]
  void player.playSong(first, songs)
}

function onPlay(song: SongRecord) {
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
      <CoverImage :cover-id="coverId" :size="120" class="header-cover" />
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
          <button class="action-btn" @click="showAdd = true">
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
        @click="onPlay(song)"
      >
        <span class="drag-handle">⋮⋮</span>
        <CoverImage :cover-id="song.coverId" :size="36" />
        <span class="drag-title">{{ song.title }}</span>
        <span class="drag-artist">{{ song.artist }}</span>
        <span class="drag-remove" title="从歌单移除" @click.stop="playlistStore.removeSong(current!.id, song.path)">
          <AppIcon name="close" :size="13" />
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

    <!-- 添加歌曲弹层 -->
    <teleport to="body">
      <Transition name="modal"><div v-if="showAdd" class="modal-mask" @click.self="showAdd = false">
        <FrostedPanel class="modal wide" radius="12px">
          <h3 class="modal-title">添加歌曲到「{{ current.name }}」</h3>
          <input v-model="addFilter" class="text-input" type="text" placeholder="搜索标题 / 艺术家 / 专辑" />
          <div class="add-list">
            <div v-for="song in addCandidates" :key="song.path" class="add-row">
              <span class="drag-title">{{ song.title }}</span>
              <span class="drag-artist">{{ song.artist }}</span>
              <button
                class="add-btn"
                :class="{ added: inPlaylist(song.path) }"
                :disabled="inPlaylist(song.path)"
                @click="playlistStore.addSongs(current!.id, [song.path])"
              >
                {{ inPlaylist(song.path) ? '已添加' : '添加' }}
              </button>
            </div>
          </div>
          <div class="modal-actions">
            <button class="action-btn primary" @click="showAdd = false">完成</button>
          </div>
        </FrostedPanel>
      </div></Transition>
    </teleport>
  </div>

  <!-- 歌单列表 -->
  <div v-else class="playlist-home">
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
          :cover-id="
            p.songPaths
              .map((path) => library.songs.find((s) => s.path === path)?.coverId ?? null)
              .find(Boolean) ?? null
          "
          :size="120"
        />
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

.drag-remove {
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
  grid-template-columns: 1fr 1fr auto;
  gap: 12px;
  align-items: center;
  height: 40px;
  padding: 0 8px;
  border-radius: 6px;
}

.add-row:hover {
  background: var(--bg-hover);
}

.add-btn {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--accent);
  color: var(--accent-text);
}

.add-btn.added {
  background: var(--bg-hover);
  color: var(--text-tertiary);
  cursor: default;
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
