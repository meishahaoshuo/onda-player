/**
 * 像素级验证：退场过渡期间，顶栏那一条（0~62px）必须**逐像素不变**。
 * 并做 A/B 对照：把裁切临时关掉 → 顶栏应立刻被画脏（证明测法有敏感性、裁切确实是生效的那一环）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decodePng, comparePng } from './png-dec.mjs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9363
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const BAND_H = 62
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-px-'))

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
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
/** 只截顶栏那一条（scale 1，便于逐像素比较） */
async function grabBand(name) {
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: BAND_H, scale: 1 } })
  const p = path.join(SHOT_DIR, name)
  fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
  return p
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
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
await evaluate(`(async () => { await window.__musicTest.stressAlbums(18); await new Promise((r) => setTimeout(r, 600)) })()`)

async function enterClipped() {
  await evaluate(`(async () => {
    const { useUiStore } = await import('/src/stores/ui.ts')
    useUiStore().navigate('albums')
    await new Promise((r) => setTimeout(r, 900))
    document.querySelector('.view-body').scrollTop = 110
    await new Promise((r) => setTimeout(r, 500))
  })()`)
  const pt = await evaluate(`(() => {
    const host = document.querySelector('.view-body')
    const ht = host.getBoundingClientRect().top
    const el = [...document.querySelectorAll('.album-card')].find((c) => { const b = c.getBoundingClientRect(); return b.top < ht - 1 && b.bottom > ht + 30 })
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.left + b.width / 2), y: Math.round(ht + 24) }
  })()`)
  await realClick(pt.x, pt.y)
  await sleep(1200)
  return pt
}
const backPt = () => evaluate(`(() => { const b = document.querySelector('.head-back'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)

/** 跑一次「进详情 → 点返回」，在退场过程里连拍顶栏；返回各帧与基准的最大像素差 */
async function run(label, disableClip) {
  await enterClipped()
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 540, y: 420 })
  await sleep(300)
  const baseline = await grabBand(`120-band-baseline-${label}.png`)
  if (disableClip) {
    await evaluate(`(() => {
      const c = document.querySelector('.detail-clip'); if (c) c.style.overflow = 'visible'
      const h = document.querySelector('.page-flight-clip'); if (h) h.style.clipPath = 'none'
      window.__clipOff = true
    })()`)
  } else {
    await evaluate(`(() => {
      const c = document.querySelector('.detail-clip'); if (c) c.style.overflow = ''
      const h = document.querySelector('.page-flight-clip'); if (h) h.style.clipPath = ''
    })()`)
  }
  const back = await backPt()
  await realClick(back.x, back.y)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 540, y: 420 })
  const base = decodePng(baseline)
  const frames = []
  for (const wait of [200, 200]) {
    await sleep(wait)
    const p = await grabBand(`121-band-${label}-${frames.length}.png`)
    const cmp = comparePng(base, decodePng(p))
    frames.push({ atMs: frames.reduce((a, f) => a + f.wait, 0) + wait, wait, ...cmp })
  }
  await sleep(1200)
  return { label, clip周: !disableClip, frames }
}

report.withClip = await run('clipON', false)
report.withoutClip = await run('clipOFF', true)
report.verdict = {
  有裁切时顶栏最大像素差: Math.max(...report.withClip.frames.map((f) => f.maxDiff)),
  有裁切时脏像素数: report.withClip.frames.reduce((a, f) => a + f.diffPixels, 0),
  关掉裁切时顶栏最大像素差: Math.max(...report.withoutClip.frames.map((f) => f.maxDiff)),
  关掉裁切时脏像素数: report.withoutClip.frames.reduce((a, f) => a + f.diffPixels, 0),
}
report.finalState = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  return { detailKey: ui.detailKey, dolly: ui.dolly, layer: !!document.querySelector('.detail-layer'), flights: document.querySelectorAll('.page-flight').length }
})()`)
report.exceptions = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
