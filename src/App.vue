<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import PlayerBar from '@/components/PlayerBar.vue'
import SongsView from '@/views/SongsView.vue'
import FoldersView from '@/views/FoldersView.vue'
import AlbumsView from '@/views/AlbumsView.vue'
import AlbumDetailView from '@/views/AlbumDetailView.vue'
import ArtistsView from '@/views/ArtistsView.vue'
import GenresView from '@/views/GenresView.vue'
import PlaylistsView from '@/views/PlaylistsView.vue'
import PlaceholderView from '@/views/PlaceholderView.vue'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { usePlaylistStore } from '@/stores/playlist'
import { useSettingsStore } from '@/stores/settings'
import type { ViewId } from '@/types'

const ui = useUiStore()
const library = useLibraryStore()
const player = usePlayerStore()
const playlistStore = usePlaylistStore()
const settings = useSettingsStore()

const viewTitles: Record<ViewId, string> = {
  songs: '歌曲',
  genres: '曲风',
  albums: '专辑',
  artists: '艺术家',
  folders: '文件夹',
  playlists: '歌单',
  settings: '设置',
}

const title = computed(() => viewTitles[ui.activeView])
const selectedRootId = ref<string | null>(null)

function addFolder() {
  library.addFolder()
}

onMounted(async () => {
  settings // 触发主题初始化
  playlistStore.load()
  await library.init()
  await player.restore()
})
</script>

<template>
  <div class="app-shell">
    <div class="body-row">
      <Sidebar />
      <main class="content">
        <header class="view-header">
          <h1>{{ title }}</h1>
        </header>
        <section class="view-body">
          <SongsView v-show="ui.activeView === 'songs'" @add-folder="addFolder" />

          <template v-if="ui.activeView === 'albums'">
            <AlbumDetailView v-if="ui.detailKey" :album-key="ui.detailKey" />
            <AlbumsView v-else />
          </template>

          <ArtistsView v-else-if="ui.activeView === 'artists'" />
          <GenresView v-else-if="ui.activeView === 'genres'" />

          <FoldersView v-else-if="ui.activeView === 'folders'" v-model:selected-root="selectedRootId" @add-folder="addFolder" />

          <PlaylistsView v-else-if="ui.activeView === 'playlists'" />

          <PlaceholderView v-else-if="ui.activeView !== 'songs'" :key="ui.activeView" :title="title" />
        </section>
      </main>
    </div>
    <PlayerBar />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.body-row {
  display: flex;
  flex: 1;
  min-height: 0;
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.view-header {
  padding: 20px 24px 12px;
}

.view-header h1 {
  font-size: 22px;
  font-weight: 600;
}

.view-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 24px 24px;
}
</style>
