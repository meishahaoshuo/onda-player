import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9347
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1280
const H = 800
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-pl-batch-'))

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
  // 不抛出：把页面异常当值返回，脚本能跑完并把失败点打进报告
  if (r.exceptionDetails) return { __ERR: String(r.exceptionDetails.exception?.description ?? '').slice(0, 300) }
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
const waitFor = async (sel, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    const n = await evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
    if (n > 0) return n
    await sleep(250)
  }
  return 0
}

/* 同步落盘的进度日志：脚本被超时杀掉时也能看到卡在哪一步 */
const LOG_FILE = path.join(SHOT_DIR, 'verify-playlist-header.log')
try { fs.unlinkSync(LOG_FILE) } catch {}
const log = (m) => fs.appendFileSync(LOG_FILE, `${new Date().toISOString().slice(11, 19)} ${m}\n`)

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })

const STUB = `window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},transformCallback:(cb)=>{const i=Math.floor(Math.random()*1e9);window['_'+i]=cb;return i},unregisterListener:()=>{},invoke:async(c)=>{const s=String(c);if(s.includes('is_maximized')||s.includes('is_minimized'))return false;if(s.includes('outer_position'))return{x:100,y:100};if(s.includes('inner_size'))return{width:${W},height:${H}};return 0}}`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(4200)

const report = {}

/* 造数据：8 首带真封面 + 一个歌单（全部加入）+ 一个空歌单（当「添加到歌单」的目标） */
const SEED = `(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const db = await import('/src/services/db.ts')
  const lib = useLibraryStore()
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 512, 512)
  grad.addColorStop(0, '#8c6b4a'); grad.addColorStop(0.5, '#4a3a2c'); grad.addColorStop(1, '#1d1712')
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512)
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '600 46px serif'; g.fillText('叶惠美', 46, 420)
  const coverId = 'demo-cover-playlist'
  await db.putCover(coverId, await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)))
  const base = { rootId: 'demo', album: '叶惠美', albumArtist: '周杰伦', artist: '周杰伦',
    genre: '流行', year: 2003, discNo: 1, sampleRateHz: 44100, bitsPerSample: 16,
    bitrateKbps: 320, container: 'flac', fileSize: 8 * 1024 * 1024, mtimeMs: 0,
    hasCover: true, coverId, embeddedLyrics: null }
  const titles = ['以父之名', '懦夫', '晴天', '三年二班', '东风破', '你听得到', '同一种调调', '她的睫毛']
  titles.forEach((t, i) => lib.songs.push({ ...base,
    path: 'demo/叶惠美/' + String(i + 1).padStart(2, '0') + ' ' + t + '.flac',
    fileName: t + '.flac', title: t, trackNo: i + 1, durationSec: 200 + i * 15 }))
  await new Promise((r) => setTimeout(r, 200))
  return { songs: lib.songs.length }
})()`
log('setup')
report.setup = await evaluate(SEED)

log('playlists')
report.playlists = await evaluate(`(async () => {
  const a = await window.__musicTest.pl('create', '周杰伦')
  const idA = a?.id ?? a
  const added = await window.__musicTest.pl('add', idA)
  const b = await window.__musicTest.pl('create', '测试歌单')
  window.__plA = idA
  window.__plB = b?.id ?? b
  return { idA, added, idB: window.__plB }
})()`)

