<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * 自绘标题栏（9.5，无边框窗口）：最小化/最大化/关闭。
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
    <div class="tb-controls">
      <button class="tb-btn" title="最小化" @click="appWindow.minimize()">
        <span class="water" aria-hidden="true">
          <svg class="wv back" viewBox="0 0 200 6" preserveAspectRatio="none"><path d="M0 3q12.5-2.4 25 0t25 0t25 0t25 0t25 0t25 0t25 0t25 0V6H0Z" /></svg>
          <svg class="wv front" viewBox="0 0 200 6" preserveAspectRatio="none"><path d="M0 3q12.5-2.4 25 0t25 0t25 0t25 0t25 0t25 0t25 0t25 0V6H0Z" /></svg>
        </span>
        <svg class="glyph" viewBox="0 0 14 14" width="14" height="14"><path d="M2.5 7h9" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" /></svg>
      </button>
      <button class="tb-btn" :title="maximized ? '还原' : '最大化'" @click="appWindow.toggleMaximize()">
        <span class="water" aria-hidden="true">
          <svg class="wv back" viewBox="0 0 200 6" preserveAspectRatio="none"><path d="M0 3q12.5-2.4 25 0t25 0t25 0t25 0t25 0t25 0t25 0t25 0V6H0Z" /></svg>
          <svg class="wv front" viewBox="0 0 200 6" preserveAspectRatio="none"><path d="M0 3q12.5-2.4 25 0t25 0t25 0t25 0t25 0t25 0t25 0t25 0V6H0Z" /></svg>
        </span>
        <svg v-if="!maximized" class="glyph" viewBox="0 0 14 14" width="14" height="14"><rect x="2.5" y="2.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
        <svg v-else class="glyph" viewBox="0 0 14 14" width="14" height="14">
          <rect x="1.8" y="4.6" width="7.6" height="7.6" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" />
          <path d="M4.6 4.6V1.8h7.6v7.6h-2.8" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="tb-btn" title="关闭（最小化到托盘）" @click="appWindow.close()">
        <span class="water" aria-hidden="true">
          <svg class="wv back" viewBox="0 0 200 6" preserveAspectRatio="none"><path d="M0 3q12.5-2.4 25 0t25 0t25 0t25 0t25 0t25 0t25 0t25 0V6H0Z" /></svg>
          <svg class="wv front" viewBox="0 0 200 6" preserveAspectRatio="none"><path d="M0 3q12.5-2.4 25 0t25 0t25 0t25 0t25 0t25 0t25 0t25 0V6H0Z" /></svg>
        </span>
        <svg class="glyph" viewBox="0 0 14 14" width="14" height="14"><path d="M3.2 3.2l7.6 7.6M10.8 3.2l-7.6 7.6" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 固定悬浮、脱离文档流：不占布局高度、不推挤内容。
   垂直方向与顶栏内容行同轴 —— 行顶 = --head-pad-top，行高 = --head-row-h，
   与板块标题（line-height 同值）、搜索框（同高）三者垂直中心一致。

   水平方向参照网易云播放器：按钮组**不贴死窗口右缘**，留出与顶栏内容同样的栅格留白
   （实测参考图关闭键图标右缘距窗口右缘 72px／1846px 宽 ≈ 3.9%），
   故用 right: 24px 与 .view-header 的右侧留白对齐。

   悬停反馈 = 「水位注入」：整块水从按钮下方升起，在略低于顶边处停住 ——
   不停满，是为了让**水面**留在按钮里面看得见（灌满就成了纯色块，波浪没处显形）。
   水面由两条同色波浪叠加：同一条波，不同速度/方向漂移，错开后就是真实水面的层次感。
   三枚按钮完全同款，关闭键不做红色处理。 */
.titlebar {
  --win-rise-dur: 480ms;
  --win-wave-h: 6px;
  position: fixed;
  top: var(--head-pad-top);
  right: 24px;
  height: var(--head-row-h);
  display: flex;
  align-items: center;
  z-index: 60;
  user-select: none;
}

.tb-controls {
  display: flex;
  align-items: center;
  height: 100%;
}

.tb-btn {
  position: relative;
  overflow: hidden;
  width: 40px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-item);
  color: var(--text-tertiary);
  transition: color var(--dur-fast) var(--ease-out);
}

.tb-btn:hover {
  color: var(--text-primary);
}

/* 水体容器：起始整体沉在按钮下方（translateY(100%)），悬停升到 13% 处停住
   （水位高度由这个百分比决定：数值越小水面越靠上、水越满） */
.water {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 100%;
  transform: translateY(100%);
  transition: transform var(--win-rise-dur) var(--ease-out);
  pointer-events: none;
}

.tb-btn:hover .water {
  transform: translateY(13%);
}

/* 水体本体：从波浪带下缘一直填到底 */
.water::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: var(--win-wave-h);
  bottom: 0;
  background: var(--win-water);
}

/* 波浪带：宽度 200%，viewBox 200 单位里排 4 个完整周期（每周期 50 单位），
   渲染到一个按钮宽（40px）上 → 波长 20px，一个按钮里能看到约 2 个波峰，
   像水面而不是"斜切一刀"。漂移正好一个波长（svg 自身宽度的 25%）→ 无缝循环。
   viewBox 200 单位里 4 个周期，每个周期 50 单位
   → svg 渲染宽 200%（= 2 个按钮宽 = 80px）时，50 单位 = 20px = svg 宽度的 25% */
.wv {
  position: absolute;
  top: 0;
  left: 0;
  width: 200%;
  height: var(--win-wave-h);
  display: block;
}

.wv.front {
  fill: var(--win-water);
  animation: win-drift 2.6s linear infinite;
}

.wv.back {
  top: 2px;
  fill: var(--win-water-back);
  animation: win-drift 3.8s linear infinite reverse;
}

@keyframes win-drift {
  to {
    transform: translateX(-25%);
  }
}

/* 图标要压在水面之上 */
.glyph {
  position: relative;
  z-index: 1;
}

@media (prefers-reduced-motion: reduce) {
  .water {
    transition: none;
  }

  .wv {
    animation: none;
  }
}
</style>
