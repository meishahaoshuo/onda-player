import { useLibraryStore } from '@/stores/library'

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

async function ensureOpfsMusicDir(): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory()
  const dir = await opfs.getDirectoryHandle('music-test', { create: true })
  const files: [string, Blob][] = [
    ['Test Song Alpha.wav', makeWav(2, 440)],
    ['Test Song Bravo.wav', makeWav(2, 550)],
    ['Test Song Charlie.wav', makeWav(2, 660)],
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
  }
}
