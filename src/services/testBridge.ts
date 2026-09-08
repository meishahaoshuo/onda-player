import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import * as db from './db'
import type { PlayMode, SongRecord } from '@/types'

/**
 * 开发/自动化测试桥（仅 import.meta.env.DEV 下加载，生产构建不含此模块）。
 * 提供绕过系统文件夹选择器的入口，用 OPFS 目录走完整的扫描/入库/列表流程。
 */

/** 生成一个单声道 16bit PCM WAV（正弦波） */
function makeWav(seconds: number, freq: number, sampleRate = 8000): Blob {
  const n = seconds * sampleRate
  const buffer = new ArrayBuffer(44 + n * 2)
  const view = new DataView(buffer)
  const w = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  w(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  w(36, 'data')
  view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000)
    view.setInt16(44 + i * 2, v, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * 生成带内嵌封面的测试 MP3（ID3v2.3 APIC + 静音 MPEG 帧）。
 * 封面画成 1200×1200 的细密条纹+文字，用于验证：
 *  - 入库缩略图（256px）与按需高清图（1024px）的差异是否肉眼可辨
 *  - 飞入动画落地时是否用了正确的图源
 */
async function makeMp3WithCover(opts?: {
  c1?: string
  c2?: string
  label?: string
  album?: string
}): Promise<Blob> {
  // 1) 封面：1200×1200 渐变 + 圆环 + 小字，缩略后糊得一眼能看出来
  const c1 = opts?.c1 ?? '#f5c98a'
  const c2 = opts?.c2 ?? '#7a4bd0'
  const label = opts?.label ?? 'ARIA 1200'
  const S = 1200
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, S, S)
  g.addColorStop(0, c1)
  g.addColorStop(1, c2)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 3
  for (let x = 0; x < S; x += 12) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, S)
    ctx.stroke()
  }
  for (let r = 60; r < S / 2; r += 60) {
    ctx.beginPath()
    ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 96px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(label, S / 2, S / 2 - 20)
  ctx.font = 'bold 42px sans-serif'
  ctx.fillText('高清封面测试', S / 2, S / 2 + 60)
  const png = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png'),
  )
  const pic = new Uint8Array(await png.arrayBuffer())
  const album = opts?.album ?? ''

  // 2) ID3v2.3 帧：TALB（专辑名，可选）+ APIC
  const textFrame = (id: string, text: string): number[] => {
    const body = [0x00, ...[...text].map((c) => c.charCodeAt(0)), 0x00]
    const size = body.length
    return [
      ...[...id].map((c) => c.charCodeAt(0)),
      (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff,
      0x00, 0x00,
      ...body,
    ]
  }
  const mime = 'image/png'
  const body: number[] = [
    0x00, // 文本编码 ISO-8859-1
    ...[...mime].map((c) => c.charCodeAt(0)),
    0x00, // MIME 结束
    0x03, // 图片类型：封面（front cover）
    0x00, // 描述（空）
    ...pic,
  ]
  const frameSize = body.length
  const frameHeader = [0x41, 0x50, 0x49, 0x43, (frameSize >> 24) & 0xff, (frameSize >> 16) & 0xff, (frameSize >> 8) & 0xff, frameSize & 0xff, 0x00, 0x00]
  const tagBody = [...(album ? textFrame('TALB', album) : []), ...frameHeader, ...body]
  const tagSize = tagBody.length
  // synchsafe 整数：每字节只用低 7 位
  const synch = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
  const tag = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, ...synch(tagSize), ...tagBody]

  // 3) 静音 MPEG-1 Layer III 帧（128kbps / 44.1kHz → 每帧 417 字节），
  // 80 帧约 3.5 秒，足够覆盖打开歌词页的整个测试窗口
  const mpeg: number[] = []
  for (let i = 0; i < 80; i++) {
    mpeg.push(0xff, 0xfb, 0x90, 0x00)
    mpeg.push(...new Array(413).fill(0))
  }
  return new Blob([new Uint8Array([...tag, ...mpeg])], { type: 'audio/mpeg' })
}

