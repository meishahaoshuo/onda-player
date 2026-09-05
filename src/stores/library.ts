import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as db from '@/services/db'
import { pickFolder, queryPermission, removeFolder, requestPermission, type PermissionState } from '@/services/fs'
import { extractHiResCover } from '@/services/cover'
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
    schedulePrewarm()
  }

  /* ---------- 封面 URL 预热 ----------
     启动后空闲时把封面 URL 预读进内存缓存（coverId → objectURL），
     本次会话第一次进任何页面，封面都不用再"先占位、后蹦出"。
     256px 缩略图每张仅十几 KB；上限兜底超大歌库，超出部分仍按需加载。 */
  const PREWARM_LIMIT = 600
  let prewarmStarted = false

  function schedulePrewarm() {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    if (ric) ric(() => void prewarmCovers())
    else window.setTimeout(() => void prewarmCovers(), 800)
  }

  async function prewarmCovers() {
    if (prewarmStarted) return
    prewarmStarted = true
    const ids: string[] = []
    const seen = new Set<string>()
    for (const s of songs.value) {
      if (s.coverId && !seen.has(s.coverId)) {
        seen.add(s.coverId)
        ids.push(s.coverId)
        if (ids.length >= PREWARM_LIMIT) break
      }
    }
    if (ids.length === 0) {
      prewarmStarted = false // 首次启动曲库为空，扫描完成后再预热
      return
    }
    let i = 0
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++]
        if (!coverUrls.value.has(id)) {
          try {
            await coverUrl(id)
          } catch {
            /* 预热失败不阻塞，按需加载兜底 */
          }
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
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
      schedulePrewarm() // 扫描产生的新封面在空闲时补预热
    }
  }

  function cancelScan() {
    if (scanTask) scanTask.cancelled = true
  }

  /* ---------- 封面 URL 缓存 ---------- */
  const coverUrls = ref(new Map<string, string>())

  /** 同步读取已缓存的封面 URL（未命中返回 null）。供组件首帧直接上 src，避免切页回来时封面闪一下。 */
  function peekCoverUrl(coverId: string | null): string | null {
    return coverId ? coverUrls.value.get(coverId) ?? null : null
  }

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

  /* ---------- 高清封面（大图场景按需提取，内存 LRU） ---------- */

  /** coverId → objectURL，插入顺序即 LRU 顺序（越靠后越新） */
  const hiResUrls = new Map<string, string>()
  const hiResPending = new Map<string, Promise<string | null>>()
  const HI_RES_LRU_LIMIT = 32

  function hiResEvict() {
    while (hiResUrls.size > HI_RES_LRU_LIMIT) {
      const oldest = hiResUrls.keys().next().value as string | undefined
      if (oldest === undefined) break
      const url = hiResUrls.get(oldest)
      if (url) URL.revokeObjectURL(url)
      hiResUrls.delete(oldest)
    }
  }

  /**
   * 高清封面 URL：找不到内嵌图时返回 null（调用方继续用缩略图）。
   * 同一 coverId 并发请求只提取一次。
   */
  function coverUrlHi(coverId: string | null): Promise<string | null> {
    if (!coverId) return Promise.resolve(null)
    const hit = hiResUrls.get(coverId)
    if (hit) {
      // 命中后移到队尾
      hiResUrls.delete(coverId)
      hiResUrls.set(coverId, hit)
      return Promise.resolve(hit)
    }
    const inflight = hiResPending.get(coverId)
    if (inflight) return inflight

    const task = (async () => {
      const song = songs.value.find((s) => s.coverId === coverId)
      if (!song) return null
      const blob = await extractHiResCover(song)
      if (!blob) return null
      const url = URL.createObjectURL(blob)
      hiResUrls.set(coverId, url)
      hiResEvict()
      return url
    })().finally(() => {
      hiResPending.delete(coverId)
    })

    hiResPending.set(coverId, task)
    return task
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
    peekCoverUrl,
    coverUrlHi,
  }
})
