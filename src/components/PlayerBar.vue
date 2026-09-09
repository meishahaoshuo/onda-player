<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import CoverImage from './CoverImage.vue'
import ProgressSlider from './ProgressSlider.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useFavoritesStore } from '@/stores/favorites'
import { useSettingsStore, type PlayerStyle } from '@/stores/settings'
import { useSongActions } from '@/composables/useSongActions'
import { useUiStore } from '@/stores/ui'
import { formatDuration } from '@/utils/format'
import type { PlayMode, SongRecord } from '@/types'

/** 底部播放条：液态玻璃 + 拖拽进度 + 队列面板；点封面打开全屏歌词 */
const player = usePlayerStore()
const ui = useUiStore()
const library = useLibraryStore()
const favorites = useFavoritesStore()
const settings = useSettingsStore()
const { openSongMenu } = useSongActions()

const currentFavorited = computed(
  () => !!player.currentPath && favorites.has(player.currentPath),
)

function toggleCurrentFav() {
  if (player.currentPath) favorites.toggle(player.currentPath)
}

/**
 * 切歌时预热当前曲目的高清封面缓存。
 * 实际打开歌词页时是秒出，flyIn 不会再等它，跟转场动画也不抢主线程。
 */
watch(
  () => player.current?.coverId ?? null,
  (coverId) => {
    if (!coverId) return
    const fire = () => { void library.coverUrlHi(coverId).catch(() => null) }
    const ric: ((cb: () => void) => void) | undefined = (window as any).requestIdleCallback
    if (typeof ric === 'function') ric(fire)
    else window.setTimeout(fire, 800)
  },
)


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

function onVolumeInput(e: Event) {
  player.setVolume(Number((e.target as HTMLInputElement).value))
}

const queueOpen = ref(false)

function jumpTo(path: string) {
  const song = player.queue.find((s) => s.path === path)
  if (song) void player.playSong(song)
}

/* ---------- 队列面板：拖拽排序 / 清空 / 定位当前行 ---------- */

const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
const dropAfter = ref(false)
const queueListEl = ref<HTMLElement | null>(null)

/** 打开面板时把当前播放行滚到可见区 */
watch(queueOpen, async (open) => {
  if (!open) return
  await nextTick()
  const el = queueListEl.value?.querySelector('.queue-row.playing')
  el?.scrollIntoView({ block: 'center' })
})

function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }
}

function onDragOver(i: number, e: DragEvent) {
  if (dragIndex.value === null) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const row = e.currentTarget as HTMLElement
  const rect = row.getBoundingClientRect()
  dropAfter.value = e.clientY - rect.top > rect.height / 2
  dragOverIndex.value = i
}

function onDrop(i: number, e: DragEvent) {
  e.preventDefault()
  const from = dragIndex.value
  if (from !== null && from !== i) {
    const target = dropAfter.value ? i + 1 : i
    const adjusted = from < target ? target - 1 : target
    player.moveInQueue(from, adjusted)
  }
  resetDrag()
}

/** dragend 在"松手但没落在有效放置区"时也会触发，缺少它行会卡在拖拽态 */
function onDragEnd() {
  resetDrag()
}

function resetDrag() {
  dragIndex.value = null
  dragOverIndex.value = null
  dropAfter.value = false
}

function onRowMenu(e: MouseEvent, song: SongRecord, i: number) {
  openSongMenu(e, song, { queueIndex: i, context: player.queue })
}

/* ---------- 播放条样式：标准 ⇄ 浮动胶囊（FLIP 连续形变） ---------- */

/** 实际渲染的样式：切换时旧形态连续「收缩/展开」为新形态，无跳变 */
const localStyle = ref<PlayerStyle>(settings.playerStyle)
const barEl = ref<HTMLElement | null>(null)
let morphing = false

