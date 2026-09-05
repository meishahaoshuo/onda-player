<script setup lang="ts">
import { computed } from 'vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import type { SongRecord } from '@/types'

/** 文件夹页：按根目录浏览歌曲 + 管理入口 */
const library = useLibraryStore()
const player = usePlayerStore()

const emit = defineEmits<{ addFolder: [] }>()

const selectedRootId = defineModel<string | null>('selectedRoot')

const rootSongs = computed(() =>
  selectedRootId.value ? library.sortedSongs.filter((s) => s.rootId === selectedRootId.value) : [],
)

function onPlay(song: SongRecord) {
  void player.playSong(song, rootSongs.value)
}
</script>

<template>
  <div class="folders-view">
    <div class="toolbar">
      <button class="primary-btn" @click="emit('addFolder')">
        <AppIcon name="plus" :size="16" /> 添加文件夹
      </button>
      <button class="ghost-btn" :disabled="library.scanning || library.roots.length === 0" @click="library.rescan()">
        <AppIcon name="scan" :size="16" /> 重新扫描
      </button>
    </div>

    <div v-if="library.roots.length === 0" class="empty-hint">还没有添加音乐文件夹</div>

    <template v-else>
      <div class="root-list">
        <button
          v-for="r in library.roots"
          :key="r.id"
          class="root-row"
          :class="{ active: selectedRootId === r.id }"
          @click="selectedRootId = selectedRootId === r.id ? null : r.id"
        >
          <AppIcon name="folder" :size="20" class="root-icon" />
          <div class="root-meta">
            <div class="root-name">{{ r.name }}</div>
            <div class="root-sub">
              {{ library.songs.filter((s) => s.rootId === r.id).length }} 首 ·
              {{ { granted: '已授权', prompt: '待确认权限', denied: '无法访问' }[r.permission] }}
            </div>
          </div>
          <span v-if="r.permission !== 'granted'" class="root-action" @click.stop="library.restorePermission(r.id)">
            恢复权限
          </span>
          <span class="root-action danger" @click.stop="library.removeFolderById(r.id)">移除</span>
        </button>
      </div>

      <SongList
        v-if="selectedRootId && rootSongs.length > 0"
        :songs="rootSongs"
        :current-path="player.currentPath"
        :persist-key="`list:folder:${selectedRootId}`"
        @play="onPlay"
        class="list"
      />
    </template>
  </div>
</template>

<style scoped>
.folders-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar {
  display: flex;
  gap: 10px;
}

.primary-btn,
.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  transition: opacity 0.15s, background 0.15s;
}

.primary-btn {
  background: var(--accent);
  color: var(--accent-text);
}

.primary-btn:hover {
  opacity: 0.9;
}

.ghost-btn {
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.ghost-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.root-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.root-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
}

.root-row:hover {
  background: var(--bg-hover);
}

.root-row.active {
  border-color: var(--accent);
}

.root-icon {
  color: var(--text-secondary);
}

.root-meta {
  flex: 1;
  min-width: 0;
}

.root-name {
  font-size: 14px;
}

.root-sub {
  font-size: 12px;
  color: var(--text-secondary);
}

.root-action {
  font-size: 12px;
  color: var(--accent);
  padding: 4px 10px;
  border-radius: 6px;
}

.root-action:hover {
  background: var(--bg-hover);
}

.root-action.danger:hover {
  color: var(--danger);
}

.list {
  flex: 1;
  min-height: 0;
}

.empty-hint {
  color: var(--text-tertiary);
  padding: 40px 0;
  text-align: center;
}
</style>
