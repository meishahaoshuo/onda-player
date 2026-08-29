import type { SongRecord } from '@/types'

/**
 * audio 单例 + MediaSession 封装。状态与队列逻辑在 stores/player.ts，
 * 这里只负责音频元素、对象 URL 生命周期和系统媒体控制绑定。
 */

let audio: HTMLAudioElement | null = null
let currentUrl: string | null = null

export function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
  }
  return audio
}

export function loadSource(file: File) {
  const a = getAudio()
  if (currentUrl) URL.revokeObjectURL(currentUrl)
  currentUrl = URL.createObjectURL(file)
  a.src = currentUrl
}

export function stopSource() {
  const a = getAudio()
  a.pause()
  a.removeAttribute('src')
  a.load()
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
}

/* ---------- MediaSession ---------- */

function coverToArtworkUrl(url: string): MediaImage[] {
  return url ? [{ src: url, sizes: '256x256', type: 'image/jpeg' }] : []
}

export function updateMediaSession(song: SongRecord, coverUrl: string | null) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: song.album,
    artwork: coverToArtworkUrl(coverUrl ?? ''),
  })
}

export function clearMediaSession() {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = null
  navigator.mediaSession.playbackState = 'none'
}

export function setMediaSessionHandlers(handlers: {
  play: () => void
  pause: () => void
  prev: () => void
  next: () => void
  seekTo: (sec: number) => void
}) {
  if (!('mediaSession' in navigator)) return
  const ms = navigator.mediaSession
  ms.setActionHandler('play', handlers.play)
  ms.setActionHandler('pause', handlers.pause)
  ms.setActionHandler('previoustrack', handlers.prev)
  ms.setActionHandler('nexttrack', handlers.next)
  try {
    ms.setActionHandler('seekto', (d) => {
      if (d.seekTime !== null && d.seekTime !== undefined) handlers.seekTo(d.seekTime)
    })
  } catch {
    // seekto 不支持时忽略
  }
}

export function updatePositionState(duration: number, position: number, rate = 1) {
  if (!('mediaSession' in navigator) || !Number.isFinite(duration) || duration <= 0) return
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(position, duration),
      playbackRate: rate,
    })
  } catch {
    // 非法状态时忽略
  }
}
