<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import CoverImage from '@/components/CoverImage.vue'
import { readLrcFile } from '@/services/fs'
import { parseLrc, type LyricGroup } from '@/services/lyrics'
import { extractBrightColors, renderAmbientUrl } from '@/services/palette'
import { getAudio } from '@/services/player'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { LYRIC_FS_STEPS, useSettingsStore, type LyricFontSize } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { formatDuration } from '@/utils/format'
import type { PlayMode } from '@/types'

/**
 * 全屏歌词页（对照 Salt Player 截图）：
 * 背景为封面颜色构图拉伸的柔和渐变；封面在左带倒影；歌词在右逐行双语；
 * 当前行放大高亮、其余按距离递减；底部居中液态玻璃迷你播放条。
 */
const player = usePlayerStore()
const ui = useUiStore()
const library = useLibraryStore()
const settings = useSettingsStore()

/* ---------- 封面飞入动画状态（须在 immediate watch 之前声明，避免 TDZ） ---------- */

/** 飞行动画进行中：期间跳过歌词滚动、延后背景渐变，避免和动画抢主线程 */
const flyActive = ref(false)
/** 飞行时长与减速曲线：收尾干脆，不拖出一段几乎静止的尾巴 */
const FLY_DURATION = 560
const FLY_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

/* ---------- 封面环境背景（单层预烘焙模糊图，避免多个全屏 blur 图层在飞入/切歌时并行栅格化） ---------- */

const ambientUrl = ref<string | null>(null)
const ambientShown = ref(false)
const ambientCache = new Map<string, string>()
/** 流光圆斑颜色：从封面提取的明亮饱和色（浅色底的亮眼点缀） */
const flowColors = ref<string[]>([])
const flowCache = new Map<string, string[]>()

function revealAmbient() {
  requestAnimationFrame(() => {
    ambientShown.value = true
  })
}

watch(
  () => player.current?.coverId ?? null,
  async (coverId) => {
    if (!coverId) {
      ambientUrl.value = null
      ambientShown.value = false
      flowColors.value = []
      return
    }
    const apply = (url: string) => {
      ambientUrl.value = url
      revealAmbient()
    }
    const cached = ambientCache.get(coverId)
    if (cached) {
      apply(cached)
      flowColors.value = flowCache.get(coverId) ?? []
      return
    }
    try {
      const url = await library.coverUrl(coverId)
      if (!url) return
      // 走 <img> 解码 → canvas：比直接 fetch(blob URL) 在 HMR / 跨源 / 跨标签
      // 场景下更稳定（fetch blob URL 偶发 Failed to fetch）。
      const blob = await urlToBlob(url)
      const baked = await renderAmbientUrl(blob)
      ambientCache.set(coverId, baked)
      apply(baked)
      // 流光取色：与背景烘焙共用一次解码，失败不阻塞
      const colors = await extractBrightColors(blob).catch(() => [] as string[])
      flowCache.set(coverId, colors)
      flowColors.value = colors
    } catch {
      // 取色失败保持浅色底
    }
  },
  { immediate: true },
)

/** 通过 <img> 解码 + canvas 取色，避免 fetch(blob:) 偶发的 Failed to fetch（HMR / 跨标签场景更稳）。 */
async function urlToBlob(url: string): Promise<Blob> {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  return await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/png'),
  )
}

/** 预加载一张图片（等位图就绪），用于在飞入前把目标封面切换到高清图，避免落地清晰度跳变。 */
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    const done = () => resolve()
    img.onload = done
    img.onerror = done
    img.src = src
    if (typeof img.decode === 'function') img.decode().then(done, done)
  })
}

const baseGroups = ref<LyricGroup[]>([])
/** 应用歌词偏移后的时间轴：偏移 > 0 = 歌词提前显示。
    高亮、逐字加深、点击跳播共用这份平移后的时间，保证三者的语义一致。 */
const groups = computed<LyricGroup[]>(() =>
  baseGroups.value.map((g) => {
    if (g.time < 0) return g
    const shift = Math.max(0, g.time - settings.lyricOffset) - g.time
    return {
      ...g,
      time: g.time + shift,
      charTimes: g.charTimes?.map((t) => t + shift),
    }
  }),
)
const loading = ref(false)
/** 歌词加载完成标记（有无歌词都置 true），飞入动画据此等布局稳定 */
const lyricsSettled = ref(false)
/** 切歌切换动画开关 */
const switching = ref(false)
/** 歌词滚动容器（须在 watch 前声明，避免 immediate 访问时 TDZ） */
const scroller = ref<HTMLElement | null>(null)
/** 切歌淡出起始时刻（须在 watch 前声明） */
let switchStart = 0
/** 是否首次挂载：首次打开歌词页由 flyIn 接管入场，不触发「切歌」过场，避免与飞入状态冲突 */
let currentPathFirstRun = true

watch(
  () => player.currentPath,
  async (path) => {
    lyricsSettled.value = false
    const isFirstRun = currentPathFirstRun
    currentPathFirstRun = false
    if (!isFirstRun) {
      switching.value = true // 切歌：内容淡出淡入
      switchStart = performance.now()
    }
    baseGroups.value = []
    const song = player.current
    if (!path || !song) {
      lyricsSettled.value = true
      switching.value = false // 未播放时不应停留在淡出态
      return
    }
    loading.value = true
    // 关键：不要 scrollTo(0)。歌词此时仍透明（flyIn/switching 控制），
    // 但 scrollTop=0 会导致歌词可见时显示在第一行，与 flyIn 落地后的 scrollToActive
    // 形成「从 0 跳到活动行」的明显跳变。先留默认位置，最后统一处理。

    // 优先同目录 .lrc 文件，其次音频内嵌歌词
    const lrc = await readLrcFile(song.rootId, path.slice(song.rootId.length + 1))
    if (lrc && lrc.trim()) {
      baseGroups.value = parseLrc(lrc)
    } else if (song.embeddedLyrics) {
      baseGroups.value = parseEmbeddedLyrics(song.embeddedLyrics)
    }
    loading.value = false
    lyricsSettled.value = true
    // 歌词就位后立即按当前播放位置定位高亮行（打开页面时可能处于暂停态，rAF 不会跑）
    activeIdx.value = computeActiveIdx(getAudio().currentTime)
    // 歌词已就位但仍透明——先把视口定位到当前行（不渲染过程、无视觉跳变），
    // 等切换动画完成再让用户看到歌词时，已经在正确位置。
    await nextTick()
    scrollToActive(false)
    // 保证入场阶段真正可见（至少 640ms 与封面滑入对齐）再归位，
    // 切歌才有完整过场；少于 640ms 就延后到刚好 640ms
    if (isFirstRun) return // 首次挂载：不停留在切换态，直接就位
    const elapsed = performance.now() - switchStart
    window.setTimeout(() => {
      switching.value = false
    }, Math.max(0, 640 - elapsed))
  },
  { immediate: true },
)

