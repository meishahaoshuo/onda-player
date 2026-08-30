import { parseBlob } from 'music-metadata'
import * as db from './db'
import { enumerateAudioFiles } from './fs'
import type { FolderRoot, ScanProgress, SongRecord } from '@/types'

/**
 * 音乐库扫描：增量（path+size+mtime 未变则跳过）、分批让出主线程、可取消。
 * 进度通过 onProgress 回调上报（通常接到 library store）。
 */

export interface ScanTask {
  cancelled: boolean
}

function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

export function coverIdOf(album: string, albumArtist: string): string {
  return hashString(`__album__${album}__${albumArtist}`)
}

/** 封面缩略图：最长边 256px，JPEG q0.8 */
async function makeThumb(picture: Uint8Array, mime: string): Promise<Blob> {
  const view = new Uint8Array(picture.buffer, picture.byteOffset, picture.byteLength)
  const bitmap = await createImageBitmap(new Blob([view], { type: mime }))
  try {
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, w, h)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  } finally {
    bitmap.close()
  }
}

const BATCH_YIELD_EVERY = 8
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * 扫描格式版本：v2 开始提取内嵌歌词。
 * 版本升级时忽略「未变化跳过」缓存，对所有文件强制重新解析一次。
 */
const SCANNER_VERSION = 2

export async function scanRoot(
  root: FolderRoot,
  handle: FileSystemDirectoryHandle,
  onProgress: (p: ScanProgress) => void,
  task: ScanTask,
): Promise<void> {
  const progress: ScanProgress = {
    phase: 'enumerating',
    total: 0,
    scanned: 0,
    skipped: 0,
    failed: 0,
    currentFile: '',
  }
  const report = () => onProgress({ ...progress })

  const existing = new Map<string, SongRecord>()
  for (const song of await db.getAllSongs()) {
    if (song.rootId === root.id) existing.set(song.path, song)
  }
  const scannerVersion = (await db.kvGet<number>('scannerVersion')) ?? 1
  const forceAll = scannerVersion < SCANNER_VERSION
  const seenPaths = new Set<string>()
  const pendingWrites: SongRecord[] = []

  // 先入库占位，扫描完成的批次再统一落库
  const flushWrites = async () => {
    if (pendingWrites.length === 0) return
    await db.putSongs([...pendingWrites])
    pendingWrites.length = 0
  }

  let sinceYield = 0
  try {
    for await (const entry of enumerateAudioFiles(handle, task)) {
      if (task.cancelled) break
      progress.total++
      progress.currentFile = entry.path
      seenPaths.add(`${root.id}/${entry.path}`)

      const fullPath = `${root.id}/${entry.path}`
      const prev = existing.get(fullPath)
      if (
        !forceAll &&
        prev &&
        prev.fileSize === entry.file.size &&
        prev.mtimeMs === entry.file.lastModified
      ) {
        progress.skipped++
        if (++sinceYield >= BATCH_YIELD_EVERY) {
          sinceYield = 0
          report()
          await yieldToUi()
        }
        continue
      }

      progress.phase = 'parsing'
      try {
        const meta = await parseBlob(entry.file)
        const common = meta.common
        const format = meta.format
        const title = common.title ?? entry.path.split('/').pop() ?? entry.path
        const album = common.album ?? '未知专辑'
        const albumArtist = common.albumartist ?? common.artist ?? '未知艺术家'

        let coverId: string | null = null
        const pic = common.picture?.[0]
        if (pic) {
          coverId = coverIdOf(album, albumArtist)
          if (!(await db.hasCover(coverId))) {
            try {
              await db.putCover(coverId, await makeThumb(pic.data, pic.format))
            } catch {
              coverId = null // 封面图片损坏不应阻断入库
            }
          }
        }

        // 内嵌歌词（USLT 等，ILyricsTag.text），多段以空行连接
        const embeddedLyrics = common.lyrics?.length
          ? common.lyrics
              .map((l) => (typeof l === 'string' ? l : (l.text ?? '')))
              .map((l) => l.trim())
              .filter(Boolean)
              .join('\n\n')
          : null

        const record: SongRecord = {
          path: fullPath,
          rootId: root.id,
          fileName: entry.path.split('/').pop() ?? entry.path,
          title,
          artist: common.artists?.join(' / ') ?? common.artist ?? '未知艺术家',
          album,
          albumArtist,
          genre: common.genre?.join(' / ') ?? '',
          year: common.year ?? null,
          trackNo: common.track?.no ?? null,
          discNo: common.disk?.no ?? null,
          durationSec: format.duration ?? 0,
          bitrateKbps: format.bitrate ? Math.round(format.bitrate / 1000) : null,
          sampleRateHz: format.sampleRate ?? null,
          bitsPerSample: format.bitsPerSample ?? null,
          container: format.container?.toLowerCase() ?? entry.path.split('.').pop() ?? '',
          fileSize: entry.file.size,
          mtimeMs: entry.file.lastModified,
          hasCover: coverId !== null,
          coverId,
          embeddedLyrics,
        }
        pendingWrites.push(record)
        progress.scanned++
      } catch {
        // 无法解析的文件（含浏览器不支持的格式）计失败并继续
        progress.failed++
      }

      if (++sinceYield >= BATCH_YIELD_EVERY) {
        sinceYield = 0
        await flushWrites()
        report()
        await yieldToUi()
      }
    }
  } finally {
    await flushWrites()
  }

  // 清理已消失的文件记录
  const doomed = [...existing.keys()].filter((p) => !seenPaths.has(p))
  if (doomed.length > 0 && !task.cancelled) {
    await db.deleteSongs(doomed)
  }

  if (!task.cancelled) {
    await db.kvSet('scannerVersion', SCANNER_VERSION)
  }

  progress.phase = 'done'
  progress.currentFile = ''
  report()
}
