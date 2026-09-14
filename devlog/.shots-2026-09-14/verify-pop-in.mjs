import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9351
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1280
const H = 800
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-pop-'))

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
const LOG_FILE = path.join(SHOT_DIR, 'verify-pop-in.log')
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

/** 触发后立刻采样：CSS 过渡会出现在 getAnimations() 里，transform 应还在起点附近 */
const SAMPLE = (sel, trigger) => `(async () => {
  ${trigger}
  // v-if 是异步更新的：等一拍（~30ms）面板才会挂上，此刻仍处于 220ms 过渡的中段
  await new Promise((r) => setTimeout(r, 30))
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return { __ERR: 'panel not found' }
  const snap = () => {
    const cs = getComputedStyle(el)
    return {
      anims: el.getAnimations().length,
      opacity: Number(cs.opacity).toFixed(2),
      transform: cs.transform === 'none' ? 'none' : cs.transform.slice(0, 40),
      origin: cs.transformOrigin,
      dur: cs.transitionDuration,
      ease: cs.transitionTimingFunction.slice(0, 30),
    }
  }
  const at0 = snap()
  await new Promise((r) => setTimeout(r, 60))
  const at60 = snap()
  await new Promise((r) => setTimeout(r, 400))
  const settled = snap()
  return { at0, at60, settled }
})()`

const report = {}

const SEED = `(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const lib = useLibraryStore()
  const base = { rootId: 'demo', album: '叶惠美', albumArtist: '周杰伦', artist: '周杰伦',
    genre: '流行', year: 2003, discNo: 1, sampleRateHz: 44100, bitsPerSample: 16,
    bitrateKbps: 320, container: 'flac', fileSize: 1024, mtimeMs: 0,
    hasCover: false, coverId: null, embeddedLyrics: null }
  ;['以父之名', '懦夫', '晴天'].forEach((t, i) => lib.songs.push({ ...base,
    path: 'demo/叶惠美/' + t + '.flac', fileName: t + '.flac', title: t, trackNo: i + 1, durationSec: 200 }))
  await new Promise((r) => setTimeout(r, 200))
  const a = await window.__musicTest.pl('create', '周杰伦')
  const idA = a?.id ?? a
  await window.__musicTest.pl('add', idA)
  const b = await window.__musicTest.pl('create', '第二个歌单')
  window.__plA = idA
  window.__plB = b?.id ?? b
  return { songs: lib.songs.length }
})()`
log('seed')
report.setup = await evaluate(SEED)

log('open playlist detail')
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  ui.activeView = 'playlists'
  ui.detailKey = window.__plA
  await new Promise((r) => setTimeout(r, 1700))
})()`)
await waitFor('.pl-actions .action-btn')

log('more-menu')
report.moreMenu = await evaluate(SAMPLE('.more-menu', `document.querySelectorAll('.pl-actions .action-btn')[1].click()`))

log('sort-menu')
report.sortMenu = await evaluate(SAMPLE('.sort-menu', `
  document.querySelector('.more-mask, .pop-mask')?.click()
  await new Promise((r) => setTimeout(r, 300))
  document.querySelector('.sort-btn').click()
`))

log('batch-add-menu')
report.batchAddMenu = await evaluate(SAMPLE('.batch-add-menu', `
  document.querySelector('.sort-mask')?.click()
  await new Promise((r) => setTimeout(r, 300))
  document.querySelectorAll('.pl-actions .action-btn')[1].click()
  await new Promise((r) => setTimeout(r, 400))
  ;[...document.querySelectorAll('.more-menu .more-item')][1].click()
  await new Promise((r) => setTimeout(r, 400))
  document.querySelector('.song-row').click()
  await new Promise((r) => setTimeout(r, 250))
  document.querySelectorAll('.batch-actions .action-btn')[1].click()
`))

log('song-menu + submenu')
report.songMenu = await evaluate(SAMPLE('.song-menu', `
  document.querySelector('.pop-mask')?.click()
  await new Promise((r) => setTimeout(r, 300))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 300))
  const row = document.querySelector('.song-row')
  const r = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 260, clientY: r.top + 10 }))
`))
report.submenu = await evaluate(SAMPLE('.submenu', `
  const sub = [...document.querySelectorAll('.song-menu .menu-item')].find((b) => b.textContent.includes('添加到歌单'))
  sub.click()
`))
await shot('140-song-menu-pop.png')
report.submenuItems = await evaluate(`[...document.querySelectorAll('.submenu .sub-item')].map((b) => b.textContent.trim())`)

log('playlist context menu')
report.playlistMenu = await evaluate(SAMPLE('.playlist-menu', `
  document.querySelector('.menu-layer')?.click()
  await new Promise((r) => setTimeout(r, 300))
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().closeDetail()
  await new Promise((r) => setTimeout(r, 1200))
  const card = document.querySelector('.pl-card')
  const r = card.getBoundingClientRect()
  card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 40 }))
`))

log('add modal + queue panel')
report.addModal = await evaluate(SAMPLE('.modal.add-modal', `
  document.querySelector('.menu-layer')?.click()
  await new Promise((r) => setTimeout(r, 300))
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { usePlaylistStore } = await import('/src/stores/playlist.ts')
  const ui = useUiStore()
  ui.activeView = 'playlists'
  ui.detailKey = usePlaylistStore().playlists[0].id
  await new Promise((r) => setTimeout(r, 1600))
  document.querySelectorAll('.pl-actions .action-btn')[1].click()
  await new Promise((r) => setTimeout(r, 350))
  ;[...document.querySelectorAll('.more-menu .more-item')][0].click()
`))
await shot('141-add-modal-pop.png')

report.queuePanel = await evaluate(SAMPLE('.queue-panel', `
  document.querySelector('.modal-mask')?.click()
  await new Promise((r) => setTimeout(r, 500))
  document.querySelector('[data-queue-toggle]').click()
`))

report.errors = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
process.exit(0)
