<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import VirtualList from '@/components/VirtualList.vue'
import CoverImage from '@/components/CoverImage.vue'
import QualityBadge from '@/components/QualityBadge.vue'
import AppIcon from '@/components/AppIcon.vue'
import { formatDuration } from '@/utils/format'
import { useSongActions } from '@/composables/useSongActions'
import { claimListReveal } from '@/composables/useStaggerReveal'
import { useFavoritesStore } from '@/stores/favorites'
import { usePlayerStore } from '@/stores/player'
import { paletteCache } from '@/services/paletteCache'
import { flyToPlayerFromRow } from '@/services/coverFlight'
import type { SongRecord } from '@/types'

const props = defineProps<{ songs: SongRecord[]; currentPath?: string | null; persistKey?: string }>()
const emit = defineEmits<{ play: [song: SongRecord] }>()

const ROW_HEIGHT = 56

const { openSongMenu } = useSongActions()
const favorites = useFavoritesStore()
const player = usePlayerStore()

/** 首屏错峰浮现：只对「本次会话首次挂载」渲染的行生效。
    虚拟列表滚动时会持续回收/重建行，一旦窗口期结束，行直接显示，滚动不闪动。

    关键：闸门必须是模块作用域（`claimListReveal`），不能是本文件里的变量——
    `<script setup>` 的顶层变量会被编译进 setup()，每个实例各一份，于是
    SongList 随左侧板块切换反复挂载时每次都会重播：前 MAX_REVEAL_ROWS 行重新浮现、
    其余行瞬间出现，看起来就是「上半部分列表在刷新、下半部分还在」。 */
const REVEAL_WINDOW_MS = 900
const MAX_REVEAL_ROWS = 14
const booting = ref(false)
let bootTimer = 0
if (claimListReveal()) {
  booting.value = true
  bootTimer = window.setTimeout(() => (booting.value = false), REVEAL_WINDOW_MS)
}
onBeforeUnmount(() => window.clearTimeout(bootTimer))

function onRowClick(song: SongRecord, e: MouseEvent) {
  flyToPlayerFromRow(e)
  emit('play', song)
}

function onRowMenu(song: SongRecord, e: MouseEvent) {
  openSongMenu(e, song, { context: props.songs })
}

/* ---------- 定位悬浮球「澜·涟漪」（所有用到 SongList 的歌曲列表通用） ----------
   正在播放的行滚出滚动宿主可视区时浮现，点击滚动回中，行回到视野后自动隐藏。
   行高固定 ROW_HEIGHT（VirtualList spacer 纯算术定位），宿主 = closest('.scroll-host')。 */

const listEl = ref<HTMLElement | null>(null)
let hostEl: HTMLElement | null = null
const rowOffscreen = ref(false)

/** 正在播放的歌在本列表中的行号；不在本列表（播放上下文不同）为 -1 */
const playingIndex = computed(() => {
  const p = props.currentPath
  return p ? props.songs.findIndex((s) => s.path === p) : -1
})

/** 行顶边相对滚动宿主内容起点的绝对偏移；测不到返回 null */
function rowTopInHost(): number | null {
  const host = hostEl
  const list = listEl.value
  const idx = playingIndex.value
  if (!host || !list || idx < 0) return null
  const listTop = list.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop
  return listTop + idx * ROW_HEIGHT
}

function measureLocate() {
  const host = hostEl
  const top = rowTopInHost()
  if (!host || top === null) {
    rowOffscreen.value = false
    return
  }
  rowOffscreen.value = top < host.scrollTop - 4 || top + ROW_HEIGHT > host.scrollTop + host.clientHeight + 4
}

function locatePlaying() {
  const host = hostEl
  const top = rowTopInHost()
  if (!host || top === null) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  host.scrollTo({
    top: Math.max(0, top - host.clientHeight / 2 + ROW_HEIGHT / 2),
    behavior: reduced ? 'auto' : 'smooth',
  })
}

watch([playingIndex, () => props.songs.length], () => nextTick(measureLocate))

onMounted(() => {
  hostEl = listEl.value?.closest<HTMLElement>('.scroll-host') ?? null
  hostEl?.addEventListener('scroll', measureLocate, { passive: true })
  window.addEventListener('resize', measureLocate)
  measureLocate()
})

