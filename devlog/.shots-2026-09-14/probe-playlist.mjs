import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9341
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-pl-'))

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

/* 复现用户场景：有歌的歌单（藏起来的那批 UI 才会出现） */
report.setup = await evaluate(`(async () => {
  await window.__musicTest.stressAlbums(4)
  const rec = await window.__musicTest.pl('create', '有歌的歌单')
  const id = rec?.id ?? rec
  const added = await window.__musicTest.pl('add', id)
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  ui.activeView = 'playlists'
  ui.detailKey = id
  await new Promise((r) => setTimeout(r, 1800))
  return { id, added }
})()`)

/* 先把头部及其所有子元素的几何/类名逐个列出，定位那个 × 归属 */
report.headerChildren = await evaluate(`(() => {
  const out = []
  const dump = (el, depth) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    out.push({
      depth,
      tag: el.tagName.toLowerCase(),
      cls: el.className && typeof el.className === 'string' ? el.className : '',
      text: (el.childElementCount === 0 ? (el.textContent || '').trim() : '').slice(0, 18),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      pos: cs.position,
      opacity: cs.opacity,
      visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0',
    })
    if (depth < 3) for (const c of el.children) dump(c, depth + 1)
  }
  const hdr = document.querySelector('.pl-header')
  if (hdr) dump(hdr, 0)
  return out
})()`)

/* 全页扫一遍带 close 图标的元素（svg path 特征：M18 6L6 18） */
report.closeIcons = await evaluate(`(() => {
  const hits = []
  for (const svg of document.querySelectorAll('svg')) {
    const d = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d') || '').join(' ')
    if (d.includes('M18 6L6 18') || d.includes('M6 6l12 12')) {
      const r = svg.getBoundingClientRect()
      const host = svg.closest('button, .header-close, [class]')
      hits.push({
        hostCls: host && host.className ? host.className : '',
        hostTag: host ? host.tagName.toLowerCase() : '',
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        hostRect: host ? (() => { const b = host.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] })() : null,
        hostPos: host ? getComputedStyle(host).position : null,
      })
    }
  }
  return hits
})()`)

report.domHasLegacyClose = await evaluate(`document.querySelectorAll('.header-close').length`)
report.stylesheetHasHeaderClose = await evaluate(`[...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.cssText && r.cssText.includes('.header-close')) } catch { return false } })`)

report.geometry = await evaluate(`(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left), top: Math.round(b.top), bottom: Math.round(b.bottom) } }
  return { header: r('.pl-header'), cover: r('.header-cover'), coverImg: r('.header-cover img, .header-cover .cover-fallback, .header-cover .collage'), name: r('.pl-name'), sideinfo: r('.pl-sideinfo') }
})()`)

await shot('50-playlist-with-songs.png')

/* 复现假设：若 '.header-close' 的元素在、样式被删，会塌成头部左侧一个裸按钮 */
report.staleSim = await evaluate(`(async () => {
  const hdr = document.querySelector('.pl-header')
  const b = document.createElement('button')
  b.className = 'header-close'
  b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  hdr.insertBefore(b, hdr.firstElementChild)
  await new Promise((r) => setTimeout(r, 200))
  const r = b.getBoundingClientRect()
  const hr = hdr.getBoundingClientRect()
  const cs = getComputedStyle(b)
  return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], headerRect: [Math.round(hr.left), Math.round(hr.top), Math.round(hr.width), Math.round(hr.height)], pos: cs.position, relX: Math.round(r.left - hr.left), relBottom: Math.round(hr.bottom - r.bottom) }
})()`)
await shot('51-stale-simulation.png')

report.errors = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
process.exit(0)
