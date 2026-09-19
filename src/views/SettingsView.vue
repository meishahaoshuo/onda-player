<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore, type LocateFabStyle } from '@/stores/settings'
import { useStatsStore } from '@/stores/stats'
import {
  HOTKEY_ACTIONS,
  HOTKEY_DEFAULTS,
  comboFromEvent,
  resetBinding,
  setBinding,
  useHotkeyBindings,
  type HotkeyAction,
} from '@/services/hotkeys'
import type { ThemeMode } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import { canInstall, isStandalone, promptInstall, installState } from '@/services/pwa'
import { isDesktop } from '@/services/fs'

/**
 * 设置页：左侧分类导航 + 右侧内容面板。
 * 分类：外观（主题与配色）/ 快捷键 / 音乐文件夹 / 数据 / 关于。
 */
const library = useLibraryStore()
const settings = useSettingsStore()
const stats = useStatsStore()
const hotkeyBindings = useHotkeyBindings()

const emit = defineEmits<{ addFolder: [] }>()

type SectionId = 'appearance' | 'hotkeys' | 'folders' | 'data' | 'about'

const SECTIONS: {
  id: SectionId
  label: string
  icon: 'sun' | 'keyboard' | 'folder' | 'info' | 'trash'
  desc: string
}[] = [
  { id: 'appearance', label: '外观', icon: 'sun', desc: '主题与配色' },
  { id: 'hotkeys', label: '快捷键', icon: 'keyboard', desc: '键盘控制播放' },
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

/** 主题色预设（首项"默认"在模板单独渲染） */
/* 一整套「同一深度」的颜色：亮度统一在 44~47%、饱和度 30~48%。
   不用彩虹式取点（高饱和七色各自为政会显得廉价），命名走传统颜料，
   也避免把竞品名（网易云红 / QQ音乐绿）写进自己的主题色。
   总数刻意压到 5，加上默认与自定义正好 7 键 = 一排不换行 */
const ACCENT_PRESETS: { c: string; name: string }[] = [
  { c: '#6B4E9E', name: '黛紫' },
  { c: '#B0413E', name: '绛红' },
  { c: '#B4762A', name: '琥珀' },
  { c: '#45A07C', name: '松绿' },
  { c: '#6B7078', name: '石墨' },
]

/** 当前选中的是「预设之外」的颜色 → 高亮「自定义」按键 */
const isCustomAccent = computed(() => {
  const c = settings.accentColor
  if (!c) return false
  return !ACCENT_PRESETS.some((p) => p.c.toLowerCase() === c.toLowerCase())
})

/* ---------- 数据：清空播放统计 ---------- */
const confirmClearStats = ref(false)

/* ---------- 桌面应用：运行形态与安装入口 ---------- */
/** 版本号：网页版取构建时注入的 package.json 版本；
    桌面端启动后再用 Tauri 的 getVersion() 覆盖为**实际安装的版本**（可能与仓库版本不同） */
const appVersion = ref(__APP_VERSION__)
onMounted(async () => {
  if (!isDesktop) return
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch {
    /* 取不到就沿用构建版本 */
  }
})

const installDesc = computed(() => {
  if (isDesktop) return '桌面版以独立系统窗口运行，音乐文件夹与数据都保存在本机'
  if (isStandalone.value) return '正在以独立窗口运行，可从桌面 / 开始菜单启动'
  if (canInstall.value) return '安装后从桌面 / 开始菜单启动，以独立窗口运行（无地址栏）'
  if (installState.value === 'done') return '已安装，重启浏览器或稍候即可以独立窗口运行'
  return '当前环境不支持安装：需要 Chrome / Edge，并通过 localhost 或 https 访问'
})

async function doInstall() {
  await promptInstall()
}

async function doClearStats() {
  confirmClearStats.value = false
  await stats.clear()
}

/* ---------- 快捷键录制 ---------- */
const recording = ref<HotkeyAction | null>(null)
const recordingConflict = ref('')

function startRecording(action: HotkeyAction) {
  recording.value = action
  recordingConflict.value = ''
  window.addEventListener('keydown', onRecordKeydown, { capture: true })
}

function stopRecording() {
  recording.value = null
  recordingConflict.value = ''
  window.removeEventListener('keydown', onRecordKeydown, { capture: true })
}

function onRecordKeydown(e: KeyboardEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    stopRecording()
    return
  }
  const combo = comboFromEvent(e)
  if (!combo) return // 仅按了修饰键，等待主键
  // 冲突检测：其它动作占用了同一组合则覆盖
  const conflicts = HOTKEY_ACTIONS.filter((a) => a.id !== recording.value && hotkeyBindings.value[a.id] === combo)
  recordingConflict.value =
    conflicts.length > 0 ? `已覆盖「${conflicts.map((c) => c.label).join('、')}」的原键位` : ''
  setBinding(recording.value!, combo)
  stopRecording()
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

          <!-- 主题色：按键式选择（每键 = 色点 + 名称），末尾保留「自定义」取色器。
               与「样式 / 材质」的分段选择同一形态；标题旁不再重复显示当前名称，
               因为按键本身已带名称、选中态也由按键表达。 -->
          <p class="panel-sub accent-heading">主题色</p>
          <div class="accent-keys">
            <button
              class="accent-key"
              :class="{ on: settings.accentColor === '' }"
              title="ONDA 蓝（默认）"
              @click="settings.setAccentColor('')"
            >
              <span class="accent-key-dot default" />
              ONDA 蓝
            </button>
            <button
              v-for="p in ACCENT_PRESETS"
              :key="p.c"
              class="accent-key"
              :class="{ on: settings.accentColor.toLowerCase() === p.c.toLowerCase() }"
              @click="settings.setAccentColor(p.c)"
            >
              <span class="accent-key-dot" :style="{ background: p.c }" />
              {{ p.name }}
            </button>
            <label
              class="accent-key accent-key-custom"
              :class="{ on: isCustomAccent }"
              title="自定义颜色"
            >
              <span class="accent-key-dot custom" />
              自定义
              <input
                type="color"
                :value="settings.accentColor || '#172554'"
                @input="settings.setAccentColor(($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>

          <!-- 播放条 -->
          <p class="panel-sub accent-heading">播放条</p>
          <div class="opt-row">
            <div class="opt-text">
              <span class="opt-name">样式</span>
              <span class="opt-desc">浮动胶囊以玻璃材质悬浮于内容上方</span>
            </div>
            <div class="seg-choice">
              <button
                class="seg-choice-btn"
                :class="{ on: settings.playerStyle === 'standard' }"
                @click="settings.setPlayerStyle('standard')"
              >
                标准
              </button>
              <button
                class="seg-choice-btn"
                :class="{ on: settings.playerStyle === 'capsule' }"
                @click="settings.setPlayerStyle('capsule')"
              >
                浮动胶囊
              </button>
            </div>
          </div>
          <div class="opt-row">
            <div class="opt-text">
              <span class="opt-name">材质</span>
              <span class="opt-desc">液态玻璃折射通透，普通磨砂沉稳平整</span>
            </div>
            <div class="seg-choice">
              <button
                class="seg-choice-btn"
                :class="{ on: settings.barMaterial === 'liquid' }"
                @click="settings.setBarMaterial('liquid')"
              >
                液态玻璃
              </button>
              <button
                class="seg-choice-btn"
                :class="{ on: settings.barMaterial === 'frosted' }"
                @click="settings.setBarMaterial('frosted')"
              >
                普通磨砂
              </button>
            </div>
          </div>
          <div class="opt-row">
            <div class="opt-text">
              <span class="opt-name">切换动效</span>
              <span class="opt-desc">标准与浮动胶囊两种形态之间的过渡方式</span>
            </div>
            <div class="seg-choice">
              <button
                class="seg-choice-btn"
                :class="{ on: settings.barMorph === 'gather' }"
                @click="settings.setBarMorph('gather')"
              >
                聚散
              </button>
              <button
                class="seg-choice-btn"
                :class="{ on: settings.barMorph === 'slide' }"
                @click="settings.setBarMorph('slide')"
              >
                交叉滑移
              </button>
            </div>
          </div>

          <!-- 定位悬浮球 -->
          <p class="panel-sub accent-heading">定位悬浮球</p>
          <div class="opt-row">
            <div class="opt-text">
              <span class="opt-name">外观</span>
              <span class="opt-desc">歌曲列表里「回到正在播放」的拟物悬浮球，滚出视野时浮现</span>
            </div>
            <div class="seg-choice">
              <button
                v-for="s in [
                  { id: 'compass', label: '罗盘' },
                  { id: 'knob', label: '旋钮' },
                  { id: 'tape', label: '卡带' },
                ]"
                :key="s.id"
                class="seg-choice-btn"
                :class="{ on: settings.locateFabStyle === s.id }"
                @click="settings.setLocateFabStyle(s.id as LocateFabStyle)"
              >
                {{ s.label }}
              </button>
            </div>
          </div>
        </section>

        <!-- 快捷键 -->
        <section v-else-if="active === 'hotkeys'" key="hotkeys" class="panel-section">
          <h2 class="panel-title">快捷键</h2>
          <p class="panel-sub">点击键位后按下新组合即可重新录制（Esc 取消）；输入框聚焦时快捷键自动失效</p>
          <div class="hotkey-list">
            <div v-for="a in HOTKEY_ACTIONS" :key="a.id" class="hotkey-row">
              <span class="hotkey-label">{{ a.label }}</span>
              <button
                class="hotkey-cap"
                :class="{ recording: recording === a.id }"
                @click="startRecording(a.id)"
              >
                <template v-if="recording === a.id">按下新组合…</template>
                <template v-else>{{ hotkeyBindings[a.id].split('+').join(' + ') }}</template>
              </button>
              <button
                v-if="hotkeyBindings[a.id] !== HOTKEY_DEFAULTS[a.id]"
                class="hotkey-reset"
                :title="`恢复默认 ${HOTKEY_DEFAULTS[a.id]}`"
                @click="resetBinding(a.id)"
              >
                <AppIcon name="close" :size="12" />
              </button>
            </div>
          </div>
          <p v-if="recordingConflict" class="hotkey-conflict">{{ recordingConflict }}</p>
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
          <p class="panel-sub">Onda Player — 本地音乐播放器</p>
          <div class="about-brand">
            <img
              :src="brandLogo"
              alt="Onda Player"
              class="about-brand-logo"
              :class="{ 'no-shadow': settings.resolvedTheme === 'dark' }"
            />
            <div class="about-brand-text">
              <span class="about-brand-name">Onda Player</span>
              <span class="about-brand-ver">v{{ appVersion }} · {{ isDesktop ? '桌面版' : '网页版' }}</span>
            </div>
          </div>
          <!-- 运行形态：桌面端只读；网页端可安装为独立窗口 -->
          <div class="opt-row install-row">
            <div class="opt-text">
              <span class="opt-name">{{ isDesktop ? '桌面应用' : '网页应用' }}</span>
              <span class="opt-desc">{{ installDesc }}</span>
            </div>
            <button
              v-if="!isDesktop && canInstall && !isStandalone"
              class="mini-btn install-btn"
              :disabled="installState === 'installing'"
              @click="doInstall"
            >
              <AppIcon name="download" :size="14" />
              {{ installState === 'installing' ? '安装中…' : '安装到桌面' }}
            </button>
          </div>
          <ul class="about-list">
            <li>所有数据（曲库索引、歌单、播放统计、设置）只保存在本机，全程零网络请求</li>
            <li>支持格式：MP3 / FLAC / OGG / OPUS / WAV / M4A；APE 等平台不支持的格式会自动跳过</li>
            <li v-if="isDesktop">桌面版以系统窗口运行，音乐文件夹授权一次后长期有效，无需重复授权</li>
            <li v-else>网页版需要 Chrome / Edge；刷新或重开后需点一次「恢复权限」重新授权音乐文件夹</li>
            <li>歌词：读取音频内嵌歌词与同目录同名 .lrc，支持双语逐行与逐字卡拉 OK</li>
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
  padding: 24px 26px;
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
  letter-spacing: 0.2px;
  margin-bottom: 2px;
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
  padding: 15px 2px;
}

