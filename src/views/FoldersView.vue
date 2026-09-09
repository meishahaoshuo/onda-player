<script setup lang="ts">
import { computed } from 'vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import type { SongRecord } from '@/types'

/** 文件夹页：左侧文件夹玻璃卡列表 + 右侧歌曲内容，双栏布局 */
const library = useLibraryStore()
const player = usePlayerStore()

const emit = defineEmits<{ addFolder: [] }>()

const selectedRootId = defineModel<string | null>('selectedRoot')

const permLabel = { granted: '已授权', prompt: '待确认权限', denied: '无法访问' } as const

const rootStats = computed(() =>
  library.roots.map((r) => ({
    ...r,
    count: library.songs.filter((s) => s.rootId === r.id).length,
  })),
)

const rootSongs = computed(() =>
  selectedRootId.value ? library.sortedSongs.filter((s) => s.rootId === selectedRootId.value) : [],
)

const selectedRootName = computed(
  () => library.roots.find((r) => r.id === selectedRootId.value)?.name ?? '',
)

/** 扫描进度百分比（用于进度条宽度） */
const scanPct = computed(() => {
  const p = library.scanProgress
  if (p.total === 0) return 0
  return Math.round(((p.scanned + p.skipped) / p.total) * 100)
})

function onPlay(song: SongRecord) {
  void player.playSong(song, rootSongs.value)
}

function selectRoot(id: string) {
  selectedRootId.value = selectedRootId.value === id ? null : id
}
</script>

<template>
  <div class="folders-view">
    <!-- 扫描进度：吸附在页顶 -->
    <div v-if="library.scanning" class="scan-bar">
      <AppIcon name="scan" :size="14" class="scan-spin" />
      <span class="scan-text">
        正在扫描 {{ library.scanProgress.scanned + library.scanProgress.skipped }} /
        {{ library.scanProgress.total }}
      </span>
      <div class="scan-track">
        <div class="scan-fill" :style="{ width: `${scanPct}%` }" />
      </div>
      <button class="scan-cancel" @click="library.cancelScan()">取消</button>
    </div>

    <div v-if="library.roots.length === 0" class="empty">
      <div class="empty-badge">
        <AppIcon name="folder" :size="32" />
      </div>
      <p class="empty-title">还没有添加音乐文件夹</p>
      <p class="empty-hint">授权一个文件夹，ONDA 会自动扫描其中的音乐建库</p>
      <button class="primary-btn" @click="emit('addFolder')">
        <AppIcon name="plus" :size="16" /> 添加文件夹
      </button>
    </div>

    <div v-else class="split">
      <!-- 左：文件夹玻璃卡列表 -->
      <aside class="side">
        <div class="side-head">
          <span class="side-title">文件夹</span>
          <span class="side-count">{{ library.roots.length }}</span>
        </div>
        <div class="root-list">
          <button
            v-for="r in rootStats"
            :key="r.id"
            class="root-card"
            :class="{ active: selectedRootId === r.id }"
            @click="selectRoot(r.id)"
          >
            <span class="root-icon"><AppIcon name="folder" :size="20" /></span>
            <span class="root-meta">
              <span class="root-name" :title="r.name">{{ r.name }}</span>
              <span class="root-sub">
                <i class="perm-dot" :class="r.permission" /> {{ r.count }} 首 ·
                {{ permLabel[r.permission] }}
              </span>
            </span>
            <span class="root-actions">
              <button
                v-if="r.permission !== 'granted'"
                class="root-act"
                title="恢复访问权限"
                @click.stop="library.restorePermission(r.id)"
              >
                <AppIcon name="check" :size="14" />
              </button>
              <button class="root-act danger" title="移除文件夹" @click.stop="library.removeFolderById(r.id)">
                <AppIcon name="close" :size="14" />
              </button>
            </span>
          </button>
        </div>
        <div class="side-toolbar">
          <button class="primary-btn" @click="emit('addFolder')">
            <AppIcon name="plus" :size="15" /> 添加
          </button>
          <button
            class="ghost-btn"
            :disabled="library.scanning"
            @click="library.rescan()"
          >
            <AppIcon name="scan" :size="15" /> 重新扫描
          </button>
        </div>
      </aside>

      <!-- 右：选中文件夹的歌曲（本列自身滚动，是 SongList 的 .scroll-host 宿主；
           左栏文件夹列表独立滚动，不受右列滚动影响） -->
      <div class="main scroll-host">
        <template v-if="selectedRootId">
          <div class="main-head">
            <h2 class="main-title">{{ selectedRootName }}</h2>
            <span class="main-sub">{{ rootSongs.length }} 首</span>
          </div>
          <SongList
            v-if="rootSongs.length > 0"
            :songs="rootSongs"
            :current-path="player.currentPath"
            :persist-key="`list:folder:${selectedRootId}`"
            @play="onPlay"
          />
          <div v-else class="list-empty">这个文件夹里没有可播放的音乐</div>
        </template>
        <div v-else class="list-empty guide">
          <AppIcon name="disc" :size="40" class="guide-icon" />
          选择左侧文件夹查看歌曲
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.folders-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

/* 扫描进度条 */
.scan-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: var(--radius-item);
  background: var(--bg-hover);
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.scan-spin {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.scan-text {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.scan-track {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--border-subtle);
  overflow: hidden;
}

.scan-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transition: width 240ms var(--ease-out);
}

.scan-cancel {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 3px 10px;
  border-radius: 6px;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.scan-cancel:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

/* 空态：全页引导 */
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

/* 图标底座：玻璃圆角方块，与左栏 root-card 的玻璃语言呼应 */
.empty-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  border-radius: 22px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
}

.empty-hint {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

/* 空态按钮保持内容宽度（flex:1 仅属于 .side-toolbar 布局，见下方作用域规则） */
.empty .primary-btn {
  flex: none;
}

/* 双栏 */
.split {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 18px;
}

/* 左：文件夹列表 */
.side {
  width: 268px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.side-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 4px 10px;
}

.side-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.side-count {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.root-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.root-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-item);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.root-card:hover {
  box-shadow: var(--shadow-1);
}

.root-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--accent) 14%, transparent), var(--shadow-1);
}

.root-icon {
  display: inline-flex;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.root-card.active .root-icon {
  color: var(--accent);
}

.root-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.root-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.root-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.perm-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.perm-dot.granted {
  background: #4caf7d;
}

.perm-dot.prompt {
  background: #e0a94c;
}

.perm-dot.denied {
  background: var(--danger);
}

/* 操作按钮：悬停卡片时浮现 */
.root-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transform: translateX(4px);
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.root-card:hover .root-actions,
.root-card:focus-within .root-actions {
  opacity: 1;
  transform: translateX(0);
}

.root-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.root-act:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.root-act.danger:hover {
  color: var(--danger);
}

.side-toolbar {
  display: flex;
  gap: 8px;
  padding-top: 12px;
}

.primary-btn,
.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  transition: opacity 0.15s, background 0.15s;
}

/* 仅左栏底部工具栏内两按钮均分宽度（flex:1 不能放进共享规则——
   纵向 flex 容器（空态）里会作用到主轴把按钮拉成通栏高竖条） */
.side-toolbar .primary-btn,
.side-toolbar .ghost-btn {
  flex: 1;
  justify-content: center;
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

/* 右：内容列（自身滚动宿主： SongList 的表头吸附与虚拟列表测量都挂在这里） */
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.main-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 10px;
}

.main-title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.main-sub {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.list-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.guide-icon {
  color: var(--text-tertiary);
  opacity: 0.6;
}
</style>
