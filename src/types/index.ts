/** 数据模型（与 docs/02-技术方案.md §3 保持一致） */

export type ThemeMode = 'system' | 'dark' | 'light'

export type ViewId =
  | 'songs'
  | 'favorites'
  | 'charts'
  | 'albums'
  | 'artists'
  | 'folders'
  | 'playlists'
  | 'settings'

export type PlayMode = 'order' | 'loop' | 'one' | 'shuffle'

export interface SongRecord {
  /** 相对根路径，主键，形如 "rootId/sub/dir/song.flac" */
  path: string
  rootId: string
  fileName: string
  title: string
  artist: string
  album: string
  albumArtist: string
  genre: string
  year: number | null
  trackNo: number | null
  discNo: number | null
  durationSec: number
  bitrateKbps: number | null
  sampleRateHz: number | null
  bitsPerSample: number | null
  container: string
  fileSize: number
  mtimeMs: number
  hasCover: boolean
  coverId: string | null
  /** 音频内嵌歌词（USLT/LRC 文本），扫描时提取 */
  embeddedLyrics?: string | null
}

export interface FolderRoot {
  id: string
  name: string
  addedAt: number
}

export interface PlaylistRecord {
  id: string
  name: string
  /** 歌曲 path 有序列表 */
  songPaths: string[]
  /** 手动指定的封面来源歌曲 path；缺省时用歌曲封面自动拼贴 */
  coverPath?: string
  createdAt: number
}

export interface AlbumSummary {
  key: string
  name: string
  artist: string
  year: number | null
  songs: SongRecord[]
  coverId: string | null
  totalDuration: number
}

export interface ArtistSummary {
  name: string
  songs: SongRecord[]
  coverId: string | null
}

export type Quality = 'hires' | 'lossless' | 'lossy'

export type ScanPhase = 'idle' | 'enumerating' | 'parsing' | 'done'

export interface ScanProgress {
  phase: ScanPhase
  total: number
  scanned: number
  skipped: number
  failed: number
  currentFile: string
}
