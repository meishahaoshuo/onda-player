<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SongList from '@/components/SongList.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { paletteCache } from '@/services/paletteCache'
import type { SongRecord } from '@/types'

const library = useLibraryStore()
const player = usePlayerStore()
const ui = useUiStore()

function onPlay(song: SongRecord) {
  player.playSong(song, library.sortedSongs)
}

/* ---------- 定位悬浮球：正在播放的行滚出视野时浮现，点击滚动回中；定位到后自动隐藏 ---------- */

const ROW = 56
const viewEl = ref<HTMLElement | null>(null)
let hostEl: HTMLElement | null = null
const rowOffscreen = ref(false)

/** 正在播放的歌在全库列表中的行号；播放上下文不在本列表时为 -1 */
const playingIndex = computed(() => {
  const p = player.currentPath
  return p ? library.sortedSongs.findIndex((s) => s.path === p) : -1
})

/** 行顶边相对滚动宿主内容起点的绝对偏移；测不到返回 null */
function rowTopInHost(): number | null {
  const host = hostEl
  const list = viewEl.value?.querySelector<HTMLElement>('.song-list')
  const idx = playingIndex.value
  if (!host || !list || idx < 0) return null
  const listTop = list.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop
  return listTop + idx * ROW
}

function measureLocate() {
  const host = hostEl
  const top = rowTopInHost()
  if (!host || top === null) {
    rowOffscreen.value = false
    return
  }
  rowOffscreen.value = top < host.scrollTop - 4 || top + ROW > host.scrollTop + host.clientHeight + 4
}

function locatePlaying() {
  const host = hostEl
  const top = rowTopInHost()
  if (!host || top === null) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  host.scrollTo({
    top: Math.max(0, top - host.clientHeight / 2 + ROW / 2),
    behavior: reduced ? 'auto' : 'smooth',
  })
}

watch([playingIndex, () => library.sortedSongs.length], () => nextTick(measureLocate))

onMounted(() => {
  hostEl = viewEl.value?.closest<HTMLElement>('.scroll-host') ?? null
  hostEl?.addEventListener('scroll', measureLocate, { passive: true })
  window.addEventListener('resize', measureLocate)
  measureLocate()
})

onBeforeUnmount(() => {
  hostEl?.removeEventListener('scroll', measureLocate)
  window.removeEventListener('resize', measureLocate)
  hostEl = null
})

/* 光晕色：当前封面明亮色（取色失败回落主题主色） */
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

const needRestore = computed(() => library.roots.filter((r) => r.permission !== 'granted'))
const scanPct = computed(() =>
  library.scanProgress.total > 0
    ? Math.round(
        ((library.scanProgress.scanned + library.scanProgress.skipped) /
          library.scanProgress.total) *
          100,
      )
    : 0,
)
</script>

