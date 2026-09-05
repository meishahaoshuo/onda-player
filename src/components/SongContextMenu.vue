<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useSongActions } from '@/composables/useSongActions'
import { usePlayerStore } from '@/stores/player'
import { useFavoritesStore } from '@/stores/favorites'
import { usePlaylistStore } from '@/stores/playlist'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'

/**
 * 全局歌曲右键菜单（teleport 到 body）：磨砂玻璃面板，项目按上下文显隐。
 * 「添加到歌单」点击展开二级面板（全部歌单 + 新建歌单并加入）。
 */
const sa = useSongActions()
const player = usePlayerStore()
const favorites = useFavoritesStore()
const playlistStore = usePlaylistStore()
const library = useLibraryStore()
const ui = useUiStore()

const menuEl = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })
const submenuOpen = ref(false)

const st = sa.menuState
const song = computed(() => st.value?.song ?? null)
const favorited = computed(() => (song.value ? favorites.has(song.value.path) : false))
const playlistId = computed(() => st.value?.opts.playlistId)
const queueIndex = computed(() => st.value?.opts.queueIndex)

watch(st, async (v) => {
  submenuOpen.value = false
  if (!v) return
  pos.value = { x: v.x, y: v.y }
  await nextTick()
  const el = menuEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  pos.value = {
    x: Math.max(8, Math.min(v.x, window.innerWidth - r.width - 8)),
    y: Math.max(8, Math.min(v.y, window.innerHeight - r.height - 40)),
  }
})

/** 执行并收起菜单 */
function act(fn: () => void) {
  sa.closeSongMenu()
  fn()
}

function play() {
  const s = song.value!
  const ctx = st.value?.opts.context
  act(() => void player.playSong(s, ctx && ctx.length > 0 ? ctx : undefined))
}

function playNext() {
  const s = song.value!
  act(() => {
    if (player.queue.length === 0) void player.playSong(s)
    else player.insertNext(s)
  })
}

function toggleFav() {
  const s = song.value!
  act(() => favorites.toggle(s.path))
}

function addToPlaylist(id: string) {
  const s = song.value!
  act(() => playlistStore.addSongs(id, [s.path]))
}

function createPlaylistWith() {
  const s = song.value!
  act(() => ui.requestPlaylistCreate([s.path]))
}

function viewAlbum() {
  const s = song.value!
  act(() => {
    ui.navigate('albums')
    ui.openDetail(library.albumKeyOf(s))
  })
}

function viewArtist() {
  const s = song.value!
  act(() => {
    ui.navigate('artists')
    ui.openDetail(library.artistNameOf(s))
  })
}

function removeFromPlaylist() {
  const id = playlistId.value!
  const s = song.value!
  act(() => playlistStore.removeSong(id, s.path))
}

function removeFromQueue() {
  const s = song.value!
  const i = queueIndex.value
  act(() => {
    if (i != null) player.removeAt(i)
    else {
      const idx = player.queue.findIndex((q) => q.path === s.path)
      if (idx >= 0) player.removeAt(idx)
    }
  })
}

function removeFromLibrary() {
  const s = song.value!
  act(() => {
    const qi = player.queue.findIndex((q) => q.path === s.path)
    if (qi >= 0) player.removeAt(qi)
    void library.removeSongs([s.path])
  })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="menu">
      <div v-if="song" class="menu-layer" @click.self="sa.closeSongMenu()" @contextmenu.prevent="sa.closeSongMenu()">
        <div ref="menuEl" class="song-menu glass" :style="{ left: `${pos.x}px`, top: `${pos.y}px` }">
          <button class="menu-item" @click="play"><AppIcon name="play" :size="15" /> 播放</button>
          <button class="menu-item" @click="playNext"><AppIcon name="next" :size="15" /> 下一首播放</button>
          <button class="menu-item" @click="toggleFav">
            <AppIcon name="heart" :size="15" :class="{ filled: favorited }" />
            {{ favorited ? '取消收藏' : '收藏' }}
          </button>
          <div class="menu-sep" />
          <div class="menu-sub-wrap">
            <button class="menu-item" :class="{ 'submenu-open': submenuOpen }" @click="submenuOpen = !submenuOpen">
              <AppIcon name="playlistAdd" :size="15" /> 添加到歌单
              <AppIcon name="next" :size="12" class="sub-arrow" />
            </button>
            <div v-if="submenuOpen" class="submenu">
              <button
                v-for="p in playlistStore.playlists"
                :key="p.id"
                class="menu-item sub-item"
                :title="p.name"
                @click="addToPlaylist(p.id)"
              >
                <AppIcon name="playlist" :size="14" /><span class="sub-label">{{ p.name }}</span>
              </button>
              <button class="menu-item sub-item accent" @click="createPlaylistWith">
                <AppIcon name="plus" :size="14" /> 新建歌单并加入
              </button>
              <div v-if="playlistStore.playlists.length === 0" class="submenu-empty">
                还没有歌单，试试「新建歌单并加入」
              </div>
            </div>
          </div>
          <div class="menu-sep" />
          <button class="menu-item" @click="viewAlbum"><AppIcon name="disc" :size="15" /> 查看专辑</button>
          <button class="menu-item" @click="viewArtist"><AppIcon name="artist" :size="15" /> 查看艺术家</button>
          <div class="menu-sep" />
          <button v-if="playlistId" class="menu-item" @click="removeFromPlaylist">
            <AppIcon name="close" :size="15" /> 从歌单移除
          </button>
          <button v-if="queueIndex != null" class="menu-item" @click="removeFromQueue">
            <AppIcon name="close" :size="15" /> 从队列移除
          </button>
          <button class="menu-item danger" @click="removeFromLibrary">
            <AppIcon name="trash" :size="15" /> 从资料库移除
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.menu-layer {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.song-menu {
  position: fixed;
  min-width: 180px;
  padding: 5px;
  border-radius: 12px;
  box-shadow: var(--shadow-2), var(--glass-highlight);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out);
}

.menu-item:hover {
  background: var(--bg-hover);
}

.menu-item.danger {
  color: var(--danger);
}

.menu-item.danger:hover {
  background: var(--danger-soft);
}

.menu-item svg {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.menu-item.danger svg {
  color: var(--danger);
}

.menu-item svg.filled {
  fill: currentColor;
  color: var(--accent);
}

.menu-sep {
  height: 1px;
  margin: 5px 8px;
  background: var(--border-subtle);
}

.menu-sub-wrap {
  position: relative;
}

.menu-item.submenu-open {
  background: var(--bg-hover);
}

.sub-arrow {
  margin-left: auto;
  transform: rotate(0deg);
}

.submenu {
  position: absolute;
  left: calc(100% - 4px);
  top: -5px;
  min-width: 170px;
  max-height: 260px;
  overflow-y: auto;
  padding: 5px;
  border-radius: 12px;
  background: var(--queue-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-2), var(--glass-highlight);
}

.sub-item .sub-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub-item.accent {
  color: var(--accent);
}

.submenu-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.menu-enter-active {
  transition: opacity 0.12s var(--ease-out), transform 0.12s var(--ease-out);
}

.menu-leave-active {
  transition: opacity 0.08s var(--ease-out);
}

.menu-enter-from {
  opacity: 0;
}

.menu-enter-from .song-menu {
  transform: scale(0.96) translateY(-2px);
}

.menu-leave-to {
  opacity: 0;
}
</style>
