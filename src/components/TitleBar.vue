<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * 自绘标题栏（9.5，无边框窗口）：拖拽区 + 最小化/最大化/关闭。
 * 关闭按钮走 CloseRequested → Rust 侧隐藏到托盘（真正的退出在托盘菜单）。
 * 容器 data-tauri-drag-region 供拖动/双击最大化；按钮不带该属性所以可正常点击。
 */
const appWindow = getCurrentWindow()
const maximized = ref(false)
let unlisten: (() => void) | null = null

onMounted(async () => {
  try {
    maximized.value = await appWindow.isMaximized()
    unlisten = await appWindow.onResized(async () => {
      maximized.value = await appWindow.isMaximized()
    })
  } catch {
    /* 非 tauri 环境不会渲染本组件 */
  }
})
onUnmounted(() => unlisten?.())
</script>

<template>
  <div class="titlebar" data-tauri-drag-region>
    <div class="tb-spacer" data-tauri-drag-region />
    <div class="tb-controls">
      <button class="tb-btn" title="最小化" @click="appWindow.minimize()">
        <svg viewBox="0 0 12 12" width="12" height="12"><path d="M1 6h10" stroke="currentColor" stroke-width="1.2" /></svg>
      </button>
      <button class="tb-btn" :title="maximized ? '还原' : '最大化'" @click="appWindow.toggleMaximize()">
        <svg v-if="!maximized" viewBox="0 0 12 12" width="12" height="12"><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
        <svg v-else viewBox="0 0 12 12" width="12" height="12">
          <rect x="1.5" y="3.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" />
          <path d="M3.5 3.5v-2h7v7h-2" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="tb-btn tb-close" title="关闭（最小化到托盘）" @click="appWindow.close()">
        <svg viewBox="0 0 12 12" width="12" height="12"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.2" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  height: 36px;
  flex: none;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  user-select: none;
}

.tb-controls {
  display: flex;
  align-items: stretch;
}

.tb-btn {
  width: 46px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.tb-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tb-btn.tb-close:hover {
  background: #e81123;
  color: #fff;
}
</style>
