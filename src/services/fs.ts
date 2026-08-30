import * as db from './db'
import type { FolderRoot } from '@/types'

/**
 * 文件夹授权与文件枚举（File System Access API）。
 * 句柄持久化到 IndexedDB；权限状态由调用方检查/请求。
 */

const AUDIO_EXTS = new Set(['mp3', 'flac', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac', 'webm', 'wma'])

export type PermissionState = 'granted' | 'prompt' | 'denied'

export async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (await handle.queryPermission({ mode: 'read' })) as PermissionState
}

export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (await handle.requestPermission({ mode: 'read' })) as PermissionState
}

/** 弹出系统文件夹选择器（授权由浏览器选择器自带） */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('当前浏览器不支持文件夹选择（需要 Chrome/Edge）')
  }
  const handle = await (window as any).showDirectoryPicker({ mode: 'read' })
  return handle ?? null
}

export async function removeFolder(rootId: string) {
  await removeRootOnly(rootId)
  await db.deleteSongsByRoot(rootId)
  const order = (await db.getRootOrder()) ?? []
  await db.setRootOrder(order.filter((x) => x !== rootId))
}

export async function removeRootOnly(rootId: string) {
  await db.deleteRootHandle(rootId)
  await db.deleteRoot(rootId)
}

/** 读取歌曲同目录同名 .lrc 歌词文本 */
export async function readLrcFile(
  rootId: string,
  songRelativePath: string,
): Promise<string | null> {
  const root = await db.getRootHandle(rootId)
  if (!root) return null
  const segments = songRelativePath.split('/')
  const fileName = segments.pop()!
  const lrcName = fileName.replace(/\.[^.]+$/, '') + '.lrc'
  let dir = root
  for (const seg of segments) {
    try {
      dir = await dir.getDirectoryHandle(seg)
    } catch {
      return null
    }
  }
  try {
    const fh = await dir.getFileHandle(lrcName)
    const file = await fh.getFile()
    return await file.text()
  } catch {
    return null
  }
}

/** 把歌曲记录（"rootId/相对路径"）解析为 File 对象 */
export async function resolveSongFile(
  rootId: string,
  relativePath: string,
): Promise<File | null> {
  const root = await db.getRootHandle(rootId)
  if (!root) return null
  const segments = relativePath.split('/')
  const fileName = segments.pop()!
  let dir = root
  for (const seg of segments) {
    try {
      dir = await dir.getDirectoryHandle(seg)
    } catch {
      return null
    }
  }
  try {
    const fh = await dir.getFileHandle(fileName)
    return await fh.getFile()
  } catch {
    return null
  }
}

/** 枚举某根目录下全部音频文件 */
export async function* enumerateAudioFiles(
  root: FileSystemDirectoryHandle,
  signal?: { cancelled: boolean },
): AsyncGenerator<{ path: string; handle: FileSystemFileHandle; file: File }> {
  async function* walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
  ): AsyncGenerator<{ path: string; handle: FileSystemFileHandle; file: File }> {
    for await (const [name, entry] of dir.entries()) {
      if (signal?.cancelled) return
      if (entry.kind === 'directory') {
        if (name.startsWith('.')) continue
        yield* walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`)
      } else {
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        if (!AUDIO_EXTS.has(ext)) continue
        const fileHandle = entry as FileSystemFileHandle
        const file = await fileHandle.getFile()
        yield {
          path: `${prefix}${name}`,
          handle: fileHandle,
          file,
        }
      }
    }
  }
  yield* walk(root, '')
}
