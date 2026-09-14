/**
 * 队列面板在「胶囊 / 标准」两种播放条下的位置测量。
 * 目的：量化它到底偏了多少、偏向哪边，再决定怎么统一。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9347
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-qpos-'))

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
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(420)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

const STUB = `
(() => {
  const orig = window.matchMedia.bind(window)
  window.matchMedia = (q) => (String(q).includes('prefers-reduced-motion') ? { matches: false, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, onchange: null } : orig(q))
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' } },
    transformCallback: (cb) => { const i = Math.floor(Math.random() * 1e9); window['_' + i] = cb; return i },
    unregisterListener: () => {},
    invoke: async (c) => { const s = String(c); if (s.includes('is_maximized') || s.includes('is_minimized')) return false; if (s.includes('outer_position')) return { x: 100, y: 100 }; if (s.includes('inner_size')) return { width: ${W}, height: ${H} }; return 0 },
  }
})()`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(4600)

const report = { viewport: [W, H] }
await evaluate(`(async () => {
  await window.__musicTest.stressAlbums(4)
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const { usePlayerStore } = await import('/src/stores/player.ts')
  const lib = useLibraryStore(), p = usePlayerStore()
  p.queue = lib.songs.slice(0, 6)
  p.index = 1
  await new Promise((r) => setTimeout(r, 500))
})()`)

const MEASURE = `(() => {
  const bar = document.querySelector('.player-bar')
  const panel = document.querySelector('.queue-panel')
  const app = document.querySelector('.app-shell') ?? document.body
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }
  const br = r(bar), pr = r(panel), ar = r(app)
  const cs = panel ? getComputedStyle(panel) : null
  return {
    barRect: br, panelRect: pr, appRect: ar,
    panelCss: cs ? { position: cs.position, left: cs.left, right: cs.right, bottom: cs.bottom, width: cs.width } : null,
    barClass: bar.className,
    gapPanelRightToWindow: pr ? +(window.innerWidth - pr.right).toFixed(1) : null,
    gapPanelRightToBar: pr && br ? +(br.right - pr.right).toFixed(1) : null,
    panelCenter: pr ? +((pr.left + pr.right) / 2).toFixed(1) : null,
    windowCenter: +(window.innerWidth / 2).toFixed(1),
    barCenter: br ? +((br.left + br.right) / 2).toFixed(1) : null,
  }
})()`

async function clickToggle() {
  const b = await evaluate(`(() => { const el = document.querySelector('[data-queue-toggle]'); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } })()`)
  await realClick(b.x, b.y)
}
const isOpen = () => evaluate(`!!document.querySelector('.queue-panel')`)
async function ensureOpen() { if (!(await isOpen())) await clickToggle() }

/* ---------- 标准模式 ---------- */
await evaluate(`(async () => { const { useSettingsStore } = await import('/src/stores/settings.ts'); useSettingsStore().playerStyle = 'standard'; await new Promise((r) => setTimeout(r, 1200)) })()`)
await ensureOpen()
report.standard = await evaluate(MEASURE)
await shot('90-queue-standard.png')
await clickToggle()

/* ---------- 胶囊模式 ---------- */
await evaluate(`(async () => { const { useSettingsStore } = await import('/src/stores/settings.ts'); useSettingsStore().playerStyle = 'capsule'; await new Promise((r) => setTimeout(r, 1400)) })()`)
await ensureOpen()
report.capsule = await evaluate(MEASURE)
await shot('91-queue-capsule.png')

/* 面板向右溢出条子后，不能把页面撑出横向滚动 */
report.overflow = await evaluate(`({
  docScrollW: document.documentElement.scrollWidth,
  bodyScrollW: document.body.scrollWidth,
  innerW: window.innerWidth,
  noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth,
  panelFullyVisible: (() => { const p = document.querySelector('.queue-panel'); if (!p) return null; const b = p.getBoundingClientRect(); return b.right <= window.innerWidth && b.left >= 0 })(),
})`)

/* 窄窗口：条子退化为 `100vw - 24px`，补偿值应约 4px，不能向右溢出 */
await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 700, deviceScaleFactor: 2, mobile: false })
await sleep(900)
report.narrow = await evaluate(MEASURE)
report.narrowOverflow = await evaluate(`(() => { const p = document.querySelector('.queue-panel'); const b = p.getBoundingClientRect(); return { panelRight: +b.right.toFixed(1), innerW: window.innerWidth, insideWindow: b.right <= window.innerWidth + 0.5 } })()`)
await shot('92-queue-capsule-narrow.png')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
await sleep(700)

report.delta = {
  panelRightStandard: report.standard.gapPanelRightToWindow,
  panelRightCapsule: report.capsule.gapPanelRightToWindow,
  差: report.standard.gapPanelRightToWindow !== null && report.capsule.gapPanelRightToWindow !== null
    ? +(report.standard.gapPanelRightToWindow - report.capsule.gapPanelRightToWindow).toFixed(1) : null,
}
report.exceptions = errors
console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
