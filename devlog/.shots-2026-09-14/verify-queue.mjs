/**
 * 播放队列面板开关回归测试。
 * 关键：必须用 CDP Input.dispatchMouseEvent 发**真实指针事件**——
 * element.click() 只派发 click，不会产生 pointerdown，
 * 而本 bug 正是 pointerdown 与 click 各改一次状态造成的，合成 click 测不出来。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9345
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-queue-'))

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
/** 真实指针点击（会依次产生 pointerdown → mousedown → pointerup → mouseup → click） */
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(420)
}
const rectOf = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } })()`)
const panelState = () => evaluate(`({
  panel: !!document.querySelector('.queue-panel'),
  toggleActive: !!document.querySelector('[data-queue-toggle].is-active'),
  rows: document.querySelectorAll('.queue-panel .queue-row').length,
})`)

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
  await window.__musicTest.stressAlbums(4)
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const { usePlayerStore } = await import('/src/stores/player.ts')
  const lib = useLibraryStore(), p = usePlayerStore()
  p.queue = lib.songs.slice(0, 6)
  p.index = 1
  await new Promise((r) => setTimeout(r, 600))
  return { queueLen: p.queue.length, index: p.index }
})()`)

const btn = await rectOf('[data-queue-toggle]')
report.buttonRect = btn
const seq = []

/* 1. 第一次点击：应打开 */
await realClick(btn.x, btn.y)
seq.push({ step: '1st click (open)', ...(await panelState()) })
await shot('80-queue-open.png')

/* 2. 第二次点击：应关闭 —— 这就是用户报的 bug */
await realClick(btn.x, btn.y)
seq.push({ step: '2nd click (close)', ...(await panelState()) })

/* 3. 第三次点击：应再次打开（确认不是"只能开一次"） */
await realClick(btn.x, btn.y)
seq.push({ step: '3rd click (open again)', ...(await panelState()) })

/* 4. 第四次点击：应关闭 */
await realClick(btn.x, btn.y)
seq.push({ step: '4th click (close again)', ...(await panelState()) })
report.toggleSeq = seq

/* 5. 开着时点播放条空白处：应收起面板且不 seek */
await realClick(btn.x, btn.y)
const beforeSeek = await evaluate(`(async () => { const { usePlayerStore } = await import('/src/stores/player.ts'); return usePlayerStore().currentTime })()`)
const bar = await rectOf('.player-bar')
await realClick(bar.left + 30, bar.top + 12)
report.blankArea = {
  ...(await panelState()),
  timeBefore: beforeSeek,
  timeAfter: await evaluate(`(async () => { const { usePlayerStore } = await import('/src/stores/player.ts'); return usePlayerStore().currentTime })()`),
}

/* 6. 开着时点队列行：面板应保持打开（面板内部不触发关闭） */
await realClick(btn.x, btn.y)
const row = await rectOf('.queue-panel .queue-row')
if (row) {
  await realClick(row.x, row.y)
  report.rowClick = { ...(await panelState()) }
  await shot('81-queue-after-row-click.png')
}

/* 7. 开着时点「上一曲」：面板应收起，且不能因此变成 seek */
await realClick(btn.x, btn.y)
const prevBtn = await evaluate(`(() => {
  const b = [...document.querySelectorAll('.player-bar .buttons .icon-btn')].find((x) => x.title === '上一曲')
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
if (prevBtn) {
  await realClick(prevBtn.x, prevBtn.y)
  report.otherControl = { ...(await panelState()) }
}

/* 8. 面板里的「清空」按钮：应清空并收起 */
await realClick(btn.x, btn.y)
const clearBtn = await rectOf('.queue-panel .queue-clear')
if (clearBtn) {
  await realClick(clearBtn.x, clearBtn.y)
  report.clearBtn = {
    ...(await panelState()),
    queueLen: await evaluate(`(async () => { const { usePlayerStore } = await import('/src/stores/player.ts'); return usePlayerStore().queue.length })()`),
  }
}

report.exceptions = errors
console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
