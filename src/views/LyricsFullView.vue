<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import CoverImage from '@/components/CoverImage.vue'
import ProgressSlider from '@/components/ProgressSlider.vue'
import { readLrcFile } from '@/services/fs'
import { parseLrc, type LyricGroup } from '@/services/lyrics'
import { makeAmbientGradient } from '@/services/palette'
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

/* ---------- 封面环境渐变（CSS 字符串：多 radial-gradient 焦点 + base 色） ---------- */

const bgImage = ref<string | null>(null)
const bgShown = ref(false)
const bgCache = new Map<string, string>()

function revealBg() {
  requestAnimationFrame(() => {
    bgShown.value = true
  })
}

watch(
  () => player.current?.coverId ?? null,
  async (coverId) => {
    if (!coverId) {
      bgImage.value = null
      bgShown.value = false
      return
    }
    // 渐变立即挂 DOM + 立即 reveal：淡入和飞行是并行的（280ms vs 560ms），
    // 飞行落地时背景已基本可见，没有"飞行后还要等半秒"的延迟感。
    const apply = (css: string) => {
      bgImage.value = css
      revealBg()
    }
    const cached = bgCache.get(coverId)
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
      const css = await makeAmbientGradient(blob)
      bgCache.set(coverId, css)
      apply(css)
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

watch(
  () => player.currentPath,
  async (path) => {
    lyricsSettled.value = false
    switching.value = true // 切歌：内容淡出
    switchStart = performance.now()
    groups.value = []
    const song = player.current
    if (!path || !song) {
      lyricsSettled.value = true
      switching.value = false // 未播放时不应停留在淡出态
      return
    }
    loading.value = true
    scroller.value?.scrollTo({ top: 0 })

    // 优先同目录 .lrc 文件，其次音频内嵌歌词
    const lrc = await readLrcFile(song.rootId, path.slice(song.rootId.length + 1))
    if (lrc && lrc.trim()) {
      groups.value = parseLrc(lrc)
    } else if (song.embeddedLyrics) {
      groups.value = parseEmbeddedLyrics(song.embeddedLyrics)
    }
    loading.value = false
    lyricsSettled.value = true
    await nextTick()
    // 保证淡出阶段真正可见（至少 260ms）再淡入，切歌才有丝滑过场
    const elapsed = performance.now() - switchStart
    window.setTimeout(() => {
      switching.value = false
    }, Math.max(0, 260 - elapsed))
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

/* 迷你播放条 */
const MODE_META: { mode: PlayMode; icon: 'repeat' | 'repeatOne' | 'shuffle'; label: string }[] = [
  { mode: 'order', icon: 'repeat', label: '顺序播放' },
  { mode: 'loop', icon: 'repeat', label: '列表循环' },
  { mode: 'one', icon: 'repeatOne', label: '单曲循环' },
  { mode: 'shuffle', icon: 'shuffle', label: '随机播放' },
]
const modeMeta = computed(() => MODE_META.find((m) => m.mode === player.playMode)!)

function cycleMode() {
  const idx = MODE_META.findIndex((m) => m.mode === player.playMode)
  player.setPlayMode(MODE_META[(idx + 1) % MODE_META.length].mode)
}

const progressDuration = computed(() => player.duration || player.current?.durationSec || 0)

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

/** 轮询等待条件成立，最多等 timeout 毫秒 */
async function waitUntil(pred: () => boolean, timeout: number) {
  const t0 = performance.now()
  while (!pred() && performance.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 30))
  }
}

/** 落地后的收尾：恢复真实封面、清掉飞行层、补上歌词定位 */
function settleFly(flying: HTMLElement | null, dstEl: HTMLElement | null) {
  if (dstEl) dstEl.style.opacity = '1'
  if (flying) {
    flying.style.willChange = ''
    flying.remove()
  }
  flyActive.value = false
  requestAnimationFrame(() => scrollToActive(false))
}

function flyIn() {
  void (async () => {
    flyActive.value = true
    await nextTick()
    // 如果已有缓存渐变（切歌时的预取或上次浏览），立即 reveal：
    // 280ms 透明度淡入与飞行 (560ms) 并行，落地时背景已基本可见。
    if (bgImage.value) revealBg()

    // 1) 等歌词加载完成（布局稳定），否则取到的目标坐标是歌词为空时的旧位置，
    //    飞过去后会再被布局推到真实位置 → 卡顿。有歌词/无歌词都靠 lyricsSettled。
    // 2) 同时给高清封面留一点时间：飞行途中显示的就是最终那张图，落地不跳清晰度。
    const coverId = player.current?.coverId ?? null
    await Promise.all([
      waitUntil(() => lyricsSettled.value, 450),
      coverId
        ? Promise.race([
            library.coverUrlHi(coverId).catch(() => null),
            new Promise((r) => setTimeout(r, 220)),
          ])
        : Promise.resolve(),
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
    flying.style.boxShadow = '0 24px 64px rgba(0,0,0,0.45)'
    flying.style.zIndex = '60'
    flying.style.pointerEvents = 'none'
    flying.style.willChange = 'transform'
    flying.style.transformOrigin = 'center center'
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
        boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
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
  <div class="lyrics-full" :class="{ closing }">
    <!-- 背景：纯深色底 + 多焦点 radial-gradient 层（环境光晕） -->
    <div class="bg" />
    <div
      v-if="bgImage"
      class="bg-grad"
      :class="{ show: bgShown }"
      :style="{ backgroundImage: bgImage }"
    />

    <!-- 右上角工具组：字号调节 + 退出 -->
    <div class="top-tools">
      <div class="fs-picker" :class="{ open: fsOpen }">
        <button
          class="icon-btn tool-btn"
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
      <button class="icon-btn tool-btn" title="退出全屏歌词" @click="closeWithFade">
        <AppIcon name="close" :size="20" />
      </button>
    </div>

    <!-- 主体：封面在左，歌词在右 -->
    <div class="main" :class="{ switching, 'fly-active': flyActive }">
      <div class="cover-col">
        <div class="cover-main" v-if="player.current">
          <CoverImage :cover-id="player.current.coverId" :size="360" hires />
        </div>
      </div>

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
            <div v-for="(text, j) in g.texts" :key="j" class="lyric-text" :class="{ sub: j > 0 }">
              {{ text }}
            </div>
          </div>
        </div>
      </div>
      <div v-else class="no-lyrics-hint">
        {{ loading ? '正在加载歌词…' : player.current ? '当前歌曲没有歌词（需要与音频同目录的同名 .lrc 文件）' : '未在播放' }}
      </div>
    </div>

    <!-- 底部居中：液态玻璃迷你播放条 -->
    <footer class="mini-bar">
      <div class="mini-progress">
        <ProgressSlider
          :current="player.currentTime"
          :duration="progressDuration"
          @seek="player.seek"
        />
      </div>
      <div class="mini-left">
        <div class="mini-title">{{ player.current?.title ?? '未在播放' }}</div>
        <div class="mini-time">
          {{ formatDuration(player.currentTime) }} / {{ formatDuration(player.duration || player.current?.durationSec || 0) }}
        </div>
      </div>
      <div class="mini-controls">
        <button class="mini-btn" :title="modeMeta.label" @click="cycleMode">
          <AppIcon :name="modeMeta.icon" :size="17" />
        </button>
        <button class="mini-btn" title="上一曲" @click="player.prev()">
          <AppIcon name="prev" :size="18" />
        </button>
        <button
          class="mini-btn play"
          :title="player.playing ? '暂停' : '播放'"
          @click="player.current ? player.togglePlay() : player.resumePlay()"
        >
          <AppIcon :name="player.playing ? 'pause' : 'play'" :size="20" />
        </button>
        <button class="mini-btn" title="下一曲" @click="player.next()">
          <AppIcon name="next" :size="18" />
        </button>
        <button class="mini-btn" :title="`音量 ${player.volume}%`" @click="player.setVolume(player.volume === 0 ? 80 : 0)">
          <AppIcon :name="player.volume === 0 ? 'volumeMute' : 'volume'" :size="17" />
        </button>
        <input
          class="mini-volume"
          type="range"
          min="0"
          max="100"
          :value="player.volume"
          :style="{ '--vol': `${player.volume}%` }"
          title="音量"
          @input="(e) => player.setVolume(Number((e.target as HTMLInputElement).value))"
        />
      </div>
    </footer>
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
  /* 沉浸式深色底：封面模糊层之下，文字固定白色系 */
  background: var(--lyric-bg);
  transition: opacity 240ms var(--ease-out);
}

.lyrics-full.closing {
  opacity: 0;
}

/* ---------- 背景：底色 + 渐变图层（渐变单独一层，用 opacity 淡入） ---------- */
.bg {
  position: absolute;
  inset: 0;
  background: var(--lyric-bg);
}

.bg-grad {
  position: absolute;
  inset: 0;
  /* 多 background-image 已由内联 style 注入（radial 焦点 + linear base 色）。
     radial 焦点天然按容器百分比定位，不需要 cover/scale，再叠一层大模糊让焦点边缘更柔。 */
  filter: blur(60px) saturate(1.4);
  opacity: 0;
  /* 飞行 560ms 完成；淡入缩短到 280ms 与飞行并行，落地时背景已基本可见，
     避免"飞行结束还要等半秒才出现模糊"的延迟感 */
  transition: opacity 280ms var(--ease-out);
  will-change: opacity;
}

.bg-grad.show {
  opacity: 1;
}

/* 底部稍压暗，保证迷你条与歌词可读 */
.bg-grad::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--lyric-shade);
}

/* ---------- 右上角工具组：字号调节 + 退出 ---------- */
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
  color: var(--lyric-control);
  background: var(--lyric-bar-bg);
  backdrop-filter: blur(24px) saturate(1.3);
  -webkit-backdrop-filter: blur(24px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: color 0.15s var(--ease-out), background 0.15s var(--ease-out),
    transform var(--dur-fast) var(--ease-spring);
}

.tool-btn:hover {
  color: var(--lyric-control-hover);
  background: var(--lyric-control-bg);
}

.tool-btn:active {
  transform: scale(0.92);
}

/* 退出按钮 hover 旋转（灵动感：小元素给一点方向性反馈） */
.tool-btn .aa {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1;
}

.top-tools > .tool-btn:last-child:hover :deep(svg) {
  transform: rotate(90deg);
}

.top-tools > .tool-btn:last-child :deep(svg) {
  transition: transform var(--dur-med) var(--ease-spring);
}

/* 字号调节器 */
.fs-picker {
  position: relative;
}

.fs-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  min-width: 128px;
  padding: 6px;
  border-radius: 14px;
  background: rgba(28, 28, 30, 0.82);
  backdrop-filter: blur(32px) saturate(1.4);
  -webkit-backdrop-filter: blur(32px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 2px;
  transform-origin: top right;
}

.fs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 9px;
  color: var(--lyric-text);
  font-size: 13px;
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.fs-item:hover {
  background: rgba(255, 255, 255, 0.1);
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
  transform: scale(0.92) translateY(-4px);
}

/* ---------- 主体：整组以整个页面为基准居中 ---------- */
.main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 96px;
  /* 上下等距内边距 → 内容垂直居中于整个视口（迷你条为浮层，不参与占位） */
  padding: 24px 48px;
}

/* 切歌切换动画：封面与歌词淡出淡入 */
.main .cover-col,
.main .lyric-scroll,
.main .no-lyrics-hint {
  transition: opacity 300ms var(--ease-out), transform 300ms var(--ease-out);
}

.main.switching .cover-col,
.main.switching .lyric-scroll,
.main.switching .no-lyrics-hint {
  opacity: 0;
  transform: translateY(10px);
}

/* 封面飞入期间：封面不参与切歌淡入淡出。
   否则淡入（300ms）会和飞行（560ms）叠加，落地瞬间封面还在半透明 → 观感就是"顿一下"。 */
.main.fly-active .cover-col {
  opacity: 1;
  transform: none;
  transition: none;
}

.cover-col {
  flex-shrink: 0;
}

.cover-main {
  position: relative;
}

.cover-main :deep(img),
.cover-main :deep(.cover-fallback) {
  display: block;
  width: min(42vh, 30vw);
  height: min(42vh, 30vw);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
}

/* ---------- 歌词 ---------- */
.lyric-scroll {
  flex: 0 1 520px;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  mask-image: linear-gradient(transparent, var(--lyric-mask) 15%, var(--lyric-mask) 85%, transparent);
  -webkit-mask-image: linear-gradient(transparent, var(--lyric-mask) 15%, var(--lyric-mask) 85%, transparent);
  scrollbar-width: none;
}

.lyric-scroll::-webkit-scrollbar {
  display: none;
}

.lyric-inner {
  padding: 45vh 12px 55vh;
  display: flex;
  flex-direction: column;
  gap: 30px;
}

/* 景深：只用 opacity + transform 表达远近，不用 filter: blur()。
   blur 会让每一行都成为独立的重绘层，几十行同时过渡时直接掉帧——
   这是旧版"卡顿抽搐"的主因。 */
.lyric-line {
  cursor: pointer;
  opacity: 0.4;
  transform-origin: left center;
  transform: scale(0.95);
  transition: opacity 0.35s var(--ease-out), transform 0.35s var(--ease-out);
}

.lyric-line.dim-1 { opacity: 0.55; }
.lyric-line.dim-2 { opacity: 0.42; }
.lyric-line.dim-3 { opacity: 0.3; }
.lyric-line.dim-4 { opacity: 0.22; }

.lyric-line:hover {
  opacity: 0.85;
}

/* 当前行：字号固定不变（改 font-size 会触发整行重排），
   只放大 + 提亮 + 上浮，全部走合成器 */
.lyric-line.active {
  opacity: 1;
  transform: scale(1);
}

.lyric-line.active .lyric-text {
  color: var(--lyric-text-active);
  text-shadow: var(--lyric-shadow);
}

/* 字号由 --lyric-fs / --lyric-fs-sub 统一控制（歌词页内可调节档位）。
   当前行不再改字号：改 font-size 会触发整行重排，是卡顿源之一。 */
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
  opacity: 0.72;
}

.lyric-line.active .lyric-text.sub {
  color: var(--lyric-text-sub);
  opacity: 0.9;
}

.no-lyrics-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lyric-hint);
  font-size: 15px;
}

