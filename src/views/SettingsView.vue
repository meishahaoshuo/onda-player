<script setup lang="ts">
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import type { ThemeMode } from '@/types'
import AppIcon from '@/components/AppIcon.vue'

const library = useLibraryStore()
const settings = useSettingsStore()

const emit = defineEmits<{ addFolder: [] }>()

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: 'monitor' | 'moon' | 'sun' }[] = [
  { mode: 'system', label: '跟随系统', icon: 'monitor' },
  { mode: 'dark', label: '深色', icon: 'moon' },
  { mode: 'light', label: '浅色', icon: 'sun' },
]

const permLabel = { granted: '已授权', prompt: '待确认权限', denied: '无法访问' }
</script>

<template>
  <div class="settings-view">
    <!-- 主题 -->
    <section class="setting-card">
      <h2 class="section-title">外观</h2>
      <div class="theme-row">
        <button
          v-for="opt in THEME_OPTIONS"
          :key="opt.mode"
          class="theme-option"
          :class="{ active: settings.themeMode === opt.mode }"
          @click="settings.setThemeMode(opt.mode)"
        >
          <AppIcon :name="opt.icon" :size="18" />
          <span>{{ opt.label }}</span>
        </button>
      </div>
    </section>

    <!-- 音乐文件夹 -->
    <section class="setting-card">
      <div class="section-head">
        <h2 class="section-title">音乐文件夹</h2>
        <div class="section-actions">
          <button class="mini-btn" @click="emit('addFolder')"><AppIcon name="plus" :size="14" /> 添加</button>
          <button
            class="mini-btn"
            :disabled="library.scanning || library.roots.length === 0"
            @click="library.rescan()"
          >
            <AppIcon name="scan" :size="14" /> 重新扫描
          </button>
        </div>
      </div>
      <div v-if="library.scanning" class="scan-status">
        正在扫描：{{ library.scanProgress.scanned + library.scanProgress.skipped }} /
        {{ library.scanProgress.total }}
        <button class="mini-btn" @click="library.cancelScan()">取消</button>
      </div>
      <div v-if="library.roots.length === 0" class="hint">还没有添加音乐文件夹</div>
      <div v-else class="root-list">
        <div v-for="r in library.roots" :key="r.id" class="root-row">
          <AppIcon name="folder" :size="18" class="root-icon" />
          <span class="root-name">{{ r.name }}</span>
          <span class="root-sub">
            {{ library.songs.filter((s) => s.rootId === r.id).length }} 首 · {{ permLabel[r.permission] }}
          </span>
          <button v-if="r.permission !== 'granted'" class="mini-btn" @click="library.restorePermission(r.id)">
            恢复权限
          </button>
          <button class="mini-btn danger" @click="library.removeFolderById(r.id)">移除</button>
        </div>
      </div>
    </section>

    <!-- 关于 -->
    <section class="setting-card">
      <h2 class="section-title">关于</h2>
      <ul class="about-list">
        <li>网页版本地音乐播放器 · 所有数据仅保存在本机浏览器中，零网络请求</li>
        <li>支持格式：MP3 / FLAC / OGG / OPUS / WAV / M4A（APE 等浏览器不支持的格式会被跳过）</li>
        <li>需要 Chrome / Edge 浏览器；刷新或重开后需点击一次「恢复权限」重新授权文件夹</li>
        <li>歌词：读取与音频同目录的同名 .lrc 文件，支持双语逐行显示</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.settings-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}

.setting-card {
  padding: 18px 20px;
  border-radius: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
}

.section-head .section-title {
  margin-bottom: 0;
}

.section-actions {
  display: flex;
  gap: 8px;
}

/* 主题选择 */
.theme-row {
  display: flex;
  gap: 10px;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  transition: all 0.15s;
}

.theme-option:hover {
  background: var(--bg-hover);
}

.theme-option.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-active);
}

/* 文件夹 */
.mini-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.mini-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.mini-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.mini-btn.danger:hover {
  color: #e05555;
  border-color: rgba(224, 85, 85, 0.4);
}

.scan-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.root-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.root-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg-hover);
}

.root-icon {
  color: var(--text-secondary);
}

.root-name {
  font-size: 13px;
}

.root-sub {
  flex: 1;
  font-size: 12px;
  color: var(--text-secondary);
}

/* 关于 */
.hint {
  font-size: 13px;
  color: var(--text-tertiary);
}

.about-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.about-list li {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  padding-left: 14px;
  position: relative;
}

.about-list li::before {
  content: '·';
  position: absolute;
  left: 0;
  color: var(--text-tertiary);
}
</style>
