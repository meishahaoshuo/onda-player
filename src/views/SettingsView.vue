<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore, LYRIC_FS_STEPS, type ChartsLimit } from '@/stores/settings'
import { useStatsStore } from '@/stores/stats'
import { useFavoritesStore } from '@/stores/favorites'
import { usePlayerStore } from '@/stores/player'
import { usePlaylistStore } from '@/stores/playlist'
import * as db from '@/services/db'
import type { ThemeMode } from '@/types'
import AppIcon from '@/components/AppIcon.vue'

/**
 * 设置页：宽屏双列卡片网格。外观 / 播放行为 / 歌词 / 排行榜 / 音乐文件夹 / 数据管理 / 关于
 */
const library = useLibraryStore()
const settings = useSettingsStore()
const stats = useStatsStore()
const favorites = useFavoritesStore()
const player = usePlayerStore()
const playlistStore = usePlaylistStore()

const emit = defineEmits<{ addFolder: [] }>()

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: 'monitor' | 'moon' | 'sun' }[] = [
  { mode: 'system', label: '跟随系统', icon: 'monitor' },
  { mode: 'dark', label: '深色', icon: 'moon' },
  { mode: 'light', label: '浅色', icon: 'sun' },
]

const CHARTS_OPTIONS: { id: ChartsLimit; label: string }[] = [
  { id: 'top50', label: 'Top 50' },
  { id: 'top100', label: 'Top 100' },
  { id: 'all', label: '全部' },
]

const permLabel = { granted: '已授权', prompt: '待确认权限', denied: '无法访问' }
const brandLogo = computed(() =>
  settings.resolvedTheme === 'dark' ? '/logo/onda-logo-main.svg' : '/logo/onda-logo-app.svg',
)

/* ---------- 数据管理 ---------- */

type ConfirmKind = 'stats' | 'favorites' | 'all' | null
const confirmKind = ref<ConfirmKind>(null)

const CONFIRM_META = {
  stats: { title: '清空播放统计', desc: '排行榜将归零，此操作不可恢复。', btn: '清空统计' },
  favorites: { title: '清空收藏', desc: '「我喜欢的音乐」将被清空，此操作不可恢复。', btn: '清空收藏' },
  all: { title: '清空全部资料', desc: '歌曲、歌单、收藏、统计、文件夹记录与播放状态都将删除（磁盘文件不受影响），此操作不可恢复。', btn: '全部清空' },
} as const

const confirmMeta = computed(() => (confirmKind.value ? CONFIRM_META[confirmKind.value] : null))

function confirmYes() {
  const kind = confirmKind.value
  confirmKind.value = null
  if (kind === 'stats') void stats.clear()
  else if (kind === 'favorites') void favorites.clear()
  else if (kind === 'all') {
    void db.clearAllData().then(() => window.location.reload())
  }
}
</script>

