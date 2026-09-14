/**
 * 「详情页里再点同一个侧栏板块 = 返回上一级」的过渡验证。
 * 关键：必须**从网格卡片真实点进去**，这样编排器才记录了 origin；
 * 直接设 detailKey 会走无线动画的轻量路径，测不出退场是否真的在跑。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9353
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-navback-'))

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
}
const centerOf = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 40) } })()`)

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
await evaluate(`(async () => { await window.__musicTest.stressAlbums(6); await new Promise((r) => setTimeout(r, 500)) })()`)

const STATE = `(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  const layer = document.querySelector('.detail-layer')
  const card = document.querySelector('.album-card, .artist-card')
  const cs = card ? getComputedStyle(card) : null
  return {
    view: ui.activeView,
    detailKey: ui.detailKey,
    dolly: ui.dolly,
    detailLayer: !!layer,
    detailAnims: layer ? layer.getAnimations({ subtree: true }).length : 0,
    cardOpacity: cs ? +Number(cs.opacity).toFixed(2) : null,
    cardTransform: cs ? cs.transform : null,
  }
})()`

/* ---------- 用例 1：专辑详情里点侧栏「专辑」 ---------- */
await evaluate(`(async () => { const { useUiStore } = await import('/src/stores/ui.ts'); useUiStore().navigate('albums'); await new Promise((r) => setTimeout(r, 900)) })()`)
const cardPt = await centerOf('.album-card')
await realClick(cardPt.x, cardPt.y)
await sleep(1100)
report.albumEntered = await evaluate(STATE)

const navAlbum = await evaluate(`(() => { const b = [...document.querySelectorAll('.sidebar .nav-item')].find((x) => x.textContent.trim() === '专辑'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
await realClick(navAlbum.x, navAlbum.y)
await sleep(110)
report.albumDuringExit = await evaluate(STATE)
await shot('100-album-exit-running.png')
await sleep(1500)
report.albumAfterExit = await evaluate(STATE)
await shot('101-album-after-nav-back.png')

/* ---------- 用例 2：艺术家详情里点侧栏「艺术家」 ---------- */
await evaluate(`(async () => { const { useUiStore } = await import('/src/stores/ui.ts'); useUiStore().navigate('artists'); await new Promise((r) => setTimeout(r, 900)) })()`)
const artPt = await centerOf('.artist-card')
await realClick(artPt.x, artPt.y)
await sleep(1100)
report.artistEntered = await evaluate(STATE)
const navArtist = await evaluate(`(() => { const b = [...document.querySelectorAll('.sidebar .nav-item')].find((x) => x.textContent.trim() === '艺术家'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
await realClick(navArtist.x, navArtist.y)
await sleep(110)
report.artistDuringExit = await evaluate(STATE)
await sleep(1500)
report.artistAfterExit = await evaluate(STATE)

/* ---------- 用例 3（回归）：详情里点**不同**板块仍应直接换页 ---------- */
await evaluate(`(async () => { const { useUiStore } = await import('/src/stores/ui.ts'); useUiStore().navigate('albums'); await new Promise((r) => setTimeout(r, 900)) })()`)
const p3 = await centerOf('.album-card')
await realClick(p3.x, p3.y)
await sleep(1100)
await realClick(navArtist.x, navArtist.y)
await sleep(1200)
report.crossView = await evaluate(STATE)

/* ---------- 用例 4（回归）：正常「返回」按钮是否仍走过渡 ---------- */
await evaluate(`(async () => { const { useUiStore } = await import('/src/stores/ui.ts'); useUiStore().navigate('albums'); await new Promise((r) => setTimeout(r, 900)) })()`)
const p4 = await centerOf('.album-card')
await realClick(p4.x, p4.y)
await sleep(1100)
const backBtn = await evaluate(`(() => { const b = document.querySelector('.head-back'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
await realClick(backBtn.x, backBtn.y)
await sleep(110)
report.backDuringExit = await evaluate(STATE)
await sleep(1500)
report.backAfterExit = await evaluate(STATE)

report.exceptions = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