watch(
  () => settings.playerStyle,
  async (nv) => {
    if (morphing || nv === localStyle.value) return
    morphing = true
    const bar = barEl.value
    if (!bar) {
      localStyle.value = nv
      morphing = false
      return
    }
    const toCapsule = nv === 'capsule'
    // 胶囊形态的 CSS 定位含 translateX(-50%)，动画帧必须携带
    const anchor = nv === 'capsule' ? 'translateX(-50%) ' : ''
    const wasAnchor = localStyle.value === 'capsule' ? 'translateX(-50%) ' : ''
    const gather = settings.barMorph === 'gather'

    if (gather) {
      // 聚散：当前形态向中心收缩溶解，新形态自中心绽放
      await bar
        .animate(
          [
            { opacity: 1, transform: `${wasAnchor}scale(1)` },
            { opacity: 0, transform: `${wasAnchor}scale(0.62)` },
          ],
          { duration: 190, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
        )
        .finished.catch(() => {})
      localStyle.value = nv
      await nextTick()
      bar.getAnimations().forEach((a) => a.cancel())
      bar.animate(
        [
          { opacity: 0, transform: `${anchor}scale(0.62)` },
          { opacity: 1, transform: `${anchor}scale(1)` },
        ],
        { duration: 460, easing: 'cubic-bezier(0.3, 1.3, 0.4, 1)' },
      )
    } else {
      // 交叉滑移：当前形态下滑淡出，新形态自下滑入
      await bar
        .animate(
          [
            { opacity: 1, transform: `${wasAnchor}translateY(0)` },
            { opacity: 0, transform: `${wasAnchor}translateY(46px)` },
          ],
          { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
        )
        .finished.catch(() => {})
      localStyle.value = nv
      await nextTick()
      bar.getAnimations().forEach((a) => a.cancel())
      bar.animate(
        [
          { opacity: 0, transform: `${anchor}translateY(40px)` },
          { opacity: 1, transform: `${anchor}translateY(0)` },
        ],
        { duration: 430, easing: 'cubic-bezier(0.22, 1.2, 0.36, 1)' },
      )
    }
    morphing = false
  },
)

onMounted(() => {
  // 首挂载入场（CSS 动画已移除，由这里播一次）
  barEl.value
    ?.animate(
      [
        { opacity: 0, transform: 'translateY(26px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 560, easing: 'cubic-bezier(0.3, 1.3, 0.5, 1)', delay: 100, fill: 'backwards' },
    )
    .finished.catch(() => {})
})

/* ---------- 胶囊进度环：沿胶囊边缘的进度描边，点击/拖拽 seek ---------- */

const ringDragging = ref(false)
const progressLineEl = ref<HTMLElement | null>(null)
const ringPct = computed(() => {
  const dur = player.duration || player.current?.durationSec || 0
  return dur > 0 ? Math.min(1, Math.max(0, player.currentTime / dur)) : 0
})

function seekFromClientX(cx: number) {
  const line = progressLineEl.value
  if (!line) return
  const dur = player.duration || player.current?.durationSec || 0
  if (dur <= 0) return
  const r = line.getBoundingClientRect()
  const pct = Math.min(1, Math.max(0, (cx - r.left) / r.width))
  player.seek(pct * dur)
}

function onRingPointerDown(e: PointerEvent) {
  ringDragging.value = true
  // 合成指针（自动化测试）没有活动 pointer id，capture 失败不应阻断 seek
  try {
    progressLineEl.value?.setPointerCapture(e.pointerId)
  } catch {
    /* 忽略 */
  }
  seekFromClientX(e.clientX)
}

function onRingPointerMove(e: PointerEvent) {
  if (ringDragging.value) seekFromClientX(e.clientX)
}

function onRingPointerUp() {
  ringDragging.value = false
}
</script>

<template>
  <footer
    ref="barEl"
    class="player-bar glass"
    :class="{
      capsule: localStyle === 'capsule',
      'glass-frost': localStyle === 'capsule' && settings.capsuleGlass === 'frost',
    }"
    @pointermove="onRingPointerMove"
    @pointerup="onRingPointerUp"
    @pointercancel="onRingPointerUp"
  >
    <!-- 胶囊模式：顶部一条低调的进度细线，鼠标悬停胶囊时才显现；点击/拖拽 seek -->
    <div
      v-if="localStyle === 'capsule'"
      ref="progressLineEl"
      class="capsule-progress"
      :class="{ dragging: ringDragging }"
      @pointerdown="onRingPointerDown"
    >
      <div class="cp-track" />
      <div class="cp-fill" :style="{ width: `${ringPct * 100}%` }" />
    </div>
    <!-- 左：曲目信息 -->
    <div class="track">
      <CoverImage
        :cover-id="player.current?.coverId ?? null"
        :size="52"
        class="cover clickable"
        title="打开全屏歌词"
        @click="ui.lyricsOpen = true"
      />
      <div class="meta">
        <div class="title-line">
          <span class="title">{{ player.current?.title ?? '未在播放' }}</span>
          <span v-if="player.playing" class="eq" aria-hidden="true">
            <i /><i /><i />
          </span>
        </div>
        <div class="subtitle">{{ player.current?.artist ?? '选择文件夹以添加音乐' }}</div>
      </div>
    </div>

    <!-- 中：控制区 -->
    <div class="controls">
      <ProgressSlider
        :current="player.currentTime"
        :duration="player.duration || player.current?.durationSec || 0"
        @seek="player.seek"
      />
      <div class="buttons">
        <button class="icon-btn" :title="modeMeta.label" @click="cycleMode">
          <AppIcon :name="modeMeta.icon" />
        </button>
        <button class="icon-btn" title="上一曲" @click="player.prev()">
          <AppIcon name="prev" :size="20" />
        </button>
        <button
          class="icon-btn play-btn"
          :title="player.playing ? '暂停' : '播放'"
          @click="player.current ? player.togglePlay() : player.resumePlay()"
        >
          <AppIcon :name="player.playing ? 'pause' : 'play'" :size="22" />
        </button>
        <button class="icon-btn" title="下一曲" @click="player.next()">
          <AppIcon name="next" :size="20" />
        </button>
        <button class="icon-btn" :class="{ 'is-active': queueOpen }" title="播放队列" @click="queueOpen = !queueOpen">
          <AppIcon name="queue" />
        </button>
      </div>
    </div>

    <!-- 右：辅助区 -->
    <div class="aux">
      <button
        class="icon-btn"
        :class="{ 'fav-active': currentFavorited }"
        :title="currentFavorited ? '取消收藏' : '收藏'"
        :disabled="!player.currentPath"
        @click="toggleCurrentFav"
      >
        <AppIcon name="heart" :class="{ filled: currentFavorited }" />
      </button>
      <button class="icon-btn" title="全屏歌词" @click="ui.lyricsOpen = true">
        <AppIcon name="expand" />
      </button>
      <AppIcon :name="player.volume === 0 ? 'volumeMute' : 'volume'" />
      <input
        class="volume"
        type="range"
        min="0"
        max="100"
        :value="player.volume"
        :style="{ '--vol': `${player.volume}%` }"
        @input="onVolumeInput"
      />
    </div>

    <!-- 播放队列面板 -->
    <Transition name="pop">
      <div v-if="queueOpen" class="queue-panel">
        <div class="queue-head">
          <span>播放队列</span>
          <span class="queue-head-right">
            <span class="queue-count">{{ player.queue.length }} 首</span>
            <button
              v-if="player.queue.length > 0"
              class="queue-clear"
              @click="player.clearQueue(); queueOpen = false"
            >
              清空
            </button>
          </span>
        </div>
        <div ref="queueListEl" class="queue-list">
          <div
            v-for="(song, i) in player.queue"
            :key="song.path"
            class="queue-row"
            :class="{
              playing: song.path === player.currentPath,
              dragging: dragIndex === i,
              'drop-before': dragOverIndex === i && !dropAfter && dragIndex !== i,
              'drop-after': dragOverIndex === i && dropAfter && dragIndex !== i,
            }"
            draggable="true"
            @dragstart="onDragStart(i, $event)"
            @dragover="onDragOver(i, $event)"
            @drop="onDrop(i, $event)"
            @dragend="onDragEnd"
            @click="jumpTo(song.path)"
            @contextmenu.prevent="onRowMenu($event, song, i)"
          >
            <CoverImage :cover-id="song.coverId" :size="32" />
            <span class="queue-title">{{ song.title }}</span>
            <span class="queue-artist">{{ song.artist }}</span>
            <span class="queue-duration">
              <span class="row-actions" @click.stop>
                <button
                  class="row-act"
                  :class="{ active: favorites.has(song.path) }"
                  :title="favorites.has(song.path) ? '取消收藏' : '收藏'"
                  @click="favorites.toggle(song.path)"
                >
                  <AppIcon name="heart" :size="14" :class="{ filled: favorites.has(song.path) }" />
                </button>
                <button class="row-act" title="更多操作" @click="onRowMenu($event, song, i)">
                  <AppIcon name="more" :size="14" />
                </button>
                <button class="row-act" title="从队列移除" @click="player.removeAt(i)">
                  <AppIcon name="close" :size="14" />
                </button>
              </span>
              {{ formatDuration(song.durationSec) }}
            </span>
          </div>
          <div v-if="player.queue.length === 0" class="queue-empty">队列是空的</div>
        </div>
      </div>
    </Transition>
  </footer>
</template>

<style scoped>
.player-bar {
  position: relative;
  /* 高于 .detail-layer(5)：进度条悬浮时间气泡会冒出播放栏顶部，不能被详情覆盖层盖住；
     低于歌词全屏页(50)与菜单/弹窗(100) */
  z-index: 6;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(320px, 2fr) minmax(180px, 1fr);
  align-items: center;
  height: 80px;
  flex-shrink: 0;
  padding: 0 20px;
  gap: 20px;
  /* 入场动画由 onMounted 的 WAAPI 播放（样式切换的 FLIP 形变也由 WAAPI 接管） */
}

/* ---------- 浮动胶囊播放条（悬浮于内容上方，材质可在设置中切换） ---------- */
/* 材质一（默认）：液态玻璃 —— 低模糊高折射，背景内容透出最清晰 */
.player-bar.capsule {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  width: min(760px, calc(100vw - 24px));
  height: 66px;
  gap: 14px;
  padding: 0 18px;
  border-radius: 999px;
  /* 悬浮于列表内容上方；低于歌词页(50)与菜单/弹窗(100) */
  z-index: 40;
  background: linear-gradient(
    120deg,
    rgba(255, 255, 255, 0.1),
    rgba(255, 255, 255, 0.05) 55%,
    rgba(255, 255, 255, 0.09)
  );
  backdrop-filter: blur(20px) saturate(2.6) brightness(1.12);
  -webkit-backdrop-filter: blur(20px) saturate(2.6) brightness(1.12);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow:
    inset 0 1.5px 0 rgba(255, 255, 255, 0.45),
    inset 0 -8px 18px rgba(255, 255, 255, 0.08),
    inset 0 -1px 0 rgba(0, 0, 0, 0.18),
    0 18px 46px rgba(0, 0, 0, 0.45);
  transition: background 420ms var(--ease-out), box-shadow 420ms var(--ease-out),
    backdrop-filter 420ms var(--ease-out), border-color 420ms var(--ease-out);
}

/* 材质二：磨砂玻璃 —— 深色薄纱 + 中度模糊，透出内容只余光影，可读性最稳 */
.player-bar.capsule.glass-frost {
  background: linear-gradient(
    120deg,
    rgba(30, 32, 40, 0.52),
    rgba(24, 26, 34, 0.42) 55%,
    rgba(30, 32, 40, 0.48)
  );
  backdrop-filter: blur(26px) saturate(1.6);
  -webkit-backdrop-filter: blur(26px) saturate(1.6);
  border-color: rgba(255, 255, 255, 0.13);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    0 18px 46px rgba(0, 0, 0, 0.45);
}

/* 顶部进度细线：平时几乎不可见，悬停胶囊时显现 */
.capsule-progress {
  position: absolute;
  top: -1px;
  left: 28px;
  right: 28px;
  height: 6px; /* 热区高度 */
  opacity: 0;
  transition: opacity var(--dur-med) var(--ease-out);
  cursor: pointer;
  touch-action: none;
}

.player-bar.capsule:hover .capsule-progress,
.capsule-progress.dragging {
  opacity: 1;
}

.capsule-progress .cp-track,
.capsule-progress .cp-fill {
  position: absolute;
  top: 2px;
  left: 0;
  height: 2.5px;
  border-radius: 999px;
}

.capsule-progress .cp-track {
  width: 100%;
  background: color-mix(in srgb, var(--text-tertiary) 30%, transparent);
}

.capsule-progress .cp-fill {
  background: var(--accent);
  transition: width 140ms linear;
}

.capsule .track {
  gap: 12px;
  min-width: 0;
}

.capsule .cover.clickable {
  width: 44px;
  height: 44px;
}

/* 进度已移到顶部细线，controls 只留按钮行 */
.capsule .pslider {
  display: none;
}

.capsule .controls {
  gap: 6px;
}

.capsule .buttons {
  gap: 4px;
}

.capsule .play-btn {
  width: 40px;
  height: 40px;
}

.capsule .icon-btn {
  transform: scale(0.92);
}

.capsule .volume {
  width: 72px;
}

/* 左：曲目 */
.track {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.cover.clickable {
  cursor: pointer;
  transition: transform var(--dur-med) var(--ease-spring), box-shadow var(--dur-med) var(--ease-out);
  border-radius: 8px;
}

.cover.clickable:hover {
  transform: scale(1.06) rotate(1deg);
  box-shadow: var(--shadow-2);
}

.meta {
  min-width: 0;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 3px;
}

/* 均衡器动画：全局 .eq 样式（main.css） */

/* 中：控制 */
.controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.play-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
  box-shadow: var(--shadow-1);
  transition: transform var(--dur-fast) var(--ease-spring), background var(--dur-fast) var(--ease-out);
}

.play-btn:hover {
  background: var(--accent-strong);
  transform: scale(1.06);
}

.play-btn:active {
  transform: scale(0.94);
}

/* 右：辅助 */
.aux {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  color: var(--text-secondary);
}

.icon-btn.fav-active {
  color: var(--accent);
}

.icon-btn :deep(svg.filled) {
  fill: currentColor;
}

.volume {
  width: 88px;
  height: 4px;
  appearance: none;
  -webkit-appearance: none;
  border-radius: 2px;
  background: linear-gradient(to right, var(--accent) var(--vol, 80%), var(--bg-hover) var(--vol, 80%));
  cursor: pointer;
}

.volume::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-primary);
  box-shadow: var(--shadow-1);
  transition: transform var(--dur-fast) var(--ease-spring);
}

