import { ref } from 'vue'
import * as db from '@/services/db'
import { downscale } from '@/services/cover'

/**
 * 自定义背景壁纸：图片二进制存 IndexedDB kv（key = 'wallpaper'），
 * 浓度等标量在 settings store（localStorage）。本模块是模块级单例，
 * App.vue（渲染层）与 SettingsView（设置入口）共享同一份状态。
 *
 * 壁纸 blob 在入库前统一压缩到长边 2560（复用封面的 downscale），
 * objectURL 全程复用一份，替换/清除时 revoke，避免泄漏。
 */

const WALLPAPER_KEY = 'wallpaper'
/** 壁纸长边上限：4K 屏全屏 cover 足够清晰，再大只是浪费存储与解码 */
const WALLPAPER_MAX_EDGE = 2560

/** 当前壁纸的 objectURL；null = 未设置（内容区显示纯色底） */
export const wallpaperUrl = ref<string | null>(null)

let revokeTimer: ReturnType<typeof setTimeout> | null = null

/** 安全替换 objectURL：旧 URL 延迟 revoke，避免淡入淡出交接时图片闪断 */
function swapUrl(blob: Blob | null) {
  const next = blob ? URL.createObjectURL(blob) : null
  const prev = wallpaperUrl.value
  wallpaperUrl.value = next
  if (prev) {
    if (revokeTimer) clearTimeout(revokeTimer)
    revokeTimer = setTimeout(() => URL.revokeObjectURL(prev), 1000)
  }
}

/** 应用启动时调用一次：从 IndexedDB 恢复壁纸（失败静默回退纯色底） */
export async function initWallpaper() {
  try {
    const blob = await db.kvGet<Blob>(WALLPAPER_KEY)
    if (blob instanceof Blob) swapUrl(blob)
  } catch {
    /* DB 读取失败按未设置处理 */
  }
}

/**
 * 设置壁纸：验证可解码 → 压缩长边 → 落库 → 更新内存 URL。
 * 返回 false 表示文件无法作为图片使用（格式不支持/文件损坏）。
 */
export async function setWallpaper(file: Blob): Promise<boolean> {
  // 先验证浏览器真的能解码（拦截 HEIC 等不支持格式与损坏文件）
  try {
    const bitmap = await createImageBitmap(file)
    bitmap.close()
  } catch {
    return false
  }
  let stored: Blob
  try {
    stored = await downscale(file, WALLPAPER_MAX_EDGE)
  } catch {
    return false
  }
  await db.kvSet(WALLPAPER_KEY, stored)
  swapUrl(stored)
  return true
}

/** 清除壁纸：kv 置 null（「清空全部资料」也会连带清掉 kv，行为一致） */
export async function clearWallpaper() {
  try {
    await db.kvSet(WALLPAPER_KEY, null)
  } catch {
    /* 清库失败也照样移除当前显示 */
  }
  swapUrl(null)
}
