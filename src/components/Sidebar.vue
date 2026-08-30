<script setup lang="ts">
import { nextTick, watch } from 'vue'
import { ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import { usePlaylistStore } from '@/stores/playlist'
import type { ViewId } from '@/types'
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

const ui = useUiStore()
const settings = useSettingsStore()
const playlistStore = usePlaylistStore()

const navItems: { id: ViewId; label: string; icon: IconName }[] = [
  { id: 'songs', label: '歌曲', icon: 'music' },
  { id: 'genres', label: '曲风', icon: 'genre' },
  { id: 'albums', label: '专辑', icon: 'disc' },
  { id: 'artists', label: '艺术家', icon: 'artist' },
  { id: 'folders', label: '文件夹', icon: 'folder' },
]

const themeIcon = { system: 'monitor', dark: 'moon', light: 'sun' } as const

function openPlaylist(id: string) {
  ui.activeView = 'playlists'
  ui.detailKey = id
}

/* ---------- 滑动指示胶囊：量测激活项位置，平滑滑动 ---------- */

const navEl = ref<HTMLElement | null>(null)
const itemEls = new Map<string, HTMLElement>()
const pill = ref({ top: 8, height: 40, opacity: 0 })

function setEl(id: string) {
  return (el: unknown) => {
    if (el instanceof HTMLElement) itemEls.set(id, el)
    else itemEls.delete(id)
  }
}

function activeNavId(): string | null {
  if (ui.activeView === 'playlists') return ui.detailKey ?? 'playlists'
  if (navItems.some((n) => n.id === ui.activeView)) return ui.activeView
  return null
}

async function updatePill() {
  await nextTick()
  const id = activeNavId()
  const el = id ? itemEls.get(id) : undefined
  if (el && navEl.value) {
    // offsetTop 相对最近的定位祖先（.nav）
    pill.value = { top: el.offsetTop, height: el.offsetHeight, opacity: 1 }
  } else {
    pill.value = { ...pill.value, opacity: 0 }
  }
}

watch([() => ui.activeView, () => ui.detailKey, () => playlistStore.playlists.length], updatePill, {
  immediate: true,
})
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <img src="/logo.svg" alt="Aria" class="brand-logo" />
      <div class="brand-text">
        <span class="brand-name">Aria</span>
        <span class="brand-sub">咏叹</span>
      </div>
    </div>

    <nav ref="navEl" class="nav">
      <!-- 滑动指示胶囊 -->
      <div
        class="nav-pill"
        :style="{ top: `${pill.top}px`, height: `${pill.height}px`, opacity: pill.opacity }"
      />

      <button
        v-for="item in navItems"
        :key="item.id"
        :ref="setEl(item.id)"
        class="nav-item"
        :class="{ active: activeNavId() === item.id }"
        @click="ui.navigate(item.id)"
      >
        <AppIcon :name="item.icon" />
        <span>{{ item.label }}</span>
      </button>

      <div class="divider" />

      <button class="nav-item" @click="ui.requestPlaylistCreate()">
        <AppIcon name="playlistAdd" />
        <span>新建歌单</span>
      </button>
      <button
        :ref="setEl('playlists')"
        class="nav-item"
        :class="{ active: activeNavId() === 'playlists' }"
        @click="ui.navigate('playlists')"
      >
        <AppIcon name="playlist" />
        <span>歌单</span>
      </button>

      <template v-if="playlistStore.playlists.length > 0">
        <div class="divider" />
        <button
          v-for="p in playlistStore.playlists"
          :key="p.id"
          :ref="setEl(p.id)"
          class="nav-item playlist-item"
          :class="{ active: ui.activeView === 'playlists' && ui.detailKey === p.id }"
          :title="p.name"
          @click="openPlaylist(p.id)"
        >
          <AppIcon name="heart" :size="16" />
          <span class="playlist-name">{{ p.name }}</span>
        </button>
      </template>
    </nav>

    <div class="bottom">
      <button
        class="nav-item"
        :class="{ active: ui.activeView === 'settings' }"
        @click="ui.navigate('settings')"
      >
        <AppIcon name="settings" />
        <span>设置</span>
      </button>
      <button
        class="nav-item"
        :title="`主题：${{ system: '跟随系统', dark: '深色', light: '浅色' }[settings.themeMode]}（点击切换）`"
        @click="settings.cycleTheme()"
      >
        <AppIcon :name="themeIcon[settings.themeMode]" />
        <span>{{ { system: '跟随系统', dark: '深色', light: '浅色' }[settings.themeMode] }}</span>
      </button>
    </div>
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

.brand-sub {
  font-size: 11px;
  color: var(--text-secondary);
  letter-spacing: 4px;
}

.nav {
  position: relative; /* 滑动胶囊的定位基准 */
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.nav-pill {
  position: absolute;
  left: 0;
  right: 0;
  border-radius: var(--radius-item);
  background: var(--bg-active);
  transition: top var(--dur-med) var(--ease-spring), opacity var(--dur-med) var(--ease-out);
  pointer-events: none;
}

.nav-pill::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--radius-item);
  color: var(--text-secondary);
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
  text-align: left;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
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

.divider {
  height: 1px;
  margin: 8px 12px;
  background: var(--border-subtle);
}

.playlist-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bottom {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.bottom .nav-item.active {
  background: var(--bg-active);
}
</style>
