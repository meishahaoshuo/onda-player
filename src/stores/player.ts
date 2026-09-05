import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import * as db from '@/services/db'
import { resolveSongFile } from '@/services/fs'
import {
  clearMediaSession,
  getAudio,
  loadSource,
  setMediaSessionHandlers,
  stopSource,
  updateMediaSession,
  updatePositionState,
} from '@/services/player'
import { useLibraryStore } from '@/stores/library'
import { useStatsStore } from '@/stores/stats'
import { useSettingsStore } from '@/stores/settings'
import type { PlayMode, SongRecord } from '@/types'

/**
 * 播放内核：队列、四种播放模式、进度/音量、MediaSession、状态持久化。
 * 刷新后恢复为暂停态，等待用户点击播放（浏览器自动播放限制）。
 */

interface PersistedState {
  paths: string[]
  index: number
  time: number
  volume: number
  mode: PlayMode
}

const STATE_KEY = 'playerState'

export const usePlayerStore = defineStore('player', () => {
  const library = useLibraryStore()
  const stats = useStatsStore()
  const settings = useSettingsStore()

  const queue = ref<SongRecord[]>([])
  const index = ref(-1)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(80)
  const lastVolume = ref(80)
  const playMode = ref<PlayMode>('loop')

  const current = computed<SongRecord | null>(() => queue.value[index.value] ?? null)
  const currentPath = computed(() => current.value?.path ?? null)

  /* ---------- 播放控制 ---------- */

  let loadSeq = 0

  async function playSong(song: SongRecord, context?: SongRecord[]) {
    if (context && context.length > 0) {
      queue.value = context
    } else if (!queue.value.some((s) => s.path === song.path)) {
      queue.value = [song]
    }
    index.value = queue.value.findIndex((s) => s.path === song.path)
    if (playMode.value === 'shuffle') reshuffleAround(index.value)
    await load(index.value)
  }

  async function load(i: number) {
    const song = queue.value[i]
    if (!song) return
    const seq = ++loadSeq
    const file = await resolveSongFile(song.rootId, song.path.slice(song.rootId.length + 1))
    if (seq !== loadSeq) return
    if (!file) {
      // 文件已不存在：跳到下一首（防死循环：队列仅剩当前则停止）
      if (queue.value.length <= 1) {
        stop()
        return
      }
      queue.value.splice(i, 1)
      if (queue.value.length === 0) {
        stop()
        return
      }
      await load(Math.min(i, queue.value.length - 1))
      return
    }
    loadSource(file)
    const a = getAudio()
    a.volume = volume.value / 100
    // 恢复场景：待 metadata 加载完成后再跳到上次进度（过早设置会被加载重置）
    if (pendingSeekSec > 0) {
      const target = pendingSeekSec
      pendingSeekSec = 0
      const apply = () => {
        try {
          a.currentTime = target
        } catch {
          // 无效进度则忽略
        }
      }
      if (a.readyState >= 1) apply()
      else a.addEventListener('loadedmetadata', apply, { once: true })
    }
    await a.play().catch(() => {
      // 自动播放被拒绝（如刷新恢复后的场景）：保持暂停态
      playing.value = false
    })
    const coverUrl = song.coverId ? await library.coverUrl(song.coverId) : null
    updateMediaSession(song, coverUrl)
  }

  function togglePlay() {
    const a = getAudio()
    if (!current.value) return
    if (a.paused) {
      if (!a.src && current.value) {
        load(index.value)
        return
      }
      a.play().catch(() => {})
    } else {
      a.pause()
    }
  }

  function next(userInitiated = true) {
    if (queue.value.length === 0) return
    if (!userInitiated && playMode.value === 'one') {
      const a = getAudio()
      a.currentTime = 0
      a.play().catch(() => {})
      return
    }
    let i = index.value
    if (playMode.value === 'shuffle') {
      i = shuffleOrder.length > 0 ? shuffleOrder.shift()! : index.value
    } else {
      i = index.value + 1
      if (i >= queue.value.length) {
        if (playMode.value === 'loop') i = 0
        else {
          // order 模式播完即停
          index.value = queue.value.length - 1
          playing.value = false
          return
        }
      }
    }
    index.value = i
    load(i)
  }

  function prev() {
    if (queue.value.length === 0) return
    const a = getAudio()
    // 播放超过 3 秒时回到本曲开头（通用播放器习惯）
    if (a.currentTime > 3) {
      a.currentTime = 0
      return
    }
    let i = index.value - 1
    if (i < 0) i = playMode.value === 'loop' ? queue.value.length - 1 : 0
    index.value = i
    load(i)
  }

  function stop() {
    stopSource()
    playing.value = false
    currentTime.value = 0
    clearMediaSession()
  }

  function seek(sec: number) {
    const a = getAudio()
    if (Number.isFinite(sec)) a.currentTime = sec
  }

  function setVolume(v: number) {
    volume.value = Math.round(Math.min(100, Math.max(0, v)))
    getAudio().volume = volume.value / 100
    scheduleSave()
  }

  /** 静音/取消静音：记录上次非 0 音量，取消时恢复而非跳回固定值。 */
  function toggleMute() {
    if (volume.value > 0) {
      lastVolume.value = volume.value
      setVolume(0)
    } else {
      setVolume(lastVolume.value || 80)
    }
  }

  function setPlayMode(mode: PlayMode) {
    playMode.value = mode
  }

  /* ---------- 队列编辑（右键菜单 / 队列面板用） ---------- */

  /** 下一首播放：移到当前曲目之后；随机模式下置顶随机顺序 */
  function insertNext(song: SongRecord) {
    const existing = queue.value.findIndex((s) => s.path === song.path)
    if (existing >= 0) {
      queue.value.splice(existing, 1)
      if (existing < index.value) index.value--
    }
    const at = index.value + 1
    queue.value.splice(at, 0, song)
    if (playMode.value === 'shuffle') reshuffleAround(index.value, at)
    scheduleSave()
  }

  /** 从队列移除一首；删到当前曲则自动接播下一首 */
  function removeAt(i: number) {
    if (i < 0 || i >= queue.value.length) return
    const wasCurrent = i === index.value
    queue.value.splice(i, 1)
    if (queue.value.length === 0) {
      index.value = -1
      stop()
      scheduleSave()
      return
    }
    if (i < index.value) {
      index.value--
    } else if (wasCurrent) {
      index.value = Math.min(i, queue.value.length - 1)
      void load(index.value)
    }
    if (playMode.value === 'shuffle' && index.value >= 0) reshuffleAround(index.value)
    scheduleSave()
  }

  /** 清空队列并清掉持久化状态 */
  function clearQueue() {
    stop()
    queue.value = []
    index.value = -1
    void db.kvSet(STATE_KEY, null)
  }

  /** 队列内拖拽排序，维护当前曲目索引跟随移动 */
  function moveInQueue(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= queue.value.length || to >= queue.value.length)
      return
    const [song] = queue.value.splice(from, 1)
    queue.value.splice(to, 0, song)
    if (from === index.value) {
      index.value = to
    } else if (from < index.value && to >= index.value) {
      index.value--
    } else if (from > index.value && to <= index.value) {
      index.value++
    }
    if (playMode.value === 'shuffle') reshuffleAround(index.value)
    scheduleSave()
  }

  /* ---------- 播放计数：听满 30 秒或进度 50%（先到）计一次 ---------- */

  let countedPath: string | null = null

  watch([currentTime, duration], () => {
    const path = currentPath.value
    if (!path || !playing.value || countedPath === path) return
    const t = currentTime.value
    const dur = duration.value || current.value?.durationSec || 0
    if (t >= 30 || (dur > 0 && t >= dur / 2)) {
      countedPath = path
      stats.recordPlay(path)
    }
  })
  watch(currentPath, () => {
    countedPath = null
  })

  /* ---------- 随机顺序 ---------- */

  let shuffleOrder: number[] = []

  /** 重建随机顺序；pinFirst 为需要排在下一个的队列索引（下一首播放用） */
  function reshuffleAround(currentIdx: number, pinFirst?: number) {
    const rest = queue.value.map((_, i) => i).filter((i) => i !== currentIdx && i !== pinFirst)
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    shuffleOrder = pinFirst != null ? [pinFirst, ...rest] : rest
  }

  watch(playMode, (mode) => {
    if (mode === 'shuffle' && index.value >= 0) reshuffleAround(index.value)
  })

  /* ---------- audio 事件 ---------- */

  function bindAudioEvents() {
    const a = getAudio()
    a.addEventListener('play', () => {
      playing.value = true
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    })
    a.addEventListener('pause', () => {
      playing.value = false
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    })
    a.addEventListener('timeupdate', () => {
      currentTime.value = a.currentTime
    })
    a.addEventListener('durationchange', () => {
      duration.value = a.duration || current.value?.durationSec || 0
      updatePositionState(duration.value, a.currentTime)
    })
    a.addEventListener('ended', () => {
      countedPath = null // 单曲循环重播时重新计数
      next(false)
    })
    a.addEventListener('error', () => {
      if (current.value) next(false)
    })
  }

  setMediaSessionHandlers({
    play: () => togglePlay(),
    pause: () => togglePlay(),
    prev: () => prev(),
    next: () => next(),
    seekTo: (sec) => seek(sec),
  })

  /* ---------- 持久化 ---------- */

  let saveTimer: number | undefined
  function scheduleSave() {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(saveNow, 800)
  }

  function saveNow() {
    if (queue.value.length === 0) return
    const state: PersistedState = {
      paths: queue.value.map((s) => s.path),
      index: index.value,
      time: getAudio().currentTime ?? 0,
      volume: volume.value,
      mode: playMode.value,
    }
    void db.kvSet(STATE_KEY, state)
  }

  watch([queueLengthWorkaround, playing, playMode], scheduleSave)
  watch(currentTime, (t, old) => {
    // 每 5 秒左右存一次进度
    if (Math.abs(t - old) >= 5) scheduleSave()
  })
  function queueLengthWorkaround() {
    return `${queue.value.length}:${index.value}`
  }

  window.addEventListener('pagehide', saveNow)

  async function restore() {
    bindAudioEvents()
    if (!settings.autoRestoreQueue) return
    const state = await db.kvGet<PersistedState>(STATE_KEY)
    if (!state || state.paths.length === 0) return
    const byPath = new Map(library.songs.map((s) => [s.path, s]))
    const restored = state.paths.map((p) => byPath.get(p)).filter((s): s is SongRecord => s !== undefined)
    if (restored.length === 0) return
    queue.value = restored
    index.value = Math.min(state.index, restored.length - 1)
    volume.value = state.volume
    playMode.value = state.mode
    getAudio().volume = volume.value / 100
    currentTime.value = state.time
    duration.value = current.value?.durationSec ?? 0
    // 不自动播放：等用户点击播放时从头加载；恢复的进度存下来供 seek
    pendingSeekSec = state.time
    // 设置开启时尝试自动续播；被浏览器自动播放策略拒绝则保持暂停态
    if (settings.autoResume) void load(index.value)
  }

  let pendingSeekSec = 0

  /** 用户手动触发播放（恢复场景下先跳到上次进度） */
  function resumePlay() {
    if (!current.value) return
    if (!getAudio().src) {
      void load(index.value)
      return
    }
    togglePlay()
  }

  return {
    queue,
    index,
    playing,
    currentTime,
    duration,
    volume,
    lastVolume,
    playMode,
    current,
    currentPath,
    playSong,
    togglePlay,
    resumePlay,
    next,
    prev,
    stop,
    seek,
    setVolume,
    toggleMute,
    setPlayMode,
    insertNext,
    removeAt,
    clearQueue,
    moveInQueue,
    restore,
  }
})
