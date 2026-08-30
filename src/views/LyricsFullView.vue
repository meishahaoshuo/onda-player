<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import CoverImage from '@/components/CoverImage.vue'
import { readLrcFile } from '@/services/fs'
import { parseLrc, type LyricGroup } from '@/services/lyrics'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

/**
 * 全屏歌词页（对照截图 1）：封面模糊背景、封面倒影、
 * 双语逐行歌词（当前行高亮居中滚动、点击行跳转）。
 */
const player = usePlayerStore()
const ui = useUiStore()

const groups = ref<LyricGroup[]>([])
const loading = ref(false)

watch(
  () => player.currentPath,
  async (path) => {
    groups.value = []
    const song = player.current
    if (!path || !song) return
    loading.value = true
    const content = await readLrcFile(song.rootId, path.slice(song.rootId.length + 1))
    groups.value = content ? parseLrc(content) : []
    loading.value = false
  },
  { immediate: true },
)

/* 当前行：最后一个 time <= currentTime 的组 */
const activeIdx = computed(() => {
  if (groups.value.length === 0) return -1
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

/* 自动居中滚动 */
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

watch(activeIdx, async () => {
  await nextTick()
  const container = scroller.value
  const el = lineEls.value[activeIdx.value]
  if (!container || !el) return
  const offset = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2
  container.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
})

/* 行透明度：按与当前行的距离递减 */
function lineClass(i: number) {
  const d = Math.abs(i - activeIdx.value)
  return {
    active: d === 0,
    [`dim-${Math.min(d, 4)}`]: d > 0,
  }
}

const hasLyrics = computed(() => groups.value.length > 0)

function close() {
  ui.lyricsOpen = false
}
</script>

<template>
  <div class="lyrics-full">
    <!-- 背景：封面铺满 + 大半径模糊 + 压暗层 -->
    <div class="bg">
      <CoverImage :cover-id="player.current?.coverId ?? null" :size="1024" class="bg-cover" />
      <div class="bg-overlay" />
    </div>

    <!-- 顶栏 -->
    <header class="topbar">
      <div class="song-info">
        <div class="song-title">{{ player.current?.title ?? '未在播放' }}</div>
        <div class="song-artist">{{ player.current?.artist ?? '' }}</div>
      </div>
      <button class="icon-btn close-btn" title="退出全屏歌词" @click="close">
        <AppIcon name="close" :size="20" />
      </button>
    </header>

    <!-- 主体：封面 + 歌词 -->
    <div class="main" :class="{ 'no-lyrics': !hasLyrics }">
      <div class="cover-wrap" v-if="player.current">
        <div class="cover-main">
          <CoverImage :cover-id="player.current.coverId" :size="320" />
        </div>
        <!-- 倒影：翻转 + 渐变遮罩 -->
        <div class="cover-reflection">
          <CoverImage :cover-id="player.current.coverId" :size="320" />
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
        {{ loading ? '正在加载歌词…' : player.current ? '当前歌曲没有歌词' : '未在播放' }}
      </div>
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
  background: var(--bg-base); /* 封面模糊层之下的不透明底色，避免无封面时透穿 */
}

/* 背景 */
.bg {
  position: absolute;
  inset: 0;
}

.bg-cover {
  width: 100%;
  height: 100%;
}

.bg-cover :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(72px) saturate(1.3) brightness(0.7);
  transform: scale(1.3);
}

/* 无封面时背景只保留底色，不渲染占位图标 */
.bg-cover :deep(.cover-fallback) {
  display: none;
}

.bg-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.25), rgba(0, 0, 0, 0.45));
}

/* 顶栏 */
.topbar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
}

.song-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.song-artist {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.close-btn {
  color: rgba(255, 255, 255, 0.75);
}

.close-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
}

/* 主体 */
.main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 48px;
  padding: 0 48px 48px;
}

.main.no-lyrics {
  gap: 0;
}

/* 封面 + 倒影 */
.cover-wrap {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.cover-main :deep(img),
.cover-main :deep(.cover-fallback) {
  width: min(38vh, 38vw);
  height: min(38vh, 38vw);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}

.cover-reflection {
  transform: scaleY(-1) translateY(-8px);
  opacity: 0.25;
  mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent 55%);
  -webkit-mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent 55%);
  pointer-events: none;
}

.cover-reflection :deep(img),
.cover-reflection :deep(.cover-fallback) {
  width: min(38vh, 38vw);
  height: min(38vh, 38vw);
  border-radius: 12px;
}

/* 歌词 */
.lyric-scroll {
  height: 100%;
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  mask-image: linear-gradient(transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(transparent, #000 12%, #000 88%, transparent);
  scrollbar-width: none;
}

.lyric-scroll::-webkit-scrollbar {
  display: none;
}

.lyric-inner {
  padding: 40vh 8px;
  display: flex;
  flex-direction: column;
  gap: 26px;
}

.lyric-line {
  cursor: pointer;
  transition: opacity 0.3s, transform 0.3s;
}

.lyric-line.dim-1 { opacity: 0.55; }
.lyric-line.dim-2 { opacity: 0.38; }
.lyric-line.dim-3 { opacity: 0.26; }
.lyric-line.dim-4 { opacity: 0.18; }

.lyric-line:hover {
  opacity: 1;
}

.lyric-line.active .lyric-text {
  font-size: 28px;
  font-weight: 600;
  color: #fff;
}

.lyric-text {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.5;
  transition: font-size 0.25s, color 0.25s;
}

.lyric-text.sub {
  font-size: 14px;
  opacity: 0.8;
}

.lyric-line.active .lyric-text.sub {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.9);
}

.no-lyrics-hint {
  color: rgba(255, 255, 255, 0.6);
  font-size: 15px;
}
</style>