/** 内嵌歌词：带时间轴的按 LRC 解析；纯文本按行静态展示 */
function parseEmbeddedLyrics(text: string): LyricGroup[] {
  if (/\[\d{1,3}:\d{1,2}(?:\.\d+)?\]/.test(text)) {
    return parseLrc(text)
  }
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ time: -1, texts: [l] }))
}

/* 当前行：由 rAF 采样时钟统一驱动（与逐字进度同一时间源，行切换与逐字不会错位）。
   无时间轴的静态歌词不高亮不递减。 */
const activeIdx = ref(-1)

function computeActiveIdx(t: number): number {
  if (groups.value.length === 0 || groups.value[0].time < 0) return -1
  let lo = 0
  let hi = groups.value.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (groups.value[mid].time <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/* 自动居中滚动（活动行保持在视口上 1/3 处，符合截图观感） */
const lineEls = ref<(HTMLElement | null)[]>([])

watch(groups, () => {
  lineEls.value = []
  syncKaraoke() // 歌词重载/偏移调整：字符 span 全部重建，引擎必须换绑新 DOM
})

function setLineEl(i: number) {
  return (el: unknown) => {
    lineEls.value[i] = el instanceof HTMLElement ? el : null
  }
}

/* 自定义缓动滚动：out-quart。
   420ms 而非 700ms——拖太久会和下一行的切换动画叠在一起，观感黏滞。 */
const SCROLL_DURATION = 420
let scrollRaf = 0

function smoothScrollTo(container: HTMLElement, target: number) {
  cancelAnimationFrame(scrollRaf)
  const start = container.scrollTop
  const delta = target - start
  // 位移很小时不做动画，避免为几像素跑一整段 rAF
  if (Math.abs(delta) < 2) {
    container.scrollTop = target
    return
  }
  const t0 = performance.now()
  const ease = (t: number) => 1 - Math.pow(1 - t, 4)
  const frame = (now: number) => {
    const p = Math.min(1, (now - t0) / SCROLL_DURATION)
    container.scrollTop = start + delta * ease(p)
    if (p < 1) scrollRaf = requestAnimationFrame(frame)
  }
  scrollRaf = requestAnimationFrame(frame)
}

/** 把当前行摆到视口上 1/3 处；animate=false 时直接定位（无过渡，省一次长时滚动动画） */
function scrollToActive(animate: boolean) {
  const container = scroller.value
  const el = lineEls.value[activeIdx.value]
  if (!container || !el) return
  const offset = Math.max(0, el.offsetTop - container.clientHeight / 3)
  if (animate) smoothScrollTo(container, offset)
  else container.scrollTop = offset
}

watch(activeIdx, async () => {
  await nextTick()
  // 飞行动画期间不滚动：落地后由 flyIn 的收尾逻辑一次性直接定位。
  if (flyActive.value) return
  // 用户刚手动滚动过 → 让出控制权，别把人拽回去
  if (userScrolling.value) return
  scrollToActive(true)
})

/** 用户手动滚动后暂停自动跟随 3 秒，避免"滚轮刚滚完又被拽回去"的对抗感 */
const userScrolling = ref(false)
let userScrollTimer = 0

function onLyricScroll() {
  if (scrollRaf) return // 自动滚动本身触发的 scroll 事件不算用户操作
  userScrolling.value = true
  window.clearTimeout(userScrollTimer)
  userScrollTimer = window.setTimeout(() => {
    userScrolling.value = false
  }, 3000)
}

function lineClass(i: number) {
  if (activeIdx.value < 0) return {} // 静态歌词（无时间轴）不高亮不递减
  const d = Math.abs(i - activeIdx.value)
  return {
    active: d === 0,
    [`dim-${Math.min(d, 4)}`]: d > 0,
  }
}

const hasLyrics = computed(() => groups.value.length > 0)

/* ---------- 卡拉OK逐字点亮（Apple Music 式）：rAF 采样 audio.currentTime，按字符更新 ----------
   player.currentTime 只有 4Hz（timeupdate），逐字效果必须自己采样音频元素。
   逐字时间来源两级：增强型 LRC 的真实 charTimes → 无则按字符类型加权智能插值。
   每帧只写当前字符的 --cp（及跨字符瞬间补齐），DOM 直写绕开 Vue 响应式。 */
let lyricRaf = 0
let kLine = -1 // kSpans 所属行号（与 activeIdx 对齐才算就绪）
let kSpans: HTMLElement[] = []
let kTimes: number[] = [] // 逐字开始时刻，长度 = 字符数 + 1（末位行尾）
let kIdx = -1 // 当前字符下标
let kLastT = -1

/** 虚拟逐字时间：按字符类型加权把行时长分配到各字符（CJK 1.0 / 拉丁 0.6 / 空白 0.3 / 其它 0.5，
    句读标点后附加停顿权重），模拟真实跟唱节奏 */
function virtualCharTimes(text: string, startT: number, endT: number): number[] {
  const chars = [...text]
  const weights = chars.map((ch, i) => {
    let w: number
    if (/\s/.test(ch)) w = 0.3
    else if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) w = 1
    else if (/[a-zA-Z0-9]/.test(ch)) w = 0.6
    else w = 0.5
    // 句读停顿：把停顿时间压到标点自身（权重 0.5）之后的下一字符前
    if (i > 0 && /[，。！？；、…—,.!?;:]/.test(chars[i - 1])) w += 0.8
    return w
  })
  const total = weights.reduce((s, w) => s + w, 0) || 1
  const times: number[] = [startT]
  let acc = startT
  for (const w of weights) {
    acc += ((endT - startT) * w) / total
    times.push(acc)
  }
  return times
}

function karaokeReady(): boolean {
  return kLine === activeIdx.value && kSpans.length > 0 && kTimes.length === kSpans.length + 1
}

function rebuildKaraoke() {
  const i = activeIdx.value
  kLine = i
  kSpans = []
  kTimes = []
  kIdx = -1
  kLastT = -1
  if (i < 0) return
  const g = groups.value[i]
  if (!g || g.time < 0 || !g.texts[0]) return
  const startT = g.time
  const endT = groups.value[i + 1]?.time ?? startT + 8
  const chars = [...g.texts[0]].length
  if (g.charTimes && g.charTimes.length === chars + 1) {
    kTimes = g.charTimes.slice()
  } else {
    kTimes = virtualCharTimes(g.texts[0], startT, Math.max(startT + 0.5, endT))
  }
  const host = lineEls.value[i]?.querySelector('.lyric-text.karaoke')
  if (!host) return
  kSpans = [...host.querySelectorAll<HTMLElement>('.lyric-char')]
}

function setCP(span: HTMLElement, v: number) {
  span.style.setProperty('--cp', `${v.toFixed(1)}%`)
}

/** 把 t 写入当前行字符填充态；t 倒退（回 seek）或 force 时全行重刷，否则只推进增量 */
function applyKaraoke(t: number, force = false) {
  if (!karaokeReady()) return
  const n = kSpans.length
  let idx = force ? 0 : Math.max(0, kIdx)
  while (idx < n - 1 && t >= kTimes[idx + 1]) idx++
  while (idx > 0 && t < kTimes[idx]) idx--
  if (force || idx !== kIdx || t < kLastT - 0.05) {
    for (let c = 0; c < n; c++) setCP(kSpans[c], c < idx ? 100 : 0)
  }
  const cs = kTimes[idx]
  const ce = Math.max(cs + 0.001, kTimes[idx + 1])
  setCP(kSpans[idx], Math.min(1, Math.max(0, (t - cs) / (ce - cs))) * 100)
  kIdx = idx
  kLastT = t
}

/** 就绪重建 + 全量刷一遍当前填充态（打开页面/换行/歌词重载/暂停 seek 后调用） */
async function syncKaraoke() {
  await nextTick()
  rebuildKaraoke()
  applyKaraoke(getAudio().currentTime, true)
}

function tickLyric() {
  const t = getAudio().currentTime
  const i = computeActiveIdx(t)
  if (i !== activeIdx.value) activeIdx.value = i // 触发 watcher 重建逐字 span
  if (i >= 0) applyKaraoke(t)
  lyricRaf = requestAnimationFrame(tickLyric)
}

function syncLyricRaf() {
  cancelAnimationFrame(lyricRaf)
  lyricRaf = 0 // 必须归零：否则暂停后兜底 watcher 的 if (lyricRaf) return 永久短路
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (ui.lyricsOpen && player.playing && !reduced) lyricRaf = requestAnimationFrame(tickLyric)
  // 暂停时冻结当前进度（不清零，恢复播放后继续）
}

watch([() => player.playing, () => ui.lyricsOpen], syncLyricRaf, { immediate: true })
watch(activeIdx, () => {
  syncKaraoke() // 换行：重建字符 span 并按当前时刻刷初始填充态
})
// 暂停态的兜底：rAF 停转时靠 timeupdate 维持行高亮与逐字态（拖拽进度/暂停后 seek）
watch(
  () => player.currentTime,
  (t) => {
    if (lyricRaf) return // rAF 运行中以此为准
    const i = computeActiveIdx(t)
    if (i !== activeIdx.value) activeIdx.value = i
    else if (kLine === i) applyKaraoke(t, t < kLastT - 0.05)
    else syncKaraoke()
  },
)

/* ---------- 鼠标视差 + 封面倾斜（浅色页面的纵深呼吸感） ---------- */
const pageEl = ref<HTMLElement | null>(null)
let parallaxRaf = 0
let parallaxEvt: MouseEvent | null = null

function applyParallax() {
  parallaxRaf = 0
  const e = parallaxEvt
  const el = pageEl.value
  if (!e || !el) return
  const x = (e.clientX / window.innerWidth) * 2 - 1
  const y = (e.clientY / window.innerHeight) * 2 - 1
  el.style.setProperty('--mx', x.toFixed(3))
  el.style.setProperty('--my', y.toFixed(3))
}

function onPageMouseMove(e: MouseEvent) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  parallaxEvt = e
  if (!parallaxRaf) parallaxRaf = requestAnimationFrame(applyParallax)
}

