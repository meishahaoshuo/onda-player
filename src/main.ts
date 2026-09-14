import { createApp } from 'vue'
import BootSplash from './components/BootSplash.vue'
import './styles/main.css'

/**
 * 启动顺序：**先把过场画上屏，再加载并挂载主应用**。
 *
 * 为什么主应用走动态引入：静态 import 会被打进同一个 chunk，浏览器必须先求值
 * 完整棵应用树才能画第一帧 —— dev 下实测那是一个 107ms 的阻塞长任务
 * （模块求值 + Vue 挂载），过场只能跟着一起等。拆开之后入口 chunk 只剩 vue + 过场，
 * 过场能在首帧就画出来（实测进 DOM 从 294ms 提前到 91ms），
 * 主应用的加载与挂载挪到它之后，两者不再互相拖累。
 *
 * 为什么等 `onda:splash-grown`：过场会在这条波浪全部成形后（840ms）发这个事件，
 * 把「挂载主应用」这个约 100ms 的阻塞长任务安排在生长动画收笔之后，
 * 不让它打断生长（详见 BootSplash 里的时间轴说明）。
 * 系统开了「减少动态效果」时过场不跑，会在 setup 阶段立刻发同一事件放行。
 */
let booted = false
function bootApp() {
  if (booted) return
  booted = true
  void import('./boot').then((m) => m.mountApp())
}

window.addEventListener('onda:splash-grown', bootApp, { once: true })
// 兜底：过场若因异常没能发事件，也不能把主应用一直挡在外面
window.setTimeout(bootApp, 1800)

const splashHost = document.createElement('div')
document.body.appendChild(splashHost)
createApp(BootSplash).mount(splashHost)

if (import.meta.env.DEV) {
  import('./services/testBridge').then((m) => m.installTestBridge())
} else {
  // 桌面化：SW 注册与安装提示捕获仅生产环境启用
  import('./services/pwa').then((m) => m.setupPwa())
}
