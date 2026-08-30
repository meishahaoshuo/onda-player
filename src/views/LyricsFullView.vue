<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import CoverImage from '@/components/CoverImage.vue'
import ProgressSlider from '@/components/ProgressSlider.vue'
import { readLrcFile } from '@/services/fs'
import { parseLrc, type LyricGroup } from '@/services/lyrics'
import { makeAmbientGradient } from '@/services/palette'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
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

/* ---------- 封面渐变背景 ---------- */

const bgUrl = ref<string | null>(null)
const bgCache = new Map<string, string>()

watch(
  () => player.current?.coverId ?? null,
  async (coverId) => {
    if (!coverId) {
      bgUrl.value = null
      return
    }
    const cached = bgCache.get(coverId)
    if (cached) {
      bgUrl.value = cached
      return
    }
    try {
      const url = await library.coverUrl(coverId)
      if (!url) return
      const blob = await (await fetch(url)).blob()
      const gradient = await makeAmbientGradient(blob)
      bgCache.set(coverId, gradient)
      bgUrl.value = gradient
    } catch {
      // 取色失败保持深色底
    }
  },
  { immediate: true },
)

const groups = ref<LyricGroup[]>([])
const loading = ref(false)

watch(
  () => player.currentPath,
  async (path) => {
    groups.value = []
    const song = player.current
    if (!path || !song) return
    loading.value = true

    // 优先同目录 .lrc 文件，其次音频内嵌歌词
    const lrc = await readLrcFile(song.rootId, path.slice(song.rootId.length + 1))
    if (lrc && lrc.trim()) {
      groups.value = parseLrc(lrc)
    } else if (song.embeddedLyrics) {
      groups.value = parseEmbeddedLyrics(song.embeddedLyrics)
    }
    loading.value = false
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
const scroller = ref<HTMLElement | null>(null)
const lineEls = ref<(HTMLElement | null)[]>([])

watch(groups, () => {
  lineEls.value = []
})

function setLineEl(i: number) {
  return (el: unknown) => {
    lineEls.value[i] = el instanceof HTMLElement ? el : null
  }
}

/* 自定义缓动滚动：out-quart 700ms，比浏览器原生 smooth 更丝滑 */
let scrollRaf = 0

function smoothScrollTo(container: HTMLElement, target: number) {
  cancelAnimationFrame(scrollRaf)
  const start = container.scrollTop
  const delta = target - start
  const t0 = performance.now()
  const ease = (t: number) => 1 - Math.pow(1 - t, 4)
  const frame = (now: number) => {
    const p = Math.min(1, (now - t0) / 700)
    container.scrollTop = start + delta * ease(p)
    if (p < 1) scrollRaf = requestAnimationFrame(frame)
  }
  scrollRaf = requestAnimationFrame(frame)
}

watch(activeIdx, async () => {
  await nextTick()
  const container = scroller.value
  const el = lineEls.value[activeIdx.value]
  if (!container || !el) return
  const offset = el.offsetTop - container.clientHeight / 3
  smoothScrollTo(container, Math.max(0, offset))
})

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

function close() {
  ui.lyricsOpen = false
}
</script>

<template>
  <div class="lyrics-full">
    <!-- 背景：封面颜色构图拉伸的柔和渐变 -->
    <div class="bg" :class="{ active: bgUrl }" :style="bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined" />

    <!-- 关闭按钮 -->
    <button class="icon-btn close-btn" title="退出全屏歌词" @click="close">
      <AppIcon name="close" :size="20" />
    </button>

    <!-- 主体：封面在左（带倒影），歌词在右 -->
    <div class="main">
      <div class="cover-col">
        <div class="cover-main" v-if="player.current">
          <CoverImage :cover-id="player.current.coverId" :size="360" />
          <!-- 倒影：翻转 + 渐变遮罩 -->
          <div class="cover-reflection">
            <CoverImage :cover-id="player.current.coverId" :size="360" />
          </div>
        </div>
      </div>

      <div v-if="hasLyrics" ref="scroller" class="lyric-scroll">
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
  background: #17191d;
}

/* ---------- 背景 ---------- */
.bg {
  position: absolute;
  inset: 0;
  background: #17191d;
  background-size: cover;
  background-position: center;
}

.bg.active {
  filter: blur(70px) saturate(1.25);
  transform: scale(1.35);
}

/* 底部稍压暗，保证迷你条与歌词可读 */
.bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0.3));
}

/* ---------- 关闭 ---------- */
.close-btn {
  position: absolute;
  top: 18px;
  right: 22px;
  z-index: 2;
  color: rgba(255, 255, 255, 0.75);
}

.close-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
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

/* 倒影脱离文档流：封面本体保持垂直居中 */
.cover-reflection {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  transform: scaleY(-1);
  opacity: 0.28;
  mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent 50%);
  -webkit-mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent 50%);
  pointer-events: none;
}

.cover-reflection :deep(img),
.cover-reflection :deep(.cover-fallback) {
  display: block;
  width: min(42vh, 30vw);
  height: min(42vh, 30vw);
  border-radius: 12px;
}

/* ---------- 歌词 ---------- */
.lyric-scroll {
  flex: 0 1 520px;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  mask-image: linear-gradient(transparent, #000 15%, #000 85%, transparent);
  -webkit-mask-image: linear-gradient(transparent, #000 15%, #000 85%, transparent);
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

.lyric-line {
  cursor: pointer;
  transition: opacity 0.4s var(--ease-out), filter 0.4s var(--ease-out), transform 0.4s var(--ease-out);
}

/* 景深：距离越远越模糊越淡 */
.lyric-line.dim-1 { opacity: 0.5; filter: blur(0.6px); }
.lyric-line.dim-2 { opacity: 0.34; filter: blur(1.2px); }
.lyric-line.dim-3 { opacity: 0.24; filter: blur(2px); }
.lyric-line.dim-4 { opacity: 0.16; filter: blur(3px); }

.lyric-line:hover {
  opacity: 1;
  filter: blur(0);
}

.lyric-line.active {
  transform: scale(1.02);
  transform-origin: left center;
}

.lyric-line.active .lyric-text {
  font-size: 30px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
  transition: font-size 0.35s var(--ease-spring);
}

.lyric-text {
  font-size: 19px;
  color: rgba(255, 255, 255, 0.88);
  line-height: 1.55;
  transition: font-size 0.25s, color 0.25s;
}

.lyric-text.sub {
  font-size: 14px;
  opacity: 0.75;
}

.lyric-line.active .lyric-text.sub {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.92);
}

.no-lyrics-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 15px;
}

/* ---------- 底部液态玻璃迷你播放条 ---------- */
.mini-bar {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 22px;
  min-width: 460px;
  max-width: 72vw;
  padding: 12px 26px 14px;
  border-radius: 24px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-2), var(--glass-highlight);
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
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.mini-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
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
  color: rgba(255, 255, 255, 0.8);
  transition: background 0.15s, color 0.15s;
}

.mini-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.mini-btn.play {
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.92);
  color: #1a1c20;
}

.mini-btn.play:hover {
  background: #fff;
}

.mini-volume {
  width: 76px;
  accent-color: #fff;
  opacity: 0.9;
}
</style>