function onCoverMouseMove(e: MouseEvent) {
  const el = pageEl.value
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const target = e.currentTarget as HTMLElement
  const r = target.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width - 0.5
  const py = (e.clientY - r.top) / r.height - 0.5
  el.style.setProperty('--rx', `${(-py * 6).toFixed(2)}deg`)
  el.style.setProperty('--ry', `${(px * 6).toFixed(2)}deg`)
}

function onCoverMouseLeave() {
  const el = pageEl.value
  el?.style.setProperty('--rx', '0deg')
  el?.style.setProperty('--ry', '0deg')
}

onBeforeUnmount(() => {
  cancelAnimationFrame(lyricRaf)
  cancelAnimationFrame(parallaxRaf)
})

/* ---------- 左栏小按钮行：播放模式 / 音量 / 字号 ---------- */
const MODE_META: { mode: PlayMode; icon: 'order' | 'repeat' | 'repeatOne' | 'shuffle'; label: string }[] = [
  { mode: 'order', icon: 'order', label: '顺序播放' },
  { mode: 'one', icon: 'repeatOne', label: '单曲循环' },
  { mode: 'loop', icon: 'repeat', label: '列表循环' },
  { mode: 'shuffle', icon: 'shuffle', label: '随机播放' },
]
const modeMeta = computed(() => MODE_META.find((m) => m.mode === player.playMode)!)

function cycleMode() {
  const idx = MODE_META.findIndex((m) => m.mode === player.playMode)
  player.setPlayMode(MODE_META[(idx + 1) % MODE_META.length].mode)
}

const fsOpen = ref(false)

function pickFontSize(size: LyricFontSize) {
  settings.setLyricFontSize(size)
  fsOpen.value = false
  // 字号变了行高也变，需重新把当前行摆到视口上 1/3
  requestAnimationFrame(() => scrollToActive(false))
}

/* ---------- 底部进度条（作为 mini-bar 整体底边线） ---------- */

const progressDuration = computed(() => player.duration || player.current?.durationSec || 0)
const progressPct = computed(() => {
  const d = progressDuration.value
  if (d <= 0) return 0
  return Math.min(100, Math.max(0, (player.currentTime / d) * 100))
})

