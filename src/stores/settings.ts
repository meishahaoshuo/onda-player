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

/**
 * 主题设置：跟随系统 / 深色 / 浅色，切换即时生效并持久化。
 * 注：第 2 阶段 IndexedDB 就绪后仍保留 localStorage——主题需要在
 * DB 打开前生效以避免闪屏，故 localStorage 是其持久化位置。
 */
export const useSettingsStore = defineStore('settings', () => {
  const themeMode = ref<ThemeMode>(loadMode())
  const lyricFontSize = ref<LyricFontSize>(loadLyricFs())
  const lyricOffset = ref(loadLyricOffset())

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

  function cycleTheme() {
    themeMode.value =
      themeMode.value === 'dark'
        ? 'light'
        : themeMode.value === 'light'
          ? 'system'
          : 'dark'
  }

  return {
    themeMode,
    resolvedTheme,
    setThemeMode,
    cycleTheme,
    lyricFontSize,
    lyricFontPx,
    setLyricFontSize,
    cycleLyricFontSize,
    lyricOffset,
    setLyricOffset,
    nudgeLyricOffset,
  }
})
