<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useLibraryStore } from '@/stores/library'

const library = useLibraryStore()

const emit = defineEmits<{ addFolder: [] }>()

const songCountByRoot = computed(() => {
  const map = new Map<string, number>()
  for (const s of library.songs) {
    map.set(s.rootId, (map.get(s.rootId) ?? 0) + 1)
  }
  return map
})

const permLabel = { granted: '已授权', prompt: '待确认权限', denied: '无法访问' }
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

    <div v-else class="root-list">
      <div v-for="r in library.roots" :key="r.id" class="root-row">
        <AppIcon name="folder" :size="20" class="root-icon" />
        <div class="root-meta">
          <div class="root-name">{{ r.name }}</div>
          <div class="root-sub">
            {{ songCountByRoot.get(r.id) ?? 0 }} 首 · {{ permLabel[r.permission] }}
          </div>
        </div>
        <button
          v-if="r.permission !== 'granted'"
          class="ghost-btn"
          @click="library.restorePermission(r.id)"
        >
          恢复权限
        </button>
        <button class="ghost-btn danger" @click="library.removeFolderById(r.id)">移除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.folders-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.ghost-btn.danger:hover {
  color: #e05555;
  border-color: rgba(224, 85, 85, 0.4);
}

.empty-hint {
  color: var(--text-tertiary);
  padding: 40px 0;
  text-align: center;
}

.root-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.root-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
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
</style>
