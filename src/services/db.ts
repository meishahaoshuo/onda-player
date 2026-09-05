import { openDB, type IDBPDatabase } from 'idb'
import type { FolderRoot, PlaylistRecord, SongRecord } from '@/types'

/**
 * IndexedDB 封装（库 music-player，模型见 docs/02-技术方案.md §3）。
 * 全应用唯一的 DB 入口。
 */

interface MusicPlayerDB extends IDBPDatabase {
  // stores 在 getDB 中以版本号创建，这里用非泛型访问
}

let dbPromise: Promise<MusicPlayerDB> | null = null

function getDB(): Promise<MusicPlayerDB> {
  if (!dbPromise) {
    dbPromise = openDB('music-player', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('handles')
          db.createObjectStore('songs', { keyPath: 'path' })
          db.createObjectStore('covers')
          db.createObjectStore('playlists', { keyPath: 'id' })
          db.createObjectStore('kv')
        }
        // v2：播放统计与我喜欢的音乐
        if (oldVersion < 2) {
          db.createObjectStore('stats')
          db.createObjectStore('favorites')
        }
      },
    }) as Promise<MusicPlayerDB>
  }
  return dbPromise
}

/* ---------- handles / 文件夹 ---------- */

export async function putRootHandle(id: string, handle: FileSystemDirectoryHandle) {
  const db = await getDB()
  await db.put('handles', handle, `root:${id}`)
}

export async function getRootHandle(id: string): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await getDB()
  return db.get('handles', `root:${id}`)
}

export async function deleteRootHandle(id: string) {
  const db = await getDB()
  await db.delete('handles', `root:${id}`)
}

export async function putRoot(root: FolderRoot) {
  const db = await getDB()
  await db.put('kv', root, `folderRoot:${root.id}`)
}

export async function deleteRoot(id: string) {
  const db = await getDB()
  await db.delete('kv', `folderRoot:${id}`)
}

export async function getAllRoots(): Promise<FolderRoot[]> {
  const db = await getDB()
  const roots: FolderRoot[] = []
  let cursor = await db.transaction('kv').store.openCursor()
  while (cursor) {
    if (String(cursor.key).startsWith('folderRoot:')) {
      roots.push(cursor.value as FolderRoot)
    }
    cursor = await cursor.continue()
  }
  return roots.sort((a, b) => a.addedAt - b.addedAt)
}

/** 保存根目录顺序（id 列表） */
export async function setRootOrder(ids: string[]) {
  const db = await getDB()
  await db.put('kv', ids, 'folderOrder')
}

export async function getRootOrder(): Promise<string[] | undefined> {
  const db = await getDB()
  return db.get('kv', 'folderOrder')
}

/* ---------- songs ---------- */

export async function putSongs(songs: SongRecord[]) {
  const db = await getDB()
  const tx = db.transaction('songs', 'readwrite')
  await Promise.all(songs.map((s) => tx.store.put(s)))
  await tx.done
}

export async function getAllSongs(): Promise<SongRecord[]> {
  const db = await getDB()
  return db.getAll('songs') as Promise<SongRecord[]>
}

export async function getSongPaths(): Promise<Set<string>> {
  const db = await getDB()
  const keys = await db.getAllKeys('songs')
  return new Set(keys as string[])
}

export async function deleteSongs(paths: string[]) {
  const db = await getDB()
  const tx = db.transaction('songs', 'readwrite')
  await Promise.all(paths.map((p) => tx.store.delete(p)))
  await tx.done
}

export async function deleteSongsByRoot(rootId: string) {
  const db = await getDB()
  const tx = db.transaction('songs', 'readwrite')
  let cursor = await tx.store.openCursor()
  const doomed: string[] = []
  while (cursor) {
    if ((cursor.value as SongRecord).rootId === rootId) doomed.push(cursor.key as string)
    cursor = await cursor.continue()
  }
  await Promise.all(doomed.map((p) => tx.store.delete(p)))
  await tx.done
}

/* ---------- covers ---------- */

export async function putCover(coverId: string, blob: Blob) {
  const db = await getDB()
  await db.put('covers', blob, coverId)
}

export async function getCover(coverId: string): Promise<Blob | undefined> {
  const db = await getDB()
  return db.get('covers', coverId)
}

export async function hasCover(coverId: string): Promise<boolean> {
  const db = await getDB()
  const key = await db.getKey('covers', coverId)
  return key !== undefined
}

/* ---------- playlists ---------- */

export async function putPlaylist(playlist: PlaylistRecord) {
  const db = await getDB()
  await db.put('playlists', playlist)
}

export async function getAllPlaylists(): Promise<PlaylistRecord[]> {
  const db = await getDB()
  return db.getAll('playlists')
}

export async function deletePlaylist(id: string) {
  const db = await getDB()
  await db.delete('playlists', id)
}

/* ---------- kv（设置/播放状态） ---------- */

export async function kvSet(key: string, value: unknown) {
  const db = await getDB()
  await db.put('kv', value, key)
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDB()
  return db.get('kv', key)
}

/* ---------- stats（播放统计，key = 歌曲 path） ---------- */

export interface PlayStat {
  playCount: number
  lastPlayedAt: number
}

export async function putStat(path: string, stat: PlayStat) {
  const db = await getDB()
  await db.put('stats', stat, path)
}

/** 全部统计，按 path 配对返回 */
export async function getAllStats(): Promise<{ path: string; stat: PlayStat }[]> {
  const db = await getDB()
  const tx = db.transaction('stats')
  const [keys, vals] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()])
  await tx.done
  return keys.map((k, i) => ({
    path: String(k),
    stat: vals[i] as PlayStat,
  }))
}

export async function clearStats() {
  const db = await getDB()
  await db.clear('stats')
}

/* ---------- favorites（我喜欢的音乐，key = 歌曲 path） ---------- */

export interface FavoriteEntry {
  addedAt: number
}

export async function putFavorite(path: string, entry: FavoriteEntry) {
  const db = await getDB()
  await db.put('favorites', entry, path)
}

export async function deleteFavorite(path: string) {
  const db = await getDB()
  await db.delete('favorites', path)
}

export async function getAllFavorites(): Promise<{ path: string; addedAt: number }[]> {
  const db = await getDB()
  const tx = db.transaction('favorites')
  const [keys, vals] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()])
  await tx.done
  return keys.map((k, i) => ({
    path: String(k),
    addedAt: (vals[i] as FavoriteEntry).addedAt,
  }))
}

export async function clearFavorites() {
  const db = await getDB()
  await db.clear('favorites')
}
