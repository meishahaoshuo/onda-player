import { ref } from 'vue'

/**
 * 桌面化（PWA）：Service Worker 注册 + 安装提示捕获 + 独立窗口检测。
 * SW 仅在生产环境注册（dev 下 Vite 的模块图不适合被 SW 缓存）。
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