/** HSL → #rrggbb（批量造不同色封面用） */
function hslHex(h: number, s = 62, l = 52): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

async function ensureOpfsMusicDir(): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory()
  const dir = await opfs.getDirectoryHandle('music-test', { create: true })
  const files: [string, Blob][] = [
    ['Test Song Alpha.wav', makeWav(2, 440)],
    ['Test Song Bravo.wav', makeWav(2, 550)],
    ['Test Song Charlie.wav', makeWav(2, 660)],
    [
      'Test Song Alpha.lrc',
      new Blob(
        [
          '[ti:Alpha]\n[by:test]\n[00:00.30]Alpha 原文第一行\n[00:00.32]Alpha 翻译第一行\n' +
            '[00:01.20]Alpha 原文第二行\n[00:01.22]Alpha 翻译第二行\n',
        ],
        { type: 'text/plain' },
      ),
    ],
  ]
  for (const [name, blob] of files) {
    const fh = await dir.getFileHandle(name, { create: true })
    const writable = await fh.createWritable()
    await writable.write(blob)
    await writable.close()
  }
  return dir
}

export function installTestBridge() {
  ;(window as any).__musicTest = {
    async addTestFolder() {
      const library = useLibraryStore()
      const handle = await ensureOpfsMusicDir()
      await library.registerRoot(handle)
      await library.rescan()
      return library.songs.length
    },
    /** 清空全部根目录后重新添加一个测试文件夹（用于自动化重跑） */
    async resetTest() {
      const library = useLibraryStore()
      for (const r of [...library.roots]) {
        await library.removeFolderById(r.id)
      }
      return this.addTestFolder()
    },
    /** 额外写入一首带内嵌封面的 MP3 并重扫（返回歌曲数与带封面的歌曲数） */
    async addCoverSong() {
      const dir = await ensureOpfsMusicDir()
      const fh = await dir.getFileHandle('Cover Song.mp3', { create: true })
      const writable = await fh.createWritable()
      await writable.write(await makeMp3WithCover())
      await writable.close()
      const lrc = await dir.getFileHandle('Cover Song.lrc', { create: true })
      const w = await lrc.createWritable()
      await w.write(
        new Blob(
          [
            '[00:00.20]封面测试 第一行\n[00:00.22]Cover line one\n' +
            '[00:01.00]封面测试 第二行\n[00:01.02]Cover line two\n' +
            '[00:01.80]封面测试 第三行\n[00:01.82]Cover line three\n',
          ],
          { type: 'text/plain' },
        ),
      )
      await w.close()
      const library = useLibraryStore()
      await library.rescan()
      return {
        songs: library.songs.length,
        withCover: library.songs.filter((s) => s.coverId).length,
        coverSizes: library.songs
          .filter((s) => s.coverId)
          .map((s) => ({ title: s.title, coverId: s.coverId })),
      }
    },
    /** 额外写入 n 首带独立封面的 MP3（不同专辑 → 不同 coverId）并重扫：
        8 首/批多批落库，供吸入动画验证（封面色相环取色，肉眼可辨） */
    async addBulkSongs(n = 20) {
      const dir = await ensureOpfsMusicDir()
      for (let i = 0; i < n; i++) {
        const idx = String(i).padStart(2, '0')
        const hue = Math.round((360 / n) * i)
        const fh = await dir.getFileHandle(`Bulk Song ${idx}.mp3`, { create: true })
        const writable = await fh.createWritable()
        await writable.write(
          await makeMp3WithCover({
            c1: hslHex(hue),
            c2: hslHex((hue + 40) % 360),
            label: `BULK ${idx}`,
            album: `Bulk Album ${idx}`,
          }),
        )
        await writable.close()
      }
      const library = useLibraryStore()
      await library.rescan()
      return library.songs.length
    },
    /** 压力测试：直接注入 n 张合成专辑（各 2 首、无封面），绕过扫描。
        用于自动化验证专辑网格「引力坍缩」过渡在连点/侧边栏抢断下不留残留。
        注意：注入只进内存，重扫或清空根目录后即消失。 */
    async stressAlbums(n = 40) {
      const library = useLibraryStore()
      const songs: SongRecord[] = []
      for (let i = 0; i < n; i++) {
        const idx = String(i).padStart(2, '0')
        const album = `Stress Album ${idx}`
        for (let t = 0; t < 2; t++) {
          songs.push({
            path: `stress/${album}/track${t + 1}.mp3`,
            rootId: 'stress',
            fileName: `track${t + 1}.mp3`,
            title: `Track ${t + 1}`,
            artist: `Artist ${idx}`,
            album,
            albumArtist: `Artist ${idx}`,
            genre: 'Test',
            year: 2026,
            trackNo: t + 1,
            discNo: 1,
            durationSec: 180,
            bitrateKbps: 320,
            sampleRateHz: 44100,
            bitsPerSample: 16,
            container: 'mp3',
            fileSize: 1024 * 1024,
            mtimeMs: 0,
            hasCover: false,
            coverId: null,
            embeddedLyrics: null,
          })
        }
      }
      library.songs.push(...songs)
      return { songs: library.songs.length, albums: library.albums.length }
    },
    /** 当前库状态（根目录数/歌曲数/最近一次扫描进度） */
    status() {
      const library = useLibraryStore()
      return {
        roots: library.roots.length,
        songs: library.songs.length,
        progress: { ...library.scanProgress },
      }
    },
    /** 对现有根目录做一次增量重扫（不新增根目录） */
    async rescanOnly() {
      const library = useLibraryStore()
      await library.rescan()
      return this.status()
    },
    /** 播放库中第 index 首歌（context 为全库，与真实点击行为一致） */
    async playAt(index: number) {
      const library = useLibraryStore()
      const player = usePlayerStore()
      const song = library.sortedSongs[index]
      if (!song) return false
      await player.playSong(song, library.sortedSongs)
      return true
    },
    /** 播放器当前状态快照 */
    playerState() {
      const p = usePlayerStore()
      return {
        currentPath: p.currentPath,
        title: p.current?.title ?? null,
        playing: p.playing,
        currentTime: Math.round(p.currentTime * 100) / 100,
        duration: Math.round(p.duration * 100) / 100,
        volume: p.volume,
        mode: p.playMode,
        queueLen: p.queue.length,
        index: p.index,
      }
    },
    next() {
      usePlayerStore().next()
    },
    prev() {
      usePlayerStore().prev()
    },
    toggle() {
      usePlayerStore().togglePlay()
    },
    seek(sec: number) {
      usePlayerStore().seek(sec)
    },
    setVolume(v: number) {
      usePlayerStore().setVolume(v)
    },
    setMode(mode: PlayMode) {
      usePlayerStore().setPlayMode(mode)
    },
    async savedState() {
      return db.kvGet('playerState')
    },
    /** 歌单测试：创建/加歌/排序/快照 */
    async pl(action: string, ...args: unknown[]) {
      const { usePlaylistStore } = await import('@/stores/playlist')
      const store = usePlaylistStore()
      switch (action) {
        case 'create':
          return store.create(String(args[0]))
        case 'add': {
          const { useLibraryStore } = await import('@/stores/library')
          const lib = useLibraryStore()
          store.addSongs(String(args[0]), lib.sortedSongs.map((s) => s.path))
          return store.playlists.find((p) => p.id === args[0])?.songPaths.length
        }
        case 'move':
          store.moveSong(String(args[0]), Number(args[1]), Number(args[2]))
          return store.playlists.find((p) => p.id === args[0])?.songPaths
        case 'rename':
          store.rename(String(args[0]), String(args[1]))
          return store.playlists.find((p) => p.id === args[0])?.name
        case 'snapshot':
          return store.playlists.map((p) => ({ name: p.name, songs: p.songPaths.length }))
        case 'dbRaw': {
          // 直接读 DB 里的歌单，验证持久化是否落库
          return db.getAllPlaylists()
        }
      }
    },
  }
}
