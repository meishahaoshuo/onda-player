import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ViewId } from '@/types'

/**
 * 界面导航状态（无路由依赖，视图由 App.vue 切换）。
 * detail 用于聚合页的钻取：如专辑页 → 专辑详情。
 */
export const useUiStore = defineStore('ui', () => {
  const activeView = ref<ViewId>('songs')
  const detailKey = ref<string | null>(null)
  /** 侧边栏「新建歌单」请求标记，由 PlaylistsView 消费 */
  const playlistCreateRequested = ref(false)
  /** 请求新建歌单时预置加入的歌曲（右键「新建歌单并加入」用） */
  const playlistCreateSeedPaths = ref<string[]>([])
  /** 全屏歌词页开关 */
  const lyricsOpen = ref(false)
  /** 专辑过渡编排状态：idle 空闲 / enter 推进中 / exit 返回中（同时用作连点闸门） */
  const dolly = ref<'idle' | 'enter' | 'exit'>('idle')
  /** 顶部搜索框关键词：非空时内容区显示搜索结果 */
  const searchQuery = ref('')
  /** 搜索范围强制为全库（默认按当前页面上下文收窄，用户可手动切到全库） */
  const searchAll = ref(false)
  /** 文件夹板块当前选中的根目录 id（搜索作用域需要知道它） */
  const folderRootId = ref<string | null>(null)
  /** 侧栏歌单右键「设置封面」请求：歌单 id，PlaylistsView 消费后清空 */
  const playlistEditCover = ref<string | null>(null)
  /** 歌单右键「添加歌曲」请求：歌单 id，PlaylistsView 消费后清空（详情头部按钮已精简） */
  const playlistAddSongs = ref<string | null>(null)

  /* ---------- 侧栏导航顺序（长按拖拽调整，localStorage 持久化） ---------- */
  const NAV_ORDER_KEY = 'ui.navOrder'
  const DEFAULT_NAV_ORDER = [
    'songs',
    'favorites',
    'recent',
    'charts',
    'albums',
    'artists',
    'folders',
    'settings',
  ]
  const navOrder = ref<string[]>(loadNavOrder())

  function loadNavOrder(): string[] {
    try {
      const raw = JSON.parse(localStorage.getItem(NAV_ORDER_KEY) ?? '[]') as string[]
      if (Array.isArray(raw) && raw.length > 0) {
        // 默认项补齐（新版本新增的视图），未知项丢弃
        const set = new Set(raw.filter((id) => DEFAULT_NAV_ORDER.includes(id)))
        return [...DEFAULT_NAV_ORDER.filter((id) => set.has(id)), ...DEFAULT_NAV_ORDER.filter((id) => !set.has(id))]
      }
    } catch {
      /* 损坏则回退默认 */
    }
    return [...DEFAULT_NAV_ORDER]
  }

  function reorderNav(from: number, to: number) {
    const arr = [...navOrder.value]
    const [moved] = arr.splice(from, 1)
    if (moved === undefined) return
    arr.splice(to, 0, moved)
    navOrder.value = arr
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(arr))
  }

  /* ---------- 滚动位置记忆（全应用） ----------
     key 约定：
     - `view:<视图id>|<detailKey>`：外层 .view-body 滚动位置（App.vue 统一捕获/恢复）
     - `list:<来源>:<id>`：.scroll-host 滚动宿主上列表的滚动位置
       （SongList/VirtualList 自存自取；外层滚动架构下记录的是宿主 scrollTop） */
  const scrollMemory = new Map<string, number>()

  function rememberScroll(key: string, top: number) {
    scrollMemory.set(key, top)
  }

  function recallScroll(key: string): number {
    return scrollMemory.get(key) ?? 0
  }

  function navigate(view: ViewId) {
    activeView.value = view
    detailKey.value = null
    dolly.value = 'idle'
    // 换页面就等于换搜索上下文：清掉关键词，否则内容区仍停在旧的搜索结果上
    searchQuery.value = ''
    searchAll.value = false
  }

  function requestPlaylistCreate(seedPaths: string[] = []) {
    activeView.value = 'playlists'
    detailKey.value = null
    playlistCreateSeedPaths.value = seedPaths
    playlistCreateRequested.value = true
  }

  /** 进入聚合页详情（同一视图内切换） */
  function openDetail(key: string) {
    detailKey.value = key
    // 搜索结果会占住内容区，带着关键词钻取会看不到目标详情
    searchQuery.value = ''
    searchAll.value = false
  }

  function closeDetail() {
    detailKey.value = null
    dolly.value = 'idle'
    searchQuery.value = ''
    searchAll.value = false
  }

  function startDolly() {
    dolly.value = 'enter'
  }

  function beginDollyExit() {
    dolly.value = 'exit'
  }

  function endDolly() {
    dolly.value = 'idle'
  }

  return {
    activeView,
    detailKey,
    playlistCreateRequested,
    playlistCreateSeedPaths,
    playlistEditCover,
    playlistAddSongs,
    searchQuery,
    searchAll,
    folderRootId,
    lyricsOpen,
    dolly,
    navOrder,
    reorderNav,
    rememberScroll,
    recallScroll,
    navigate,
    requestPlaylistCreate,
    openDetail,
    closeDetail,
    startDolly,
    beginDollyExit,
    endDolly,
  }
})
