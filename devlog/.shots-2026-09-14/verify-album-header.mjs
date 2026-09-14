import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9341
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1280
const H = 800
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-albumhdr-'))

const proc = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, '--no-first-run',
   '--no-default-browser-check', '--mute-audio', '--no-proxy-server', `--window-size=${W},${H}`, URL_APP],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('CDP 未就绪')
}

const ws = new WebSocket(await getWsUrl())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception')
}
const send = (method, params = {}) => {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => { pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result))) })
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'))
}
const shotClip = async (name, clip) => {
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })

const STUB = `window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},transformCallback:(cb)=>{const i=Math.floor(Math.random()*1e9);window['_'+i]=cb;return i},unregisterListener:()=>{},invoke:async(c)=>{const s=String(c);if(s.includes('is_maximized')||s.includes('is_minimized'))return false;if(s.includes('outer_position'))return{x:100,y:100};if(s.includes('inner_size'))return{width:${W},height:${H}};return 0}}`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(4200)

const report = {}

/* 造一张「像真专辑」的数据：canvas 画封面写进封面库 + 11 首元数据齐全的同专辑曲目 */
const SEED = `(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const db = await import('/src/services/db.ts')
  const lib = useLibraryStore()
  // 造一张真封面：canvas 画暖色渐变 + 标题，写进封面库（避免占位图影响观感判断）
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 512, 512)
  grad.addColorStop(0, '#d9a441')
  grad.addColorStop(0.55, '#b56f2a')
  grad.addColorStop(1, '#4a2b16')
  g.fillStyle = grad
  g.fillRect(0, 0, 512, 512)
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.font = '600 54px serif'
  g.fillText('橙月', 48, 420)
  g.font = '400 26px serif'
  g.fillText('Orange Moon', 48, 462)
  const coverId = 'demo-cover-album-header'
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92))
  await db.putCover(coverId, blob)
  const base = {
    rootId: 'demo',
    album: '橙月',
    albumArtist: '方大同',
    artist: '方大同',
    genre: '流行',
    year: 2008,
    discNo: 1,
    sampleRateHz: 44100,
    bitsPerSample: 16,
    bitrateKbps: 320,
    container: 'flac',
    fileSize: 8 * 1024 * 1024,
    mtimeMs: 0,
    hasCover: true,
    coverId,
    embeddedLyrics: null,
  }
  const titles = ['Singalongsong', '小小虫', '1234567', '黑白', '如果爱', '黑洞里', '三人游', '爱我吧', '为你写的歌', 'Orange Moon', '玫瑰味道']
  titles.forEach((t, i) => {
    lib.songs.push({
      ...base,
      path: 'demo/橙月/' + String(i + 1).padStart(2, '0') + ' ' + t + '.flac',
      fileName: String(i + 1).padStart(2, '0') + ' ' + t + '.flac',
      title: t,
      trackNo: i + 1,
      durationSec: 60 + i * 25,
      fileSize: 8 * 1024 * 1024 + i * 1000,
    })
  })
  await new Promise((r) => setTimeout(r, 200))
  const album = lib.albums.find((a) => a.name === '橙月')
  return { coverId, albumKey: album?.key ?? null, songs: lib.songs.length }
})()`
report.setup = await evaluate(SEED)

const ALBUM_PROBE = `(() => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) } }
  const card = document.querySelector('.album-header')
  const cover = document.querySelector('.album-header .header-cover')
  const title = document.querySelector('.album-title')
  const actions = document.querySelector('.album-actions')
  const side = document.querySelector('.album-sideinfo')
  const rows = [...document.querySelectorAll('.album-sideinfo .row')].map((r) => ({
    k: r.querySelector('.k')?.textContent?.trim(),
    v: r.querySelector('.v')?.textContent?.trim(),
    rect: R(r),
  }))
  const cs = side ? getComputedStyle(side) : null
  return {
    card: R(card),
    cover: R(cover),
    title: R(title),
    titleText: title?.textContent?.trim(),
    titleMinusCoverTop: cover && title ? Math.round(title.getBoundingClientRect().top - cover.getBoundingClientRect().top) : null,
    actions: R(actions),
    actionsVsCoverBottom: cover && actions ? Math.round(cover.getBoundingClientRect().bottom - actions.getBoundingClientRect().bottom) : null,
    side: R(side),
    sideVsCoverTop: cover && side ? Math.round(side.getBoundingClientRect().top - cover.getBoundingClientRect().top) : null,
    rows,
    sideStyle: cs ? { borderLeft: cs.borderLeftWidth + ' ' + cs.borderLeftStyle + ' ' + cs.borderLeftColor, paddingLeft: cs.paddingLeft, alignSelf: cs.alignSelf } : null,
    oldArtistLine: !!document.querySelector('.album-artist'),
    oldStatsLine: !!document.querySelector('.album-stats'),
    oldMetaPanel: !!document.querySelector('.album-meta'),
  }
})()`

