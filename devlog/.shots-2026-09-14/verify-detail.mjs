import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9337
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-detail-'))

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

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })

const STUB = `window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},transformCallback:(cb)=>{const i=Math.floor(Math.random()*1e9);window['_'+i]=cb;return i},unregisterListener:()=>{},invoke:async(c)=>{const s=String(c);if(s.includes('is_maximized')||s.includes('is_minimized'))return false;if(s.includes('outer_position'))return{x:100,y:100};if(s.includes('inner_size'))return{width:${W},height:${H}};return 0}}`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(4200)

const report = {}

/* 造数据：注入 4 张合成专辑（各 2 首），并切到专辑详情 */
report.setup = await evaluate(`(async () => {
  await window.__musicTest.stressAlbums(4)
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const lib = useLibraryStore()
  const a = lib.albums[0]
  const art = lib.artists[0]
  return {
    albumCount: lib.albums.length,
    albumFields: a ? Object.keys(a) : [],
    albumKey: a ? (a.key ?? a.id ?? a.name ?? null) : null,
    artistCount: lib.artists.length,
    artistFields: art && typeof art === 'object' ? Object.keys(art) : typeof art,
    artistKey: art ? (typeof art === 'string' ? art : (art.name ?? art.key ?? null)) : null,
  }
})()`)

const PROBE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) } }
  const close = document.querySelector('.header-close')
  const btn = document.querySelector('.titlebar .tb-btn:last-child')
  const rc = r(close), rb = r(btn)
  if (!rc || !rb) return { error: 'missing', hasClose: !!close, hasBtn: !!btn }
  const overlapX = Math.min(rc.right, rb.right) - Math.max(rc.left, rb.left)
  const overlapY = Math.min(rc.bottom, rb.bottom) - Math.max(rc.top, rb.top)
  const hit = document.elementFromPoint(Math.round((rc.left + rc.right) / 2), Math.round((rc.top + rc.bottom) / 2))
  const hitIsClose = !!(hit && (hit === close || close.contains(hit) || hit.closest('.header-close')))
  return {
    closeRect: rc,
    winCloseRect: rb,
    overlapW: overlapX > 0 ? overlapX : 0,
    overlapH: overlapY > 0 ? overlapY : 0,
    overlapped: overlapX > 0 && overlapY > 0,
    hitElement: hit ? (hit.className || hit.tagName) : null,
    closeClickable: hitIsClose,
  }
})()`

/* 让返回钮显形（它常态 opacity:0，悬停才浮现） */
const revealClose = `document.querySelector('.header-close')?.style.setProperty('opacity','1','important')`

report.album = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const ui = useUiStore()
  const lib = useLibraryStore()
  const a = lib.albums[0]
  ui.activeView = 'albums'
  ui.detailKey = a.key ?? a.id ?? a.name
  await new Promise((r) => setTimeout(r, 1400))
  ${revealClose}
  await new Promise((r) => setTimeout(r, 200))
  return { detailKey: ui.detailKey, closeInDom: !!document.querySelector('.header-close') }
})()`)
report.albumProbe = await evaluate(PROBE)
await shot('20-album-detail.png')

report.artist = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const ui = useUiStore()
  const lib = useLibraryStore()
  const art = lib.artists[0]
  ui.activeView = 'artists'
  ui.detailKey = typeof art === 'string' ? art : (art.name ?? art.key)
  await new Promise((r) => setTimeout(r, 1400))
  ${revealClose}
  await new Promise((r) => setTimeout(r, 200))
  return { detailKey: ui.detailKey, closeInDom: !!document.querySelector('.header-close') }
})()`)
report.artistProbe = await evaluate(PROBE)
await shot('21-artist-detail.png')

report.errors = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
process.exit(0)