onBeforeUnmount(() => {
  hostEl?.removeEventListener('scroll', measureLocate)
  window.removeEventListener('resize', measureLocate)
  hostEl = null
})

/* 光珠色：当前封面明亮色（取色失败回落主题主色） */
const haloColor = ref('')
let haloSeq = 0
watch(
  () => player.current?.coverId ?? null,
  async (coverId) => {
    const seq = ++haloSeq
    if (!coverId) {
      haloColor.value = ''
      return
    }
    paletteCache.primeNow(coverId)
    const colors = await paletteCache.brightColors(coverId).catch(() => [] as string[])
    if (seq === haloSeq) haloColor.value = colors[0] ?? ''
  },
  { immediate: true },
)

const showLocateFab = computed(() => playingIndex.value >= 0 && rowOffscreen.value)

/** 悬停时测量本行「标题内容」的右端（从标题列左缘算起），写入 --title-end。
    悬停按钮以此为左端点、以标题列右缘为右端点取中，居中在标题与艺术家之间的空白里 */
function onRowHover(e: MouseEvent) {
  const row = e.currentTarget as HTMLElement | null
  const title = row?.querySelector<HTMLElement>('.col-title')
  const line = title?.querySelector<HTMLElement>('.title-line')
  if (!row || !title || !line) return
  const range = document.createRange()
  range.selectNodeContents(line)
  const r = range.getBoundingClientRect()
  const t = title.getBoundingClientRect()
  row.style.setProperty('--title-end', `${Math.max(0, r.right - t.left).toFixed(1)}px`)
}
</script>

<template>
  <div ref="listEl" class="song-list">
    <div class="list-body">
      <VirtualList :items="props.songs" :item-height="ROW_HEIGHT" :persist-key="props.persistKey">
        <template #default="{ item, index }">
          <div
            class="song-row"
            :class="{
              playing: item.path === props.currentPath,
              'stagger-row': booting && index < MAX_REVEAL_ROWS,
            }"
            :style="{ height: `${ROW_HEIGHT}px`, '--reveal-i': index }"
            @click="onRowClick(item, $event)"
            @mouseenter="onRowHover"
            @contextmenu.prevent="onRowMenu(item, $event)"
          >
            <span class="col-cover" data-flight-cover>
              <CoverImage :cover-id="item.coverId" :size="40" />
            </span>
            <span class="col-title">
              <span class="title-line">
                <QualityBadge
                  :container="item.container"
                  :sample-rate-hz="item.sampleRateHz"
                  :bits-per-sample="item.bitsPerSample"
                  :bitrate-kbps="item.bitrateKbps"
                />
                <span class="title-text">{{ item.title }}</span>
              </span>
              <span class="subtitle-text">{{ item.artist }}</span>
              <!-- 悬停快捷操作：锚在标题列右端空白（标题与艺术家列之间） -->
              <span class="row-actions" @click.stop>
                <button
                  class="row-act"
                  :class="{ active: favorites.has(item.path) }"
                  :title="favorites.has(item.path) ? '取消收藏' : '收藏'"
                  @click="favorites.toggle(item.path)"
                >
                  <AppIcon name="heart" :size="15" :class="{ filled: favorites.has(item.path) }" />
                </button>
                <button class="row-act" title="更多操作" @click="onRowMenu(item, $event)">
                  <AppIcon name="more" :size="15" />
                </button>
              </span>
            </span>
            <span class="col-artist" :title="item.artist">{{ item.artist }}</span>
            <span class="col-album" :title="item.album">{{ item.album }}</span>
            <span class="col-duration">{{ formatDuration(item.durationSec) }}</span>
          </div>
        </template>
      </VirtualList>
    </div>

    <!-- 定位悬浮球「澜·涟漪」：正在播放的行滚出视野时浮现（fixed 相对视口，
         横向停在时长列左侧、纵向在播放条上方）。20px 液态玻璃珠（播放条
         material-liquid 同语言 + 封面色内晕染）＋ 球心封面色光珠 ＋ 双道涟漪外扩
         ＋ 球内光尘慢漂；点击滚动回中，行回到视野后自动隐藏 -->
    <Transition name="fab">
      <button
        v-if="showLocateFab"
        class="locate-fab"
        :style="{ '--halo-c': haloColor || 'var(--accent)' }"
        title="定位到正在播放"
        @click="locatePlaying"
      >
        <span class="lf-ripple" aria-hidden="true"></span>
        <span class="lf-ripple r2" aria-hidden="true"></span>
        <i class="lf-dust d1" aria-hidden="true"></i>
        <i class="lf-dust d2" aria-hidden="true"></i>
        <i class="lf-dust d3" aria-hidden="true"></i>
        <i class="lf-dust d4" aria-hidden="true"></i>
        <span class="lf-core" aria-hidden="true"></span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
