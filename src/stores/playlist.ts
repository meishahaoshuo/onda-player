import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as db from '@/services/db'
import type { PlaylistRecord } from '@/types'

const ORDER_KEY = 'playlists.order'

/** 歌单：增删改查 + 内含歌曲的顺序维护，全部即时持久化到 IndexedDB */
export const usePlaylistStore = defineStore('playlists', () => {
  const playlists = ref<PlaylistRecord[]>([])
  const loaded = ref(false)

  async function load() {
    const rows = await db.getAllPlaylists()
    // 按 kv 里保存的拖拽顺序排序，未登记的新歌单排在末尾
    const order = (await db.kvGet<string[]>(ORDER_KEY)) ?? []
    const idx = new Map(order.map((id, i) => [id, i]))
    rows.sort((a, b) => (idx.get(a.id) ?? Infinity) - (idx.get(b.id) ?? Infinity))
    playlists.value = rows
    loaded.value = true
  }

  function create(name: string, seedPaths: string[] = []): PlaylistRecord {
    const playlist: PlaylistRecord = {
      id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || '新建歌单',
      songPaths: [...seedPaths],
      createdAt: Date.now(),
    }
    playlists.value = [...playlists.value, playlist]
    void db.putPlaylist(playlist)
    return playlist
  }

  function rename(id: string, name: string) {
    update(id, (p) => ({ ...p, name: name.trim() || p.name }))
  }

  function remove(id: string) {
    playlists.value = playlists.value.filter((p) => p.id !== id)
    void db.deletePlaylist(id)
  }

  function addSongs(id: string, paths: string[]) {
    update(id, (p) => {
      const existing = new Set(p.songPaths)
      const fresh = paths.filter((x) => !existing.has(x))
      return fresh.length > 0 ? { ...p, songPaths: [...p.songPaths, ...fresh] } : p
    })
  }

  function removeSong(id: string, path: string) {
    update(id, (p) => ({ ...p, songPaths: p.songPaths.filter((x) => x !== path) }))
  }

  /** 拖拽排序：把 fromPos 位置的歌移到 toPos */
  function moveSong(id: string, fromPos: number, toPos: number) {
    update(id, (p) => {
      const next = [...p.songPaths]
      const [moved] = next.splice(fromPos, 1)
      if (moved === undefined) return p
      next.splice(toPos, 0, moved)
      return { ...p, songPaths: next }
    })
  }

  /** 侧栏歌单子项拖拽排序：重排歌单数组并持久化顺序 */
  function reorder(from: number, to: number) {
    const arr = [...playlists.value]
    const [moved] = arr.splice(from, 1)
    if (moved === undefined) return
    arr.splice(to, 0, moved)
    playlists.value = arr
    void db.kvSet(ORDER_KEY, arr.map((p) => p.id))
  }

  /** 指定歌单封面来源歌曲；null 恢复默认（自动拼贴） */
  function setCover(id: string, path: string | null) {
    update(id, (p) => {
      const next = { ...p, coverPath: path ?? undefined }
      if (path === null) delete next.coverPath
      // 歌曲封面与自定义导入封面互斥
      delete next.customCoverId
      return next
    })
  }

  /** 设置用户导入的自定义封面（coverId 须已写入 covers 库）；null 恢复默认 */
  function setCustomCover(id: string, coverId: string | null) {
    update(id, (p) => {
      const next = { ...p, customCoverId: coverId ?? undefined }
      if (coverId === null) delete next.customCoverId
      else delete next.coverPath
      return next
    })
  }

  function update(id: string, fn: (p: PlaylistRecord) => PlaylistRecord) {
    playlists.value = playlists.value.map((p) => {
      if (p.id !== id) return p
      const next = fn(p)
      // songPaths 可能是响应式 Proxy（如 rename 的浅拷贝路径），
      // IndexedDB 结构化克隆不接受 Proxy，必须还原为普通数组
      void db.putPlaylist({ ...next, songPaths: [...next.songPaths] })
      return next
    })
  }

  return { playlists, loaded, load, create, rename, remove, addSongs, removeSong, moveSong, reorder, setCover, setCustomCover }
})

/** 歌单手动封面的最终 coverId：用户导入的自定义图优先，其次封面来源歌曲；都没设返回 null */
export function playlistManualCoverId(
  p: PlaylistRecord,
  coverByPath: Map<string, string | null>,
): string | null {
  if (p.customCoverId) return p.customCoverId
  if (p.coverPath) return coverByPath.get(p.coverPath) ?? null
  return null
}