<template>
  <div class="settings-view">
    <!-- 外观 -->
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

    <!-- 播放行为 -->
    <section class="setting-card">
      <h2 class="section-title">播放行为</h2>
      <div class="opt-row">
        <div class="opt-text">
          <span class="opt-name">启动时恢复上次队列</span>
          <span class="opt-desc">关闭后每次打开应用都是空队列</span>
        </div>
        <button
          class="toggle"
          :class="{ on: settings.autoRestoreQueue }"
          :aria-pressed="settings.autoRestoreQueue"
          @click="settings.setAutoRestoreQueue(!settings.autoRestoreQueue)"
        />
      </div>
      <div class="opt-row">
        <div class="opt-text">
          <span class="opt-name">尝试自动续播</span>
          <span class="opt-desc">恢复队列后自动从上次进度播放（可能被浏览器拦截，需点一次播放）</span>
        </div>
        <button
          class="toggle"
          :class="{ on: settings.autoResume }"
          :aria-pressed="settings.autoResume"
          @click="settings.setAutoResume(!settings.autoResume)"
        />
      </div>
    </section>

    <!-- 歌词 -->
    <section class="setting-card">
      <h2 class="section-title">歌词</h2>
      <div class="opt-row">
        <div class="opt-text">
          <span class="opt-name">字号</span>
          <span class="opt-desc">全屏歌词的主行 / 翻译行字号</span>
        </div>
        <div class="seg-row">
          <button
            v-for="step in LYRIC_FS_STEPS"
            :key="step.id"
            class="seg-option"
            :class="{ active: settings.lyricFontSize === step.id }"
            @click="settings.setLyricFontSize(step.id)"
          >
            {{ step.label }}
          </button>
        </div>
      </div>
      <div class="opt-row">
        <div class="opt-text">
          <span class="opt-name">歌词偏移</span>
          <span class="opt-desc">正数提前、负数延后，用于校准时间轴</span>
        </div>
        <div class="offset-row">
          <button class="mini-btn" @click="settings.nudgeLyricOffset(-0.1)">−</button>
          <span class="offset-val">{{ settings.lyricOffset.toFixed(1) }}s</span>
          <button class="mini-btn" @click="settings.nudgeLyricOffset(0.1)">＋</button>
          <button class="mini-btn" title="归零" @click="settings.setLyricOffset(0)">重置</button>
        </div>
      </div>
    </section>

    <!-- 排行榜 -->
    <section class="setting-card">
      <h2 class="section-title">排行榜</h2>
      <div class="opt-row">
        <div class="opt-text">
          <span class="opt-name">榜单容量</span>
          <span class="opt-desc">计数规则：听满 30 秒或一半进度计 1 次</span>
        </div>
        <div class="seg-row">
          <button
            v-for="opt in CHARTS_OPTIONS"
            :key="opt.id"
            class="seg-option"
            :class="{ active: settings.chartsLimit === opt.id }"
            @click="settings.setChartsLimit(opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
      <div class="opt-row">
        <div class="opt-text">
          <span class="opt-name">累计播放</span>
          <span class="opt-desc">全库共被播放 {{ stats.totalPlays }} 次</span>
        </div>
        <button class="mini-btn danger" @click="confirmKind = 'stats'">清空统计</button>
      </div>
    </section>

    <!-- 音乐文件夹 -->
    <section class="setting-card span-2">
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

    <!-- 数据管理 -->
    <section class="setting-card">
      <h2 class="section-title">数据管理</h2>
      <div class="opt-row">
        <div class="opt-text">
          <span class="opt-name">我喜欢的音乐</span>
          <span class="opt-desc">已收藏 {{ favorites.paths.length }} 首</span>
        </div>
        <button class="mini-btn danger" :disabled="favorites.paths.length === 0" @click="confirmKind = 'favorites'">
          清空收藏
        </button>
      </div>
      <div class="opt-row">
        <div class="opt-text">
          <span class="opt-name">清空全部资料</span>
          <span class="opt-desc">歌曲 / 歌单 / 收藏 / 统计 / 文件夹记录（不碰磁盘文件），清空后自动刷新</span>
        </div>
        <button class="mini-btn danger" @click="confirmKind = 'all'">清空</button>
      </div>
    </section>

    <!-- 关于 -->
    <section class="setting-card">
      <h2 class="section-title">关于</h2>
      <div class="about-brand">
        <img :src="brandLogo" alt="ONDA · 澜" class="about-brand-logo" :class="{ 'no-shadow': settings.resolvedTheme === 'dark' }" />
        <div class="about-brand-text">
          <span class="about-brand-name">ONDA · 澜</span>
          <span class="about-brand-ver">v0.1.0 · 网页版本地音乐播放器</span>
        </div>
      </div>
      <ul class="about-list">
        <li>所有数据仅保存在本机浏览器中，零网络请求</li>
        <li>支持格式：MP3 / FLAC / OGG / OPUS / WAV / M4A（APE 等浏览器不支持的格式会被跳过）</li>
        <li>需要 Chrome / Edge 浏览器；刷新或重开后需点击一次「恢复权限」重新授权文件夹</li>
        <li>歌词：读取音频内嵌歌词与同目录同名 .lrc，支持双语逐行与逐字卡拉OK</li>
      </ul>
    </section>

    <!-- 清空确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="confirmMeta" class="modal-mask" @click.self="confirmKind = null">
          <div class="confirm-panel">
            <h3 class="modal-title">{{ confirmMeta.title }}</h3>
            <p class="confirm-desc">{{ confirmMeta.desc }}</p>
            <div class="modal-actions">
              <button class="mini-btn" @click="confirmKind = null">取消</button>
              <button class="danger-solid-btn" @click="confirmYes">{{ confirmMeta.btn }}</button>
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
  grid-template-columns: 1fr;
  gap: 16px;
  max-width: 860px;
}

@media (min-width: 1000px) {
  .settings-view {
    grid-template-columns: 1fr 1fr;
    align-items: start;
  }

  .span-2 {
    grid-column: 1 / -1;
  }
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

/* 选项行（开关 / 分段 / 步进器共用） */
.opt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
}

.opt-row + .opt-row {
  border-top: 1px solid var(--border-subtle);
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

/* 开关 */
.toggle {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 11px;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  transition: background var(--dur-med) var(--ease-out), border-color var(--dur-med) var(--ease-out);
}

.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-secondary);
  transition: left var(--dur-med) var(--ease-spring), background var(--dur-med) var(--ease-out);
}

.toggle.on {
  background: var(--accent);
  border-color: transparent;
}

.toggle.on::after {
  left: 20px;
  background: var(--accent-text);
}

/* 分段选择 */
.seg-row {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--bg-hover);
  flex-shrink: 0;
}

.seg-option {
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.seg-option:hover {
  color: var(--text-primary);
}

.seg-option.active {
  background: var(--accent);
  color: var(--accent-text);
}

/* 偏移步进 */
.offset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.offset-val {
  min-width: 44px;
  text-align: center;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
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

/* 数据管理确认弹窗 */
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

/* 关于 */
.hint {
  font-size: 13px;
  color: var(--text-tertiary);
}

.about-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
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

/* 弹窗遮罩与过渡（与歌单弹窗一致） */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
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

.modal-title {
  font-size: 16px;
  font-weight: 600;
}
</style>