<template>
  <div ref="viewEl" class="songs-view">
    <!-- 错误提示 -->
    <div v-if="library.lastError" class="error-banner">
      <span>{{ library.lastError }}</span>
      <button class="scan-cancel" @click="library.lastError = null">关闭</button>
    </div>

    <!-- 空状态：还没有音乐文件夹（添加/扫描入口统一在文件夹板块） -->
    <div v-if="library.roots.length === 0" class="empty">
      <AppIcon name="folder" :size="48" class="empty-icon" />
      <p class="empty-title">还没有音乐文件</p>
      <p class="empty-hint">支持 MP3 / FLAC / OGG / OPUS / WAV / M4A，文件保留在原处不会被复制</p>
      <button class="primary-btn" @click="ui.navigate('folders')">去文件夹板块添加</button>
    </div>

    <template v-else>
      <!-- 权限恢复提示（浏览器要求用户手势授权） -->
      <div v-if="needRestore.length > 0" class="restore-banner">
        <span>需要恢复文件夹访问权限：</span>
        <button
          v-for="r in needRestore"
          :key="r.id"
          class="restore-btn"
          @click="library.restorePermission(r.id)"
        >
          {{ r.name }}
        </button>
      </div>

      <!-- 扫描进度 -->
      <div v-if="library.scanning" class="scan-bar">
        <div class="scan-fill" :style="{ width: `${scanPct}%` }" />
        <span class="scan-text">
          {{ ({ idle: '', enumerating: '正在扫描', parsing: '正在读取标签', done: '扫描完成' })[library.scanProgress.phase] }}
          {{ library.scanProgress.scanned + library.scanProgress.skipped }} /
          {{ library.scanProgress.total }}
          <template v-if="library.scanProgress.failed > 0">（跳过 {{ library.scanProgress.failed }}）</template>
        </span>
        <button class="scan-cancel" @click="library.cancelScan()">取消</button>
      </div>

      <SongList
        v-if="library.sortedSongs.length > 0"
        :songs="library.sortedSongs"
        :current-path="player.currentPath"
        persist-key="list:songs"
        @play="onPlay"
      />
      <div v-else class="empty small">
        <p class="empty-hint">尚未扫描到音频文件</p>
      </div>
    </template>

    <!-- 定位悬浮球：正在播放的行滚出视野时浮现（fixed 相对视口，右下角播放条上方）；
         外圈是当前封面色的呼吸光晕，点击滚动回中，行回到视野后自动隐藏 -->
    <Transition name="fab">
      <button
        v-if="showLocateFab"
        class="locate-fab"
        :style="{ '--halo-c': haloColor || 'var(--accent)' }"
        title="定位到正在播放"
        @click="locatePlaying"
      >
        <AppIcon name="locate" :size="18" />
      </button>
    </Transition>
  </div>
</template>

<style scoped>
/* min-height 而非 height：列表内容走外层滚动（view-body），自然高度向下生长；
   空态时仍占满一屏供 flex 居中。不能加 overflow（会让 sticky 表头失效） */
.songs-view {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.empty.small {
  justify-content: flex-start;
  padding-top: 48px;
}

.empty-icon {
  color: var(--text-tertiary);
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
}

.empty-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.primary-btn {
  margin-top: 8px;
  padding: 10px 24px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 14px;
  font-weight: 500;
  transition: opacity 0.15s;
}

.primary-btn:hover {
  opacity: 0.9;
}

.restore-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  font-size: 13px;
  color: var(--text-secondary);
}

.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--danger-soft);
  border: 1px solid var(--danger-border);
  font-size: 13px;
  color: var(--danger);
}

.restore-btn {
  padding: 4px 12px;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 12px;
}

.scan-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 28px;
  border-radius: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
  padding: 0 12px;
}

.scan-fill {
  position: absolute;
  inset: 0;
  background: var(--bg-active);
  transition: width 0.2s;
}

.scan-text {
  position: relative;
  font-size: 12px;
  color: var(--text-secondary);
}

.scan-cancel {
  position: relative;
  margin-left: auto;
  font-size: 12px;
  color: var(--accent);
}

/* 定位悬浮球：磨砂玻璃圆球（与队列面板同一套玻璃令牌），
   fixed 贴视口右下、播放条上方；外圈封面色细光晕呼吸 */
.locate-fab {
  position: fixed;
  right: 24px;
  bottom: 112px; /* 标准条 80px / 胶囊 16+66px 上方都留出间距 */
  z-index: 4; /* 内容之上、详情覆盖层(5)/播放条(6)/弹窗(100) 之下 */
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-2), var(--glass-highlight);
  color: var(--text-secondary);
  transition: color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-spring);
}

.locate-fab:hover {
  color: var(--text-primary);
  transform: scale(1.06);
}

.locate-fab:active {
  transform: scale(0.94);
}

/* 封面色呼吸光晕：一圈 2px 细环，明暗往复 */
.locate-fab::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--halo-c, var(--accent)) 40%, transparent);
  animation: fab-halo 2.4s var(--ease-out) infinite alternate;
  pointer-events: none;
}

@keyframes fab-halo {
  from {
    opacity: 0.35;
  }
  to {
    opacity: 1;
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
  .locate-fab::after {
    animation: none;
  }

  .fab-enter-active,
  .fab-leave-active {
    transition: none;
  }
}
</style>