/* 自然高度：滚动交给外层 .scroll-host 宿主（外层滚动架构）。
   注意不能加 overflow（会计算成 overflow-y:auto），否则本元素成为
   最近滚动容器，虚拟列表的吸附/测量假设全部失效 */
.song-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.list-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.song-row {
  position: relative;
  display: grid;
  grid-template-columns: 56px minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1.2fr) 72px;
  gap: 12px;
  align-items: center;
  padding: 0 12px;
  border-radius: var(--radius-item);
  cursor: default;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.song-row:hover {
  background: var(--bg-hover);
  transform: translateX(2px);
}

.song-row.playing {
  background: var(--bg-active);
}

.song-row.playing .title-text {
  color: var(--accent);
}

.song-row:hover :deep(.cover-img),
.song-row:hover :deep(.cover-fallback) {
  transform: scale(1.08);
}

.song-row :deep(.cover-img),
.song-row :deep(.cover-fallback) {
  transition: transform var(--dur-med) var(--ease-spring);
}

.col-cover {
  display: flex;
}

.col-title {
  min-width: 0;
  position: relative; /* row-actions 的定位基准：锚在标题列右端 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.title-text {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subtitle-text {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-artist,
.col-album {
  min-width: 0;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-duration {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* 悬停快捷操作：水平居中在「标题内容右端（--title-end，悬停时测得）→ 标题列右缘」
   的空白带里——正是标题与艺术家列之间的空白；垂直仍对齐行中线。
   透明底与行背景融为一体，opacity + 位移过渡浮现 */
.row-actions {
  position: absolute;
  top: 50%;
  left: calc(var(--title-end, 70%) + (100% - var(--title-end, 70%)) / 2);
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transform: translate(-50%, -50%) translateX(6px);
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.song-row:hover .row-actions,
.song-row:focus-within .row-actions {
  opacity: 1;
  transform: translate(-50%, -50%) translateX(0);
  pointer-events: auto;
}

.row-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
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

/* 首屏行错峰浮现：窗口期内渲染的行依次上浮淡入。
   用 backwards 而非 forwards：结束后不残留 fill，行上原有的 hover 位移不被压住 */
.song-row.stagger-row {
  animation: row-reveal 340ms var(--ease-out) backwards;
  animation-delay: calc(var(--reveal-i, 0) * 40ms);
}

@keyframes row-reveal {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .song-row.stagger-row {
    animation: none;
  }
}

/* ---------- 定位悬浮球「澜·涟漪」 ----------
   20px 液态玻璃珠（播放条 material-liquid 同语言：白纱 + 高折射 blur/saturate/brightness
   + 顶缘内高光），再叠一层封面色内晕染让玻璃「有光」；球心 4px 封面色光珠，
   两道细涟漪交错外扩（品牌「澜」），球内四粒光尘慢漂（播放条光尘同语言）。
   fixed 相对视口：横向 = 内容右缘(24) + 行右缘(12) + 时长列(72) + 8px 间隙，
   即停在时长列左侧不遮时长；纵向在播放条上方。封面色 --halo-c 行内注入 */
.locate-fab {
  position: fixed;
  right: 116px;
  bottom: 116px; /* 标准条 80px / 胶囊 16+66px 上方都留出间距 */
  z-index: 4; /* 内容之上、详情覆盖层(5)/播放条(6)/弹窗(100) 之下 */
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background:
    radial-gradient(120% 120% at 30% 22%, color-mix(in srgb, var(--halo-c, var(--accent)) 20%, transparent), transparent 62%),
    linear-gradient(120deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02) 55%, rgba(255, 255, 255, 0.035));
  backdrop-filter: blur(20px) saturate(3.6) brightness(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(3.6) brightness(1.2);
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.32),
    inset 0 -1px 2px color-mix(in srgb, var(--halo-c, var(--accent)) 22%, transparent),
    0 6px 18px color-mix(in srgb, var(--halo-c, var(--accent)) 16%, rgba(0, 0, 0, 0.35));
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-spring);
}

