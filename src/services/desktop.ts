import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './fs'

export { isDesktop }

/**
 * 桌面端初始化（9.5）：磨砂窗口效果、窗口状态记忆、托盘事件转发。
 * 仅在 Tauri 环境由 App.vue onMounted 调用；浏览器形态零开销。
 *
 * 磨砂：html 加 .desktop-glass 后基底变半透明，材质由 Rust 侧 Acrylic
 * （按主题 tint）提供；切主题时由 data-theme 变更观察器重调。
 *
 * 托盘播放控制：Rust emit `tray://playpause|prev|next` → 转发为 DOM 事件
 * `onda:tray-*`（App.vue 监听后调 player store，避免本服务反向依赖 store）。
 */

const WIN_STATE_KEY = 'desktop.winState'

interface WinState {
  x: number
  y: number
  w: number
  h: number
  max: boolean
}

export async function initDesktop(): Promise<void> {
  if (!isDesktop) return
  document.documentElement.classList.add('desktop-glass')

  const [{ listen }, { getCurrentWindow }, { PhysicalPosition, PhysicalSize }] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/dpi'),
  ])
  const win = getCurrentWindow()

  /* ---------- 窗口状态记忆：位置/尺寸跨启动恢复（最大化只记状态不覆盖常规尺寸） ----------
     保存与恢复都做健康检查：最小化时读到的是屏幕外坐标（-32000, -32000, 276×45），
     一旦存进去，之后每次启动窗口都会被"恢复"到屏幕外——恢复前校验，脏数据直接居中兜底 */
  try {
    const saved = JSON.parse(localStorage.getItem(WIN_STATE_KEY) ?? 'null') as WinState | null
    const sane =
      saved &&
      saved.w >= 600 &&
      saved.h >= 400 &&
      saved.x > -100 &&
      saved.y > -100 &&
      saved.x < 20000 &&
      saved.y < 20000
    if (saved?.max) {
      await win.maximize()
    } else if (sane) {
      await win.setPosition(new PhysicalPosition(saved!.x, saved!.y)).catch(() => {})
      await win.setSize(new PhysicalSize(saved!.w, saved!.h)).catch(() => {})
    } else {
      await win.center().catch(() => {})
    }
  } catch {
    /* 脏数据忽略，用默认窗口 */
  }
  let saveTimer: number | undefined
  const scheduleSave = () => {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(async () => {
      try {
        const max = await win.isMaximized()
        const min = await win.isMinimized()
        if (max || min) return // 最大化/最小化状态不覆盖记忆的常规位置尺寸
        const pos = await win.outerPosition()
        const size = await win.innerSize()
        localStorage.setItem(
          WIN_STATE_KEY,
          JSON.stringify({ x: pos.x, y: pos.y, w: size.width, h: size.height, max } satisfies WinState),
        )
      } catch {
        /* 忽略瞬时取值失败 */
      }
    }, 600)
  }
  void win.onMoved(scheduleSave)
  void win.onResized(scheduleSave)

  /* ---------- 托盘播放控制事件 → DOM 自定义事件 ---------- */
  const relay = (trayEvent: string, domEvent: string) =>
    listen(trayEvent, () => window.dispatchEvent(new CustomEvent(domEvent)))
  void relay('tray://playpause', 'onda:tray-playpause')
  void relay('tray://prev', 'onda:tray-prev')
  void relay('tray://next', 'onda:tray-next')

  /* ---------- 磨砂：随主题重调 Acrylic tint ---------- */
  const applyEffect = () => {
    const dark = document.documentElement.dataset.theme === 'dark'
    void invoke('set_window_effect', { dark }).catch(() => {
      /* 系统不支持时保持 CSS 半透明基底降级 */
    })
  }
  applyEffect()
  new MutationObserver(applyEffect).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}