/* 相邻选项行之间加发丝分隔线，形成可扫读的节奏 */
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

/* 分段选择（播放条样式等）：与全站胶囊语义一致 */
.seg-choice {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: var(--bg-hover);
  flex-shrink: 0;
}

.seg-choice-btn {
  padding: 5px 14px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.seg-choice-btn.on {
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-1);
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

/* 桌面应用安装入口 */
.install-row {
  margin: 6px 0 12px;
  padding: 12px 14px;
  border-radius: var(--radius-item);
  background: var(--bg-hover);
}

.install-btn {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.install-btn:hover {
  color: var(--accent-text);
  background: var(--accent);
}

.install-btn:disabled {
  opacity: 0.6;
  cursor: default;
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

/* 快捷键 */
.hotkey-list {
  display: flex;
  flex-direction: column;
  /* 与 .theme-row 用同一个「副标题 → 首个内容」的间距；
     原来为 0，长副标题会直接贴住第一行快捷键 */
  margin-top: 16px;
}

.hotkey-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.hotkey-row + .hotkey-row {
  border-top: 1px solid var(--border-subtle);
}

.hotkey-label {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
}

.hotkey-cap {
  min-width: 130px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-hover);
  color: var(--text-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.hotkey-cap:hover {
  border-color: var(--accent);
}

.hotkey-cap.recording {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.hotkey-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--text-tertiary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.hotkey-reset:hover {
  background: var(--bg-hover);
  color: var(--danger);
}

.hotkey-conflict {
  margin-top: 10px;
  font-size: 12px;
  color: var(--accent);
}

/* 主题色板与背景 */
.accent-heading {
  margin-top: 22px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

/* 当前预设名：标题旁的小字提示 */
/* 主题色按键组：形态与「样式 / 材质」的分段选择一致（按键，不是色圆点），
   每键 = 色点 + 名称，末尾是「自定义」取色器（label 包 input，整键可点） */
/* 一行放满：7 键（默认 + 5 预设 + 自定义）总宽必须塞进容器。
   实测原内边距下是 534px > 容器约 510px 会折行，故把间距与左右内边距各收紧一档，
   留出约 30px 余量（缩小的是留白不是字号，观感基本不变） */
.accent-keys {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 12px;
}

.accent-key {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px 5px 7px;
  border-radius: 9px;
  border: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.accent-key:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.accent-key.on {
  color: var(--text-primary);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.accent-key-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.accent-key-dot.default {
  background: linear-gradient(135deg, #172554, #5c7ce0);
}

/* 自定义：色轮小点作为标识（点击后由系统取色器决定具体颜色）。
   色相环取当前这套预设的颜色，跟着色板一起走 —— 别写死成已删除的旧色 */
.accent-key-dot.custom {
  background: conic-gradient(#b0413e, #b4762a, #45a07c, #6b4e9e, #6b7078, #b0413e);
}

.accent-key-custom {
  cursor: pointer;
}

.accent-key-custom input[type='color'] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

</style>
