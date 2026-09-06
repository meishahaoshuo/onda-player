<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useStatsStore } from '@/stores/stats'
import type { ThemeMode } from '@/types'
import AppIcon from '@/components/AppIcon.vue'

/**
 * 设置页：左侧分类导航 + 右侧内容面板。
 * 分类：外观（主题与配色）/ 快捷键 / 音乐文件夹 / 数据 / 关于。
 */
const library = useLibraryStore()
const settings = useSettingsStore()
const stats = useStatsStore()

const emit = defineEmits<{ addFolder: [] }>()

type SectionId = 'appearance' | 'folders' | 'data' | 'about'

const SECTIONS: { id: SectionId; label: string; icon: 'sun' | 'folder' | 'info' | 'trash'; desc: string }[] = [
  { id: 'appearance', label: '外观', icon: 'sun', desc: '主题与配色' },
  { id: 'folders', label: '音乐文件夹', icon: 'folder', desc: '曲库来源与扫描' },
  { id: 'data', label: '数据', icon: 'trash', desc: '播放统计管理' },
  { id: 'about', label: '关于', icon: 'info', desc: '版本与说明' },
]

const active = ref<SectionId>('appearance')

const THEME_OPTIONS: {
  mode: ThemeMode
  label: string
  desc: string
  icon: 'monitor' | 'moon' | 'sun'
}[] = [
  { mode: 'system', label: '跟随系统', desc: '与操作系统的深浅色保持一致', icon: 'monitor' },
  { mode: 'dark', label: '深色', desc: '深夜听歌的海军蓝', icon: 'moon' },
  { mode: 'light', label: '浅色', desc: '明亮环境下的清爽配色', icon: 'sun' },
]

const permLabel = { granted: '已授权', prompt: '待确认权限', denied: '无法访问' }
const brandLogo = computed(() =>
  settings.resolvedTheme === 'dark' ? '/logo/onda-logo-main.svg' : '/logo/onda-logo-app.svg',
)

const songCount = computed(() => library.songs.length)

/* ---------- 数据：清空播放统计 ---------- */
const confirmClearStats = ref(false)

async function doClearStats() {
  confirmClearStats.value = false
  await stats.clear()
}
</script>

<template>
  <div class="settings-view">
    <!-- 左：分类导航 -->
    <aside class="settings-nav">
      <button
        v-for="s in SECTIONS"
        :key="s.id"
        class="nav-card"
        :class="{ active: active === s.id }"
        @click="active = s.id"
      >
        <span class="nav-icon"><AppIcon :name="s.icon" :size="17" /></span>
        <span class="nav-text">
          <span class="nav-label">{{ s.label }}</span>
          <span class="nav-desc">{{ s.desc }}</span>
        </span>
      </button>
    </aside>

    <!-- 右：内容面板 -->
    <div class="settings-panel">
      <Transition name="panel" mode="out-in">
        <!-- 外观 -->
        <section v-if="active === 'appearance'" key="appearance" class="panel-section">
          <h2 class="panel-title">外观</h2>
          <p class="panel-sub">选择应用的主题配色，切换即时生效</p>
          <div class="theme-row">
            <button
              v-for="opt in THEME_OPTIONS"
              :key="opt.mode"
              class="theme-option"
              :class="{ active: settings.themeMode === opt.mode }"
              @click="settings.setThemeMode(opt.mode)"
            >
              <span class="theme-icon"><AppIcon :name="opt.icon" :size="20" /></span>
              <span class="theme-text">
                <span class="theme-label">{{ opt.label }}</span>
                <span class="theme-desc">{{ opt.desc }}</span>
              </span>
              <span class="theme-check"><AppIcon v-if="settings.themeMode === opt.mode" name="check" :size="15" /></span>
            </button>
          </div>
        </section>

        <!-- 音乐文件夹 -->
        <section v-else-if="active === 'folders'" key="folders" class="panel-section">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">音乐文件夹</h2>
              <p class="panel-sub">已接入 {{ library.roots.length }} 个文件夹 · 共 {{ songCount }} 首歌曲</p>
            </div>
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
            <AppIcon name="scan" :size="14" class="scan-spin" />
            正在扫描：{{ library.scanProgress.scanned + library.scanProgress.skipped }} /
            {{ library.scanProgress.total }}
            <button class="mini-btn" @click="library.cancelScan()">取消</button>
          </div>
          <div v-if="library.roots.length === 0" class="hint">
            还没有添加音乐文件夹，点击右上角「添加」授权一个文件夹开始建库
          </div>
          <div v-else class="root-list">
            <div v-for="r in library.roots" :key="r.id" class="root-row">
              <span class="root-icon"><AppIcon name="folder" :size="18" /></span>
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

        <!-- 数据 -->
        <section v-else-if="active === 'data'" key="data" class="panel-section">
          <h2 class="panel-title">数据</h2>
          <p class="panel-sub">播放统计与排行榜数据管理</p>
          <div class="opt-row">
            <div class="opt-text">
              <span class="opt-name">播放统计</span>
              <span class="opt-desc">全库累计播放 {{ stats.totalPlays }} 次 · 清空后排行榜归零，不可恢复</span>
            </div>
            <button
              class="mini-btn danger"
              :disabled="stats.totalPlays === 0"
              @click="confirmClearStats = true"
            >
              <AppIcon name="trash" :size="14" /> 清空统计
            </button>
          </div>
        </section>

        <!-- 关于 -->
        <section v-else key="about" class="panel-section">
          <h2 class="panel-title">关于</h2>
          <p class="panel-sub">ONDA · 澜 — 网页版本地音乐播放器</p>
          <div class="about-brand">
            <img
              :src="brandLogo"
              alt="ONDA · 澜"
              class="about-brand-logo"
              :class="{ 'no-shadow': settings.resolvedTheme === 'dark' }"
            />
            <div class="about-brand-text">
              <span class="about-brand-name">ONDA · 澜</span>
              <span class="about-brand-ver">v0.1.0 · 对标 Salt Player 的本地播放器</span>
            </div>
          </div>
          <ul class="about-list">
            <li>所有数据仅保存在本机浏览器中，零网络请求</li>
            <li>支持格式：MP3 / FLAC / OGG / OPUS / WAV / M4A（APE 等浏览器不支持的格式会被跳过）</li>
            <li>需要 Chrome / Edge 浏览器；刷新或重开后需点击一次「恢复权限」重新授权文件夹</li>
            <li>歌词：读取音频内嵌歌词与同目录同名 .lrc，支持双语逐行与逐字卡拉OK</li>
          </ul>
        </section>
      </Transition>
    </div>

    <!-- 清空统计确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="confirmClearStats" class="modal-mask" @click.self="confirmClearStats = false">
          <div class="confirm-panel">
            <h3 class="modal-title">清空播放统计</h3>
            <p class="confirm-desc">排行榜将归零（全库累计 {{ stats.totalPlays }} 次播放），此操作不可恢复。</p>
            <div class="modal-actions">
              <button class="mini-btn" @click="confirmClearStats = false">取消</button>
              <button class="danger-solid-btn" @click="doClearStats">清空统计</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.settings-view {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr);
  gap: 20px;
  max-width: 920px;
  align-items: start;
}

