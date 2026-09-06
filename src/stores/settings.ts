import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'
import type { ThemeMode } from '@/types'

const STORAGE_KEY = 'settings.themeMode'
const LYRIC_FS_KEY = 'settings.lyricFontSize'
const LYRIC_OFFSET_KEY = 'settings.lyricOffset'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function loadMode(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'dark' || raw === 'light' ? raw : 'system'
}

/** 歌词字号档位：小 / 中 / 大 / 特大（主行 + 翻译行的成组字号） */
export type LyricFontSize = 'sm' | 'md' | 'lg' | 'xl'

export const LYRIC_FS_STEPS: { id: LyricFontSize; label: string; main: number; sub: number }[] = [
  { id: 'sm', label: '小', main: 18, sub: 13 },
  { id: 'md', label: '中', main: 22, sub: 15 },
  { id: 'lg', label: '大', main: 27, sub: 18 },
  { id: 'xl', label: '特大', main: 33, sub: 22 },
]

function loadLyricFs(): LyricFontSize {
  const raw = localStorage.getItem(LYRIC_FS_KEY)
  return LYRIC_FS_STEPS.some((s) => s.id === raw) ? (raw as LyricFontSize) : 'md'
}

/** 歌词偏移（秒，-3 ~ +3）：正数 = 歌词整体提前显示，负数 = 延后。
    不同来源的 LRC 时间轴与实际演唱普遍存在零点几秒的固定偏差，逐歌手动校准用。 */
function loadLyricOffset(): number {
  const raw = Number(localStorage.getItem(LYRIC_OFFSET_KEY))
  return Number.isFinite(raw) ? Math.min(3, Math.max(-3, raw)) : 0
}

/** 启动时恢复上次队列（关闭则每次冷启动为空队列） */
const AUTO_RESTORE_KEY = 'settings.autoRestoreQueue'
function loadAutoRestore(): boolean {
  return localStorage.getItem(AUTO_RESTORE_KEY) !== '0'
}

/** 恢复队列后尝试自动续播（受浏览器自动播放策略限制，可能需要一次交互） */
const AUTO_RESUME_KEY = 'settings.autoResume'
function loadAutoResume(): boolean {
  return localStorage.getItem(AUTO_RESUME_KEY) === '1'
}

/* ---------- 自定义主题色 ----------
   accentColor 为空字符串表示使用 CSS 默认（海军蓝）；非空则运行时写 override 变量。 */
const ACCENT_KEY = 'settings.accentColor'
function loadAccent(): string {
  const raw = localStorage.getItem(ACCENT_KEY) ?? ''
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : ''
}

/** 由十六进制色计算相对亮度（0 暗 ~ 1 亮），决定文字用黑还是白 */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** 主色压暗（strong 变体）：各通道 ×0.78 并钳制 */
function darken(hex: string, f = 0.78): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f))
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/* ---------- 封面氛围光开关 ---------- */
const AMBIENT_KEY = 'settings.ambientGlow'
function loadAmbient(): boolean {
  return localStorage.getItem(AMBIENT_KEY) !== '0'
}

/**
 * 主题设置：跟随系统 / 深色 / 浅色，切换即时生效并持久化。
 * 注：第 2 阶段 IndexedDB 就绪后仍保留 localStorage——主题需要在
 * DB 打开前生效以避免闪屏，故 localStorage 是其持久化位置。
 */
