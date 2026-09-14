/**
 * 顶部裁切的完整验证：
 *  A. 被裁切卡片 —— 进入时封面克隆的 top、退出时折叠层的 top，都必须 >= 顶栏下缘
 *  B. 完全可见卡片（回归）—— 过渡仍正常完成，不能因为加了夹紧而卡住
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9359
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-clip-'))

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

/* 采样器：持续记录某个选择器的 rect.top / opacity */
const makeSampler = (sel, ms) => send('Runtime.evaluate', {
  expression: `(async () => {
    const sel = ${JSON.stringify(sel)}
    const band = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-band-h')) || 62
    const samples = []
    const t0 = performance.now()
    return await new Promise((resolve) => {
      const tick = () => {
        for (const el of document.querySelectorAll(sel)) {
          const b = el.getBoundingClientRect()
          samples.push({ t: Math.round(performance.now() - t0), top: +b.top.toFixed(1), op: +Number(getComputedStyle(el).opacity).toFixed(2) })
        }
        if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick)
        else resolve({ band, samples })
      }
      requestAnimationFrame(tick)
    })
  })()`,
  awaitPromise: true,
  returnByValue: true,
})

const verdictOf = (label, r) => {
  const band = r.result.value.band
  const s = r.result.value.samples
  if (!s.length) return { label, samples: 0, note: '未捕获到元素' }
  const minTop = Math.min(...s.map((x) => x.top))
  const over = s.filter((x) => x.top < band - 0.5)
  return { label, band, samples: s.length, minTop, overflowSamples: over.length, firstOverflow: over[0] ?? null }
}

const report = {}
await evaluate(`(async () => { await window.__musicTest.stressAlbums(18); await new Promise((r) => setTimeout(r, 600)) })()`)

async function gotoAlbumsWithScroll(scrollTop) {
  await evaluate(`(async () => {
    const { useUiStore } = await import('/src/stores/ui.ts')
    useUiStore().navigate('albums')
    await new Promise((r) => setTimeout(r, 900))
    const host = document.querySelector('.view-body')
    host.scrollTop = ${scrollTop}
    await new Promise((r) => setTimeout(r, 500))
  })()`)
}
const pickCard = (mode) => evaluate(`(() => {
  const host = document.querySelector('.view-body')
  const ht = host.getBoundingClientRect().top
  const cards = [...document.querySelectorAll('.album-card')]
  const cut = cards.filter((c) => { const b = c.getBoundingClientRect(); return b.top < ht - 1 && b.bottom > ht + 30 })
  const full = cards.filter((c) => c.getBoundingClientRect().top >= ht + 4)
  const el = ${JSON.stringify(mode)} === 'clipped' ? cut[0] : full[0]
  if (!el) return null
  const b = el.getBoundingClientRect()
  return { x: Math.round(b.left + b.width / 2), y: Math.round(Math.max(b.top, ht) + 24), rawTop: +b.top.toFixed(1), hostTop: +ht.toFixed(1) }
})()`)

/* ---------- A. 被裁切卡片 ---------- */
await gotoAlbumsWithScroll(110)
const cut = await pickCard('clipped')
report.clippedClick = cut
let p = makeSampler('.page-flight', 900)
await sleep(60)
await realClick(cut.x, cut.y)
report.enterCloneClipped = verdictOf('进入·封面克隆（被裁切卡片）', await p)
await sleep(900)
const back = await evaluate(`(() => { const b = document.querySelector('.head-back'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
p = makeSampler('.detail-layer', 1400)
await sleep(60)
await realClick(back.x, back.y)
await sleep(300)
await shot('111-clipped-exit-fixed.png')
report.exitLayerClipped = verdictOf('退出·折叠层（被裁切卡片）', await p)
await sleep(900)

/* ---------- B. 回归：完全可见的卡片 ---------- */
await gotoAlbumsWithScroll(0)
const full = await pickCard('full')
report.fullClick = full
let p2 = makeSampler('.page-flight', 900)
await sleep(60)
await realClick(full.x, full.y)
report.enterCloneFull = verdictOf('进入·封面克隆（完全可见卡片）', await p2)
await sleep(900)
const back2 = await evaluate(`(() => { const b = document.querySelector('.head-back'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
let p3 = makeSampler('.detail-layer', 1400)
await sleep(60)
await realClick(back2.x, back2.y)
report.exitLayerFull = verdictOf('退出·折叠层（完全可见卡片）', await p3)
await sleep(1000)
report.finalState = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  const card = document.querySelector('.album-card')
  return { detailKey: ui.detailKey, dolly: ui.dolly, layer: !!document.querySelector('.detail-layer'), flights: document.querySelectorAll('.page-flight').length, cardOpacity: card ? +Number(getComputedStyle(card).opacity).toFixed(2) : null }
})()`)

report.exceptions = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
