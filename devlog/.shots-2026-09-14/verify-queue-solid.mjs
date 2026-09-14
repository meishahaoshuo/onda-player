/**
 * 队列面板改纯色底验收：
 *  - 计算样式确认 backdrop-filter 已移除、背景为不透明纯色（无渐变图）
 *  - 浅/深两主题截图，且面板背后刻意放一张封面/文字，验证不再透出
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9349
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-qsolid-'))

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
  await sleep(450)
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

const report = {}
report.setup = await evaluate(`(async () => {
  await window.__musicTest.stressAlbums(6)
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const { usePlayerStore } = await import('/src/stores/player.ts')
  const { useSettingsStore } = await import('/src/stores/settings.ts')
  const lib = useLibraryStore(), p = usePlayerStore()
  useSettingsStore().playerStyle = 'standard'
  useSettingsStore().themeMode = 'light'
  p.queue = lib.songs.slice(0, 6)
  p.index = 1
  await new Promise((r) => setTimeout(r, 1200))
  return { queueLen: p.queue.length }
})()`)

const STYLE_PROBE = `(() => {
  const p = document.querySelector('.queue-panel')
  if (!p) return null
  const cs = getComputedStyle(p)
  const bg = cs.backgroundColor
  const m = bg.match(/rgba?\\(([^)]+)\\)/)
  const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : []
  const alpha = parts.length === 4 ? parts[3] : 1
  return {
    backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
    backgroundImage: cs.backgroundImage,
    backgroundColor: bg,
    alpha,
    opaque: alpha === 1,
    noGradient: cs.backgroundImage === 'none',
    borderColor: cs.borderTopColor,
    boxShadow: cs.boxShadow.slice(0, 60),
  }
})()`

async function openPanel() {
  const b = await evaluate(`(() => { const el = document.querySelector('[data-queue-toggle]'); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } })()`)
  await realClick(b.x, b.y)
}

/* 浅色主题：面板背后故意滚一张专辑网格上去，看会不会透出来 */
await evaluate(`(async () => { const { useUiStore } = await import('/src/stores/ui.ts'); useUiStore().activeView = 'albums'; await new Promise((r) => setTimeout(r, 900)) })()`)
await openPanel()
report.light = await evaluate(STYLE_PROBE)
await shot('93-queue-solid-light.png')

/* 悬停一行非播放行：确认行内不再浮现收藏/更多/移除按钮 */
const hoverTarget = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.queue-panel .queue-row')]
  const el = rows.find((r) => !r.classList.contains('playing')) ?? rows[0]
  const b = el.getBoundingClientRect()
  return { x: Math.round(b.left + 120), y: Math.round(b.top + b.height / 2) }
})()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverTarget.x, y: hoverTarget.y })
await sleep(500)
report.rowHover = await evaluate(`({
  actionButtons: document.querySelectorAll('.queue-panel .row-act, .queue-panel .row-actions').length,
  rowButtons: document.querySelectorAll('.queue-panel .queue-row button').length,
  hoveredBg: (() => { const el = document.querySelector('.queue-panel .queue-row:hover'); return el ? getComputedStyle(el).backgroundColor : null })(),
  hoveredShadow: (() => { const el = document.querySelector('.queue-panel .queue-row:hover'); return el ? getComputedStyle(el).boxShadow : null })(),
})`)
await shot('96-queue-row-hover.png')


/* 深色主题 */
await evaluate(`(async () => { const { useSettingsStore } = await import('/src/stores/settings.ts'); useSettingsStore().themeMode = 'dark'; await new Promise((r) => setTimeout(r, 900)) })()`)
report.dark = await evaluate(STYLE_PROBE)
await shot('94-queue-solid-dark.png')

/* 胶囊态 + 浅色，确认位置与材质同时成立 */
await evaluate(`(async () => {
  const { useSettingsStore } = await import('/src/stores/settings.ts')
  useSettingsStore().themeMode = 'light'
  useSettingsStore().playerStyle = 'capsule'
  await new Promise((r) => setTimeout(r, 1300))
})()`)
report.capsuleLight = await evaluate(STYLE_PROBE)
report.capsuleGeometry = await evaluate(`(() => {
  const p = document.querySelector('.queue-panel').getBoundingClientRect()
  return { right: +p.right.toFixed(1), gapToWindowRight: +(window.innerWidth - p.right).toFixed(1) }
})()`)
await shot('95-queue-solid-capsule.png')

report.exceptions = errors
console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
