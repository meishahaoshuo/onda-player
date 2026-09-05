<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import CoverImage from '@/components/CoverImage.vue'
import { readLrcFile } from '@/services/fs'
import { parseLrc, type LyricGroup } from '@/services/lyrics'
import { renderAmbientUrl } from '@/services/palette'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { LYRIC_FS_STEPS, type LyricFontSize } from '@/stores/settings'
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
      return
    }
    const apply = (url: string) => {
      ambientUrl.value = url
      revealAmbient()
    }
    const cached = ambientCache.get(coverId)
    if (cached) {
      apply(cached)
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
    } catch {
      // 取色失败保持深色底
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

const groups = ref<LyricGroup[]>([])
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
    groups.value = []
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
      groups.value = parseLrc(lrc)
      lyricSource.value = 'lrc'
    } else if (song.embeddedLyrics) {
      groups.value = parseEmbeddedLyrics(song.embeddedLyrics)
      lyricSource.value = 'embedded'
    } else {
      lyricSource.value = null
    }
    loading.value = false
    lyricsSettled.value = true
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

/* 当前行：最后一个 time <= currentTime 的组；无时间轴的静态歌词不高亮 */
const activeIdx = computed(() => {
  if (groups.value.length === 0 || groups.value[0].time < 0) return -1
  const t = player.currentTime
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
})

/* 自动居中滚动（活动行保持在视口上 1/3 处，符合截图观感） */
const lineEls = ref<(HTMLElement | null)[]>([])

