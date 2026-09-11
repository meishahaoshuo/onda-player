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
  // 首挂载入场（CSS 动画已移除，由这里播一次）。
  // 胶囊形态 resting transform 含 translateX(-50%)，关键帧必须携带，
  // 否则入场期间水平锚点缺失：胶囊先被顶到 left:50%（偏右），结束回落时
  // 才跳回 CSS 的 translateX(-50%)，表现为「从右边抽搐到中间」。
  const anchor = localStyle.value === 'capsule' ? 'translateX(-50%) ' : ''
  barEl.value
    ?.animate(
      [
        { opacity: 0, transform: `${anchor}translateY(26px)` },
        { opacity: 1, transform: `${anchor}translateY(0)` },
      ],
      { duration: 560, easing: 'cubic-bezier(0.3, 1.3, 0.5, 1)', delay: 100, fill: 'backwards' },
    )
    .finished.catch(() => {})
})

/* ---------- 胶囊进度弧线：沿胶囊边框轮廓走的进度描边，点击/拖拽 seek ---------- */

/** 贴合外框的进度线：沿胶囊外轮廓圆角「平行内缩 2px」描摹。
    坐标系 viewBox 0 0 760 26，与胶囊内宽 758 近似 1:1。
    胶囊外框圆角半径 33、圆心 (33,33)；元素在 border 内侧，故元素坐标里
    圆心 (32,32)、半径 32，内缩 2px 后描摹半径 30。
    路径 = 左圆弧(从 y=20 沿圆角爬升) → 顶部直线(y=2，顶边内缩 2px) → 右圆弧。
    圆弧与直线相切，所以直线段与弯曲段之间是 C1 连续的，没有折角。
    两端只爬到 y=20（距胶囊中线 33 还有 13px），下沉 18px ——
    旧路径一路包到 y=33 下沉 31.5px（用户：弯太多），
    上一版只下沉 8.5px 且断在 x=0（用户：像被硬切一刀），这里取中并且真正贴着圆弧走。 */
const CP_PATH =
  'M 4.5,20 A 30 30 0 0 1 32,2 L 726,2 A 30 30 0 0 1 753.5,20'

const ringDragging = ref(false)
const progressLineEl = ref<HTMLElement | null>(null)
const ringPct = computed(() => {
  const dur = player.duration || player.current?.durationSec || 0
  return dur > 0 ? Math.min(1, Math.max(0, player.currentTime / dur)) : 0
})

/** 拖拽期间用本地 dragPct 即时跟手（纯视觉，60fps 不卡顿）；
    音频 seek 只在按下（跳到点按处）与松手（落到最终位置）各执行一次 */
const dragPct = ref(0)
const displayPct = computed(() => (ringDragging.value ? dragPct.value : ringPct.value))
const cpDash = computed(() => 1 - displayPct.value)
/** 进度为 0 时隐藏填充线：round 线帽在 dash 长度为 0 时仍会画出一个小圆点 */
const cpVisible = computed(() => displayPct.value > 0.004)
/** 三层光晕共用同一份行内样式：dashoffset 驱动进度，进度为 0 时整组隐藏
    （round 线帽在 dash 长度为 0 时仍会画出一个小圆点） */
const cpFillStyle = computed(() => ({
  strokeDashoffset: cpDash.value,
  opacity: cpVisible.value ? undefined : 0,
}))

function pctFromClientX(cx: number): number {
  const line = progressLineEl.value
  if (!line) return 0
  const r = line.getBoundingClientRect()
  if (r.width <= 0) return 0
  return Math.min(1, Math.max(0, (cx - r.left) / r.width))
}

function onRingPointerDown(e: PointerEvent) {
  const dur = player.duration || player.current?.durationSec || 0
  if (dur <= 0) return
  ringDragging.value = true
  // 合成指针（自动化测试）没有活动 pointer id，capture 失败不应阻断 seek
  try {
    progressLineEl.value?.setPointerCapture(e.pointerId)
  } catch {
    /* 忽略 */
  }
  dragPct.value = pctFromClientX(e.clientX)
  player.seek(dragPct.value * dur) // 按下即跳到点按处
}

function onRingPointerMove(e: PointerEvent) {
  if (!ringDragging.value) return
  // 拖动中只推进视觉进度，不反复 seek（频繁跳音频是卡顿感来源）
  dragPct.value = pctFromClientX(e.clientX)
}

function onRingPointerUp() {
  if (!ringDragging.value) return
  const dur = player.duration || player.current?.durationSec || 0
  if (dur > 0) player.seek(dragPct.value * dur) // 松手落到最终位置
  ringDragging.value = false
}

/* 进度线配色已改为跟着主题对比方向走的「玻璃高光 / 压深」——
   深色玻璃提亮（白）、浅色玻璃压深（近黑），不再从封面派生彩色。
   详见下方 .capsule-progress 上的 --cp-line / --cp-rail 定义。 */
