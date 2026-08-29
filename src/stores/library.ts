import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as db from '@/services/db'
import { pickFolder, queryPermission, removeFolder, requestPermission, type PermissionState } from '@/services/fs'
import { scanRoot, type ScanTask } from '@/services/scanner'
import type { FolderRoot, ScanProgress, SongRecord } from '@/types'

/**
 * 音乐库：根文件夹、歌曲数据、扫描进度、封面 URL 缓存
 */
export const useLibraryStore = defineStore('library', () => {
  const roots = ref<(FolderRoot & { permission: PermissionState })[]>([])
  const songs = ref<SongRecord[]>([])
  const loaded = ref(false)
  const scanning = ref(false)
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
    const handle = await pickFolder()
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
    loaded,
    scanning,
    scanProgress,
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
