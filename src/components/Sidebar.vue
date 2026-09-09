<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch, ref, computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import { usePlaylistStore } from '@/stores/playlist'
import { useLibraryStore } from '@/stores/library'
import { usePlaylistMenu } from '@/composables/usePlaylistMenu'
import { useDragReorder } from '@/composables/useDragReorder'
import type { ViewId } from '@/types'
import AppIcon from './AppIcon.vue'
import CoverImage from './CoverImage.vue'
import PlaylistContextMenu from './PlaylistContextMenu.vue'
import type { IconName } from './icons'

const ui = useUiStore()
const settings = useSettingsStore()
const playlistStore = usePlaylistStore()
const library = useLibraryStore()
const { open: openPlaylistMenu } = usePlaylistMenu()

/** 导航定义：id 与 ui.navOrder 对应（仅主导航项参与拖拽排序，歌单板块固定在分隔线下） */
const NAV_DEFS: Record<string, { view: ViewId; label: string; icon: IconName }> = {
  songs: { view: 'songs', label: '歌曲', icon: 'music' },
  favorites: { view: 'favorites', label: '我喜欢的音乐', icon: 'heart' },
  recent: { view: 'recent', label: '最近在听', icon: 'clock' },
  charts: { view: 'charts', label: '排行榜', icon: 'chart' },
  albums: { view: 'albums', label: '专辑', icon: 'disc' },
  artists: { view: 'artists', label: '艺术家', icon: 'artist' },
  folders: { view: 'folders', label: '文件夹', icon: 'folder' },
  settings: { view: 'settings', label: '设置', icon: 'settings' },
}

const brandLogo = computed(() =>
  settings.resolvedTheme === 'dark' ? '/logo/onda-logo-main.svg' : '/logo/onda-logo-app.svg',
)

function openPlaylist(id: string) {
  ui.activeView = 'playlists'
  ui.detailKey = id
}

/* ---------- 拖拽排序：主导航组 / 歌单子项组各自内部排序 ---------- */
const navDrag = useDragReorder({ onReorder: (from, to) => ui.reorderNav(from, to) })
const plDrag = useDragReorder({ onReorder: (from, to) => playlistStore.reorder(from, to) })
onBeforeUnmount(() => {
  navDrag.dispose()
  plDrag.dispose()
})

/* ---------- 歌单项小封面：手动指定的封面优先，否则取歌单内第一首有封面的歌 ---------- */
const playlistCovers = computed(() => {
  const byPath = new Map(library.songs.map((s) => [s.path, s.coverId]))
  const map = new Map<string, string | null>()
  for (const p of playlistStore.playlists) {
    if (p.coverPath && byPath.has(p.coverPath)) {
      map.set(p.id, byPath.get(p.coverPath) ?? null)
      continue
    }
    const first = p.songPaths.map((x) => byPath.get(x) ?? null).find((c) => c !== null) ?? null
    map.set(p.id, first)
  }
  return map
})

/* ---------- 滑动指示胶囊：量测激活项位置，平滑滑动 ---------- */

const navEl = ref<HTMLElement | null>(null)
const itemEls = new Map<string, HTMLElement>()
const pill = ref({ top: 8, height: 40, opacity: 0 })
/** 大跨度跳转：弹簧过冲会冲出导航区，切回无过冲缓动 */
const pillFar = ref(false)

/** 超过该跨度（px）视为远跳 */
const PILL_FAR_PX = 100

function setEl(id: string) {
  return (el: unknown) => {
    if (el instanceof HTMLElement) itemEls.set(id, el)
    else itemEls.delete(id)
  }
}

function activeNavId(): string | null {
  if (ui.activeView === 'playlists') return ui.detailKey ?? 'playlists'
  return ui.activeView // 设置已并入主导航，pill 同样滑到设置项
}

async function updatePill() {
  await nextTick()
  const id = activeNavId()
  const el = id ? itemEls.get(id) : undefined
  if (el && navEl.value) {
    // offsetTop 相对最近的定位祖先（.nav）
    const top = el.offsetTop
    pillFar.value = Math.abs(top - pill.value.top) > PILL_FAR_PX
    pill.value = { top, height: el.offsetHeight, opacity: 1 }
  } else {
    pill.value = { ...pill.value, opacity: 0 }
  }
}

watch(
  [() => ui.activeView, () => ui.detailKey, () => playlistStore.playlists.length, () => ui.navOrder],
  updatePill,
  { immediate: true, flush: 'post' },
)

function navClick(view: ViewId) {
  if (navDrag.isClickSuppressed()) return
  ui.navigate(view)
}

function plClick(id: string) {
  if (plDrag.isClickSuppressed()) return
  openPlaylist(id)
}
</script>

