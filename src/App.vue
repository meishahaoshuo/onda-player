<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import PlayerBar from '@/components/PlayerBar.vue'
import SongsView from '@/views/SongsView.vue'
import FoldersView from '@/views/FoldersView.vue'
import PlaceholderView from '@/views/PlaceholderView.vue'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import type { ViewId } from '@/types'

const ui = useUiStore()
const library = useLibraryStore()
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

function addFolder() {
  library.addFolder()
}

onMounted(() => {
  settings // 触发主题初始化
  library.init()
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
          <FoldersView v-if="ui.activeView === 'folders'" @add-folder="addFolder" />
          <PlaceholderView
            v-else-if="ui.activeView !== 'songs'"
            :key="ui.activeView"
            :title="title"
          />
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