/* ---------- 底部轻量悬浮胶囊（方案 A：更透明、更扁、无边界感，溶进背景） ---------- */
.mini-bar {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 440px;
  max-width: 72vw;
  padding: 9px 18px 11px;
  border-radius: 24px;
  background: var(--lyric-bar-bg);
  backdrop-filter: blur(36px) saturate(1.3);
  -webkit-backdrop-filter: blur(36px) saturate(1.3);
  border: none;
  box-shadow: none;
  animation: bar-in 480ms var(--ease-spring) 120ms backwards;
  transition: background 0.3s var(--ease-out);
}

/* 悬停胶囊时轻微提亮，给出可交互暗示 */
.mini-bar:hover {
  background: rgba(28, 28, 30, 0.3);
}

@keyframes bar-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(16px) scale(0.96);
  }
}

/* 迷你条内进度条透明化：极淡的白玻璃，拖拽不突兀 */
.mini-bar :deep(.ps-track) {
  background: var(--lyric-ps-track);
}

.mini-bar :deep(.ps-fill) {
  background: var(--lyric-ps-fill);
}

.mini-bar :deep(.ps-thumb) {
  background: var(--lyric-ps-thumb);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
}

.mini-bar :deep(.pslider.dragging .ps-fill),
.mini-bar :deep(.pslider:hover .ps-fill) {
  background: var(--lyric-ps-fill-hover);
}

