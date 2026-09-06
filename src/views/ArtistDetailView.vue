<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import CoverImage from '@/components/CoverImage.vue'
import SongList from '@/components/SongList.vue'
import { playAlbumEnter, playAlbumExit } from '@/services/pageTransition'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { formatTotalDuration } from '@/utils/format'
import type { SongRecord } from '@/types'

/**
 * 艺术家详情覆盖层：与专辑详情共用 pageTransition 的「引力坍缩」编排
 * （进入：网格吸入 + 详情析出 + 封面飞行；返回：对称反向）。
 * 由 App.vue 渲染为 .detail-layer 覆盖层，网格常驻不卸载。
 */
const props = defineProps<{ artistName: string }>()

const library = useLibraryStore()
const player = usePlayerStore()
const ui = useUiStore()

const rootEl = ref<HTMLElement | null>(null)
const revealed = ref(false)

watch(
  () => props.artistName,
  async () => {
    revealed.value = false
    await nextTick()
    await playAlbumEnter(rootEl.value)
    revealed.value = true
  },
  { immediate: true, flush: 'post' },
)

async function close() {
  if (ui.dolly !== 'idle') return
  ui.beginDollyExit()
  // 收尾（clearTransitionState / closeDetail / endDolly）由编排器完成
  await playAlbumExit(rootEl.value)
}

const artist = computed(() => library.artists.find((a) => a.name === props.artistName))

function onPlay(song: SongRecord) {
  if (artist.value) void player.playSong(song, artist.value.songs)
}
</script>

<template>
  <div v-if="artist" ref="rootEl" class="artist-detail" :class="{ revealed }">
    <header class="artist-header">
      <!-- 返回艺术家列表：头部右上角的隐藏式关闭钮，悬停浮现 -->
      <button class="header-close" title="返回艺术家列表" aria-label="返回艺术家列表" @click="close">
        <AppIcon name="close" :size="15" />
      </button>
      <div class="header-cover">
        <CoverImage :cover-id="artist.coverId" :size="120" />
      </div>
      <div class="header-info">
        <h1 class="artist-name">{{ artist.name }}</h1>
        <div class="artist-sub">
          {{ artist.songs.length }} 首歌曲 · {{ formatTotalDuration(artist.songs.reduce((s, x) => s + x.durationSec, 0)) }}
        </div>
      </div>
    </header>
    <SongList
      class="list"
      :songs="artist.songs"
      :current-path="player.currentPath"
      :persist-key="`list:artist:${artist.name}`"
      @play="onPlay"
    />
  </div>
  <div v-else class="empty-hint">艺术家不存在</div>
</template>

<style scoped>
/* 根元素同时是 App 传入的 .detail-layer 滚动层。
   歌曲列表需要有界高度才能内部虚拟滚动，故此页不让覆盖层滚动，
   而是 .list 占满剩余高度、由列表内部滚动（滚动位置由 persistKey 记忆）。 */
.artist-detail {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.artist-detail > .artist-header {
  flex-shrink: 0;
}

/* 内容初始隐藏，由 pageTransition 的波前时序接管；.revealed 兜底直接显示 */
.artist-detail .header-info {
  opacity: 0;
}

.artist-detail.revealed .header-info {
  opacity: 1;
}

/* 返回艺术家列表：头部右上角的隐藏式关闭钮，悬停/聚焦时浮现 */
.artist-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
}

.header-close {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--text-secondary);
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.artist-header:hover .header-close,
.header-close:focus-visible {
  opacity: 1;
  transform: translateY(0);
}

.header-close:hover {
  color: var(--text-primary);
  background: var(--bg-active);
}

/* 艺术家封面圆形（与网格卡片一致），也是封面飞行的落点。
   注意 .header-cover 是包一层 div——CoverImage 根上直接挂类的话 :deep 选择器打不到 img。 */
.header-cover {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: var(--shadow-1);
}

.header-cover :deep(img),
.header-cover :deep(.cover-fallback) {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

.artist-name {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
}

.artist-sub {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.list {
  flex: 1;
  min-height: 0;
}

.empty-hint {
  color: var(--text-tertiary);
  padding: 48px 0;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .artist-detail .header-info {
    opacity: 1;
  }

  /* 关闭钮保持默认隐藏（可发现性设计而非动效），只是浮现不做位移过渡 */
  .artist-header .header-close {
    transform: none;
  }
}
</style>
