<script setup lang="ts">
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
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <AppIcon name="music" :size="22" class="brand-icon" />
      <span>音乐播放器</span>
    </div>

    <nav class="nav">
      <button
        v-for="item in navItems"
        :key="item.id"
        class="nav-item"
        :class="{ active: ui.activeView === item.id }"
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
        class="nav-item"
        :class="{ active: ui.activeView === 'playlists' && !ui.detailKey }"
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
  width: 224px;
  flex-shrink: 0;
  height: 100%;
  background: var(--bg-sidebar);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border-right: 1px solid var(--border-subtle);
  padding: 12px 8px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  padding: 6px 12px 16px;
  color: var(--text-primary);
}

.brand-icon {
  color: var(--accent);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--text-secondary);
  position: relative;
  transition: background 0.15s, color 0.15s;
  text-align: left;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--bg-active);
  color: var(--text-primary);
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
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
</style>
