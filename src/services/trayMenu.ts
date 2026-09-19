import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './fs'

/**
 * 托盘浮层（自绘菜单）与主窗口之间的契约。
 *
 * 浮层不是主应用的一部分，而是**另一个 webview**：Rust 侧的 `tray-menu` 窗口，
 * 加载 `index.html?tray=1`，由 `src/tray.ts` 单独挂载。它同源、共用同一个
 * WebView2 数据目录，所以能直接读 IndexedDB —— 状态里只传 `coverId`，
 * 封面由浮层自己取，免得把 base64 在两个窗口之间搬来搬去。
 *
 * 三个方向：
 *   主窗口 → 浮层：`pushTrayState()` → Rust 缓存一份并转发 `tray://state`
 *   浮层 → 主窗口：广播 `tray://favorite | go`（desktop.ts 里 relay）
 *   浮层 → Rust　：tray_show_main / tray_quit / tray_menu_hide / tray_menu_resize
 */
export interface TrayState {
  /** 歌名；空串表示当前没有播放 */
  title: string
  artist: string
  coverId: string | null
  playing: boolean
  /** 当前曲目是否已收藏（决定心形是实心还是空心） */
  favorited: boolean
}

/**
 * 把主窗口状态推给浮层。
 *
 * Rust 侧会缓存一份，右键展开时回放 —— 浮层平时是隐藏的常驻窗口，
 * 只靠广播会漏掉「它被打开之前」发生的那次更新。
 */
export function pushTrayState(state: TrayState): void {
  if (!isDesktop) return
  void invoke('tray_menu_state', { state }).catch(() => {
    /* 浮层尚未创建时忽略 */
  })
}

/**
 * 预热浮层窗口：在启动过场收尾之后调用，让首次右键不必等 webview 冷启动。
 * 刻意不挂在启动路径上，不给开机速度添负担。
 */
export function prepareTrayMenu(): void {
  if (!isDesktop) return
  void invoke('tray_menu_prepare').catch(() => {})
}
