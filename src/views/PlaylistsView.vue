<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import CoverImage from '@/components/CoverImage.vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import FrostedPanel from '@/components/FrostedPanel.vue'
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

function onDragStart(i: number) {
  dragIndex.value = i
}

function onDrop(i: number) {
  if (current.value && dragIndex.value !== null && dragIndex.value !== i) {
    playlistStore.moveSong(current.value.id, dragIndex.value, i)
  }
  dragIndex.value = null
}

function confirmRemove() {
  if (!current.value) return
  playlistStore.remove(current.value.id)
  ui.closeDetail()
}
</script>

<template>
  <!-- 歌单详情 -->
  <div v-if="current" class="playlist-detail">
    <button class="back-btn" @click="ui.closeDetail()">
      <AppIcon name="close" :size="14" /> 返回歌单列表
    </button>

    <header class="pl-header">
      <CoverImage :cover-id="coverId" :size="120" />
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
        :class="{ playing: song.path === player.currentPath, dragging: dragIndex === i }"
        draggable="true"
        @dragstart="onDragStart(i)"
        @dragover.prevent
        @drop="onDrop(i)"
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
      <div v-if="showRename" class="modal-mask" @click.self="showRename = false">
        <FrostedPanel class="modal" radius="12px">
          <h3 class="modal-title">重命名歌单</h3>
          <input v-model="renameText" class="text-input" type="text" @keyup.enter="confirmRename" />
          <div class="modal-actions">
            <button class="action-btn" @click="showRename = false">取消</button>
            <button class="action-btn primary" @click="confirmRename">确定</button>
          </div>
        </FrostedPanel>
      </div>
    </teleport>

    <!-- 添加歌曲弹层 -->
    <teleport to="body">
      <div v-if="showAdd" class="modal-mask" @click.self="showAdd = false">
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
      </div>
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
      <button v-for="p in playlistStore.playlists" :key="p.id" class="pl-card" @click="ui.openDetail(p.id)">
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
      <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
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
      </div>
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
  display: grid;
  grid-template-columns: 24px 36px 1fr 1fr 32px;
  gap: 12px;
  align-items: center;
  height: 52px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: grab;
  transition: background 0.12s;
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
</style>