/** 进度条拖拽：只以全宽 .mini-progress-track 为稳定参考（点中 thumb/fill 也用 track 矩形求比例），拖拽期间用 dragPct 即时跟手。 */
const trackRef = ref<HTMLElement | null>(null)
const dragPct = ref<number | null>(null)
const displayPct = computed(() => dragPct.value ?? progressPct.value)
const bubbleTime = computed(() => formatDuration((displayPct.value / 100) * progressDuration.value))
let progressDraggingPointerId = -1
const progressDragging = ref(false)
let progressDragTimer = 0

function ratioFromPointer(e: PointerEvent): number {
  const track = trackRef.value
  if (!track) return 0
  const rect = track.getBoundingClientRect()
  if (rect.width <= 0) return 0
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
}

function onProgressPointerDown(e: PointerEvent) {
  const d = progressDuration.value
  if (d <= 0) return
  const track = trackRef.value
  if (!track) return
  // 阻止文本选择 + native dragstart
  e.preventDefault()
  track.setPointerCapture?.(e.pointerId)
  progressDraggingPointerId = e.pointerId
  progressDragging.value = true
  window.clearTimeout(progressDragTimer)
  // 即时跳到点击位置（按下就 seek，不要等到松手）
  const r = ratioFromPointer(e)
  dragPct.value = r * 100
  player.seek(r * d)
}

function onProgressPointerMove(e: PointerEvent) {
  if (progressDraggingPointerId !== e.pointerId) return
  const d = progressDuration.value
  if (d <= 0) return
  const r = ratioFromPointer(e)
  dragPct.value = r * 100
  player.seek(r * d)
}

function onProgressPointerUp(e: PointerEvent) {
  if (progressDraggingPointerId !== e.pointerId) return
  trackRef.value?.releasePointerCapture?.(e.pointerId)
  progressDraggingPointerId = -1
  progressDragging.value = false
  window.clearTimeout(progressDragTimer)
  // 松手后把 dragPct 交还给 progressPct（下一帧 currentTime 已跟上，避免视觉回弹）
  requestAnimationFrame(() => {
    dragPct.value = null
  })
}

/* ---------- 歌词字号：档位在设置页调整；歌词页打开期间跟随变化并重新定位 ---------- */
watch(
  () => settings.lyricFontPx,
  () => {
    requestAnimationFrame(() => scrollToActive(false))
  },
)

/* 偏移变化 → 时间轴整体平移，立即重算高亮行并重新定位视口 */
watch(
  () => settings.lyricOffset,
  () => {
    activeIdx.value = computeActiveIdx(getAudio().currentTime)
    nextTick(() => scrollToActive(false))
  },
)

/** 歌词页根元素内联字号变量（档位切换即时生效） */
const lyricVars = computed(() => ({
  '--lyric-fs': `${settings.lyricFontPx.main}px`,
  '--lyric-fs-sub': `${settings.lyricFontPx.sub}px`,
}))

function close() {
  ui.lyricsOpen = false
}

/* ---------- 封面飞入动画（FLIP 共享元素过渡，来自播放条小封面） ---------- */

const closing = ref(false)

/** 等待歌词就位（布局稳定），最多等 timeout 毫秒；改用事件驱动而非 30ms 轮询。 */
function waitForLyrics(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if (lyricsSettled.value) {
      resolve()
      return
    }
    const stop = watch(lyricsSettled, (v) => {
      if (v) {
        window.clearTimeout(timer)
        stop()
        resolve()
      }
    })
    const timer = window.setTimeout(() => {
      stop()
      resolve()
    }, timeout)
  })
}

/** 落地后的收尾：恢复真实封面、清掉飞行层、补上歌词定位 */
function settleFly(flying: HTMLElement | null, dstEl: HTMLElement | null) {
  const finish = () => {
    if (flying) {
      flying.style.willChange = ''
      flying.remove()
    }
    if (dstEl) dstEl.style.transition = ''
    requestAnimationFrame(() => {
      flyActive.value = false
      requestAnimationFrame(() => scrollToActive(false))
    })
  }
  // 交接：真实封面立即不透明并藏于克隆之下，再仅淡出克隆——避免两者同时半透明让背景透出（闪一下）
  if (flying && dstEl) {
    // 真实封面立即不透明（被仍在顶层的克隆盖住），再只淡出克隆：
    // 两者若同时半透明会让背景透出、亮度坍塌成「闪一下」
    dstEl.style.transition = 'none'
    dstEl.style.opacity = '1'
    flying.style.transition = 'opacity 120ms linear'
    flying.style.opacity = '0'
    requestAnimationFrame(() => {
      window.setTimeout(finish, 130)
    })
  } else {
    if (dstEl) dstEl.style.opacity = '1'
    finish()
  }
}

