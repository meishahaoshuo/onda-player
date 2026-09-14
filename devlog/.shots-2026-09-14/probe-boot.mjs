import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9336
const URL_APP = process.argv[2] ?? 'http://localhost:5180/'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-boot-'))

const proc = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, '--no-first-run',
   '--no-default-browser-check', '--mute-audio', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required',
   `--window-size=${W},${H}`, 'about:blank'],
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
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

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })

/* 在应用脚本之前注入：帧间隔 + 长任务 + 阶段时间点 + 波浪动画挂载时刻 */
const BOOT = `
(() => {
  const T = { marks: [], frames: [], long: [], waveAnimAt: null, waveCount: 0 }
  window.__boot = T
  const now = () => Math.round(performance.now())
  const mark = (n) => T.marks.push({ n, t: now() })

  let last = null
  const tick = (t) => {
    if (last !== null) T.frames.push({ d: Math.round(t - last) })
    last = t
    if (T.waveAnimAt === null) {
      const w = document.querySelector('.boot-splash .wave')
      if (w) {
        T.waveCount = w.getAnimations ? w.getAnimations().length : 0
        if (T.waveCount > 0) T.waveAnimAt = now()
      }
    }
    if (t < 5000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) T.long.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }) }).observe({ type: 'longtask', buffered: true })
  } catch (e) { T.longErr = String(e) }

  let seenSplash = false, seenShell = false
  new MutationObserver(() => {
    if (!seenSplash && document.querySelector('.boot-splash')) { seenSplash = true; mark('splash-in-dom') }
    if (!seenShell && document.querySelector('.app-shell')) { seenShell = true; mark('app-shell-in-dom') }
  }).observe(document, { childList: true, subtree: true })

  document.addEventListener('DOMContentLoaded', () => mark('DOMContentLoaded'))
  window.addEventListener('load', () => mark('load'))
})()
`
await send('Page.addScriptToEvaluateOnNewDocument', { source: BOOT })
await send('Page.navigate', { url: URL_APP })
await sleep(5200)

const raw = await evaluate(`(() => {
  const T = window.__boot
  const frames = T.frames
  const d = frames.map((f) => f.d)
  const sorted = [...d].sort((a, b) => a - b)
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null
  const spikes = []
  let acc = 0
  for (let i = 0; i < d.length; i++) {
    acc += d[i]
    if (d[i] > 24) spikes.push({ atMs: acc, dur: d[i] })
  }
  return {
    marks: T.marks,
    waveAnimAt: T.waveAnimAt,
    waveAnimCount: T.waveCount,
    frameCount: frames.length,
    frameTotalMs: acc,
    p50: q(0.5), p90: q(0.9), p99: q(0.99), max: sorted[sorted.length - 1],
    over24: d.filter((x) => x > 24).length,
    over50: d.filter((x) => x > 50).length,
    over100: d.filter((x) => x > 100).length,
    spikes: spikes.slice(0, 14),
    longTasks: T.long,
    longTotal: T.long.reduce((a, b) => a + b.d, 0),
  }
})()`)

console.log(JSON.stringify(raw, null, 2))

ws.close()
proc.kill()
process.exit(0)
