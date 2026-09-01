import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'
import type { ThemeMode } from '@/types'

const STORAGE_KEY = 'settings.themeMode'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function loadMode(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'dark' || raw === 'light' ? raw : 'system'
}

/**
 * 主题设置：跟随系统 / 深色 / 浅色，切换即时生效并持久化。
 * 注：第 2 阶段 IndexedDB 就绪后仍保留 localStorage——主题需要在
 * DB 打开前生效以避免闪屏，故 localStorage 是其持久化位置。
 */
export const useSettingsStore = defineStore('settings', () => {
  const themeMode = ref<ThemeMode>(loadMode())

  // 实际生效的主题（system 模式下随系统实时变化）
  const resolvedTheme = ref<'dark' | 'light'>(media.matches ? 'dark' : 'light')

  watchEffect(() => {
    resolvedTheme.value =
      themeMode.value === 'system'
        ? media.matches
          ? 'dark'
          : 'light'
        : themeMode.value
    document.documentElement.dataset.theme = resolvedTheme.value
    // 同步浏览器地址栏/任务栏主题色：深色 #0A0A0A，浅色品牌红 #FA233B
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme.value === 'dark' ? '#0A0A0A' : '#FA233B')
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

  function cycleTheme() {
    themeMode.value =
      themeMode.value === 'dark'
        ? 'light'
        : themeMode.value === 'light'
          ? 'system'
          : 'dark'
  }

  return { themeMode, resolvedTheme, setThemeMode, cycleTheme }
})