</script>

<template>
  <footer
    ref="barEl"
    class="player-bar glass"
    :class="{ capsule: localStyle === 'capsule', 'material-liquid': settings.barMaterial === 'liquid', 'material-frosted': settings.barMaterial === 'frosted', 'ring-dragging': ringDragging }"
    @pointermove="onRingPointerMove"
    @pointerup="onRingPointerUp"
    @pointercancel="onRingPointerUp"
  >
    <!-- 胶囊模式：顶部一条沿胶囊外框微微弯曲的进度线，常驻可见（半透明）、
         悬停胶囊时变清晰加粗；点击/拖拽 seek -->
    <div
      v-if="localStyle === 'capsule'"
      ref="progressLineEl"
      class="capsule-progress"
      :class="{ dragging: ringDragging }"
      @pointerdown="onRingPointerDown"
    >
      <svg class="cp-svg" viewBox="0 0 760 26" preserveAspectRatio="none" aria-hidden="true">
        <!-- 轨道：极淡的细线 -->
        <path class="cp-track" :d="CP_PATH" />
        <!-- 进度「光晕」：三层同心描边叠加（宽而淡 → 窄而亮），
             形成贴在玻璃边框上的一层浅浅的光。
             不用 filter: blur —— 每帧模糊是项目明令禁止的卡顿根因，
             而纯描边叠加在合成上几乎无开销。 -->
        <path class="cp-fill cp-haze" :d="CP_PATH" pathLength="1" :style="cpFillStyle" />
        <path class="cp-fill cp-glow" :d="CP_PATH" pathLength="1" :style="cpFillStyle" />
        <path class="cp-fill cp-core" :d="CP_PATH" pathLength="1" :style="cpFillStyle" />
      </svg>
    </div>
    <!-- 左：曲目信息 -->
    <div class="track">
      <CoverImage
        :cover-id="player.current?.coverId ?? null"
        :size="52"
        class="cover clickable"
        title="打开全屏歌词"
        draggable="false"
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
  /* 悬浮玻璃条：absolute 贴底（不再占布局流），列表内容从玻璃后面滚过——
     有内容可透，blur/白纱的玻璃才真正可见 */
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  /* 高于 .detail-layer(5)：进度条悬浮时间气泡会冒出播放栏顶部，不能被详情覆盖层盖住；
     低于歌词全屏页(50)与菜单/弹窗(100) */
  z-index: 6;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(320px, 2fr) minmax(180px, 1fr);
  align-items: center;
  height: 80px;
  padding: 0 20px;
  gap: 20px;
  /* 材质切换（液态玻璃 ⇄ 普通磨砂）由 material-liquid / material-frosted 提供；
     此处统管过渡，使切换平滑。两种材质都覆盖全局 .glass 的默认面板材质 */
  transition: background 420ms var(--ease-out), box-shadow 420ms var(--ease-out),
    backdrop-filter 420ms var(--ease-out), border-color 420ms var(--ease-out);
}

/* 材质一：液态玻璃 —— 低模糊高折射白纱 + 顶高光，背景内容透出最清晰
   透明度↑：白纱 alpha 压到 3/1.5/2.5%；折射感↑：saturate 3.6 + brightness 1.2 + 顶缘高光更亮 */
.player-bar.material-liquid {
  background: linear-gradient(
    120deg,
    rgba(255, 255, 255, 0.03),
    rgba(255, 255, 255, 0.015) 55%,
    rgba(255, 255, 255, 0.025)
  );
  backdrop-filter: blur(20px) saturate(3.6) brightness(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(3.6) brightness(1.2);
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.36);
  box-shadow:
    inset 0 1.5px 1px rgba(255, 255, 255, 0.62),
    inset 0 -1px 0 rgba(0, 0, 0, 0.16),
    0 -8px 24px rgba(0, 0, 0, 0.22);
}

