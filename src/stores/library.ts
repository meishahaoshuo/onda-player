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
    // 「按专辑」分组：只看专辑名，完全不看歌手——同一张专辑（即使各曲目
    // 的专辑艺术家/内嵌封面字节不同）只显示一张卡片。专辑名缺失时按艺术家兜底。
    const map = new Map<string, SongRecord[]>()
    for (const s of songs.value) {
      const key = s.album ? `album:${s.album}` : `meta:${s.albumArtist}`
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
      // 艺术家展示：取专辑艺术家的首位（"周杰伦、林迈可"→周杰伦）；
      // 首位都不一致（真合辑）才显示"群星"
      const leads = [...new Set(sorted.map((s) => s.albumArtist.split(/[、/]/)[0].trim()).filter(Boolean))]
      return {
        key,
        name: sorted[0].album,
        artist: leads.length === 1 ? leads[0] : '群星',
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

  /** 从资料库移除指定歌曲（不删磁盘文件；重新扫描会恢复） */
  async function removeSongs(paths: string[]) {
    const doomed = new Set(paths)
    songs.value = songs.value.filter((s) => !doomed.has(s.path))
    await db.deleteSongs(paths)
  }

  /** 歌曲所属专辑的详情 key（与 albums computed 的 key 规则一致） */
  function albumKeyOf(song: SongRecord): string {
    return song.album ? `album:${song.album}` : `meta:${song.albumArtist}`
  }

  /** 歌曲主艺术家（与 artists computed 的拆分规则一致） */
  function artistNameOf(song: SongRecord): string {
    return song.artist.split(' / ')[0]?.trim() || song.artist
  }

  /** 全量重扫所有根目录（增量：未变化的文件只跳过） */
  async function rescan() {
    if (scanning.value) return
    scanning.value = true
    scanTask = { cancelled: false }
    // 重新扫描也触发吸入动画：封面取自全部文件夹的曲库（洗牌抽样），
    // 与「新入库批次」走同一 sink，flownCoverIds 去重保证不重复起飞
    emitRescanShow()
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
          (batch) => {
            // 本批新入库歌曲的封面（同专辑共享 coverId，去重）→ 转发给吸入动画订阅者
            const ids = [...new Set(batch.map((s) => s.coverId).filter(Boolean))] as string[]
            if (ids.length > 0) scanBatchSink?.(ids)
          },
        )
        // 扫描中实时并入新数据，列表即时可见
        songs.value = await db.getAllSongs()
      }
    } finally {
      scanning.value = false
      schedulePrewarm() // 扫描产生的新封面在空闲时补预热
    }
  }

  /** 扫描批次订阅槽：吸入动画（absorbFlight）经此接收每批新入库的封面 id，store 不依赖动画模块 */
  let scanBatchSink: ((coverIds: string[]) => void) | null = null
  function setScanBatchSink(fn: ((coverIds: string[]) => void) | null) {
    scanBatchSink = fn
  }

  /**
   * 重扫演出：把全库封面洗牌抽样成最多 4 批投喂给吸入动画。
   * 批间节奏由 absorbFlight 的队列泵控制（BATCH_GAP + 在飞等待），
   * 这里一次性入队即可；setTimeout(0) 等 scanning watcher 先清场，避免旧
   * flownCoverIds 残留误去重。重扫结束时未消费的批也会继续飞完再收漩涡。
   */
  function emitRescanShow() {
    const ids = [...new Set(songs.value.map((s) => s.coverId).filter(Boolean))] as string[]
    if (ids.length === 0) return
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
    }
    window.setTimeout(() => {
      const batches = Math.min(4, Math.ceil(ids.length / 6))
      for (let b = 0; b < batches; b++) scanBatchSink?.(ids.slice(b * 6, b * 6 + 6))
    }, 0)
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
    loaded,
    scanning,
    scanProgress,
    lastError,
    init,
    addFolder,
    registerRoot,
    restorePermission,
    removeFolderById,
    removeSongs,
    albumKeyOf,
    artistNameOf,
    rescan,
    setScanBatchSink,
    cancelScan,
    coverUrl,
    peekCoverUrl,
    coverUrlHi,
  }
})
