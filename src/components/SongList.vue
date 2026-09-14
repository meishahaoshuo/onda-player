<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import VirtualList from '@/components/VirtualList.vue'
import CoverImage from '@/components/CoverImage.vue'
import QualityBadge from '@/components/QualityBadge.vue'
import AppIcon from '@/components/AppIcon.vue'
import LocateFab from '@/components/LocateFab.vue'
import { formatDuration } from '@/utils/format'
import { useSongActions } from '@/composables/useSongActions'
import { claimListReveal } from '@/composables/useStaggerReveal'
import { useFavoritesStore } from '@/stores/favorites'
import { flyToPlayerFromRow } from '@/services/coverFlight'
import type { SongRecord } from '@/types'

const props = defineProps<{
  songs: SongRecord[]
  currentPath?: string | null
  persistKey?: string
  hideRowActions?: boolean
  playlistId?: string
  /** 选择态（批量操作）：行首封面换成勾选框、行点击改为切换勾选，选中集由父组件持有 */
  selecting?: boolean
  selectedPaths?: Set<string>
}>()
const emit = defineEmits<{ play: [song: SongRecord]; pick: [song: SongRecord] }>()

const ROW_HEIGHT = 56

const { openSongMenu } = useSongActions()
const favorites = useFavoritesStore()

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
  // 选择态：整行是勾选开关，不做封面飞行与播放
  if (props.selecting) {
    emit('pick', song)
    return
  }
  flyToPlayerFromRow(e)
  emit('play', song)
}

function onRowMenu(song: SongRecord, e: MouseEvent) {
  // playlistId（歌单详情内）：菜单追加「从歌单移除」等歌单项
  openSongMenu(e, song, { context: props.songs, playlistId: props.playlistId })
}

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
  <div class="song-list">
    <div class="list-body">
      <VirtualList :items="props.songs" :item-height="ROW_HEIGHT" :persist-key="props.persistKey">
        <template #default="{ item, index }">
          <div
            class="song-row"
            :class="{
              playing: item.path === props.currentPath,
              selecting: props.selecting,
              picked: props.selecting && props.selectedPaths?.has(item.path),
              'stagger-row': booting && index < MAX_REVEAL_ROWS,
            }"
            :style="{ height: `${ROW_HEIGHT}px`, '--reveal-i': index }"
            @click="onRowClick(item, $event)"
            @mouseenter="onRowHover"
            @contextmenu.prevent="onRowMenu(item, $event)"
          >
            <span class="col-cover" data-flight-cover>
              <span
                v-if="props.selecting"
                class="row-check"
                :class="{ on: props.selectedPaths?.has(item.path) }"
              >
                <AppIcon v-if="props.selectedPaths?.has(item.path)" name="check" :size="12" />
              </span>
              <CoverImage v-else :cover-id="item.coverId" :size="40" />
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
              <!-- 悬停快捷操作：锚在标题列右端空白（标题与艺术家列之间）；hideRowActions 时整体隐藏 -->
              <span v-if="!props.hideRowActions" class="row-actions" @click.stop>
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

    <!-- 定位悬浮球：正在播放的行滚出视野时浮现，点击回中（外观在设置里选，见 LocateFab） -->
    <LocateFab :songs="songs" :current-path="currentPath" />
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

/* 选择态（批量操作）：整行可点、已选行用强调色底（写在 :hover 之后，
   同特异性下后者胜出，悬停不会把已选色冲掉） */
.song-row.selecting {
  cursor: pointer;
}

.song-row.picked {
  background: var(--accent-soft);
}

.song-row.selecting .col-cover {
  justify-content: center;
}

/* 勾选框：替掉行首封面（列宽 56 不变，行几何不动） */
.row-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1.5px solid var(--text-tertiary);
  color: var(--accent-text);
  transition: background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.row-check.on {
  background: var(--accent);
  border-color: var(--accent);
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

/* 选择态下不收行内快捷操作（批量动作统一在工具条上）。
   特异性 (0,4,0) 高于上面的悬停规则，位置无关 */
.song-row.selecting:hover .row-actions,
.song-row.selecting:focus-within .row-actions {
  opacity: 0;
  pointer-events: none;
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
</style>