/* 材质一浅色主题：更薄白纱 + 更强折射，深色细边区分条与背景 */
:global([data-theme='light'] .player-bar.material-liquid) {
  background: linear-gradient(
    120deg,
    rgba(255, 255, 255, 0.08),
    rgba(255, 255, 255, 0.04) 55%,
    rgba(255, 255, 255, 0.065)
  );
  backdrop-filter: blur(18px) saturate(3.1) brightness(1.05);
  -webkit-backdrop-filter: blur(18px) saturate(3.1) brightness(1.05);
  border-top-color: rgba(0, 0, 0, 0.08);
  box-shadow:
    inset 0 1.5px 0 rgba(255, 255, 255, 0.95),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

/* 材质二：普通磨砂 —— 平整半透明底色 + 大模糊，无高折射白纱，观感沉稳 */
.player-bar.material-frosted {
  background: rgba(22, 22, 24, 0.6);
  backdrop-filter: blur(24px) saturate(1.8);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 0.5px 0 rgba(255, 255, 255, 0.16),
    0 -8px 24px rgba(0, 0, 0, 0.28);
}

/* 材质二浅色主题：浅白底 + 深色细边 */
:global([data-theme='light'] .player-bar.material-frosted) {
  background: rgba(246, 246, 248, 0.66);
  backdrop-filter: blur(24px) saturate(1.8);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  border-top-color: rgba(0, 0, 0, 0.08);
  box-shadow:
    inset 0 0.5px 0 rgba(255, 255, 255, 0.8),
    0 -8px 24px rgba(0, 0, 0, 0.1);
}

/* ---------- 浮动胶囊播放条（悬浮于内容上方，材质可在设置中切换） ---------- */
/* 此块只负责「形状」（圆角/尺寸/居中定位），材质底色由上方 material-* 提供，
   边框与投影按材质在下方分别定义，避免 capsule 的边框覆盖掉磨砂材质 */
.player-bar.capsule {
  right: auto;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  width: min(760px, calc(100vw - 24px));
  height: 66px;
  gap: 14px;
  padding: 0 18px;
  border-radius: 999px;
}

/* 胶囊 + 液态玻璃：全边框 + 更强立体投影（折射感↑：边框/顶缘高光更亮，玻璃更「厚」） */
.player-bar.capsule.material-liquid {
  border: 1px solid rgba(255, 255, 255, 0.38);
  box-shadow:
    inset 0 1.5px 1px rgba(255, 255, 255, 0.7),
    inset 0 -10px 22px rgba(255, 255, 255, 0.1),
    inset 0 -1px 0 rgba(0, 0, 0, 0.24),
    0 22px 54px rgba(0, 0, 0, 0.5),
    0 4px 16px rgba(0, 0, 0, 0.2);
}

:global([data-theme='light'] .player-bar.capsule.material-liquid) {
  border: 1px solid rgba(0, 0, 0, 0.1);
  box-shadow:
    inset 0 1.5px 0 rgba(255, 255, 255, 0.98),
    inset 0 0 0 1px rgba(255, 255, 255, 0.6),
    0 18px 46px rgba(0, 0, 0, 0.24),
    0 4px 16px rgba(0, 0, 0, 0.12);
}

/* 胶囊 + 普通磨砂：全边框 + 大模糊投影（边框略弱于液态玻璃，观感更平） */
.player-bar.capsule.material-frosted {
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 0.5px 0 rgba(255, 255, 255, 0.16),
    0 22px 54px rgba(0, 0, 0, 0.5),
    0 4px 16px rgba(0, 0, 0, 0.2);
}

:global([data-theme='light'] .player-bar.capsule.material-frosted) {
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow:
    inset 0 0.5px 0 rgba(255, 255, 255, 0.8),
    0 18px 46px rgba(0, 0, 0, 0.24),
    0 4px 16px rgba(0, 0, 0, 0.12);
}

/* 顶部进度线：平时完全隐藏，鼠标移到它上面（或正在拖拽）才显现。
   线本身沿胶囊外框圆角贴合（见 CP_PATH），元素铺满胶囊内宽与之对齐。
   热区只占顶部 18px —— 旧版是 left/right:0 的整条全宽、高 26px，
   覆盖胶囊 40% 高度，鼠标从上缘进出极易误触发 seek；压到 18px 后
   同时避开了封面主体（封面从 11px 起）。 */
.capsule-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 18px;
  opacity: 0;
  transition: opacity var(--dur-med) var(--ease-out);
  cursor: pointer;
  touch-action: none;
  /* 进度线走「玻璃高光」语义：线色跟随主题的对比方向——
     深色玻璃提亮（白线读起来像玻璃受光），浅色玻璃压深（近黑线）。
     白线照搬到浅色玻璃上会整个隐形，所以两边不能共用一套值。 */
  /* 线色只负责「亮/暗」，柔和不透明度交给各光晕层的 opacity 控制 */
  --cp-line: #ffffff;
  --cp-rail: rgba(255, 255, 255, 0.2);
}

:global([data-theme='light'] .capsule-progress) {
  --cp-line: #14141a;
  --cp-rail: rgba(0, 0, 0, 0.1);
}

.capsule-progress:hover,
.capsule-progress.dragging {
  opacity: 1;
}

/* 拖拽进度期间，内容区与按钮一律不响应指针事件。
   热区只有 18px 高（还要让出封面所在的下半区），拖动中指针极易滑出热区
   落到封面或按钮上；若它们此时仍响应，用户就会感觉「拖进度条反而抓到了封面」。
   配合 setPointerCapture 双保险。 */
