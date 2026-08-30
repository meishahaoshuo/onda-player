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

  function navigate(view: ViewId) {
    activeView.value = view
    detailKey.value = null
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
  }

  return {
    activeView,
    detailKey,
    playlistCreateRequested,
    lyricsOpen,
    navigate,
    requestPlaylistCreate,
    openDetail,
    closeDetail,
  }
})
