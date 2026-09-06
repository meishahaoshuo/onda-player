import { ref } from 'vue'

/** 歌单右键菜单的全局单例状态（侧栏歌单项 / 歌单卡片共用） */

export interface PlaylistMenuState {
  x: number
  y: number
  playlistId: string
}

const menuState = ref<PlaylistMenuState | null>(null)

export function usePlaylistMenu() {
  function open(playlistId: string, e: MouseEvent) {
    menuState.value = { x: e.clientX, y: e.clientY, playlistId }
  }

  function close() {
    menuState.value = null
  }

  return { menuState, open, close }
}