.player-bar.ring-dragging .track,
.player-bar.ring-dragging .controls,
.player-bar.ring-dragging .aux {
  pointer-events: none;
}

.capsule-progress .cp-svg {
  display: block;
  width: 100%;
  height: 26px; /* 高于 18px 热区：两端线条画到 y=20，靠 overflow 补全 */
  overflow: visible;
  pointer-events: none; /* 命中一律交给热区容器，避免 svg 自身拦事件 */
}

.capsule-progress .cp-track,
.capsule-progress .cp-fill {
  fill: none;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  transition: stroke-width 180ms var(--ease-out);
}

/* dasharray 只给填充线（它在模板里带 pathLength="1"，故 1 = 整条实线）。
   轨道没有 pathLength，若继承同一条 dasharray:1，会被解析成
   「1px 实线 + 1px 空隙」的密集虚线，轨道凭空淡掉约一半。 */
.capsule-progress .cp-fill {
  stroke-dasharray: 1;
}

.capsule-progress .cp-track {
  stroke: var(--cp-rail);
  stroke-width: 2;
}

/* 光晕三层：宽而淡的 haze 垫底、窄而亮的 core 压面，中间 glow 过渡。
   叠加起来就是「贴在玻璃边框上的一层浅浅的光」——比一根实线柔和得多 */
.capsule-progress .cp-fill {
  stroke: var(--cp-line);
  stroke-linecap: round;
  transition:
    stroke-dashoffset 160ms linear,
    stroke-width 180ms var(--ease-out),
    opacity 180ms var(--ease-out);
}

.capsule-progress .cp-haze {
  stroke-width: 7;
  opacity: 0.1;
}

.capsule-progress .cp-glow {
  stroke-width: 3.5;
  opacity: 0.16;
}

.capsule-progress .cp-core {
  stroke-width: 1.5;
  opacity: 0.85;
}

/* 悬停：光晕整体增强一档，提示「这里可点可拖」 */
.player-bar.capsule:hover .capsule-progress .cp-haze {
  stroke-width: 8;
  opacity: 0.13;
}

.player-bar.capsule:hover .capsule-progress .cp-glow {
  stroke-width: 4.5;
  opacity: 0.2;
}

.player-bar.capsule:hover .capsule-progress .cp-core {
  stroke-width: 2;
  opacity: 0.95;
}

/* 拖拽中：光晕再增强并加粗（进度更醒目、更好瞄准）；
   同时关闭进度过渡，使拖动 100% 跟手（松手恢复平滑跟随播放时钟） */
.player-bar.capsule .capsule-progress.dragging .cp-haze {
  stroke-width: 9;
  opacity: 0.15;
}

.player-bar.capsule .capsule-progress.dragging .cp-glow {
  stroke-width: 5;
  opacity: 0.24;
}

.player-bar.capsule .capsule-progress.dragging .cp-core {
  stroke-width: 2.5;
  opacity: 1;
}

.capsule-progress.dragging .cp-fill {
  transition: none;
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
  /* 关掉 <img> 的原生拖拽与文字选中：否则在进度条上按下后拖到封面，
     浏览器会启动图片 drag，表现为「拖进度条却把小封面拖动了」 */
  -webkit-user-drag: none;
  user-select: none;
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

/* 音量条：极细 3px 线 + 低对比轨道；拇指缩到 8px、去掉投影，
   平时隐藏，仅 hover/聚焦/拖拽时浮出，整体最无感但功能完全正常 */
.volume {
  width: 88px;
  height: 14px; /* 透明命中区，可见线仅 3px 居中 */
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
}

.volume::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--accent) var(--vol, 80%),
    color-mix(in srgb, var(--text-tertiary) 18%, transparent) var(--vol, 80%)
  );
  transition: filter var(--dur-fast) var(--ease-out);
}

/* 克制提示：hover 时整条线微微提亮，无圆点/发光，保持无感 */
.volume:hover::-webkit-slider-runnable-track {
  filter: brightness(1.22);
}

.volume::-moz-range-track {
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-tertiary) 18%, transparent);
  transition: filter var(--dur-fast) var(--ease-out);
}

.volume:hover::-moz-range-track {
  filter: brightness(1.22);
}

.volume::-moz-range-progress {
  height: 3px;
  border-radius: 999px;
  background: var(--accent);
}

.volume::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 8px;
  height: 8px;
  margin-top: -2.5px; /* (3-8)/2 居中于细线 */
  border: none;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-spring);
}

.volume::-moz-range-thumb {
  width: 8px;
  height: 8px;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}

/* 拇指永久隐藏：音量条就是一条随音量填充的细线，彻底无「包裹」感；
   点击/拖拽轨道本身（原生 range 行为）调音量仍正常，填充段实时跟随 */

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
