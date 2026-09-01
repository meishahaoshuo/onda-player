<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import CoverImage from './CoverImage.vue'
import ProgressSlider from './ProgressSlider.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { formatDuration } from '@/utils/format'
import type { PlayMode } from '@/types'

/** 底部播放条：液态玻璃 + 拖拽进度 + 队列面板；点封面打开全屏歌词 */
const player = usePlayerStore()
const settings = useSettingsStore()
const ui = useUiStore()
const library = useLibraryStore()

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

function onVolumeInput(e: Event) {
  player.setVolume(Number((e.target as HTMLInputElement).value))
}

const queueOpen = ref(false)

function jumpTo(path: string) {
  const song = player.queue.find((s) => s.path === path)
  if (song) void player.playSong(song)
}
</script>

<template>
  <footer class="player-bar glass">
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
      <button
        class="icon-btn"
        :title="`主题：${settings.themeMode === 'system' ? '跟随系统' : settings.themeMode === 'dark' ? '深色' : '浅色'}`"
      >
        <AppIcon name="more" />
      </button>
    </div>

    <!-- 播放队列面板 -->
    <Transition name="pop">
      <div v-if="queueOpen" class="queue-panel">
        <div class="queue-head">
          <span>播放队列</span>
          <span class="queue-count">{{ player.queue.length }} 首</span>
        </div>
        <div class="queue-list">
          <button
            v-for="song in player.queue"
            :key="song.path"
            class="queue-row"
            :class="{ playing: song.path === player.currentPath }"
            @click="jumpTo(song.path)"
          >
            <CoverImage :cover-id="song.coverId" :size="32" />
            <span class="queue-title">{{ song.title }}</span>
            <span class="queue-artist">{{ song.artist }}</span>
            <span class="queue-duration">{{ formatDuration(song.durationSec) }}</span>
          </button>
          <div v-if="player.queue.length === 0" class="queue-empty">队列是空的</div>
        </div>
      </div>
    </Transition>
  </footer>
</template>

<style scoped>
.player-bar {
  position: relative;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(320px, 2fr) minmax(180px, 1fr);
  align-items: center;
  height: 80px;
  flex-shrink: 0;
  padding: 0 20px;
  gap: 20px;
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
  background: linear-gradient(120deg, rgba(40, 32, 26, 0.92), rgba(34, 27, 22, 0.88));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-2), var(--glass-highlight);
}

:root[data-theme='light'] .queue-panel {
  background: linear-gradient(120deg, rgba(255, 250, 242, 0.94), rgba(255, 246, 238, 0.9));
}

.queue-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px 10px;
  font-size: 13px;
  font-weight: 600;
}

.queue-count {
  color: var(--text-secondary);
  font-weight: 400;
  font-size: 12px;
}

.queue-list {
  overflow-y: auto;
  padding: 0 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.queue-row {
  display: grid;
  grid-template-columns: 32px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 6px 10px;
  border-radius: var(--radius-item);
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out);
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
</style>
