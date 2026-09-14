/**
 * 复现「封面被裁切时点进详情、退出动画盖住顶栏」。
 * 采样退场期间 .detail-layer 的 rect.top —— 若低于顶栏下缘（head-band-h = 62px），即证实越界。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9357
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-fold-'))

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
await evaluate(`(async () => { await window.__musicTest.stressAlbums(18); await new Promise((r) => setTimeout(r, 600)) })()`)

/* 切到专辑页并下滚，让首行卡片被裁切 */
report.env = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().navigate('albums')
  await new Promise((r) => setTimeout(r, 900))
  const host = document.querySelector('.view-body')
  host.scrollTop = 90
  await new Promise((r) => setTimeout(r, 500))
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) } }
  const header = document.querySelector('.view-header')
  const cards = [...document.querySelectorAll('.album-card')]
  const partial = cards.filter((c) => c.getBoundingClientRect().top < host.getBoundingClientRect().top + 1 && c.getBoundingClientRect().bottom > host.getBoundingClientRect().top + 4)
  return {
    viewBody: r(host),
    viewHeader: r(header),
    scrollTop: host.scrollTop,
    partialCount: partial.length,
    partialCard: partial[0] ? { ...r(partial[0]), index: cards.indexOf(partial[0]) } : null,
  }
})()`)

if (!report.env.partialCard) {
  console.log(JSON.stringify({ ...report, note: '没有找到被裁切的卡片，加大滚动量重试' }, null, 2))
  ws.close(); proc.kill(); process.exit(0)
}

/* 点被裁切的卡片进详情 */
const p = report.env.partialCard
await realClick(Math.round(p.left + p.width / 2), Math.round(report.env.viewBody.top + 20))
await sleep(1300)
report.entered = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const layer = document.querySelector('.detail-layer')
  return { detailKey: useUiStore().detailKey, layerTop: layer ? +layer.getBoundingClientRect().top.toFixed(1) : null }
})()`)

/* 在页面内高频采样退场期间层的 top 与层内是否越界 */
const sampler = send('Runtime.evaluate', {
  expression: `(async () => {
    const layer = document.querySelector('.detail-layer')
    const bandBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-band-h')) || 62
    const samples = []
    const t0 = performance.now()
    return await new Promise((resolve) => {
      const tick = () => {
        const el = document.querySelector('.detail-layer')
        if (el) {
          const b = el.getBoundingClientRect()
          samples.push({ t: Math.round(performance.now() - t0), top: +b.top.toFixed(1), opacity: +Number(getComputedStyle(el).opacity).toFixed(2) })
        }
        if (performance.now() - t0 < 1400) requestAnimationFrame(tick)
        else resolve({ bandBottom, samples })
      }
      requestAnimationFrame(tick)
    })
  })()`,
  awaitPromise: true,
  returnByValue: true,
})

const back = await evaluate(`(() => { const b = document.querySelector('.head-back'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
await sleep(60)
await realClick(back.x, back.y)
await sleep(260)
await shot('110-fold-overflow.png')
const sres = await sampler
report.sampling = sres.result.value

const band = report.sampling.bandBottom
const over = report.sampling.samples.filter((s) => s.top < band - 0.5)
report.verdict = {
  bandBottom: band,
  minTop: Math.min(...report.sampling.samples.map((s) => s.top)),
  overflowSamples: over.length,
  firstOverflow: over[0] ?? null,
}
report.exceptions = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
