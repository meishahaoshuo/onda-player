<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import CoverImage from './CoverImage.vue'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { formatDuration } from '@/utils/format'
import type { PlayMode } from '@/types'

/** 底部播放条（数据接自播放内核 store） */
const player = usePlayerStore()
const settings = useSettingsStore()
const ui = useUiStore()

const MODE_META: { mode: PlayMode; icon: 'repeat' | 'repeatOne' | 'shuffle'; label: string }[] = [
  { mode: 'order', icon: 'repeat', label: '顺序播放' },
  { mode: 'loop', icon: 'repeat', label: '列表循环' },
  { mode: 'one', icon: 'repeatOne', label: '单曲循环' },
  { mode: 'shuffle', icon: 'shuffle', label: '随机播放' },
]

const modeMeta = computed(() => MODE_META.find((m) => m.mode === player.playMode)!)
const progressPct = computed(() =>
  player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0,
)

function onSeek(e: Event) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const x = (e as MouseEvent).clientX - rect.left
  player.seek((x / rect.width) * player.duration)
}

function onVolumeInput(e: Event) {
  player.setVolume(Number((e.target as HTMLInputElement).value))
}

function cycleMode() {
  const idx = MODE_META.findIndex((m) => m.mode === player.playMode)
  player.setPlayMode(MODE_META[(idx + 1) % MODE_META.length].mode)
}
</script>

<template>
  <footer class="player-bar">
    <!-- 左：曲目信息 -->
    <div class="track">
      <CoverImage :cover-id="player.current?.coverId ?? null" :size="44" class="cover" />
      <div class="meta">
        <div class="title">{{ player.current?.title ?? '未在播放' }}</div>
        <div class="subtitle">{{ player.current?.artist ?? '选择文件夹以添加音乐' }}</div>
      </div>
    </div>

    <!-- 中：控制区 -->
    <div class="controls">
      <div class="progress">
        <span class="time">{{ formatDuration(player.currentTime) }}</span>
        <div class="bar" @pointerdown="onSeek">
          <div class="bar-fill" :style="{ width: `${progressPct}%` }" />
        </div>
        <span class="time">{{ formatDuration(player.duration || player.current?.durationSec || 0) }}</span>
      </div>
      <div class="buttons">
        <button class="icon-btn" :title="modeMeta.label" @click="cycleMode">
          <AppIcon :name="modeMeta.icon" />
        </button>
        <button class="icon-btn" title="上一曲" @click="player.prev()">
          <AppIcon name="prev" :size="20" />
        </button>
        <button class="icon-btn play-btn" :title="player.playing ? '暂停' : '播放'" @click="player.current ? player.togglePlay() : player.resumePlay()">
          <AppIcon :name="player.playing ? 'pause' : 'play'" :size="22" />
        </button>
        <button class="icon-btn" title="下一曲" @click="player.next()">
          <AppIcon name="next" :size="20" />
        </button>
        <button class="icon-btn" title="播放队列">
          <AppIcon name="queue" />
        </button>
      </div>
    </div>

    <!-- 右：辅助区 -->
    <div class="aux">
      <button class="icon-btn" title="全屏歌词" @click="ui.lyricsOpen = true">
        <AppIcon name="expand" />
      </button>
      <button class="icon-btn" :title="`音量 ${player.volume}%`">
        <AppIcon :name="player.volume === 0 ? 'volumeMute' : 'volume'" />
      </button>
      <input
        class="volume"
        type="range"
        min="0"
        max="100"
        :value="player.volume"
        @input="onVolumeInput"
      />
      <button class="icon-btn" :title="`主题：${settings.themeMode === 'system' ? '跟随系统' : settings.themeMode === 'dark' ? '深色' : '浅色'}`">
        <AppIcon name="more" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.player-bar {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(320px, 2fr) minmax(160px, 1fr);
  align-items: center;
  height: 72px;
  flex-shrink: 0;
  background: var(--bg-playerbar);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border-top: 1px solid var(--border-subtle);
  padding: 0 16px;
  gap: 16px;
}

/* 左：曲目 */
.track {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.meta {
  min-width: 0;
}

.title {
  font-size: 13px;
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
}

/* 中：控制 */
.controls {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.progress {
  display: flex;
  align-items: center;
  gap: 10px;
}

.time {
  font-size: 11px;
  color: var(--text-tertiary);
  min-width: 32px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-hover);
  cursor: pointer;
  transition: height 0.15s;
}

.bar:hover {
  height: 6px;
}

.bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  pointer-events: none;
}

.buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.play-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
}

.play-btn:hover {
  opacity: 0.9;
}

/* 右：辅助 */
.aux {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.volume {
  width: 80px;
  accent-color: var(--accent);
}
</style>
