<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import type { PlayMode } from '@/types'
import type { IconName } from './icons'

/**
 * 底部播放条（第 1 阶段为静态骨架，交互在第 3 阶段接入播放内核）
 */
const settings = useSettingsStore()

const modeIcon: Record<PlayMode, IconName> = {
  order: 'repeat',
  loop: 'repeat',
  one: 'repeatOne',
  shuffle: 'shuffle',
}
const playMode = ref<PlayMode>('loop')
const volume = ref(80)
</script>

<template>
  <footer class="player-bar">
    <!-- 左：曲目信息 -->
    <div class="track">
      <div class="cover">
        <AppIcon name="music" :size="18" />
      </div>
      <div class="meta">
        <div class="title">未在播放</div>
        <div class="subtitle">选择文件夹以添加音乐</div>
      </div>
    </div>

    <!-- 中：控制区 -->
    <div class="controls">
      <div class="progress">
        <span class="time">0:00</span>
        <div class="bar"><div class="bar-fill" :style="{ width: '0%' }" /></div>
        <span class="time">0:00</span>
      </div>
      <div class="buttons">
        <button
          class="icon-btn"
          :title="{ order: '顺序播放', loop: '列表循环', one: '单曲循环', shuffle: '随机播放' }[playMode]"
          @click="
            playMode =
              playMode === 'order' ? 'loop' : playMode === 'loop' ? 'one' : playMode === 'one' ? 'shuffle' : 'order'
          "
        >
          <AppIcon :name="modeIcon[playMode]" />
        </button>
        <button class="icon-btn" title="上一曲"><AppIcon name="prev" :size="20" /></button>
        <button class="icon-btn play-btn" title="播放">
          <AppIcon name="play" :size="22" />
        </button>
        <button class="icon-btn" title="下一曲"><AppIcon name="next" :size="20" /></button>
        <button class="icon-btn" title="播放队列"><AppIcon name="queue" /></button>
      </div>
    </div>

    <!-- 右：辅助区 -->
    <div class="aux">
      <button class="icon-btn" title="全屏歌词"><AppIcon name="expand" /></button>
      <button class="icon-btn" :title="`音量 ${volume}%`">
        <AppIcon :name="volume === 0 ? 'volumeMute' : 'volume'" />
      </button>
      <input v-model.number="volume" class="volume" type="range" min="0" max="100" />
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

.cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text-tertiary);
  flex-shrink: 0;
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
  background: var(--accent);
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