const PL_PROBE = `(() => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) } }
  const card = document.querySelector('.pl-header')
  const cover = document.querySelector('.pl-header .header-cover')
  const name = document.querySelector('.pl-name')
  const side = document.querySelector('.pl-sideinfo')
  return { card: R(card), cover: R(cover), name: R(name), nameText: name?.textContent?.trim(), side: R(side) }
})()`

report.album = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const ui = useUiStore()
  const lib = useLibraryStore()
  const a = lib.albums.find((x) => x.name === '橙月')
  ui.activeView = 'albums'
  ui.detailKey = a.key
  await new Promise((r) => setTimeout(r, 1800))
  return { detailKey: ui.detailKey }
})()`)
report.albumProbe = await evaluate(ALBUM_PROBE)
await shot('100-album-detail-header.png')
report.albumHeaderRect = await evaluate(`(() => { const b = document.querySelector('.album-header')?.getBoundingClientRect(); return b ? { x: 0, y: Math.max(0, b.top - 10), width: ${W}, height: Math.round(b.height + 20) } : null })()`)
await shotClip('101-album-header-crop.png', report.albumHeaderRect)

/* 窄视口：面板不再像旧版在 1100px 以下整块隐藏，标题走省略号 */
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 760, deviceScaleFactor: 2, mobile: false })
await sleep(500)
report.narrowProbe = await evaluate(ALBUM_PROBE)
await shot('103-album-narrow.png')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
await sleep(400)

/* 深色主题下同款头部 */
await evaluate(`localStorage.setItem('settings.themeMode','dark')`)
await send('Page.navigate', { url: URL_APP })
await sleep(4200)
await evaluate(SEED)
report.albumDark = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const ui = useUiStore()
  const lib = useLibraryStore()
  ui.activeView = 'albums'
  ui.detailKey = lib.albums.find((x) => x.name === '橙月').key
  await new Promise((r) => setTimeout(r, 1800))
  return { theme: document.documentElement.dataset.theme ?? document.documentElement.className }
})()`)
await shot('104-album-detail-dark.png')
report.darkHeaderRect = await evaluate(`(() => { const b = document.querySelector('.album-header')?.getBoundingClientRect(); return b ? { x: 0, y: Math.max(0, b.top - 10), width: ${W}, height: Math.round(b.height + 20) } : null })()`)
await shotClip('105-album-header-dark-crop.png', report.darkHeaderRect)
await evaluate(`localStorage.setItem('settings.themeMode','light')`)
await send('Page.navigate', { url: URL_APP })
await sleep(4200)
await evaluate(SEED)

/* 歌单详情页头部同款对照 */
report.playlist = await evaluate(`(async () => {
  const rec = await window.__musicTest.pl('create', '周杰伦')
  const id = rec?.id ?? rec
  await window.__musicTest.pl('add', id)
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  ui.activeView = 'playlists'
  ui.detailKey = id
  await new Promise((r) => setTimeout(r, 1800))
  return { id }
})()`)
report.playlistProbe = await evaluate(PL_PROBE)
report.playlistHeaderRect = await evaluate(`(() => { const b = document.querySelector('.pl-header')?.getBoundingClientRect(); return b ? { x: 0, y: Math.max(0, b.top - 10), width: ${W}, height: Math.round(b.height + 20) } : null })()`)
await shotClip('102-playlist-header-crop.png', report.playlistHeaderRect)

report.errors = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
process.exit(0)
