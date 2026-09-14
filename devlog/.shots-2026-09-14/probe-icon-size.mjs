/**
 * 量侧栏每个图标的「墨迹盒子」（路径几何 bbox + 描边外扩），
 * 用来判断磁带的视觉尺寸该放大到多少才能和邻居匹配。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9351
const URL_APP = 'http://localhost:5180/'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-isize-'))

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

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: URL_APP })
await sleep(4600)

const report = await evaluate(`(async () => {
  const { iconPaths } = await import('/src/components/icons.ts')
  const nav = [...document.querySelectorAll('.sidebar .nav-item')]
  const items = []
  for (const el of nav) {
    const svg = el.querySelector('svg')
    if (!svg) continue
    const label = el.textContent.trim()
    const size = Number(svg.getAttribute('width'))
    const vb = svg.getAttribute('viewBox')
    let bb
    try { bb = svg.getBBox() } catch { bb = null }
    if (!bb || !bb.width) continue
    // 墨迹 = 几何 bbox 外扩 stroke/2
    const sw = Number(svg.getAttribute('stroke-width') ?? 2)
    const half = sw / 2
    items.push({
      label,
      size,
      viewBox: vb,
      几何: { x: +bb.x.toFixed(2), y: +bb.y.toFixed(2), w: +bb.width.toFixed(2), h: +bb.height.toFixed(2) },
      墨迹: { w: +(bb.width + sw).toFixed(2), h: +(bb.height + sw).toFixed(2) },
      墨迹占视框高比: +(((bb.height + sw) / 24) * 100).toFixed(1),
      实机像素高: +(((bb.height + sw) / 24) * size).toFixed(1),
    })
  }
  const hs = items.map((i) => i.墨迹.h).sort((a, b) => a - b)
  const med = hs[Math.floor(hs.length / 2)]
  return { items, 中位墨迹高: med, 排除自身中位: items.filter((i) => i.label !== '歌单').map((i) => i.墨迹.h).sort((a, b) => a - b) }
})()`)

console.log(JSON.stringify(report, null, 2))
console.log('exceptions:', errors.length)
ws.close()
proc.kill()