/* 浅色主题：更薄白纱 + 更强折射，深色细边区分球与背景（同播放条液态玻璃的浅色处理） */
:global([data-theme='light'] .locate-fab) {
  background:
    radial-gradient(120% 120% at 30% 22%, color-mix(in srgb, var(--halo-c, var(--accent)) 16%, transparent), transparent 62%),
    linear-gradient(120deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05) 55%, rgba(255, 255, 255, 0.08));
  backdrop-filter: blur(18px) saturate(3.1) brightness(1.05);
  -webkit-backdrop-filter: blur(18px) saturate(3.1) brightness(1.05);
  border-color: rgba(0, 0, 0, 0.1);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 -1px 2px color-mix(in srgb, var(--halo-c, var(--accent)) 18%, transparent),
    0 6px 18px color-mix(in srgb, var(--halo-c, var(--accent)) 20%, rgba(0, 0, 0, 0.1));
}

.locate-fab:hover {
  transform: scale(1.12);
}

.locate-fab:active {
  transform: scale(0.92);
}

/* 涟漪：封面色细环从珠心向外漾开，两道 2.6s 交错（呼应品牌「澜」） */
.lf-ripple {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--halo-c, var(--accent)) 60%, transparent);
  opacity: 0;
  animation: lf-rip 2.6s var(--ease-out) infinite;
  pointer-events: none;
}

.lf-ripple.r2 {
  animation-delay: 1.3s;
}

@keyframes lf-rip {
  0% {
    transform: scale(0.6);
    opacity: 0.55;
  }
  70% {
    opacity: 0.12;
  }
  100% {
    transform: scale(2.2);
    opacity: 0;
  }
}

/* 球心：封面色光珠（微光晕） */
.lf-core {
  position: relative;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--halo-c, var(--accent));
  box-shadow: 0 0 5px color-mix(in srgb, var(--halo-c, var(--accent)) 70%, transparent);
}

/* 光尘：1px 圆点 + 一条 box-shadow 画出的亮微粒，球内慢漂（播放条光尘同语言）。
   深色用白亮尘、浅色用封面色微尘（白尘在白玻璃上看不见）；
   基础 transform 是静态散布位（reduced-motion 关动画后不至于叠在球心） */
.lf-dust {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1px;
  height: 1px;
  border-radius: 50%;
  box-shadow: 0 0 1px 0.5px rgba(255, 255, 255, 0.9);
  pointer-events: none;
}

:global([data-theme='light'] .locate-fab .lf-dust) {
  box-shadow: 0 0 1px 0.5px color-mix(in srgb, var(--halo-c, var(--accent)) 90%, transparent);
}

.lf-dust.d1 {
  transform: translate(-5px, -3px);
  animation: lf-drift1 4.5s ease-in-out infinite alternate;
}

.lf-dust.d2 {
  transform: translate(4px, 3px);
  animation: lf-drift2 5.5s ease-in-out infinite alternate;
}

.lf-dust.d3 {
  transform: translate(0, -5px);
  animation: lf-drift3 5s ease-in-out infinite alternate;
}

.lf-dust.d4 {
  transform: translate(-3px, 4px);
  animation: lf-drift2 6s ease-in-out infinite alternate-reverse;
}

@keyframes lf-drift1 {
  from {
    transform: translate(-5px, -3px);
  }
  to {
    transform: translate(4px, 3px);
  }
}

@keyframes lf-drift2 {
  from {
    transform: translate(4px, 3px);
  }
  to {
    transform: translate(-4px, -2px);
  }
}

@keyframes lf-drift3 {
  from {
    transform: translate(0, -5px);
  }
  to {
    transform: translate(-2px, 4px);
  }
}

.fab-enter-active,
.fab-leave-active {
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

@media (prefers-reduced-motion: reduce) {
  .lf-ripple,
  .lf-dust {
    animation: none;
  }

  .lf-ripple {
    opacity: 0;
  }

  .fab-enter-active,
  .fab-leave-active {
    transition: none;
  }
}
</style>
