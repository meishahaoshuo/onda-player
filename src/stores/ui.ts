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
  /** 全屏歌词页开关 */
  const lyricsOpen = ref(false)
  /** 专辑过渡编排状态：idle 空闲 / enter 推进中 / exit 返回中（同时用作连点闸门） */
  const dolly = ref<'idle' | 'enter' | 'exit'>('idle')

  /* ---------- 滚动位置记忆（全应用） ----------
     key 约定：
     - `view:<视图id>|<detailKey>`：外层 .view-body 滚动位置（App.vue 统一捕获/恢复）
     - `list:<来源>:<id>`：SongList/VirtualList 内部滚动位置（组件自存自取） */
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
  }

  function requestPlaylistCreate() {
    activeView.value = 'playlists'
    detailKey.value = null
    playlistCreateRequested.value = true
  }

  /** 进入聚合页详情（同一视图内切换） */
  function openDetail(key: string) {
    detailKey.value = key
  }

  function closeDetail() {
    detailKey.value = null
    dolly.value = 'idle'
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
    lyricsOpen,
    dolly,
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
