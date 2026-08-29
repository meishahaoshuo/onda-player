<script setup lang="ts">
import { computed } from 'vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import type { SongRecord } from '@/types'

const library = useLibraryStore()
const player = usePlayerStore()

const emit = defineEmits<{ addFolder: [] }>()

function onPlay(song: SongRecord) {
  player.playSong(song, library.sortedSongs)
}

const needRestore = computed(() => library.roots.filter((r) => r.permission !== 'granted'))
const scanPct = computed(() =>
  library.scanProgress.total > 0
    ? Math.round(
        ((library.scanProgress.scanned + library.scanProgress.skipped) /
          library.scanProgress.total) *
          100,
      )
    : 0,
)
</script>

<template>
  <div class="songs-view">
    <!-- 空状态：还没有音乐文件夹 -->
    <div v-if="library.roots.length === 0" class="empty">
      <AppIcon name="folder" :size="48" class="empty-icon" />
      <p class="empty-title">添加你的音乐文件夹</p>
      <p class="empty-hint">支持 MP3 / FLAC / OGG / OPUS / WAV / M4A，文件保留在原处不会被复制</p>
      <button class="primary-btn" @click="emit('addFolder')">选择音乐文件夹</button>
    </div>

    <template v-else>
      <!-- 权限恢复提示（浏览器要求用户手势授权） -->
      <div v-if="needRestore.length > 0" class="restore-banner">
        <span>需要恢复文件夹访问权限：</span>
        <button
          v-for="r in needRestore"
          :key="r.id"
          class="restore-btn"
          @click="library.restorePermission(r.id)"
        >
          {{ r.name }}
        </button>
      </div>

      <!-- 扫描进度 -->
      <div v-if="library.scanning" class="scan-bar">
        <div class="scan-fill" :style="{ width: `${scanPct}%` }" />
        <span class="scan-text">
          {{ ({ idle: '', enumerating: '正在扫描', parsing: '正在读取标签', done: '扫描完成' })[library.scanProgress.phase] }}
          {{ library.scanProgress.scanned + library.scanProgress.skipped }} /
          {{ library.scanProgress.total }}
          <template v-if="library.scanProgress.failed > 0">（跳过 {{ library.scanProgress.failed }}）</template>
        </span>
        <button class="scan-cancel" @click="library.cancelScan()">取消</button>
      </div>

      <SongList
        v-if="library.sortedSongs.length > 0"
        :songs="library.sortedSongs"
        :current-path="player.currentPath"
        @play="onPlay"
        class="list"
      />
      <div v-else class="empty small">
        <p class="empty-hint">尚未扫描到音频文件</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.songs-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.empty.small {
  justify-content: flex-start;
  padding-top: 48px;
}

.empty-icon {
  color: var(--text-tertiary);
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
}

.empty-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.primary-btn {
  margin-top: 8px;
  padding: 10px 24px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 14px;
  font-weight: 500;
  transition: opacity 0.15s;
}

.primary-btn:hover {
  opacity: 0.9;
}

.restore-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  font-size: 13px;
  color: var(--text-secondary);
}

.restore-btn {
  padding: 4px 12px;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 12px;
}

.scan-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 28px;
  border-radius: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
  padding: 0 12px;
}

.scan-fill {
  position: absolute;
  inset: 0;
  background: var(--bg-active);
  transition: width 0.2s;
}

.scan-text {
  position: relative;
  font-size: 12px;
  color: var(--text-secondary);
}

.scan-cancel {
  position: relative;
  margin-left: auto;
  font-size: 12px;
  color: var(--accent);
}

.list {
  flex: 1;
  min-height: 0;
}
</style>
