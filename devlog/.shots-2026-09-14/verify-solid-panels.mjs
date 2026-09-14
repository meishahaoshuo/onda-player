import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9349
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1280
const H = 800
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-solid-'))

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
  if (r.exceptionDetails) return { __ERR: String(r.exceptionDetails.exception?.description ?? '').slice(0, 300) }
  return r.result.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'))
}
const LOG_FILE = path.join(SHOT_DIR, 'verify-solid-panels.log')
try { fs.unlinkSync(LOG_FILE) } catch {}
const log = (m) => fs.appendFileSync(LOG_FILE, `${new Date().toISOString().slice(11, 19)} ${m}\n`)
const waitFor = async (sel, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    const n = await evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
    if (n > 0) return n
    await sleep(250)
  }
  return 0
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })

const STUB = `window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},transformCallback:(cb)=>{const i=Math.floor(Math.random()*1e9);window['_'+i]=cb;return i},unregisterListener:()=>{},invoke:async(c)=>{const s=String(c);if(s.includes('is_maximized')||s.includes('is_minimized'))return false;if(s.includes('outer_position'))return{x:100,y:100};if(s.includes('inner_size'))return{width:${W},height:${H}};return 0}}`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(4200)

/* 面板材质探针：纯色底 = backgroundColor 不透明 + backdropFilter none */
const PROBE = (sel) => `(() => {
  const P = (s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage === 'none' ? 'none' : 'gradient',
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      border: cs.borderTopColor + ' ' + cs.borderTopWidth,
    }
  }
  return P(${JSON.stringify(sel)})
})()`

const report = {}

const SEED = `(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const lib = useLibraryStore()
  const base = { rootId: 'demo', album: '叶惠美', albumArtist: '周杰伦', artist: '周杰伦',
    genre: '流行', year: 2003, discNo: 1, sampleRateHz: 44100, bitsPerSample: 16,
    bitrateKbps: 320, container: 'flac', fileSize: 8 * 1024 * 1024, mtimeMs: 0,
    hasCover: false, coverId: null, embeddedLyrics: null }
  const titles = ['以父之名', '懦夫', '晴天', '三年二班', '东风破', '你听得到']
  titles.forEach((t, i) => lib.songs.push({ ...base,
    path: 'demo/叶惠美/' + String(i + 1).padStart(2, '0') + ' ' + t + '.flac',
    fileName: t + '.flac', title: t, trackNo: i + 1, durationSec: 200 + i * 15 }))
  await new Promise((r) => setTimeout(r, 200))
  const a = await window.__musicTest.pl('create', '周杰伦')
  const idA = a?.id ?? a
  await window.__musicTest.pl('add', idA)
  window.__plA = idA
  return { songs: lib.songs.length, playlist: idA }
})()`
log('seed')
report.setup = await evaluate(SEED)

log('open playlist')
report.enter = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  ui.activeView = 'playlists'
  ui.detailKey = window.__plA
  await new Promise((r) => setTimeout(r, 1600))
  return ui.detailKey
})()`)
await waitFor('.pl-actions .action-btn')

/* ① 更多操作下拉 */
log('more menu')
report.moreMenu = await evaluate(`(async () => {
  document.querySelectorAll('.pl-actions .action-btn')[1].click()
  await new Promise((r) => setTimeout(r, 350))
  return ${PROBE('.more-menu')}
})()`)
await shot('130-more-menu-solid.png')

/* ② 添加歌曲弹窗（用户截图 1） */
log('add modal')
report.addModal = await evaluate(`(async () => {
  ;[...document.querySelectorAll('.more-menu .more-item')][0].click()
  await new Promise((r) => setTimeout(r, 700))
  const p = ${PROBE('.modal.add-modal')}
  const mask = getComputedStyle(document.querySelector('.modal-mask')).backgroundColor
  return { panel: p, mask, open: !!document.querySelector('.add-modal') }
})()`)
await shot('131-add-modal-solid.png')

/* ④ 歌单排序下拉 + 右键菜单与二级面板 */
log('sort + context menu')
report.sortMenu = await evaluate(`(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 500))
  const btn = document.querySelector('.sort-btn')
  btn?.click()
  await new Promise((r) => setTimeout(r, 350))
  return ${PROBE('.sort-menu')}
})()`)

report.contextMenu = await evaluate(`(async () => {
  document.querySelector('.sort-mask')?.click()
  await new Promise((r) => setTimeout(r, 300))
  const row = document.querySelector('.song-row')
  if (!row) return { __ERR: 'no song-row' }
  const r = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 200, clientY: r.top + 20 }))
  await new Promise((res) => setTimeout(res, 500))
  const plain = ${PROBE('.song-menu')}
  // 展开「添加到歌单」二级面板
  const sub = [...document.querySelectorAll('.song-menu .menu-item')].find((b) => b.textContent.includes('添加到歌单'))
  sub?.click()
  await new Promise((res) => setTimeout(res, 400))
  return { menu: plain, submenu: ${PROBE('.submenu')}, submenuOpen: !!document.querySelector('.submenu') }
})()`)
await shot('133-context-menu-solid.png')
await evaluate(`document.querySelector('.menu-layer')?.click(); await new Promise(r=>setTimeout(r,300))`)

/* ⑤ 新建歌单弹窗（用户截图 2） */
log('create dialog')
report.createDialog = await evaluate(`(async () => {
  document.querySelector('.add-close')?.click()
  await new Promise((r) => setTimeout(r, 400))
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  ui.requestPlaylistCreate()
  await new Promise((r) => setTimeout(r, 900))
  const modals = [...document.querySelectorAll('.modal')]
  return {
    open: modals.length,
    panel: ${PROBE('.modal')},
    title: document.querySelector('.modal .modal-title')?.textContent?.trim() ?? null,
  }
})()`)
await shot('132-create-dialog-solid.png')

/* ⑥ 专辑页的「添加到歌单」二级面板 */
log('album add menu')
report.albumMenu = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const ui = useUiStore()
  ui.activeView = 'albums'
  ui.detailKey = useLibraryStore().albums[0].key
  await new Promise((r) => setTimeout(r, 1700))
  document.querySelectorAll('.album-actions .action-btn')[1].click()
  await new Promise((r) => setTimeout(r, 400))
  document.querySelectorAll('.song-row, .track-row')[0].click()
  await new Promise((r) => setTimeout(r, 300))
  document.querySelectorAll('.batch-actions .action-btn')[1].click()
  await new Promise((r) => setTimeout(r, 400))
  return ${PROBE('.add-menu')}
})()`)
await shot('134-album-add-menu-solid.png')

/* ⑦ 深色主题下的弹窗 */
log('dark modal')
await evaluate(`localStorage.setItem('settings.themeMode','dark')`)
await send('Page.navigate', { url: URL_APP })
await sleep(4200)
await evaluate(SEED)
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  ui.activeView = 'playlists'
  ui.detailKey = window.__plA
  await new Promise((r) => setTimeout(r, 1600))
})()`)
await waitFor('.pl-actions .action-btn')
report.darkModal = await evaluate(`(async () => {
  document.querySelectorAll('.pl-actions .action-btn')[1].click()
  await new Promise((r) => setTimeout(r, 350))
  ;[...document.querySelectorAll('.more-menu .more-item')][0].click()
  await new Promise((r) => setTimeout(r, 700))
  return { theme: document.documentElement.dataset.theme, panel: ${PROBE('.modal.add-modal')} }
})()`)
await shot('135-add-modal-dark.png')
await evaluate(`localStorage.setItem('settings.themeMode','light')`)

report.errors = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
process.exit(0)
