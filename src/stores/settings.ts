import { defineStore } from 'pinia'
import { computed, ref, watchEffect } from 'vue'
import type { ThemeMode } from '@/types'

const STORAGE_KEY = 'settings.themeMode'
const LYRIC_FS_KEY = 'settings.lyricFontSize'
const LYRIC_FW_KEY = 'settings.lyricFontWeight'
const LYRIC_ALIGN_KEY = 'settings.lyricAlign'
const LYRIC_BLUR_KEY = 'settings.lyricBlur'
const PLAYER_STYLE_KEY = 'settings.playerStyle'
const MORPH_KEY = 'settings.barMorph'
const BAR_MATERIAL_KEY = 'settings.barMaterial'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function loadMode(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'dark' || raw === 'light' ? raw : 'system'
}

/* ---------- 歌词页外观：字号/字重无级调节 + 对齐/景深模糊/控制样式 ---------- */

/** 歌词主行字号（px，无级），翻译行按比例派生 */
function loadLyricPx(): number {
  const raw = Number(localStorage.getItem(LYRIC_FS_KEY))
  return Number.isFinite(raw) && raw >= 14 && raw <= 44 ? raw : 22
}

/** 歌词字重（300-800，无级，50 步进） */
function loadLyricWeight(): number {
  const raw = Number(localStorage.getItem(LYRIC_FW_KEY))
  return Number.isFinite(raw) && raw >= 300 && raw <= 800 ? Math.round(raw / 50) * 50 : 500
}

export type LyricAlign = 'center' | 'left'

function loadLyricAlign(): LyricAlign {
  return localStorage.getItem(LYRIC_ALIGN_KEY) === 'left' ? 'left' : 'center'
}

/** 歌词景深模糊：非当前行按距离轻微模糊（Apple Music 式层次） */
function loadLyricBlur(): boolean {
  return localStorage.getItem(LYRIC_BLUR_KEY) !== '0'
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

// 遗留清理：导入动画样式选择器已下线（固定液态玻璃）；交错滚动/歌词页音频可视化已下线
localStorage.removeItem('settings.absorbStyle')
localStorage.removeItem('settings.lyricStagger')
localStorage.removeItem('settings.lyricViz')
localStorage.removeItem('settings.capsuleGlass')
localStorage.removeItem('settings.lyricViz')

/** 播放条样式：standard = 底部通栏；capsule = Liquid Glass 浮动胶囊（悬浮于内容上方） */
export type PlayerStyle = 'standard' | 'capsule'
function loadPlayerStyle(): PlayerStyle {
  return localStorage.getItem(PLAYER_STYLE_KEY) === 'capsule' ? 'capsule' : 'standard'
}

/** 标准⇄胶囊切换动效：gather = 聚散（中心收缩/绽放）；slide = 交叉滑移 */
export type BarMorph = 'gather' | 'slide'
function loadBarMorph(): BarMorph {
  return localStorage.getItem(MORPH_KEY) === 'slide' ? 'slide' : 'gather'
}

/** 播放条材质：liquid = 液态玻璃（高折射白纱 + 顶高光）；frosted = 普通磨砂（平整半透明 + 大模糊） */
export type BarMaterial = 'liquid' | 'frosted'
function loadBarMaterial(): BarMaterial {
  return localStorage.getItem(BAR_MATERIAL_KEY) === 'frosted' ? 'frosted' : 'liquid'
}

/**
 * 主题设置：跟随系统 / 深色 / 浅色，切换即时生效并持久化。
 * 注：第 2 阶段 IndexedDB 就绪后仍保留 localStorage——主题需要在
 * DB 打开前生效以避免闪屏，故 localStorage 是其持久化位置。
 */
export const useSettingsStore = defineStore('settings', () => {
  const themeMode = ref<ThemeMode>(loadMode())
  /** 歌词外观：字号/字重无级、对齐、景深模糊、控制组件风格 */
  const lyricFontPx = ref(loadLyricPx())
  const lyricFontWeight = ref(loadLyricWeight())
  const lyricAlign = ref<LyricAlign>(loadLyricAlign())
  const lyricBlur = ref(loadLyricBlur())
  const playerStyle = ref<PlayerStyle>(loadPlayerStyle())
  const barMorph = ref<BarMorph>(loadBarMorph())
  const barMaterial = ref<BarMaterial>(loadBarMaterial())
  const autoRestoreQueue = ref(loadAutoRestore())
  const autoResume = ref(loadAutoResume())
  /** 自定义主题色：'' = 默认海军蓝 */
  const accentColor = ref(loadAccent())
  /** 封面氛围光：主内容区背景跟随当前播放封面取色发光 */
  const ambientGlow = ref(loadAmbient())

  // 实际生效的主题（system 模式下随系统实时变化）
  const resolvedTheme = ref<'dark' | 'light'>(media.matches ? 'dark' : 'light')

  /** 当前字号对应的翻译行字号（px）：按主行 0.66 比例派生 */
  const lyricSubPx = computed(() => Math.round(lyricFontPx.value * 0.66))

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

  function setLyricFontSize(px: number) {
    const v = Math.min(44, Math.max(14, Math.round(px)))
    lyricFontPx.value = v
    localStorage.setItem(LYRIC_FS_KEY, String(v))
  }

  function setLyricFontWeight(w: number) {
    const v = Math.min(800, Math.max(300, Math.round(w / 50) * 50))
    lyricFontWeight.value = v
    localStorage.setItem(LYRIC_FW_KEY, String(v))
  }

  function setLyricAlign(a: LyricAlign) {
    lyricAlign.value = a
    localStorage.setItem(LYRIC_ALIGN_KEY, a)
  }

  function setLyricBlur(v: boolean) {
    lyricBlur.value = v
    localStorage.setItem(LYRIC_BLUR_KEY, v ? '1' : '0')
  }

  function setPlayerStyle(s: PlayerStyle) {
    playerStyle.value = s
    localStorage.setItem(PLAYER_STYLE_KEY, s)
  }

  function setBarMorph(m: BarMorph) {
    barMorph.value = m
    localStorage.setItem(MORPH_KEY, m)
  }

  function setBarMaterial(m: BarMaterial) {
    barMaterial.value = m
    localStorage.setItem(BAR_MATERIAL_KEY, m)
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
    lyricFontPx,
    lyricSubPx,
    lyricFontWeight,
    setLyricFontSize,
    setLyricFontWeight,
    lyricAlign,
    setLyricAlign,
    lyricBlur,
    setLyricBlur,
    playerStyle,
    setPlayerStyle,
    barMorph,
    setBarMorph,
    barMaterial,
    setBarMaterial,
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
