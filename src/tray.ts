import { createApp } from 'vue'
import TrayMenu from './components/TrayMenu.vue'
import './styles/main.css'

/**
 * 托盘浮层的挂载入口，由 main.ts 在 `?tray=1` 时动态引入。
 *
 * 它跟主应用是**两个互不相干的应用**：这里不跑启动过场、不定位主窗口、
 * 不建 Pinia —— 只挂一个菜单组件（见 TrayMenu.vue）。
 *
 * 窗口本身是透明的（Rust 侧 transparent:true），所以把 html/body 的底色
 * 摘掉：main.css 给 body 铺了 `--bg-base`，留着的话整个窗口会是一块不透明色板，
 * 圆角与阴影都白做了。用内联样式覆盖，避免和全局样式表打架。
 */
export function mountTrayMenu() {
  const html = document.documentElement
  html.style.background = 'transparent'
  document.body.style.background = 'transparent'
  // 托盘菜单**固定浅色**，不跟随应用/系统主题（用户 2026-09-15 定）。
  // ⚠️ main.css 在没有 data-theme 时默认是深色令牌，必须显式钉成 light 才是白卡
  html.dataset.theme = 'light'
  // 窗口高度由内容撑出来（ResizeObserver 回报给 Rust），不允许出现滚动条
  document.body.style.overflow = 'hidden'

  createApp(TrayMenu).mount('#app')
}