watch(groups, () => {
  lineEls.value = []
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

/** 歌词来源徽标（右栏左下角）：LRC 文件 / EMBEDDED 内嵌 */
const lyricSource = ref<'lrc' | 'embedded' | null>(null)
const lyricSourceLabel = computed(() =>
  lyricSource.value === 'lrc' ? 'LRC' : lyricSource.value === 'embedded' ? 'EMBEDDED' : '',
)

/** 音频格式行（左栏封面下方）：容器 + 采样率 + 位深 */
const formatMeta = computed(() => {
  const s = player.current
  if (!s) return ''
  const parts: string[] = []
  if (s.container) parts.push(s.container.toUpperCase())
  if (s.sampleRateHz) parts.push(`${(s.sampleRateHz / 1000).toFixed(1)} kHz`)
  if (s.bitsPerSample) parts.push(`${s.bitsPerSample}bit`)
  return parts.join('  ')
})

/* 迷你播放条 */
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

/* ---------- 歌词字号：歌词页内 Aa 快捷档位 ---------- */

const fsOpen = ref(false)

function pickFontSize(size: LyricFontSize) {
  settings.setLyricFontSize(size)
  fsOpen.value = false
  // 字号变了行高也变，需重新把当前行摆到视口上 1/3
  requestAnimationFrame(() => scrollToActive(false))
}

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
  <div class="lyrics-full" :class="{ closing, 'fly-active': flyActive, switching }" :style="lyricVars">
    <!-- 背景：纯深色底 + 单层预烘焙环境光（多焦点已画进一张小模糊图，无需多个全屏 blur 层） -->
    <div class="bg" />
    <div
      v-if="ambientUrl"
      class="bg-ambient"
      :class="{ show: ambientShown }"
      :style="{ backgroundImage: `url(${ambientUrl})` }"
    />

    <!-- 双栏布局：左栏信息+控制，右栏歌词 -->
    <div class="layout" :class="{ switching, 'fly-active': flyActive }">
      <aside class="info-col">
        <header class="track-head">
          <h1 class="track-title">{{ player.current?.title ?? '未在播放' }}</h1>
          <div class="track-artist">{{ player.current?.artist ?? '' }}</div>
        </header>

        <div class="cover-stack">
          <div class="cover-main" v-if="player.current">
            <CoverImage :cover-id="player.current.coverId" :size="420" hires />
          </div>
          <div class="format-line">{{ formatMeta }}</div>

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
            <button class="ctrl-btn" title="上一曲" @click="player.prev()">
              <AppIcon name="prev" :size="22" />
            </button>
            <button
              class="ctrl-btn play"
              :title="player.playing ? '暂停' : '播放'"
              @click="player.current ? player.togglePlay() : player.resumePlay()"
            >
              <AppIcon :name="player.playing ? 'pause' : 'play'" :size="26" />
            </button>
            <button class="ctrl-btn" title="下一曲" @click="player.next()">
              <AppIcon name="next" :size="22" />
            </button>
          </div>
        </div>

        <div class="sub-row">
          <button class="sub-btn mode" :title="modeMeta.label" @click="cycleMode">
            <AppIcon :name="modeMeta.icon" :size="18" />
          </button>
          <div class="volume-wrap">
            <button class="sub-btn" :title="`音量 ${player.volume}%`" @click="player.toggleMute()">
              <AppIcon :name="player.volume === 0 ? 'volumeMute' : 'volume'" :size="18" />
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
          <div class="fs-picker" :class="{ open: fsOpen }">
            <button
              class="sub-btn"
              :class="{ 'is-active': fsOpen }"
              title="调节歌词字号"
              @click="fsOpen = !fsOpen"
            >
              <span class="aa">Aa</span>
            </button>
            <Transition name="fs-pop">
              <div v-if="fsOpen" class="fs-menu">
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
              </div>
            </Transition>
          </div>
          <button class="sub-btn" title="退出全屏歌词" @click="closeWithFade">
            <AppIcon name="close" :size="18" />
          </button>
        </div>
      </aside>

      <section class="lyric-col">
        <div v-if="hasLyrics" ref="scroller" class="lyric-scroll" @scroll.passive="onLyricScroll">
          <div class="lyric-inner">
            <div class="lyric-line lyric-head">
              {{ player.current?.title ?? '' }} - {{ player.current?.artist ?? '' }}
            </div>
            <div
              v-for="(g, i) in groups"
              :key="i"
              :ref="setLineEl(i)"
              class="lyric-line"
              :class="lineClass(i)"
              @click="player.seek(g.time)"
            >
              <div v-for="(text, j) in g.texts" :key="j" class="lyric-text" :class="{ sub: j > 0 }">
                {{ text }}
              </div>
            </div>
          </div>
        </div>
        <div v-else class="no-lyrics-hint">
          {{ loading ? '正在加载歌词…' : player.current ? '当前歌曲没有歌词（需要与音频同目录的同名 .lrc 文件）' : '未在播放' }}
        </div>
        <div v-if="lyricSourceLabel" class="lyric-badge">
          <span class="badge-tag">词</span>
          <span class="badge-src">{{ lyricSourceLabel }}</span>
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

/* 底部稍压暗，保证迷你条与歌词可读 —— 已在 palette.renderAmbientUrl 烘焙进图内，无需单独压暗层 */

/* ---------- 字号调节器（挂在左栏底部小按钮行，菜单向上弹） ---------- */
.fs-picker {
  position: relative;
}

.fs-menu {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  margin-left: -64px;
  min-width: 128px;
  padding: 6px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(32px) saturate(1.4);
  -webkit-backdrop-filter: blur(32px) saturate(1.4);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 12px 32px rgba(70, 58, 34, 0.16);
  display: flex;
  flex-direction: column;
  gap: 2px;
  transform-origin: bottom center;
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

.fs-pop-enter-active {
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-spring);
}

.fs-pop-leave-active {
  transition: opacity 100ms var(--ease-out), transform 100ms var(--ease-out);
}

.fs-pop-enter-from,
.fs-pop-leave-to {
  opacity: 0;
  transform: scale(0.92) translateY(4px);
}

/* ---------- 双栏主体：左栏信息+控制（约45%），右栏歌词 ---------- */
.layout {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
}

.info-col {
  --cover-w: min(46vh, 30vw);
  width: 45%;
  min-width: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 34px 36px 26px;
}

.track-head {
  align-self: stretch;
}

.track-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--lyric-text-active);
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-artist {
  margin-top: 5px;
  font-size: 13px;
  color: var(--lyric-time);
}

.cover-stack {
  margin: auto 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

/* 切歌切换动画：封面平滑缩入 + 歌词上浮淡入 */
.cover-main {
  position: relative;
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
}

.format-line {
  min-height: 16px;
  font-size: 12px;
  color: var(--lyric-time);
  letter-spacing: 0.4px;
  font-variant-numeric: tabular-nums;
}

/* ---------- 进度条（左栏、与封面同宽） ---------- */
.progress-block {
  width: var(--cover-w);
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

/* ---------- 大号三键控制 ---------- */
.controls {
  display: flex;
  align-items: center;
  gap: 28px;
  margin-top: 20px;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  color: var(--lyric-control);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out),
    transform var(--dur-fast) var(--ease-spring);
}

.ctrl-btn:hover {
  color: var(--lyric-control-hover);
  background: var(--lyric-control-bg);
}

.ctrl-btn:active {
  transform: scale(0.9);
}

.ctrl-btn.play {
  color: var(--lyric-play-icon);
}

/* ---------- 左栏底部小按钮行：播放模式 / 音量 / 字号 / 退出 ---------- */
.sub-row {
  margin-top: auto;
  padding-top: 20px;
  display: flex;
  align-items: center;
  gap: 26px;
}

.sub-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: var(--lyric-control);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out),
    transform var(--dur-fast) var(--ease-spring);
}

.sub-btn:hover {
  color: var(--lyric-control-hover);
  background: var(--lyric-control-bg);
}

.sub-btn:active {
  transform: scale(0.9);
}

.sub-btn.mode:active {
  transform: scale(0.9) rotate(-14deg);
}

.sub-btn .aa {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1;
}

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
  width: 72px;
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

/* ---------- 右栏歌词 ---------- */
.lyric-col {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
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

/* 歌词来源徽标（右栏左下角）：词 LRC / 词 EMBEDDED */
.lyric-badge {
  position: absolute;
  left: 4vw;
  bottom: 26px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--lyric-time);
  letter-spacing: 0.5px;
}

.badge-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  border: 1px solid currentColor;
  border-radius: 5px;
  font-size: 11px;
}

/* ---------- 迷你播放条已移除：进度与控制键并入左栏（对照参考排版） ---------- */
</style>
