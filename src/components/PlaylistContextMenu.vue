<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { usePlaylistMenu } from '@/composables/usePlaylistMenu'
import { usePlaylistStore } from '@/stores/playlist'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

/**
 * 歌单右键菜单：播放 / 重命名 / 设置封面 / 删除。
 * 重命名与删除在菜单内完成（内联输入与确认），设置封面跳转详情并发出请求标记。
 */
const { menuState, close } = usePlaylistMenu()
const playlistStore = usePlaylistStore()
const library = useLibraryStore()
const player = usePlayerStore()
const ui = useUiStore()

const pl = computed(() =>
  menuState.value ? playlistStore.playlists.find((p) => p.id === menuState.value!.playlistId) : null,
)
const visible = computed(() => !!pl.value)

/* 重命名（内联输入） */
const renaming = ref(false)
const renameText = ref('')

function openRename() {
  if (!pl.value) return
  renameText.value = pl.value.name
  renaming.value = true
}

function confirmRename() {
  if (pl.value && renameText.value.trim()) playlistStore.rename(pl.value.id, renameText.value)
  renaming.value = false
  close()
}

/* 删除（内联确认） */
const confirmingDelete = ref(false)

function confirmDelete() {
  if (!pl.value) return
  playlistStore.remove(pl.value.id)
  confirmingDelete.value = false
  // 删除的是正在查看的歌单时，关闭详情
  if (ui.detailKey === pl.value.id) ui.closeDetail()
  close()
}

function play() {
  if (!pl.value) return
  const byPath = new Map(library.songs.map((s) => [s.path, s]))
  const songs = pl.value.songPaths.map((p) => byPath.get(p)).filter((s) => s !== undefined)
  if (songs.length > 0) void player.playSong(songs[0], songs)
  close()
}

function editCover() {
  if (!pl.value) return
  ui.playlistEditCover = pl.value.id
  ui.activeView = 'playlists'
  ui.detailKey = pl.value.id
  close()
}

/* 打开时定位并防溢出 */
const menuEl = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })

watch(
  menuState,
  async (st) => {
    if (!st) return
    renaming.value = false
    confirmingDelete.value = false
    pos.value = { x: st.x, y: st.y }
    await new Promise((r) => requestAnimationFrame(r))
    const el = menuEl.value
    if (el) {
      const r = el.getBoundingClientRect()
      pos.value = {
        x: Math.min(st.x, window.innerWidth - r.width - 8),
        y: Math.min(st.y, window.innerHeight - r.height - 8),
      }
    }
  },
  { flush: 'post' },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="menu-layer" @click.self="close" @contextmenu.prevent="close">
      <div
        ref="menuEl"
        class="playlist-menu glass"
        :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
      >
        <template v-if="renaming">
          <input
            v-model="renameText"
            class="rename-input"
            type="text"
            autofocus
            @keyup.enter="confirmRename"
            @keyup.esc="renaming = false"
          />
          <div class="menu-row-pair">
            <button class="menu-item" @click="renaming = false"><AppIcon name="close" :size="14" /> 取消</button>
            <button class="menu-item accent" @click="confirmRename"><AppIcon name="check" :size="14" /> 确定</button>
          </div>
        </template>
        <template v-else-if="confirmingDelete">
          <div class="confirm-hint">删除歌单「{{ pl?.name }}」？歌曲不受影响。</div>
          <div class="menu-row-pair">
            <button class="menu-item" @click="confirmingDelete = false"><AppIcon name="close" :size="14" /> 取消</button>
            <button class="menu-item danger" @click="confirmDelete"><AppIcon name="trash" :size="14" /> 删除</button>
          </div>
        </template>
        <template v-else>
          <button class="menu-item" @click="play"><AppIcon name="play" :size="14" /> 播放</button>
          <button class="menu-item" @click="openRename"><AppIcon name="lyrics" :size="14" /> 重命名</button>
          <button class="menu-item" @click="editCover"><AppIcon name="image" :size="14" /> 设置封面</button>
          <div class="menu-sep" />
          <button class="menu-item danger" @click="confirmingDelete = true">
            <AppIcon name="trash" :size="14" /> 删除歌单
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-layer {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.playlist-menu {
  position: fixed;
  min-width: 150px;
  padding: 6px;
  border-radius: 10px;
  z-index: 100;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 7px;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out);
}

.menu-item:hover {
  background: var(--bg-hover);
}

.menu-item.accent {
  color: var(--accent);
}

.menu-item.danger {
  color: var(--danger);
}

.menu-item.danger:hover {
  background: var(--danger-soft);
}

.menu-sep {
  height: 1px;
  margin: 5px 8px;
  background: var(--border-subtle);
}

.rename-input {
  width: 100%;
  height: 34px;
  margin-bottom: 6px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-hover);
  color: var(--text-primary);
  outline: none;
  font-size: 13px;
}

.rename-input:focus {
  border-color: var(--accent);
}

.menu-row-pair {
  display: flex;
  gap: 6px;
}

.menu-row-pair .menu-item {
  flex: 1;
  justify-content: center;
}

.confirm-hint {
  padding: 4px 6px 10px;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
}

.menu-enter-active,
.menu-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-4px);
}
</style>
