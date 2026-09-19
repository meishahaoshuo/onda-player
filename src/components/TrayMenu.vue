<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import AppIcon from './AppIcon.vue'
import { getCover } from '@/services/db'
import type { TrayState } from '@/services/trayMenu'

/**
 * 托盘浮层菜单（自绘）。
 *
 * 它跑在一个独立的小窗口里、是一个独立的 Vue 应用（见 src/tray.ts），
 * 没有 Pinia：状态全部来自主窗口推来的 `tray://state`，动作则反向广播
 * `tray://*` 交回主窗口执行 —— 播放逻辑只有一个出处，主窗口隐藏着也照样生效。
 *
 * 交互约定（用户 2026-09-15 定）：
 *  - 播放控制/收藏点完**不收起菜单**，状态由主窗口推回来就地更新
 *  - 只有跳转（设置）才收起
 *  - **固定浅色**，不跟随应用主题
 *
 * 外观上与 App 内的二级浮层同族（纯色底 + 同一批图标），差别只有阴影：
 * 窗口关掉了系统阴影（shadow:false），而窗口只有 268 宽，
 * 放不下 --shadow-2 那 48px 的大扩散，所以改用收紧过的 --tray-menu-shadow。
 */

const state = ref<TrayState | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const coverUrl = ref<string | null>(null)

const hasSong = computed(() => !!state.value?.title)
const title = computed(() => state.value?.title || '未在播放')
const artist = computed(() => state.value?.artist || '')
const playing = computed(() => !!state.value?.playing)
const favorited = computed(() => !!state.value?.favorited)

/* ---------- 封面：自己在 IndexedDB 里取，不经 IPC 搬字节 ---------- */
let shownCoverId: string | null = null
async function loadCover(coverId: string | null) {
  if (coverId === shownCoverId) return
  shownCoverId = coverId
  if (coverUrl.value) {
    URL.revokeObjectURL(coverUrl.value)
    coverUrl.value = null
  }
  if (!coverId) return
  try {
    const blob = await getCover(coverId)
    // 取值期间可能又换歌了，过期的结果直接丢掉
    if (blob && shownCoverId === coverId) coverUrl.value = URL.createObjectURL(blob)
  } catch {
    /* 封面缺失不影响菜单本身 */
  }
}

function applyState(next: TrayState) {
  state.value = next
  void loadCover(next.coverId)
}

/* ---------- 窗口高度跟着内容走 ---------- */
let reportedH = 0
function syncHeight() {
  const h = rootEl.value?.offsetHeight ?? 0
  if (!h || Math.abs(h - reportedH) < 1) return
  reportedH = h
  void invoke('tray_menu_resize', { height: h }).catch(() => {})
}

/* ---------- 动作 ---------- */
/** 播放类动作：只广播，不收起 —— 主窗口推回新状态后菜单就地刷新 */
function send(event: string, payload?: unknown) {
  void emit(event, payload)
}
function hide() {
  void invoke('tray_menu_hide').catch(() => {})
}
function quit() {
  void invoke('tray_quit').catch(() => {})
}

/* ---------- 生命周期 ---------- */
let stopState: (() => void) | undefined
let ro: ResizeObserver | null = null

// 窗口展开时是带焦点的，Esc 收起是托盘菜单的基本预期
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') hide()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  ro = new ResizeObserver(syncHeight)
  if (rootEl.value) ro.observe(rootEl.value)
  syncHeight()

  /**
   * DEV 预览钩子：浏览器里直接打开 `?tray=1` 时没有 Tauri 事件总线，
   * 靠它注入一份假状态来核对界面（生产构建整段摇掉）。
   * 验证脚本见 `devlog/.shots-2026-09-15/verify-tray-menu.mjs`。
   */
  if (import.meta.env.DEV) {
    window.addEventListener('onda:tray-preview', (e) =>
      applyState((e as CustomEvent<TrayState>).detail),
    )
  }

  try {
    stopState = await listen<TrayState>('tray://state', (e) => applyState(e.payload))
    // 监听就绪后主动要一次：若状态在它注册之前就被发过（首次右键时浮层可能
    // 刚建好还在加载），这里补上，不然菜单会一直停在「未在播放」
    void invoke('tray_menu_state_sync').catch(() => {})
  } catch {
    /* 浏览器预览没有事件总线，界面照常渲染 */
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  ro?.disconnect()
  stopState?.()
  if (coverUrl.value) URL.revokeObjectURL(coverUrl.value)
})
</script>

