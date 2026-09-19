import { invoke } from '@tauri-apps/api/core'
import type { Window } from '@tauri-apps/api/window'
import { isDesktop } from './fs'

export { isDesktop }

/**
 * 桌面端初始化（9.5）：窗口定位与显示、窗口状态记忆、托盘事件转发。
 * 浏览器形态零开销。
 *
 * 窗口显示时机见 primeWindow —— 窗口以 visible:false 创建，由它在最早时机
 * 定位后 show，避免"先在默认位置露脸、过一会儿才跳到记忆位置"。
 *
 * 窗口材质（透出桌面 + Acrylic）已移除，见 main.css 同名注释：
 * 窗口不再透明，页面底色是不透明的 --bg-base，各层关系恒定。
 *
 * 托盘浮层菜单：自绘菜单是另一个 webview（Rust 的 `tray-menu` 窗口），
 * 它的按钮广播 `tray://playpause|prev|next|favorite|go`，这里统一
 * 转发为 DOM 事件 `onda:tray-*`（App.vue 监听后调 store）。
 * 反方向的状态推送见 `services/trayMenu.ts` 的 `pushTrayState()`。
 */

const WIN_STATE_KEY = 'desktop.winState'

interface WinState {
  x: number
  y: number
  w: number
  h: number
  max: boolean
}

/** primeWindow 只允许跑一次 */
let primed = false

/** 取当前主窗口（延迟 import：浏览器形态完全不加载这部分代码） */
async function mainWindow(): Promise<Window> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

/**
 * 把窗口摆回上次关闭时的位置尺寸；没有有效记忆则居中。
 *
 * 保存与恢复都做健康检查：最小化时读到的是屏幕外坐标（-32000, -32000, 276×45），
 * 一旦存进去，之后每次启动窗口都会被"恢复"到屏幕外——恢复前校验，脏数据居中兜底。
 */
async function restoreBounds(win: Window): Promise<void> {
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
      const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi')
      await win.setPosition(new PhysicalPosition(saved!.x, saved!.y)).catch(() => {})
      await win.setSize(new PhysicalSize(saved!.w, saved!.h)).catch(() => {})
    } else {
      await win.center().catch(() => {})
    }
  } catch {
    /* 脏数据忽略，退回 tauri.conf.json 的 center: true */
  }
}

/**
 * 窗口「预定位 + 显示」，必须在入口脚本挂上过场后**立刻**调用（见 main.ts）。
 *
 * 窗口在 tauri.conf.json 里以 visible:false 且无 position 创建：出生时既不可见、
 * 也没有位置。原来的定位写在 App.vue onMounted 里，而主应用要等过场生长拍收笔
 * （840ms 后）才挂载——在那之前窗口早就按 Windows 默认位置显示出来了，用户看到的
 * 就是「外框先落在右下角、过一会儿才跳到中间」。挪到这里后，定位发生在过场挂载后
 * 的几十毫秒内，窗口第一次出现在屏幕上就已经在正确的位置和尺寸。
 *
 * 注意定时器节流：窗口隐藏时 Chromium 会把 setTimeout 压到 1s 粒度，而过场的时间轴
 * 恰好是 setTimeout 驱动的（BootSplash 的 later()）。所以本函数必须在过场挂载后
 * 立即调用，把隐藏窗口的时间压到百毫秒以内，不能让过场在隐藏状态下空等。
 *
 * 失败时窗口会留在隐藏态，因此不能只靠前端兜底：Rust 侧另有一个 2 秒保险
 * （收到 mark_window_primed 回执即不动作）。
 */
export async function primeWindow(): Promise<void> {
  if (!isDesktop || primed) return
  primed = true
  try {
    const win = await mainWindow()
    await restoreBounds(win)
    await win.show()
    // 回执：前端已把窗口显示出来，Rust 兜底线程不必再插手
    void invoke('mark_window_primed').catch(() => {})
  } catch {
    /* 保持隐藏，交给 Rust 兜底显示 */
  }
}

export async function initDesktop(): Promise<void> {
  if (!isDesktop) return

  const [{ listen }, win] = await Promise.all([import('@tauri-apps/api/event'), mainWindow()])

  /* ---------- 窗口状态记忆（定位已在 primeWindow 做过，这里只负责记录） ---------- */
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

  /* ---------- 托盘浮层的动作事件 → DOM 自定义事件 ----------
     浮层是另一个 webview，它的按钮广播 `tray://*`，这里统一转成 `onda:tray-*`
     交给 App.vue 去调 store —— 本服务不反向依赖 store。
     带参数的（收藏 / 跳转）把 payload 一并带过去。 */
  const relay = (trayEvent: string, domEvent: string) =>
    listen<unknown>(trayEvent, (e) => {
      window.dispatchEvent(new CustomEvent(domEvent, { detail: e.payload }))
    })
  void relay('tray://playpause', 'onda:tray-playpause')
  void relay('tray://prev', 'onda:tray-prev')
  void relay('tray://next', 'onda:tray-next')
  void relay('tray://favorite', 'onda:tray-favorite')
  void relay('tray://go', 'onda:tray-go')
}

/* ------------------------------------------------------------------ *
 * 托盘浮层的「显示主窗口」
 * ------------------------------------------------------------------ */

/** 唤起并聚焦主窗口（浮层的跳转动作都要先把窗口叫出来） */
export function showMainWindow(): void {
  if (!isDesktop) return
  void invoke('tray_show_main').catch(() => {})
}