.mini-bar :deep(.pslider.dragging .ps-track) {
  background: var(--lyric-ps-track-hover);
}

.mini-progress {
  position: absolute;
  top: 5px;
  left: 22px;
  right: 22px;
}

.mini-left {
  min-width: 0;
}

.mini-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--lyric-text-active);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.mini-time {
  font-size: 11px;
  color: var(--lyric-time);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

.mini-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mini-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: var(--lyric-control);
  transition: background 0.15s, color 0.15s;
}

.mini-btn:hover {
  background: var(--lyric-control-bg);
  color: var(--lyric-control-hover);
}

.mini-btn.play {
  width: 40px;
  height: 40px;
  background: var(--lyric-play-bg);
  color: var(--lyric-play-icon);
}

.mini-btn.play:hover {
  background: var(--lyric-play-bg-hover);
}

/* 音量条默认收起，悬停控件区时从右侧展开——胶囊更紧凑，功能不缺席 */
.mini-volume {
  width: 0;
  height: 4px;
  appearance: none;
  -webkit-appearance: none;
  border-radius: 2px;
  background: linear-gradient(to right, var(--lyric-control) var(--vol, 80%), rgba(255, 255, 255, 0.15) var(--vol, 80%));
  cursor: pointer;
  opacity: 0;
  transition: width var(--dur-med) var(--ease-out), opacity var(--dur-med) var(--ease-out), margin var(--dur-med) var(--ease-out);
}

.mini-controls:hover .mini-volume,
.mini-volume:focus-visible {
  width: 76px;
  opacity: 0.9;
  margin-left: 4px;
}

.mini-volume::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--lyric-text-active);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
  transition: transform var(--dur-fast) var(--ease-spring);
}

.mini-volume:hover::-webkit-slider-thumb {
  transform: scale(1.2);
}
</style>
