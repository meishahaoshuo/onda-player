import { ref } from 'vue'
import type { SongRecord } from '@/types'

/**
 * 歌曲操作菜单的全局单例状态。
 * 任何列表（歌曲/收藏/排行/专辑详情/艺术家详情/歌单详情/队列）都通过
 * openSongMenu 唤起同一个 SongContextMenu，菜单项按 opts 携带的上下文显隐。
 */

export interface SongMenuOptions {
  /** 在歌单详情内：显示「从歌单移除」 */
  playlistId?: string
  /** 在队列面板内：显示「从队列移除」 */
  queueIndex?: number
  /** 「播放」时使用的列表上下文（整张列表入队） */
  context?: SongRecord[]
}

export interface SongMenuState {
  x: number
  y: number
  song: SongRecord
  opts: SongMenuOptions
}

const menuState = ref<SongMenuState | null>(null)

export function useSongActions() {
  function openSongMenu(e: MouseEvent, song: SongRecord, opts: SongMenuOptions = {}) {
    menuState.value = { x: e.clientX, y: e.clientY, song, opts }
  }

  function closeSongMenu() {
    menuState.value = null
  }

  return { menuState, openSongMenu, closeSongMenu }
}
