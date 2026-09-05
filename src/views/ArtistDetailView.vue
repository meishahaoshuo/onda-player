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
  await playAlbumExit(rootEl.value)
  ui.closeDetail()
  ui.endDolly()
}

const artist = computed(() => library.artists.find((a) => a.name === props.artistName))

function onPlay(song: SongRecord) {
  if (artist.value) void player.playSong(song, artist.value.songs)
}
</script>

<template>
  <div v-if="artist" ref="rootEl" class="artist-detail" :class="{ revealed }">
    <button class="back-btn" @click="close">
      <AppIcon name="close" :size="14" /> 返回艺术家列表
    </button>
    <header class="artist-header">
      <CoverImage :cover-id="artist.coverId" :size="120" class="header-cover" />
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

.artist-detail > .back-btn,
.artist-detail > .artist-header {
  flex-shrink: 0;
}

/* 内容初始隐藏，由 pageTransition 的波前时序接管；.revealed 兜底直接显示 */
.artist-detail .back-btn,
.artist-detail .header-info {
  opacity: 0;
}

.artist-detail.revealed .back-btn,
.artist-detail.revealed .header-info {
  opacity: 1;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: 6px;
}

.back-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.artist-header {
  display: flex;
  align-items: center;
  gap: 20px;
}

/* 艺术家封面圆形（与网格卡片一致），也是封面飞行的落点 */
.header-cover :deep(img),
.header-cover :deep(.cover-fallback) {
  border-radius: 50%;
  box-shadow: var(--shadow-1);
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
  .artist-detail .back-btn,
  .artist-detail .header-info {
    opacity: 1;
  }
}
</style>