function flyIn() {
  void (async () => {
    flyActive.value = true
    await nextTick()
    // 如果已有缓存背景（切歌时的预取或上次浏览），立即 reveal：
    // 280ms 透明度淡入与飞行 (560ms) 并行，落地时背景已基本可见。
    if (ambientUrl.value) revealAmbient()

    // 1) 等歌词加载完成（布局稳定），否则取到的目标坐标是歌词为空时的旧位置，
    //    飞过去后会再被布局推到真实位置 → 卡顿。有歌词/无歌词都靠 lyricsSettled。
    // 2) 同时给高清封面留一点时间：飞行途中显示的就是最终那张图，落地不跳清晰度。
    const coverId = player.current?.coverId ?? null
    const [hiRes] = await Promise.all([
      coverId
        ? Promise.race([
            library.coverUrlHi(coverId).catch(() => null),
            new Promise((r) => setTimeout(r, 220)),
          ])
        : Promise.resolve(null),
      waitForLyrics(450),
    ])
    // 双 rAF：确保最终布局已提交，取到真实目标坐标
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    const srcEl = document.querySelector<HTMLElement>('.player-bar .track .cover')
    const dstEl = document.querySelector<HTMLElement>('.cover-main')
    if (!srcEl || !dstEl) {
      settleFly(null, dstEl)
      return
    }

    // 克隆「目标封面」而不是播放条小图：与落地后显示的是同一张（含高清图），
    // 交接瞬间不会有任何内容或清晰度的跳变。
    const dstInner = dstEl.matches('img') ? dstEl : dstEl.querySelector('img, .cover-fallback')
    if (!dstInner) {
      settleFly(null, dstEl)
      return
    }
    // 落地前先把目标封面切到高清图并预载，克隆与落地后是同一张 → 无清晰度跳变
    if (
      typeof hiRes === 'string' &&
      dstInner.tagName === 'IMG' &&
      dstInner.getAttribute('src') !== hiRes
    ) {
      await preloadImage(hiRes)
      dstInner.setAttribute('src', hiRes)
    }
    const flying = dstInner.cloneNode(true) as HTMLElement

    const s = srcEl.getBoundingClientRect()
    const d = dstEl.getBoundingClientRect()
    if (s.width < 1 || d.width < 1) {
      settleFly(null, dstEl)
      return
    }

    // FLIP：元素按「终点」尺寸和位置铺好，用 transform 反向缩回起点，再动回单位矩阵。
    // 全程只动 transform —— 走合成器，不触发布局，也不会让全屏 blur 背景重新栅格化。
    const scale = s.width / d.width
    const dx = s.left + s.width / 2 - (d.left + d.width / 2)
    const dy = s.top + s.height / 2 - (d.top + d.height / 2)

    flying.style.position = 'fixed'
    flying.style.margin = '0'
    flying.style.left = `${d.left}px`
    flying.style.top = `${d.top}px`
    flying.style.width = `${d.width}px`
    flying.style.height = `${d.height}px`
    flying.style.borderRadius = '12px'
    flying.style.boxShadow = 'none'
    flying.style.zIndex = '60'
    flying.style.pointerEvents = 'none'
    flying.style.willChange = 'transform'
    flying.style.transformOrigin = 'center center'
    flying.style.objectFit = 'cover'
    flying.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`

    // 飞行期间隐藏目标封面，避免重叠
    dstEl.style.opacity = '0'
    document.body.appendChild(flying)

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      settleFly(flying, dstEl)
    }

    requestAnimationFrame(() => {
      const anim = flying.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          { transform: 'translate(0px, 0px) scale(1)' },
        ],
        { duration: FLY_DURATION, easing: FLY_EASING, fill: 'both' },
      )
      anim.onfinish = finish
      // 兜底：即使 onfinish 未触发（如页面切换），也在动画结束附近清理，避免残留
      window.setTimeout(finish, FLY_DURATION + 240)
    })
  })()
}

async function closeWithFade() {
  if (closing.value) return
  closing.value = true

  // 「从哪里来，回哪里去」：大封面 FLIP 反向飞回播放条小封面。
  // 飞行层挂在 body 上，不随 lyrics-full 销毁 —— 页面淡出后封面继续飞完最后一段。
  const srcEl = document.querySelector<HTMLElement>('.cover-main')
  const dstEl = document.querySelector<HTMLElement>('.player-bar .track .cover')
  let flying: HTMLElement | null = null

  if (srcEl && dstEl) {
    const inner = srcEl.matches('img') ? srcEl : srcEl.querySelector('img, .cover-fallback')
    const s = srcEl.getBoundingClientRect()
    const d = dstEl.getBoundingClientRect()
    if (inner && s.width > 1 && d.width > 1) {
      flying = inner.cloneNode(true) as HTMLElement
      const scale = d.width / s.width
      const dx = d.left + d.width / 2 - (s.left + s.width / 2)
      const dy = d.top + d.height / 2 - (s.top + s.height / 2)
      Object.assign(flying.style, {
        position: 'fixed',
        margin: '0',
        left: `${s.left}px`,
        top: `${s.top}px`,
        width: `${s.width}px`,
        height: `${s.height}px`,
        borderRadius: '12px',
        boxShadow: 'none',
        zIndex: '80',
        pointerEvents: 'none',
        willChange: 'transform',
        transformOrigin: 'center center',
      } as CSSStyleDeclaration)
      // 源封面隐藏，避免飞行期间重叠
      srcEl.style.opacity = '0'
      document.body.appendChild(flying)
      const anim = flying.animate(
        [
          { transform: 'translate(0px, 0px) scale(1)' },
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        ],
        { duration: 420, easing: FLY_EASING, fill: 'both' },
      )
      const cleanup = () => flying?.remove()
      anim.onfinish = cleanup
      window.setTimeout(cleanup, 660) // 兜底清理
    }
  }

  // 页面本体淡出（.lyrics-full.closing 240ms），飞行比页面多飞 180ms 落进播放条
  setTimeout(() => {
    ui.lyricsOpen = false
    closing.value = false
  }, 240)
}

onMounted(() => {
  flyIn()
})
</script>

<template>
  <div
    class="lyrics-full"
    ref="pageEl"
    :class="{ closing, 'fly-active': flyActive, switching }"
    :style="lyricVars"
    @mousemove="onPageMouseMove"
  >
    <!-- 背景：浅色暖调渐变 + 低透明度环境光 + 封面明亮色流光圆斑 -->
    <div class="bg" />
    <div
      v-if="ambientUrl"
      class="bg-ambient"
      :class="{ show: ambientShown }"
      :style="{ backgroundImage: `url(${ambientUrl})` }"
    />
    <div
      v-for="(c, i) in flowColors.slice(0, 2)"
      :key="i"
      class="flow"
      :class="`flow-${i}`"
      :style="{ '--fc': c }"
    />

    <!-- 右上角工具组：歌词设置（字号，后续可扩展） + 退出 -->
    <div class="top-tools">
      <div class="fs-picker" :class="{ open: fsOpen }">
        <button
          class="tool-btn"
          :class="{ 'is-active': fsOpen }"
          title="歌词设置"
          @click="fsOpen = !fsOpen"
        >
          <AppIcon name="settings" :size="19" />
        </button>
        <Transition name="fs-pop">
          <div v-if="fsOpen" class="fs-menu">
            <div class="fs-heading">歌词字号</div>
            <button
              v-for="step in LYRIC_FS_STEPS"
              :key="step.id"
              class="fs-item"
              :class="{ current: settings.lyricFontSize === step.id }"
              @click="pickFontSize(step.id)"
            >
              <span class="fs-dot" :style="{ width: `${step.main / 3.2}px`, height: `${step.main / 3.2}px` }" />
              <span class="fs-label">{{ step.label }}</span>
            </button>
            <div class="fs-heading" title="正数歌词提前显示，负数延后">歌词偏移</div>
            <div class="offset-row">
              <button class="offset-btn" title="延后 0.1s" @click="settings.nudgeLyricOffset(-0.1)">−</button>
              <span class="offset-val">{{ settings.lyricOffset.toFixed(1) }}s</span>
              <button class="offset-btn" title="提前 0.1s" @click="settings.nudgeLyricOffset(0.1)">＋</button>
            </div>
          </div>
        </Transition>
      </div>
      <button class="tool-btn" title="退出全屏歌词" @click="closeWithFade">
        <AppIcon name="close" :size="19" />
      </button>
    </div>

    <!-- 双栏布局：左栏信息+控制，右栏歌词 -->
    <div class="layout" :class="{ switching, 'fly-active': flyActive }">
      <aside class="info-col">
        <div class="stack">
        <header class="track-head">
          <h1 class="track-title">{{ player.current?.title ?? '未在播放' }}</h1>
          <div class="track-artist">{{ player.current?.artist ?? '' }}</div>
        </header>

          <div
            class="cover-main"
            v-if="player.current"
            @mousemove="onCoverMouseMove"
            @mouseleave="onCoverMouseLeave"
          >
            <CoverImage :cover-id="player.current.coverId" :size="420" hires />
          </div>

          <div class="progress-block" :class="{ 'is-dragging': progressDragging }">
            <div class="progress-edge">
              <div class="progress-fill" :style="{ width: displayPct + '%' }" />
              <div
                class="progress-thumb"
                :style="{ left: displayPct + '%', opacity: progressDragging ? 1 : 0 }"
              />
              <div
                class="progress-bubble"
                :class="{ show: progressDragging }"
                :style="{ left: displayPct + '%' }"
              >
                {{ bubbleTime }}
              </div>
              <div
                ref="trackRef"
                class="progress-track"
                @pointerdown="onProgressPointerDown"
                @pointermove="onProgressPointerMove"
                @pointerup="onProgressPointerUp"
                @pointercancel="onProgressPointerUp"
              />
            </div>
            <div class="progress-times">
              <span class="cur">{{ formatDuration(player.currentTime) }}</span>
              <span class="dur">{{ formatDuration(progressDuration) }}</span>
            </div>
          </div>

          <div class="controls">
            <button class="ctrl-btn ghost" :title="modeMeta.label" @click="cycleMode">
              <AppIcon :name="modeMeta.icon" :size="20" />
            </button>
            <button class="ctrl-btn" title="上一曲" @click="player.prev()">
              <AppIcon name="prev" :size="24" />
            </button>
            <button
              class="ctrl-btn play"
              :title="player.playing ? '暂停' : '播放'"
              @click="player.current ? player.togglePlay() : player.resumePlay()"
            >
              <AppIcon :name="player.playing ? 'pause' : 'play'" :size="28" />
            </button>
            <button class="ctrl-btn" title="下一曲" @click="player.next()">
              <AppIcon name="next" :size="24" />
            </button>
            <div class="volume-wrap">
              <button class="ctrl-btn ghost" :title="`音量 ${player.volume}%`" @click="player.toggleMute()">
                <AppIcon :name="player.volume === 0 ? 'volumeMute' : 'volume'" :size="20" />
              </button>
              <input
                class="volume-slider"
                type="range"
                min="0"
                max="100"
                :value="player.volume"
                :style="{ '--vol': `${player.volume}%` }"
                title="音量"
                @input="(e) => player.setVolume(Number((e.target as HTMLInputElement).value))"
              />
            </div>
          </div>
        </div>
      </aside>

      <section class="lyric-col">
        <div v-if="hasLyrics" ref="scroller" class="lyric-scroll" @scroll.passive="onLyricScroll">
          <div class="lyric-inner">
            <div
              v-for="(g, i) in groups"
              :key="i"
              :ref="setLineEl(i)"
              class="lyric-line"
              :class="lineClass(i)"
              @click="player.seek(g.time)"
            >
              <div
                v-for="(text, j) in g.texts"
                :key="j"
                class="lyric-text"
                :class="{ sub: j > 0, karaoke: j === 0 && i === activeIdx && g.time >= 0 }"
              >
                <template v-if="j === 0 && i === activeIdx && g.time >= 0">
                  <span v-for="(ch, ci) in [...text]" :key="ci" class="lyric-char">{{ ch }}</span>
                </template>
                <template v-else>{{ text }}</template>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="no-lyrics-hint">
          {{ loading ? '正在加载歌词…' : player.current ? '当前歌曲没有歌词（需要与音频同目录的同名 .lrc 文件）' : '未在播放' }}
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lyrics-full {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 浅色暖调底（对照参考排版） */
  background: var(--lyric-bg);
  transition: opacity 240ms var(--ease-out);
}

.lyrics-full.closing {
  opacity: 0;
}

/* ---------- 背景：暖调浅色渐变 + 单层预烘焙环境光（低透明度，给每首歌一点自己的色调） ---------- */
.bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(165deg, #fbf9f4 0%, var(--lyric-bg) 52%, var(--lyric-bg-deep) 100%);
}

/* 单层环境光：多焦点已烘焙进图内（palette.renderAmbientUrl），低透明度叠在浅底上 */
.bg-ambient {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0;
  transform-origin: center center;
  animation: ambient-breathe 12s ease-in-out infinite;
  transition: opacity 280ms var(--ease-out);
  will-change: transform, opacity;
}

.bg-ambient.show {
  opacity: 0.16;
}

@keyframes ambient-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.06);
  }
}

/* 飞入/切歌过场期间暂停背景呼吸，避免呼吸与过场动画叠加抢帧（单层已很轻，此为双保险） */
.lyrics-full.fly-active .bg-ambient,
.lyrics-full.switching .bg-ambient {
  animation-play-state: paused;
}

/* ---------- 封面明亮色流光：radial 柔光圆斑缓慢漂移（只动 transform，无 filter），
   鼠标视差经独立的 translate 属性叠加，二者互不打架 ---------- */
.flow {
  position: absolute;
  width: 40vw;
  height: 40vw;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(closest-side, var(--fc), transparent 70%);
  opacity: 0.16;
  will-change: transform;
  translate: calc(var(--mx, 0) * 12px) calc(var(--my, 0) * 9px);
}

.flow-0 {
  top: -14%;
  left: -12%;
  animation: flow-a 38s ease-in-out infinite alternate;
}

.flow-1 {
  bottom: -20%;
  right: -8%;
  animation: flow-b 46s ease-in-out infinite alternate;
}

@keyframes flow-a {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(9vw, 7vh) scale(1.18); }
}

@keyframes flow-b {
  from { transform: translate(0, 0) scale(1.05); }
  to { transform: translate(-8vw, -6vh) scale(0.92); }
}

/* 飞入/切歌过场期间暂停背景呼吸与流光漂移，避免动画叠加抢帧 */
.lyrics-full.fly-active .flow,
.lyrics-full.switching .flow {
  animation-play-state: paused;
}

/* 底部稍压暗，保证迷你条与歌词可读 —— 已在 palette.renderAmbientUrl 烘焙进图内，无需单独压暗层 */

/* ---------- 双栏主体：整组水平居中，两栏间距受控 ----------
   注意：这里不能设 align-items:center —— 两栏必须拉伸到全高，
   歌词滚动容器依赖高度约束，居中会让它和内容一样高、彻底失去滚动。 */
.layout {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
  gap: clamp(32px, 5vw, 96px);
  padding: 0 4vw;
}

.info-col {
  --cover-w: min(54vh, 34vw);
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  padding: 32px 0 28px;
}

/* 内容栈：与封面同宽 —— 歌名/歌手与封面左缘严格对齐；整组在栏内垂直居中聚拢 */
.stack {
  width: var(--cover-w);
  margin: auto;
  display: flex;
  flex-direction: column;
}

.track-head {
  min-width: 0;
}

.track-title {
  margin: 0;
  font-size: clamp(26px, 2.6vw, 34px);
  font-weight: 800;
  color: var(--lyric-text-active);
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-artist {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 14px;
  color: var(--lyric-time);
}

/* 歌手名前的品牌红竖条：左栏唯一的强调色点缀 */
.track-artist::before {
  content: '';
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--lyric-accent);
}

/* 切歌切换动画：封面平滑缩入 + 歌词上浮淡入 */
.cover-main {
  position: relative;
  margin: 30px 0 30px;
  /* 鼠标视差：封面与流光反向微移，制造纵深（translate 属性与 transform 动画独立叠加） */
  translate: calc(var(--mx, 0) * -6px) calc(var(--my, 0) * -5px);
  transition: transform 640ms var(--ease-out), opacity 460ms var(--ease-out);
}

.layout.switching .cover-main {
  transform: scale(0.96);
  opacity: 0.55;
}

/* 封面飞入期间：封面不参与切歌淡入淡出（与飞行叠加会"顿一下"） */
.layout.fly-active .cover-main {
  opacity: 1;
  transform: none;
  transition: none;
}

.cover-main :deep(img),
.cover-main :deep(.cover-fallback) {
  display: block;
  width: var(--cover-w);
  height: var(--cover-w);
  border-radius: 10px;
  box-shadow: 0 20px 48px rgba(70, 58, 34, 0.18);
  /* hover 倾斜：随光标位置轻微 3D 端详（--rx/--ry 由封面 mousemove 写入） */
  transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 0.25s var(--ease-out);
}

/* ---------- 进度条（左栏、与封面同宽） ---------- */
.progress-block {
  width: 100%;
}

.progress-edge {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: var(--lyric-ps-track);
  transition: height var(--dur-fast) var(--ease-out), background 0.2s var(--ease-out);
}

.progress-track {
  position: absolute;
  inset: -8px 0;
  cursor: pointer;
  border-radius: 999px;
}

.progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  border-radius: 999px;
  background: var(--lyric-ps-fill);
  transition: width 80ms linear;
  pointer-events: none;
}

.progress-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--lyric-ps-thumb);
  transform: translate(-50%, -50%) scale(0.6);
  pointer-events: none;
  transition: opacity 0.12s var(--ease-out), transform 0.18s var(--ease-spring);
}

.progress-block.is-dragging .progress-thumb {
  transform: translate(-50%, -50%) scale(1);
}

.progress-block.is-dragging .progress-fill {
  transition: none;
}

.progress-block:hover .progress-edge,
.progress-block.is-dragging .progress-edge {
  height: 5px;
  background: var(--lyric-ps-track-hover);
}

.progress-bubble {
  position: absolute;
  bottom: 14px;
  left: 0;
  transform: translateX(-50%) scale(0.9);
  transform-origin: center bottom;
  padding: 3px 9px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--lyric-progress-bubble-text);
  background: var(--lyric-progress-bubble-bg);
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 4px 14px rgba(70, 58, 34, 0.16);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-spring);
}

.progress-bubble.show {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}

.progress-times {
  display: flex;
  justify-content: space-between;
  margin-top: 9px;
  font-size: 11px;
  color: var(--lyric-time);
  font-variant-numeric: tabular-nums;
}

.progress-times .cur {
  color: var(--lyric-text-active);
  font-weight: 600;
}

/* ---------- 大号三键控制（播放键实心圆底，更稳重；模式/音量分列左右） ---------- */
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 22px;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  color: var(--lyric-control);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out),
    transform var(--dur-fast) var(--ease-spring), box-shadow 0.2s var(--ease-out);
}

.ctrl-btn.ghost {
  width: 40px;
  height: 40px;
}

.volume-wrap {
  display: flex;
  align-items: center;
}

.ctrl-btn:hover {
  color: var(--lyric-control-hover);
  background: var(--lyric-control-bg);
}

.ctrl-btn:active {
  transform: scale(0.92);
}

.ctrl-btn.play {
  width: 60px;
  height: 60px;
  background: var(--lyric-text-active);
  color: var(--lyric-bg);
  box-shadow: 0 10px 26px rgba(29, 29, 31, 0.28);
}

.ctrl-btn.play:hover {
  background: #000;
  color: #fff;
  transform: scale(1.05);
}

.ctrl-btn.play:active {
  transform: scale(0.95);
}

/* 音量滑杆（hover 展开） */
.volume-wrap {
  display: flex;
  align-items: center;
}

.volume-slider {
  width: 0;
  height: 4px;
  appearance: none;
  -webkit-appearance: none;
  border-radius: 2px;
  background: linear-gradient(
    to right,
    var(--lyric-ps-fill) var(--vol, 80%),
    var(--lyric-ps-track) var(--vol, 80%)
  );
  cursor: pointer;
  opacity: 0;
  margin-left: 0;
  transition: width var(--dur-med) var(--ease-out), opacity var(--dur-med) var(--ease-out),
    margin var(--dur-med) var(--ease-out);
}

.volume-wrap:hover .volume-slider,
.volume-slider:focus-visible {
  width: 68px;
  opacity: 1;
  margin-left: 6px;
}

.volume-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--lyric-ps-thumb);
  transition: transform var(--dur-fast) var(--ease-spring);
}

.volume-slider:hover::-webkit-slider-thumb {
  transform: scale(1.2);
}

/* ---------- 右上角工具组：歌词设置（字号，可扩展） + 退出 ---------- */
.top-tools {
  position: absolute;
  top: 18px;
  right: 22px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--lyric-control);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}

.tool-btn:hover {
  color: var(--lyric-control-hover);
  background: var(--lyric-control-bg);
}

.tool-btn:active {
  transform: scale(0.92);
}

.tool-btn :deep(svg) {
  transition: transform var(--dur-med) var(--ease-spring);
}

.tool-btn:hover :deep(svg) {
  transform: rotate(90deg);
}

.fs-picker {
  position: relative;
}

.fs-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  min-width: 148px;
  padding: 8px 6px 6px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(32px) saturate(1.4);
  -webkit-backdrop-filter: blur(32px) saturate(1.4);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 12px 32px rgba(70, 58, 34, 0.16);
  display: flex;
  flex-direction: column;
  gap: 2px;
  transform-origin: top right;
}

.fs-heading {
  padding: 2px 10px 6px;
  font-size: 11px;
  color: var(--lyric-time);
  letter-spacing: 0.5px;
}

.fs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 9px;
  color: var(--lyric-control);
  font-size: 13px;
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.fs-item:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--lyric-text-active);
}

.fs-item.current {
  color: var(--lyric-text-active);
}

.fs-dot {
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--lyric-control);
  transition: background 0.12s;
}

.fs-item.current .fs-dot {
  background: var(--lyric-text-active);
}

.fs-label {
  flex: 1;
  text-align: left;
}

.offset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px 6px;
}

.offset-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
  color: var(--lyric-control);
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.offset-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--lyric-text-active);
}

.offset-val {
  min-width: 42px;
  text-align: center;
  font-size: 12px;
  color: var(--lyric-text-active);
  font-variant-numeric: tabular-nums;
}

.fs-pop-enter-active {
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-spring);
}

.fs-pop-leave-active {
  transition: opacity 100ms var(--ease-out), transform 100ms var(--ease-out);
}

.fs-pop-enter-from,
.fs-pop-leave-to {
  opacity: 0;
  transform: scale(0.92) translateY(-4px);
}

/* 歌词设置/退出：右上角工具组（.top-tools） */

/* ---------- 右栏歌词 ---------- */
.lyric-col {
  flex: 0 1 min(44vw, 720px);
  min-width: 0;
  position: relative;
  display: flex;
  padding: 0;
}

.lyric-scroll {
  flex: 1;
  height: 100%;
  overflow-y: auto;
  text-align: center;
  padding: 0 4vw;
  mask-image: linear-gradient(transparent, var(--lyric-mask) 12%, var(--lyric-mask) 88%, transparent);
  -webkit-mask-image: linear-gradient(transparent, var(--lyric-mask) 12%, var(--lyric-mask) 88%, transparent);
  scrollbar-width: none;
  transition: opacity 520ms var(--ease-out), transform 560ms var(--ease-out);
}

.lyric-scroll::-webkit-scrollbar {
  display: none;
}

.layout.switching .lyric-scroll,
.layout.switching .no-lyrics-hint {
  opacity: 0.55;
  transform: translateY(22px);
}

.lyric-inner {
  padding: 42vh 0 50vh;
  display: flex;
  flex-direction: column;
  gap: 34px;
}

/* 景深：只用 opacity + transform 表达远近，不用 filter: blur()（多行同时过渡会掉帧）。
   当前行加粗变黑、其余灰阶，对照参考排版。 */
.lyric-line {
  cursor: pointer;
  opacity: 0.72;
  transform-origin: center center;
  transform: scale(0.97);
  transition: opacity 0.35s var(--ease-out), transform 0.35s var(--ease-out);
}

.lyric-line.dim-1 { opacity: 0.6; }
.lyric-line.dim-2 { opacity: 0.45; }
.lyric-line.dim-3 { opacity: 0.32; }
.lyric-line.dim-4 { opacity: 0.22; }

.lyric-line:hover {
  opacity: 0.9;
}

.lyric-line.active {
  opacity: 1;
  transform: scale(1);
}

.lyric-line.active .lyric-text {
  color: var(--lyric-text-active);
  font-weight: 700;
  text-shadow: var(--lyric-shadow);
}

.lyric-text {
  font-size: var(--lyric-fs);
  font-weight: 500;
  color: var(--lyric-text);
  line-height: 1.6;
  letter-spacing: 0.2px;
  transition: color 0.3s var(--ease-out);
}

.lyric-text.sub {
  font-size: var(--lyric-fs-sub);
  font-weight: 400;
  opacity: 0.75;
}

.lyric-line.active .lyric-text.sub {
  color: var(--lyric-text-sub);
  opacity: 0.9;
}

/* 卡拉OK逐字点亮：字符级 background-clip:text，--cp 为该字符填充度（rAF 逐字直写）。
   三停渐变带 ~0.12 字宽柔光前沿，不再是硬边界 */
.lyric-text.karaoke .lyric-char {
  background-image: linear-gradient(
    90deg,
    var(--lyric-text-active) calc(var(--cp, 0%) - 12%),
    color-mix(in srgb, var(--lyric-text-active) 45%, var(--lyric-text)) var(--cp, 0%),
    var(--lyric-text) calc(var(--cp, 0%) + 12%)
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}

/* 首行元数据："歌名 - 歌手"（不可点击，弱于普通行） */
.lyric-head {
  cursor: default;
  color: var(--lyric-text);
  font-size: calc(var(--lyric-fs) * 0.72);
  font-weight: 500;
  opacity: 0.6;
}

.no-lyrics-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lyric-hint);
  font-size: 15px;
  transition: opacity 520ms var(--ease-out), transform 560ms var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .flow {
    animation: none;
    translate: none;
    opacity: 0.22;
  }
  .bg-ambient {
    animation: none;
  }
  .cover-main {
    translate: none;
  }
  .cover-main :deep(img),
  .cover-main :deep(.cover-fallback) {
    transform: none;
    transition: none;
  }
}
</style>