export const useSettingsStore = defineStore('settings', () => {
  const themeMode = ref<ThemeMode>(loadMode())
  const lyricFontSize = ref<LyricFontSize>(loadLyricFs())
  const lyricOffset = ref(loadLyricOffset())
  const autoRestoreQueue = ref(loadAutoRestore())
  const autoResume = ref(loadAutoResume())
  /** 自定义主题色：'' = 默认海军蓝 */
  const accentColor = ref(loadAccent())
  /** 封面氛围光：主内容区背景跟随当前播放封面取色发光 */
  const ambientGlow = ref(loadAmbient())

  // 实际生效的主题（system 模式下随系统实时变化）
  const resolvedTheme = ref<'dark' | 'light'>(media.matches ? 'dark' : 'light')

  /** 当前档位对应的主行 / 翻译行字号（px） */
  const lyricFontPx = ref(
    LYRIC_FS_STEPS.find((s) => s.id === lyricFontSize.value) ?? LYRIC_FS_STEPS[1],
  )

  watchEffect(() => {
    resolvedTheme.value =
      themeMode.value === 'system'
        ? media.matches
          ? 'dark'
          : 'light'
        : themeMode.value
    document.documentElement.dataset.theme = resolvedTheme.value
    // 同步浏览器地址栏/任务栏主题色：深色 #0A0A0A，浅色 ONDA 深蓝 #172554
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme.value === 'dark' ? '#0A0A0A' : '#172554')
    localStorage.setItem(STORAGE_KEY, themeMode.value)
  })

  media.addEventListener('change', (e) => {
    if (themeMode.value === 'system') {
      resolvedTheme.value = e.matches ? 'dark' : 'light'
    }
  })

  // 自定义主题色派生：写 inline override 压过 CSS 默认；空值时清除回退
  watchEffect(() => {
    const c = accentColor.value
    const root = document.documentElement
    if (!c) {
      for (const v of ['--accent', '--accent-strong', '--accent-text', '--accent-soft', '--bg-active', '--ambient-fallback'])
        root.style.removeProperty(v)
      return
    }
    root.style.setProperty('--accent', c)
    root.style.setProperty('--accent-strong', darken(c))
    root.style.setProperty('--accent-text', luminance(c) > 0.62 ? '#17203a' : '#ffffff')
    root.style.setProperty('--accent-soft', `color-mix(in srgb, ${c} 22%, transparent)`)
    root.style.setProperty('--bg-active', `color-mix(in srgb, ${c} 16%, transparent)`)
    root.style.setProperty('--ambient-fallback', `color-mix(in srgb, ${c} 18%, transparent)`)
  })

  function setThemeMode(mode: ThemeMode) {
    themeMode.value = mode
  }

  function setLyricFontSize(size: LyricFontSize) {
    lyricFontSize.value = size
    lyricFontPx.value = LYRIC_FS_STEPS.find((s) => s.id === size) ?? LYRIC_FS_STEPS[1]
    localStorage.setItem(LYRIC_FS_KEY, size)
  }

  function cycleLyricFontSize() {
    const idx = LYRIC_FS_STEPS.findIndex((s) => s.id === lyricFontSize.value)
    setLyricFontSize(LYRIC_FS_STEPS[(idx + 1) % LYRIC_FS_STEPS.length].id)
  }

  function setLyricOffset(v: number) {
    const clamped = Math.min(3, Math.max(-3, Math.round(v * 10) / 10))
    lyricOffset.value = clamped
    localStorage.setItem(LYRIC_OFFSET_KEY, String(clamped))
  }

  function nudgeLyricOffset(delta: number) {
    setLyricOffset(lyricOffset.value + delta)
  }

  function setAutoRestoreQueue(v: boolean) {
    autoRestoreQueue.value = v
    localStorage.setItem(AUTO_RESTORE_KEY, v ? '1' : '0')
  }

  function setAutoResume(v: boolean) {
    autoResume.value = v
    localStorage.setItem(AUTO_RESUME_KEY, v ? '1' : '0')
  }

  /** 设置自定义主题色：'' 恢复默认 */
  function setAccentColor(c: string) {
    accentColor.value = /^#[0-9a-fA-F]{6}$/.test(c) ? c : ''
    localStorage.setItem(ACCENT_KEY, accentColor.value)
  }

  function setAmbientGlow(v: boolean) {
    ambientGlow.value = v
    localStorage.setItem(AMBIENT_KEY, v ? '1' : '0')
  }

  return {
    themeMode,
    resolvedTheme,
    setThemeMode,
    lyricFontSize,
    lyricFontPx,
    setLyricFontSize,
    cycleLyricFontSize,
    lyricOffset,
    setLyricOffset,
    nudgeLyricOffset,
    autoRestoreQueue,
    setAutoRestoreQueue,
    autoResume,
    setAutoResume,
    accentColor,
    setAccentColor,
    ambientGlow,
    setAmbientGlow,
  }
})