log('enter')
report.enter = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  ui.activeView = 'playlists'
  ui.detailKey = window.__plA
  await new Promise((r) => setTimeout(r, 1800))
  return { detailKey: ui.detailKey }
})()`)
report.buttonsFound = await waitFor('.pl-actions .action-btn')

const PL_PROBE = `(() => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) } }
  const card = document.querySelector('.pl-header')
  const cover = document.querySelector('.pl-header .header-cover')
  const name = document.querySelector('.pl-name')
  const btns = [...document.querySelectorAll('.pl-actions .action-btn')].map((b) => ({
    text: b.textContent.trim(),
    primary: b.classList.contains('primary'),
    disabled: b.disabled,
    icon: [...b.querySelectorAll('svg path')].map((p) => (p.getAttribute('d') || '').slice(0, 20)).join('|'),
  }))
  return {
    card: R(card), cover: R(cover), name: R(name),
    nameMinusCoverTop: cover && name ? Math.round(name.getBoundingClientRect().top - cover.getBoundingClientRect().top) : null,
    side: R(document.querySelector('.pl-sideinfo')),
    buttons: btns,
    actionsRect: R(document.querySelector('.pl-actions')),
    rowCount: document.querySelectorAll('.song-row').length,
    covers: document.querySelectorAll('.song-row .cover-img, .song-row .cover-fallback').length,
  }
})()`
log('header')
report.header = await evaluate(PL_PROBE)
log('headerRect')
report.headerRect = await evaluate(`(() => { const b = document.querySelector('.pl-header')?.getBoundingClientRect(); return b ? { x: 0, y: Math.max(0, b.top - 10), width: ${W}, height: Math.round(b.height + 20) } : null })()`)
if (report.headerRect) await shotClip('120-playlist-header.png', report.headerRect)

/* 更多操作下拉：teleport 到 body、定位在按钮下方、两项菜单 */
log('moreMenu')
report.moreMenu = await evaluate(`(async () => {
  const btn = document.querySelectorAll('.pl-actions .action-btn')[1]
  const r = btn.getBoundingClientRect()
  btn.click()
  await new Promise((res) => setTimeout(res, 400))
  const menu = document.querySelector('.more-menu')
  const mr = menu?.getBoundingClientRect()
  return {
    open: !!menu,
    inBody: menu ? menu.parentElement === document.body : null,
    items: [...document.querySelectorAll('.more-menu .more-item')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })),
    gapBelow: mr ? Math.round(mr.top - r.bottom) : null,
    rightAligned: mr ? Math.round(mr.right - r.right) : null,
    clipped: mr ? mr.bottom > window.innerHeight : null,
  }
})()`)
log('shot')
await shot('121-playlist-more-menu.png')

/* 进入批量操作 */
log('enterBatch')
report.enterBatch = await evaluate(`(async () => {
  const items = [...document.querySelectorAll('.more-menu .more-item')]
  items[1].click()
  await new Promise((res) => setTimeout(res, 500))
  return {
    menuClosed: !document.querySelector('.more-menu'),
    barText: document.querySelector('.batch-bar')?.textContent?.replace(/\\s+/g, ' ').trim(),
    checks: document.querySelectorAll('.song-row .row-check').length,
    coversLeft: document.querySelectorAll('.song-row .cover-img, .song-row .cover-fallback').length,
    moreBtnLabel: document.querySelectorAll('.pl-actions .action-btn')[1].textContent.trim(),
  }
})()`)
log('pick')
report.pick = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.song-row')]
  rows[0].click(); rows[2].click()
  await new Promise((res) => setTimeout(res, 250))
  const a = { count: document.querySelector('.batch-count')?.textContent.trim(), picked: document.querySelectorAll('.song-row.picked').length, playing: document.querySelectorAll('.song-row.playing').length }
  const links = [...document.querySelectorAll('.batch-links .mini-link')]
  links[0].click()
  await new Promise((res) => setTimeout(res, 200))
  const b = { count: document.querySelector('.batch-count')?.textContent.trim(), picked: document.querySelectorAll('.song-row.picked').length }
  links[1].click()
  await new Promise((res) => setTimeout(res, 200))
  const c = { count: document.querySelector('.batch-count')?.textContent.trim(), picked: document.querySelectorAll('.song-row.picked').length }
  links[0].click()
  await new Promise((res) => setTimeout(res, 200))
  const d = { count: document.querySelector('.batch-count')?.textContent.trim(), picked: document.querySelectorAll('.song-row.picked').length }
  return { afterRowClick: a, afterSelectAll: b, afterInvert: c, restoredAll: d }
})()`)
log('shot')
await shot('122-playlist-batch.png')

/* 收藏 8 首 → 取消收藏 */
log('favorite')
report.favorite = await evaluate(`(async () => {
  const { useFavoritesStore } = await import('/src/stores/favorites.ts')
  const fav = useFavoritesStore()
  const btn = document.querySelectorAll('.batch-actions .action-btn')[0]
  btn.click()
  await new Promise((res) => setTimeout(res, 250))
  const first = { label: btn.textContent.trim(), total: fav.paths.length }
  btn.click()
  await new Promise((res) => setTimeout(res, 250))
  return { first, afterSecond: { label: btn.textContent.trim(), total: fav.paths.length } }
})()`)

/* 添加到歌单：面板 → 选「测试歌单」→ 歌单落 8 首 + 退出选择态 */
log('addMenu')
report.addMenu = await evaluate(`(async () => {
  document.querySelectorAll('.batch-actions .action-btn')[1].click()
  await new Promise((res) => setTimeout(res, 400))
  return {
    open: !!document.querySelector('.batch-add-menu'),
    items: [...document.querySelectorAll('.batch-add-menu .more-item')].map((b) => b.textContent.trim()),
  }
})()`)
log('shot')
await shot('123-playlist-add-menu.png')

