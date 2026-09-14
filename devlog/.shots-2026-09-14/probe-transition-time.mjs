/**
 * 量「引力坍缩」正/反向过渡的真实墙钟耗时（从 dolly 变为非 idle 起，到回到 idle 止）。
 * 在页面内用 rAF 计时，避免 CDP 往返误差。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9355
const URL_APP = 'http://localhost:5180/'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-tdur-'))

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

/* 页面内计时器：等 dolly 由 idle 变为非 idle 起算，回到 idle 为止 */
await evaluate(`(() => {
  window.__arm = async () => {
    const { useUiStore } = await import('/src/stores/ui.ts')
    const ui = useUiStore()
    return await new Promise((resolve) => {
      let started = 0
      const tick = () => {
        const now = performance.now()
        if (!started && ui.dolly !== 'idle') started = now
        if (started && ui.dolly === 'idle') { resolve(+(now - started).toFixed(0)); return }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }
})()`)

await evaluate(`(async () => { await window.__musicTest.stressAlbums(6); await new Promise((r) => setTimeout(r, 600)) })()`)

/** 不 await：先挂计时器，再发真实点击，最后取结果 */
async function measure(clickPt) {
  const p = send('Runtime.evaluate', { expression: 'window.__arm()', awaitPromise: true, returnByValue: true })
  await sleep(80)
  await realClick(clickPt.x, clickPt.y)
  const r = await p
  return r.result.value
}

const report = {}

await evaluate(`(async () => { const { useUiStore } = await import('/src/stores/ui.ts'); useUiStore().navigate('albums'); await new Promise((r) => setTimeout(r, 900)) })()`)
const card = await centerOf('.album-card')

/* 第一次会触发 fps 探针（可能把 lite 打开），故测两轮取第二轮为准 */
report.enter1 = await measure(card)
await sleep(400)
await evaluate(`(async () => { const { useUiStore } = await import('/src/stores/ui.ts'); useUiStore().navigate('albums'); await new Promise((r) => setTimeout(r, 700)) })()`)
const card2 = await centerOf('.album-card')
report.enter2 = await measure(card2)
await sleep(400)

/* 反向：点顶栏返回 */
const back = await evaluate(`(() => { const b = document.querySelector('.head-back'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
report.exit1 = await measure(back)
await sleep(500)

/* 再进一次，量第二次反向（此时 lite 状态已稳定） */
const card3 = await centerOf('.album-card')
await measure(card3)
await sleep(500)
const back2 = await evaluate(`(() => { const b = document.querySelector('.head-back'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
report.exit2 = await measure(back2)

/* 顺带读出实际施加的动画时长（WAAPI） */
report.animDurations = await evaluate(`(() => {
  const out = []
  for (const a of document.getAnimations()) {
    const t = a.effect?.getTiming?.()
    if (t && t.duration) out.push({ dur: Math.round(Number(t.duration)), delay: Math.round(Number(t.delay || 0)) })
  }
  return out.slice(0, 12)
})()`)

report.exceptions = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
