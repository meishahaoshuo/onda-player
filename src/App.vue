<script setup lang="ts">
import { computed } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import PlayerBar from '@/components/PlayerBar.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

const viewTitles = {
  songs: '歌曲',
  genres: '曲风',
  albums: '专辑',
  artists: '艺术家',
  folders: '文件夹',
  playlists: '歌单',
  settings: '设置',
} as const

const title = computed(() => viewTitles[ui.activeView])
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
          <p class="placeholder-hint">此区域将在后续阶段实现「{{ title }}」内容</p>
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

.placeholder-hint {
  color: var(--text-tertiary);
  padding: 48px 0;
  text-align: center;
}
</style>
