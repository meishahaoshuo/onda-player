import { invoke } from '@tauri-apps/api/core'
import * as db from './db'
import type { RootRef } from '@/types'

/**
 * 文件夹授权与文件枚举，平台双形态（docs/02「桌面端重要说明」）：
 *  - web：File System Access API，句柄持久化到 IndexedDB，权限需确认
 *  - desktop（Tauri）：目录路径持久化，原生对话框选择；枚举/读取走 Rust 命令，
 *    播放走 media:// 协议（Rust 侧按 Range 流式返回）
 * 平台差异收敛在本文件，调用方只感知 RootRef 与统一函数签名。
 */

const AUDIO_EXTS = new Set(['mp3', 'flac', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac', 'webm', 'wma'])

export const isDesktop = '__TAURI_INTERNALS__' in window

export type PermissionState = 'granted' | 'prompt' | 'denied'

function desktopPathOf(ref: RootRef | undefined | null): string | null {
  return ref && typeof ref === 'object' && 'desktopPath' in ref ? ref.desktopPath : null
}

/** 由路径拼绝对文件路径（Windows 的 std::fs 接受 '/' 分隔） */
function joinAbs(base: string, segments: string[]): string {
  return [base.replace(/[\\/]+$/, ''), ...segments].join('/')
}

/** 弹出文件夹选择器：web=FSA 选择器；desktop=原生对话框 */
export async function pickFolder(): Promise<RootRef | null> {
  if (isDesktop) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false, title: '选择音乐文件夹' })
    if (typeof picked !== 'string' || !picked) return null
    return { desktopPath: picked }
  }
  if (!('showDirectoryPicker' in window)) {
    throw new Error('当前浏览器不支持文件夹选择（需要 Chrome/Edge）')
  }
  const handle = await (window as any).showDirectoryPicker({ mode: 'read' })
  return (handle ?? null) as RootRef | null
}

/** 根目录显示名：web=句柄 name；desktop=路径末段 */
export function refName(ref: RootRef): string {
  const p = desktopPathOf(ref)
  if (p != null) return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
  return (ref as FileSystemDirectoryHandle).name
}

export async function queryPermission(ref: RootRef): Promise<PermissionState> {
  if (desktopPathOf(ref)) return 'granted' // 桌面端路径无权限机制
  return (await (ref as FileSystemDirectoryHandle).queryPermission({ mode: 'read' })) as PermissionState
}

export async function requestPermission(ref: RootRef): Promise<PermissionState> {
  if (desktopPathOf(ref)) return 'granted'
  return (await (ref as FileSystemDirectoryHandle).requestPermission({ mode: 'read' })) as PermissionState
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
  const ref = await db.getRootHandle(rootId)
  const base = desktopPathOf(ref ?? null)
  if (!base) return null
  const segments = songRelativePath.split('/')
  const fileName = segments.pop()!
  const lrcName = fileName.replace(/\.[^.]+$/, '') + '.lrc'
  try {
    return await invoke<string>('read_text_file', { path: joinAbs(base, [...segments, lrcName]) })
  } catch {
    return null
  }
}

/** 读根目录的桌面路径（desktop 专用，web 返回 null） */
export async function getRootBase(rootId: string): Promise<string | null> {
  const ref = await db.getRootHandle(rootId)
  return desktopPathOf(ref ?? null)
}

/** 读音频文件头部字节（desktop 标签解析用；返回 ArrayBuffer，失败返回 null） */
export async function readHeadBytes(
  rootId: string,
  relativePath: string,
  maxLen = 2 * 1024 * 1024,
): Promise<Uint8Array | null> {
  const base = await getRootBase(rootId)
  if (!base) return null
  try {
    const buf = await invoke<ArrayBuffer>('read_head', {
      path: joinAbs(base, relativePath.split('/')),
      maxLen,
    })
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

/** 歌曲的 media:// 播放地址（desktop；web 走 resolveSongFile + objectURL） */
export async function songMediaUrl(rootId: string, relativePath: string): Promise<string | null> {
  const base = await getRootBase(rootId)
  if (!base) return null
  const abs = joinAbs(base, relativePath.split('/'))
  // Tauri/Windows 上自定义协议以 http://media.localhost 形式可达（Rust 侧注册 media）
  return `http://media.localhost/?p=${encodeURIComponent(abs)}`
}

/** 把歌曲记录（"rootId/相对路径"）解析为 File 对象（仅 web；desktop 返回 null） */
export async function resolveSongFile(
  rootId: string,
  relativePath: string,
): Promise<File | null> {
  if (isDesktop) return null
  const root = await db.getRootHandle(rootId)
  if (!root) return null
  const segments = relativePath.split('/')
  const fileName = segments.pop()!
  let dir = root as FileSystemDirectoryHandle
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

/** 枚举产生的条目：web 带 File；desktop 带 absPath/size/mtimeMs */
export interface AudioEntry {
  path: string
  handle: FileSystemFileHandle | { desktopAbs: string }
  /** web 为 File；desktop 为 null（解析走 readHeadBytes） */
  file: File | null
  absPath?: string
  size?: number
  mtimeMs?: number
}

/** 枚举某根目录下全部音频文件 */
export async function* enumerateAudioFiles(
  root: RootRef,
  signal?: { cancelled: boolean },
): AsyncGenerator<AudioEntry> {
  const base = desktopPathOf(root)
  if (base != null) {
    const list = await invoke<{ abs: string; rel: string; size: number; mtime_ms: number }[]>(
      'list_audio_files',
      { dir: base },
    )
    for (const e of list) {
      if (signal?.cancelled) return
      yield {
        path: e.rel,
        handle: { desktopAbs: e.abs },
        file: null,
        absPath: e.abs,
        size: e.size,
        mtimeMs: e.mtime_ms,
      }
    }
    return
  }
  const dir = root as FileSystemDirectoryHandle
  async function* walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
  ): AsyncGenerator<AudioEntry> {
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
  yield* walk(dir, '')
}
