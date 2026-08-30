import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as db from '@/services/db'
import { pickFolder, queryPermission, removeFolder, requestPermission, type PermissionState } from '@/services/fs'
import { scanRoot, type ScanTask } from '@/services/scanner'
import type { AlbumSummary, FolderRoot, ScanProgress, SongRecord } from '@/types'

/**
 * 音乐库：根文件夹、歌曲数据、扫描进度、封面 URL 缓存
 */
export const useLibraryStore = defineStore('library', () => {
  const roots = ref<(FolderRoot & { permission: PermissionState })[]>([])
  const songs = ref<SongRecord[]>([])
  const loaded = ref(false)
  const scanning = ref(false)
  /** 文件夹选择/扫描的最近一次错误（供界面横幅展示） */
  const lastError = ref<string | null>(null)
  const scanProgress = ref<ScanProgress>({
    phase: 'idle',
    total: 0,
    scanned: 0,
    skipped: 0,
    failed: 0,
    currentFile: '',
  })

  let scanTask: ScanTask | null = null

  const sortedSongs = computed(() =>
    [...songs.value].sort(
      (a, b) =>
        a.title.localeCompare(b.title, 'zh-Hans-CN') || a.path.localeCompare(b.path),
    ),
  )

  /* ---------- 聚合视图数据 ---------- */

  const albums = computed<AlbumSummary[]>(() => {
    const map = new Map<string, SongRecord[]>()
    for (const s of songs.value) {
      const key = `${s.album}\n${s.albumArtist}`
      const list = map.get(key)
      if (list) list.push(s)
      else map.set(key, [s])
    }
    return [...map.entries()].map(([key, list]) => {
      const sorted = [...list].sort(
        (a, b) =>
          (a.discNo ?? 1) - (b.discNo ?? 1) ||
          (a.trackNo ?? 9999) - (b.trackNo ?? 9999) ||
          a.title.localeCompare(b.title, 'zh-Hans-CN'),
      )
      const withYear = sorted.find((s) => s.year !== null)
      return {
        key,
        name: sorted[0].album,
        artist: sorted[0].albumArtist,
        year: withYear?.year ?? null,
        songs: sorted,
        coverId: sorted.find((s) => s.coverId)?.coverId ?? null,
        totalDuration: sorted.reduce((sum, s) => sum + s.durationSec, 0),
      }
    })
  })

  const artists = computed(() => {
    const map = new Map<string, SongRecord[]>()
    for (const s of songs.value) {
      for (const name of s.artist.split(' / ').map((x) => x.trim()).filter(Boolean)) {
        const list = map.get(name)
        if (list) list.push(s)
        else map.set(name, [s])
      }
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, songs: list, coverId: list.find((s) => s.coverId)?.coverId ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  })

  const genres = computed(() => {
    const map = new Map<string, SongRecord[]>()
    for (const s of songs.value) {
      const g = s.genre || '未知曲风'
      const list = map.get(g)
      if (list) list.push(s)
      else map.set(g, [s])
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, songs: list }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  })

  /** 启动：从 DB 恢复歌曲列表与根文件夹（权限需用户点击确认后才恢复） */
  async function init() {
    songs.value = await db.getAllSongs()
    const order = (await db.getRootOrder()) ?? []
    const allRoots = await db.getAllRoots()
    roots.value = await Promise.all(
      order
        .map((id) => allRoots.find((r) => r.id === id))
        .filter((r): r is FolderRoot => r !== undefined)
        .map(async (r) => {
          const handle = await db.getRootHandle(r.id)
          return { ...r, permission: handle ? await queryPermission(handle) : 'denied' }
        }),
    )
    loaded.value = true
  }

  async function addFolder(): Promise<boolean> {
    lastError.value = null
    let handle: FileSystemDirectoryHandle | null
    try {
      handle = await pickFolder()
    } catch (e) {
      lastError.value =
        e instanceof Error && /abort/i.test(e.message)
          ? null // 用户取消了选择器，不算错误
          : `无法打开文件夹选择器：${e instanceof Error ? e.message : String(e)}（请使用最新版 Chrome/Edge）`
      return false
    }
    if (!handle) return false
    await registerRoot(handle)
    await rescan()
    return true
  }

  /** 注册一个已授权的根目录句柄（pickFolder 与测试桥共用） */
  async function registerRoot(handle: FileSystemDirectoryHandle): Promise<FolderRoot> {
    const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const root: FolderRoot = { id, name: handle.name, addedAt: Date.now() }
    await db.putRootHandle(id, handle)
    await db.putRoot(root)
    const order = (await db.getRootOrder()) ?? []
    await db.setRootOrder([...order, id])
    roots.value = [...roots.value, { ...root, permission: 'granted' }]
    return root
  }

  /** 用户点击恢复某文件夹的读取权限（requestPermission 需要用户手势） */
  async function restorePermission(rootId: string) {
    const handle = await db.getRootHandle(rootId)
    if (!handle) return
    const state = await requestPermission(handle)
    roots.value = roots.value.map((r) =>
      r.id === rootId ? { ...r, permission: state } : r,
    )
  }

  async function removeFolderById(rootId: string) {
    await removeFolder(rootId)
    roots.value = roots.value.filter((r) => r.id !== rootId)
    songs.value = songs.value.filter((s) => s.rootId !== rootId)
  }

  /** 全量重扫所有根目录（增量：未变化的文件只跳过） */
  async function rescan() {
    if (scanning.value) return
    scanning.value = true
    scanTask = { cancelled: false }
    try {
      for (const root of roots.value) {
        if (scanTask.cancelled) break
        if (root.permission !== 'granted') continue
        const handle = await db.getRootHandle(root.id)
        if (!handle) continue
        await scanRoot(
          root,
          handle,
          (p) => {
            scanProgress.value = p
          },
          scanTask,
        )
        // 扫描中实时并入新数据，列表即时可见
        songs.value = await db.getAllSongs()
      }
    } finally {
      scanning.value = false
    }
  }

  function cancelScan() {
    if (scanTask) scanTask.cancelled = true
  }

  /* ---------- 封面 URL 缓存 ---------- */
  const coverUrls = ref(new Map<string, string>())

  async function coverUrl(coverId: string | null): Promise<string | null> {
    if (!coverId) return null
    const cached = coverUrls.value.get(coverId)
    if (cached) return cached
    const blob = await db.getCover(coverId)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    coverUrls.value.set(coverId, url)
    return url
  }

  return {
    roots,
    songs,
    sortedSongs,
    albums,
    artists,
    genres,
    loaded,
    scanning,
    scanProgress,
    lastError,
    init,
    addFolder,
    registerRoot,
    restorePermission,
    removeFolderById,
    rescan,
    cancelScan,
    coverUrl,
  }
})