.volume:hover::-webkit-slider-thumb {
  transform: scale(1.2);
}

/* 队列面板 */
.queue-panel {
  position: absolute;
  right: 16px;
  bottom: calc(100% + 12px);
  width: 380px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-panel);
  overflow: hidden;
  z-index: 30;
  /* 比 .glass 更实一些的底，保证列表文字可读 */
  background: var(--queue-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-2), var(--glass-highlight);
}

.queue-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px 10px;
  font-size: 13px;
  font-weight: 600;
}

.queue-head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.queue-count {
  color: var(--text-secondary);
  font-weight: 400;
  font-size: 12px;
}

.queue-clear {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 2px 8px;
  border-radius: 6px;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.queue-clear:hover {
  background: var(--bg-hover);
  color: var(--danger);
}

.queue-list {
  overflow-y: auto;
  padding: 0 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.queue-row {
  position: relative;
  display: grid;
  grid-template-columns: 32px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 6px 10px;
  border-radius: var(--radius-item);
  text-align: left;
  cursor: grab;
  transition: background var(--dur-fast) var(--ease-out);
}

.queue-row:active {
  cursor: grabbing;
}

.queue-row.dragging {
  opacity: 0.4;
}

.queue-row.drop-before::before,
.queue-row.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
  pointer-events: none;
}

.queue-row.drop-before::before {
  top: -1px;
}

.queue-row.drop-after::after {
  bottom: -1px;
}

.queue-row:hover {
  background: var(--bg-hover);
}

.queue-row.playing {
  background: var(--bg-active);
}

.queue-row.playing .queue-title {
  color: var(--accent);
}

.queue-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-artist {
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 90px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-duration {
  position: relative;
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.queue-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}

/* 队列行悬停快捷操作（收藏/更多/移除）：悬浮在时长左侧，透明底与行背景融为一体 */
.row-actions {
  position: absolute;
  right: calc(100% + 4px);
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transform: translateX(6px);
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.queue-row:hover .row-actions,
.queue-row:focus-within .row-actions {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

.row-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--text-secondary);
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.row-act:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.row-act.active {
  color: var(--accent);
}

.row-act :deep(svg.filled) {
  fill: currentColor;
}
</style>
