import { parseBlob } from 'music-metadata'
import { resolveSongFile } from './fs'
import type { SongRecord } from '@/types'

/**
 * 高清封面：扫描时入库的 `covers` 是最长边 256px 的缩略图，
 * 只够列表用；歌词页/专辑详情这类大图场景按需从音频内嵌图重新提取，
 * 缩到最长边 HI_RES_MAX_EDGE（兼顾清晰度与内存），不落盘、只进内存 LRU。
 */
const HI_RES_MAX_EDGE = 1024

/** 只解析头部元数据（跳过时长扫描与尾部标签），避免整文件读取 */
export async function extractHiResCover(song: SongRecord): Promise<Blob | null> {
  const relativePath = song.path.slice(song.rootId.length + 1)
  const file = await resolveSongFile(song.rootId, relativePath)
  if (!file) return null
  try {
    const meta = await parseBlob(file, { duration: false, skipPostHeaders: true })
    const pic = meta.common.picture?.[0]
    if (!pic?.data?.length) return null
    const raw = new Blob([pic.data], { type: pic.format || 'image/jpeg' })
    return await downscale(raw, HI_RES_MAX_EDGE)
  } catch {
    return null
  }
}

/** 最长边超过阈值才缩放，否则直接用原图 */
async function downscale(blob: Blob, maxEdge: number): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return blob
  }
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height)
    if (longEdge <= maxEdge) return blob
    const scale = maxEdge / longEdge
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
  } finally {
    bitmap.close()
  }
}