<template>
  <aside class="sidebar">
    <PlaylistContextMenu />
    <div class="brand">
      <img :src="brandLogo" alt="Onda Player" class="brand-logo" :class="{ 'no-shadow': settings.resolvedTheme === 'dark' }" />
      <div class="brand-text">
        <span class="brand-name">Onda Player</span>
      </div>
    </div>

    <nav ref="navEl" class="nav">
      <!-- 滑动指示胶囊 -->
      <div
        class="nav-pill"
        :class="{ far: pillFar }"
        :style="{ top: `${pill.top}px`, height: `${pill.height}px`, opacity: pill.opacity }"
      />

      <div class="nav-group">
        <button
          v-for="(id, idx) in ui.navOrder"
          :key="id"
          :ref="setEl(id)"
          class="nav-item"
          :class="{ active: activeNavId() === id, dragging: navDrag.draggingIndex.value === idx }"
          @pointerdown="navDrag.onItemPointerdown(idx, $event)"
          @click="navClick(NAV_DEFS[id].view)"
        >
          <AppIcon :name="NAV_DEFS[id].icon" />
          <span>{{ NAV_DEFS[id].label }}</span>
        </button>
      </div>

      <div class="divider" />

      <!-- 歌单板块：固定在分隔线下方，仅子项可拖拽排序 -->
      <div :ref="setEl('playlists')" class="section-head">
        <button
          class="nav-item grow"
          :class="{ active: activeNavId() === 'playlists' }"
          @click="navClick('playlists')"
        >
          <AppIcon name="playlist" />
          <span>歌单</span>
        </button>
        <button class="nav-item add-playlist" title="新建歌单" @click="ui.requestPlaylistCreate()">
          <AppIcon name="playlistAdd" :size="16" />
        </button>
      </div>

      <!-- 歌单子项：长按拖拽排序、右键菜单 -->
      <div v-if="playlistStore.playlists.length > 0" class="pl-group">
        <button
          v-for="(p, i) in playlistStore.playlists"
          :key="p.id"
          :ref="setEl(p.id)"
          class="nav-item playlist-item"
          :class="{ active: ui.activeView === 'playlists' && ui.detailKey === p.id, dragging: plDrag.draggingIndex.value === i }"
          :title="p.name"
          @pointerdown="plDrag.onItemPointerdown(i, $event)"
          @click="plClick(p.id)"
          @contextmenu.prevent="openPlaylistMenu(p.id, $event)"
        >
          <CoverImage :cover-id="playlistCovers.get(p.id) ?? null" :size="36" class="playlist-cover" />
          <span class="playlist-name">{{ p.name }}</span>
        </button>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 232px;
  flex-shrink: 0;
  height: 100%;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-right: 1px solid var(--glass-border);
  padding: 16px 10px 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 4px 12px 18px;
  color: var(--text-primary);
}

.brand-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  box-shadow: var(--shadow-1);
  transition: transform var(--dur-med) var(--ease-spring);
}

.brand-logo.no-shadow {
  box-shadow: none;
}

.brand:hover .brand-logo {
  transform: scale(1.08) rotate(-3deg);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.brand-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.nav {
  position: relative; /* 滑动胶囊的定位基准 */
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
}

.nav-pill {
  position: absolute;
  left: 0;
  right: 0;
  border-radius: var(--radius-item);
  background: var(--bg-active);
  /* 近距离移动用弹簧过冲（手感活泼）；大跨度时过冲会冲出导航区边缘，切无过冲缓动 */
  transition: top var(--dur-med) var(--ease-spring), opacity var(--dur-med) var(--ease-out);
  pointer-events: none;
}

.nav-pill.far {
  transition: top var(--dur-med) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}

.nav-item {
  position: relative;
  /* button 不会像块级元素那样自动撑满父容器（width:auto 是收缩宽度），
     必须显式铺满，否则悬停底色/点击热区只有文字那一截 */
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--radius-item);
  color: var(--text-secondary);
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  text-align: left;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* 选中项的强调只保留滑动胶囊一层：悬停不再叠加灰底盖住胶囊 */
.nav-item.active:hover {
  background: transparent;
}

.nav-item:active {
  transform: scale(0.98);
}

.nav-item.active {
  color: var(--text-primary);
}

.nav-item.active svg {
  color: var(--accent);
}

/* 拖拽中的项：不加底色——避免与点击选中的胶囊背景（更长的那块）重叠突兀，
   反馈靠 composable 行内驱动的轻微缩放 + 抓取光标 */
.nav-item.dragging {
  cursor: grabbing;
}

.divider {
  height: 1px;
  margin: 8px 12px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

/* 歌单板块标题行：歌单项 + 右侧悬浮的新建按钮。
   注意不能加 position:relative —— 滑动胶囊依赖 nav-item 的 offsetTop 以 .nav 为基准 */
.section-head {
  display: flex;
  align-items: center;
}

.section-head .grow {
  flex: 1;
  min-width: 0;
}

.add-playlist {
  width: 28px;
  height: 28px;
  padding: 0;
  margin-right: 4px;
  justify-content: center;
  color: var(--text-tertiary);
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.section-head:hover .add-playlist,
.add-playlist:focus-visible {
  opacity: 1;
  transform: translateX(0);
}

.add-playlist:hover {
  color: var(--accent);
  background: var(--bg-hover);
}

.playlist-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 歌单子项：更大的封面与行高，和主导航项形成分组层次 */
.nav-item.playlist-item {
  height: 48px;
  gap: 10px;
}

.playlist-cover {
  border-radius: 8px;
  flex-shrink: 0;
}

/* 设置入口已并入 nav（分隔线上方），底部容器移除 */
</style>
