import { ref } from 'vue'
import { isDesktop } from './fs'

/**
 * 桌面化（PWA）：Service Worker 注册 + 安装提示捕获 + 独立窗口检测。
 * SW 仅在生产环境注册（dev 下 Vite 的模块图不适合被 SW 缓存），
 * 且**桌面端一律不注册** —— 原因见 setupPwa。
 */

/** 浏览器抛出的安装提示事件，prompt() 只能调用一次，必须保存引用 */
let deferredPrompt: BeforeInstallPromptEvent | null = null

/** 是否可以调起安装弹窗（捕获到 beforeinstallprompt 且尚未用过） */
export const canInstall = ref(false)

/** 是否正以独立窗口（已安装的桌面应用）运行 */
export const isStandalone = ref(false)

/** 安装流程进行中 / 结果提示 */
export const installState = ref<'idle' | 'installing' | 'done' | 'dismissed'>('idle')

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function detectStandalone() {
  isStandalone.value =
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari 的专有标记
    (navigator as unknown as { standalone?: boolean }).standalone === true
}

/** 调起浏览器安装弹窗；返回是否安装成功 */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  installState.value = 'installing'
  deferredPrompt.prompt()
  try {
    const { outcome } = await deferredPrompt.userChoice
    installState.value = outcome === 'accepted' ? 'done' : 'dismissed'
    return outcome === 'accepted'
  } finally {
    // prompt() 一次有效，用完即弃；若用户取消，浏览器过段时间会重新派发事件
    deferredPrompt = null
    canInstall.value = false
  }
}

export function setupPwa() {
  detectStandalone()
  window.matchMedia('(display-mode: standalone)').addEventListener('change', detectStandalone)

  // 桌面端（Tauri）不注册 Service Worker。
  // 资源本来就内嵌在二进制里、不存在离线需求；而 SW 在这里只会帮倒忙 ——
  // 它的 fetch 拿不到 tauri.localhost 自定义协议下的资源，于是回退到缓存，
  // 把旧 index.html（连同旧 hash 的 JS）一直喂给页面，表现就是
  // 「装了新版本，打开的却还是几周前的界面」。
  // 目录级清理在 Rust 侧启动时做（purge_stale_service_worker），
  // 这里再把可能残活的注册与缓存注销一遍作为兜底。
  if (isDesktop) {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((rs) => Promise.all(rs.map((r) => r.unregister())))
        .catch(() => {})
    }
    if ('caches' in window) {
      void caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {})
    }
    return
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    canInstall.value = true
  })

  window.addEventListener('appinstalled', () => {
    canInstall.value = false
    installState.value = 'done'
  })

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW 注册失败不影响播放器功能（localhost/https 之外的访问场景）
      })
    })
  }
}
