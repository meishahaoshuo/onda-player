import { computed } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { usePlaylistStore } from '@/stores/playlist'
import { useFavoritesStore } from '@/stores/favorites'
import { useStatsStore } from '@/stores/stats'
import { useUiStore } from '@/stores/ui'
import type { SongRecord } from '@/types'

/**
 * 搜索作用域：顶栏搜索应当只在「用户当前所处的位置」里找歌。
 * 在歌单详情里搜索就只出这个歌单的歌，专辑/艺术家/收藏/最近在听/文件夹同理；
 * 歌曲页等没有收窄语义的位置退化为全库。用户可手动切到全库（ui.searchAll）。
 */
export interface SearchScope {
  /** 作用域展示名，如「深夜自驾」/「我喜欢的音乐」 */
  label: string
  /** 作用域内的候选歌曲 */
  songs: SongRecord[]
  /** 是否为收窄作用域（false = 全库） */
  scoped: boolean
  /** 稳定标识，用于滚动位置记忆 */
  key: string
}

export function useSearchScope() {
  const library = useLibraryStore()
  const playlist = usePlaylistStore()
  const favorites = useFavoritesStore()
  const stats = useStatsStore()
  const ui = useUiStore()

  const ALL = computed<SearchScope>(() => ({
    label: '全部歌曲',
    songs: library.sortedSongs,
    scoped: false,
    key: 'all',
  }))

  /** 按当前上下文解析出的收窄作用域；上下文不具备收窄语义时为 null */
  const narrow = computed<SearchScope | null>(() => {
    const byPath = () => new Map(library.songs.map((s) => [s.path, s]))
    const pick = (paths: string[]) => {
      const map = byPath()
      return paths.map((p) => map.get(p)).filter((s): s is SongRecord => s !== undefined)
    }

    switch (ui.activeView) {
      case 'playlists': {
        const id = ui.detailKey
        const pl = id ? playlist.playlists.find((p) => p.id === id) : undefined
        if (!pl) return null
        return { label: pl.name, songs: pick(pl.songPaths), scoped: true, key: `pl:${pl.id}` }
      }
      case 'albums': {
        const key = ui.detailKey
        if (!key) return null
        const album = library.albums.find((a) => a.key === key)
        if (!album) return null
        return { label: album.name, songs: album.songs, scoped: true, key: `al:${key}` }
      }
      case 'artists': {
        const name = ui.detailKey
        if (!name) return null
        const artist = library.artists.find((a) => a.name === name)
        if (!artist) return null
        return { label: artist.name, songs: artist.songs, scoped: true, key: `ar:${name}` }
      }
      case 'favorites': {
        return {
          label: '我喜欢的音乐',
          songs: pick(favorites.paths),
          scoped: true,
          key: 'fav',
        }
      }
      case 'recent': {
        return { label: '最近在听', songs: pick(stats.recentPaths), scoped: true, key: 'recent' }
      }
      case 'charts': {
        const songs = library.sortedSongs.filter((s) => (stats.counts[s.path] ?? 0) > 0)
        return { label: '排行榜', songs, scoped: true, key: 'charts' }
      }
      case 'folders': {
        const rid = ui.folderRootId
        if (!rid) return null
        const name = library.roots.find((r) => r.id === rid)?.name ?? '此文件夹'
        return {
          label: name,
          songs: library.sortedSongs.filter((s) => s.rootId === rid),
          scoped: true,
          key: `fd:${rid}`,
        }
      }
      default:
        return null
    }
  })

  /** 最终生效的作用域 */
  const scope = computed<SearchScope>(() =>
    ui.searchAll ? ALL.value : (narrow.value ?? ALL.value),
  )

  /** 当前上下文是否提供了收窄作用域（决定要不要显示「本范围 / 全部歌曲」切换） */
  const canNarrow = computed(() => narrow.value !== null)

  return { scope, narrow, canNarrow }
}