<template>
  <div ref="rootEl" class="tray-menu" :class="{ 'is-idle': !hasSong }">
    <div class="tm-card">
      <!-- 卡头：当前曲目 -->
      <div class="tm-head">
        <div class="tm-cover">
          <img v-if="coverUrl" :src="coverUrl" alt="" />
          <!-- 无封面时的占位与 App 的 CoverImage 一致：music 图标，尺寸取 0.45 倍 -->
          <AppIcon v-else name="music" :size="17" />
        </div>
        <div class="tm-meta">
          <p class="tm-title">{{ title }}</p>
          <p v-if="artist" class="tm-artist">{{ artist }}</p>
        </div>
      </div>

      <div class="tm-sep" />

      <!-- 播放控制（点完不收起，状态就地更新） -->
      <div class="tm-controls">
        <button class="tm-cbtn" :disabled="!hasSong" title="上一曲" @click="send('tray://prev')">
          <AppIcon name="prev" :size="19" />
        </button>
        <button
          class="tm-cbtn is-primary"
          :disabled="!hasSong"
          :title="playing ? '暂停' : '播放'"
          @click="send('tray://playpause')"
        >
          <AppIcon :name="playing ? 'pause' : 'play'" :size="21" />
        </button>
        <button class="tm-cbtn" :disabled="!hasSong" title="下一曲" @click="send('tray://next')">
          <AppIcon name="next" :size="19" />
        </button>
        <button
          class="tm-cbtn"
          :class="{ 'is-on': favorited }"
          :disabled="!hasSong"
          :title="favorited ? '取消收藏' : '收藏'"
          @click="send('tray://favorite')"
        >
          <AppIcon name="heart" :size="19" :class="{ 'tm-heart-on': favorited }" />
        </button>
      </div>

      <div class="tm-sep" />

      <button class="tm-row" @click="send('tray://go', { target: 'settings' }); hide()">
        <AppIcon class="tm-ico" name="settings" :size="17" />
        <span class="tm-label">设置</span>
      </button>

      <div class="tm-sep" />

      <button class="tm-row" @click="quit">
        <AppIcon class="tm-ico" name="power" :size="17" />
        <span class="tm-label">退出 Onda Player</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 外层留 16px：给 CSS 阴影留出扩散空间（窗口边界会裁掉超出的部分） */
.tray-menu {
  padding: 16px;
  box-sizing: border-box;
  user-select: none;
  -webkit-user-select: none;
}

.tm-card {
  padding: 6px;
  border-radius: var(--radius-item);
  background: var(--panel-solid-bg);
  border: 1px solid var(--panel-solid-border);
  box-shadow: var(--tray-menu-shadow);
}

/* ---------- 卡头 ---------- */
.tm-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 10px;
}
.tm-cover {
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text-tertiary);
}
.tm-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tm-meta {
  min-width: 0;
}
.tm-title,
.tm-artist {
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tm-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-primary);
}
.tm-artist {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);
}

/* 没有播放时整块压暗，一眼能看出当前是空态 */
.is-idle .tm-cover,
.is-idle .tm-title {
  color: var(--text-tertiary);
}

.tm-sep {
  height: 1px;
  margin: 5px 8px;
  background: var(--panel-solid-border);
}

/* ---------- 播放控制行 ---------- */
.tm-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px;
}
.tm-cbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: default;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.tm-cbtn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.tm-cbtn:disabled {
  color: var(--text-tertiary);
  opacity: 0.5;
}
.tm-cbtn.is-primary {
  color: var(--text-primary);
}
.tm-cbtn.is-on {
  color: var(--accent);
}
/* 收藏后把心形填实（heart 图标本身是描边态，填色由 class 落在 svg 根上完成） */
.tm-heart-on {
  fill: currentColor;
}

/* ---------- 列表项 ---------- */
.tm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
  cursor: default;
  transition: background var(--dur-fast) var(--ease-out);
}
.tm-row:hover:not(:disabled) {
  background: var(--bg-hover);
}
.tm-row:hover:not(:disabled) .tm-ico {
  color: var(--text-primary);
}
.tm-ico {
  flex: 0 0 auto;
  color: var(--text-secondary);
  transition: color var(--dur-fast) var(--ease-out);
}
.tm-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