log('addCommit')
report.addCommit = await evaluate(`(async () => {
  const { usePlaylistStore } = await import('/src/stores/playlist.ts')
  const store = usePlaylistStore()
  const items = [...document.querySelectorAll('.batch-add-menu .more-item')]
  const target = items.find((b) => b.textContent.includes('测试歌单'))
  target.click()
  await new Promise((res) => setTimeout(res, 500))
  const pl = store.playlists.find((p) => p.id === window.__plB)
  return { targetSongs: pl?.songPaths.length ?? null, menuClosed: !document.querySelector('.batch-add-menu'), barGone: !document.querySelector('.batch-bar') }
})()`)

/* 从歌单移除：重新进入 → 选前 2 首 → 移除 → 歌单少 2 首 */
log('remove')
report.remove = await evaluate(`(async () => {
  const { usePlaylistStore } = await import('/src/stores/playlist.ts')
  const store = usePlaylistStore()
  const before = store.playlists.find((p) => p.id === window.__plA).songPaths.length
  const more = document.querySelectorAll('.pl-actions .action-btn')[1]
  more.click()
  await new Promise((res) => setTimeout(res, 300))
  ;[...document.querySelectorAll('.more-menu .more-item')][1].click()
  await new Promise((res) => setTimeout(res, 400))
  const rows = [...document.querySelectorAll('.song-row')]
  rows[0].click(); rows[1].click()
  await new Promise((res) => setTimeout(res, 250))
  const picked = document.querySelectorAll('.song-row.picked').length
  const removeBtn = [...document.querySelectorAll('.batch-actions .action-btn')].find((b) => b.textContent.includes('从歌单移除'))
  removeBtn.click()
  await new Promise((res) => setTimeout(res, 500))
  return { before, picked, after: store.playlists.find((p) => p.id === window.__plA).songPaths.length, barGone: !document.querySelector('.batch-bar') }
})()`)

/* Esc 退出 */
log('esc')
report.esc = await evaluate(`(async () => {
  const more = document.querySelectorAll('.pl-actions .action-btn')[1]
  more.click()
  await new Promise((res) => setTimeout(res, 300))
  ;[...document.querySelectorAll('.more-menu .more-item')][1].click()
  await new Promise((res) => setTimeout(res, 400))
  const entered = !!document.querySelector('.batch-bar')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((res) => setTimeout(res, 300))
  return { entered, goneAfterEsc: !document.querySelector('.batch-bar') }
})()`)

/* 播放全部 */
log('playAll')
report.playAll = await evaluate(`(async () => {
  const { usePlayerStore } = await import('/src/stores/player.ts')
  const player = usePlayerStore()
  player.setPlayMode('shuffle')
  document.querySelectorAll('.pl-actions .action-btn')[0].click()
  const queueSync = player.queue.length
  const first = player.queue[0]?.title
  return { mode: player.playMode, queueSync, first }
})()`)

/* 深色态 */
await evaluate(`localStorage.setItem('settings.themeMode','dark')`)
await send('Page.navigate', { url: URL_APP })
await sleep(4200)
await evaluate(SEED)
await evaluate(`(async () => {
  const a = await window.__musicTest.pl('create', '周杰伦')
  const id = a?.id ?? a
  await window.__musicTest.pl('add', id)
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  ui.activeView = 'playlists'
  ui.detailKey = id
  await new Promise((r) => setTimeout(r, 1800))
})()`)
await waitFor('.pl-actions .action-btn')
log('darkBatch')
report.darkBatch = await evaluate(`(async () => {
  document.querySelectorAll('.pl-actions .action-btn')[1].click()
  await new Promise((r) => setTimeout(r, 300))
  ;[...document.querySelectorAll('.more-menu .more-item')][1].click()
  await new Promise((r) => setTimeout(r, 400))
  const links = [...document.querySelectorAll('.batch-links .mini-link')]
  links[0].click()
  await new Promise((r) => setTimeout(r, 200))
  return { theme: document.documentElement.dataset.theme, picked: document.querySelectorAll('.song-row.picked').length }
})()`)
log('shot')
await shot('124-playlist-batch-dark.png')
await evaluate(`localStorage.setItem('settings.themeMode','light')`)

report.errors = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
process.exit(0)