/* ---------- 左：分类导航 ---------- */

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: sticky;
  top: 0;
}

.nav-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-item);
  text-align: left;
  border: 1px solid transparent;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.nav-card:hover {
  background: var(--bg-hover);
}

.nav-card:active {
  transform: scale(0.98);
}

.nav-card.active {
  background: var(--bg-active);
  border-color: var(--border-subtle);
}

.nav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  flex-shrink: 0;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.nav-card.active .nav-icon {
  background: var(--accent);
  color: var(--accent-text);
}

.nav-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.nav-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.nav-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- 右：内容面板 ---------- */

.settings-panel {
  min-width: 0;
}

.panel-section {
  padding: 22px 24px;
  border-radius: var(--radius-panel);
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
}

/* 面板切换：淡入 + 轻位移 */
.panel-enter-active {
  transition: opacity var(--dur-med) var(--ease-out), transform var(--dur-med) var(--ease-out);
}

.panel-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.panel-enter-from {
  opacity: 0;
  transform: translateX(10px);
}

.panel-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.panel-title {
  font-size: 18px;
  font-weight: 600;
}

.panel-sub {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
}

.section-actions {
  display: flex;
  gap: 8px;
}

/* 主题选择：大卡片 + 选中角标 */
.theme-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-item);
  border: 1px solid var(--border-subtle);
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.theme-option:hover {
  background: var(--bg-hover);
  transform: translateY(-1px);
}

.theme-option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.theme-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.theme-option.active .theme-icon {
  color: var(--accent);
}

.theme-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.theme-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.theme-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}

.theme-check {
  margin-left: auto;
  color: var(--accent);
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

.mini-btn.danger {
  color: var(--danger);
  border-color: var(--danger-border);
}

.mini-btn.danger:hover {
  background: var(--danger-soft);
}

/* 选项行与确认弹窗 */
.opt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
}

.opt-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.opt-name {
  font-size: 13px;
  color: var(--text-primary);
}

.opt-desc {
  font-size: 12px;
  color: var(--text-tertiary);
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.confirm-panel {
  width: 380px;
  max-width: 90vw;
  padding: 20px;
  border-radius: 12px;
  background: var(--queue-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-2), var(--glass-highlight);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
}

.confirm-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.danger-solid-btn {
  padding: 5px 14px;
  border-radius: 6px;
  background: var(--danger);
  color: #fff;
  font-size: 12px;
  transition: opacity 0.15s;
}

.danger-solid-btn:hover {
  opacity: 0.9;
}

.modal-enter-active {
  transition: opacity var(--dur-med) var(--ease-out);
}

.modal-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}

.modal-enter-active .confirm-panel {
  transition: transform var(--dur-med) var(--ease-spring), opacity var(--dur-med) var(--ease-out);
}

.modal-leave-active .confirm-panel {
  transition: transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .confirm-panel {
  transform: translateY(14px) scale(0.96);
  opacity: 0;
}

.modal-leave-to .confirm-panel {
  transform: translateY(6px) scale(0.98);
  opacity: 0;
}

.scan-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 14px;
}

.scan-spin {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.root-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 16px;
}

.root-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-item);
  background: var(--bg-hover);
}

.root-icon {
  display: inline-flex;
  color: var(--text-secondary);
}

.root-name {
  font-size: 13px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.root-sub {
  flex: 1;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
  white-space: nowrap;
}

.hint {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-top: 16px;
  line-height: 1.6;
}

/* 关于 */
.about-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0 14px;
}

.about-brand-logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  box-shadow: var(--shadow-1);
}

.about-brand-logo.no-shadow {
  box-shadow: none;
}

.about-brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.about-brand-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.about-brand-ver {
  font-size: 12px;
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

/* 窄屏：导航收成横向一行 */
@media (max-width: 720px) {
  .settings-view {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    position: static;
    flex-direction: row;
  }

  .nav-card {
    flex: 1;
    padding: 10px 12px;
  }

  .nav-desc {
    display: none;
  }
}
</style>
