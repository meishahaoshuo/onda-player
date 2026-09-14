import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9335
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-water-'))

const proc = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, '--no-first-run',
   '--no-default-browser-check', '--mute-audio', `--window-size=${W},${H}`, URL_APP],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5180'))
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error')
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

const STUB = `window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},transformCallback:(cb)=>{const i=Math.floor(Math.random()*1e9);window['_'+i]=cb;return i},unregisterListener:()=>{},invoke:async(c)=>{const s=String(c);if(s.includes('is_maximized')||s.includes('is_minimized'))return false;if(s.includes('outer_position'))return{x:100,y:100};if(s.includes('inner_size'))return{width:${W},height:${H}};return 0}}`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(3600)

/* 按钮区域裁剪：三枚按钮 x 940~1060、行 y 20~56 */
const CLIP = { x: 926, y: 8, width: 148, height: 60, scale: 3 }
const shot = async (name, clip) => {
  const s = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' })
  const p = path.join(SHOT_DIR, name)
  fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
  return { path: p, data: s.data }
}

const report = {}

report.rest = await evaluate(`(() => {
  const b = [...document.querySelectorAll('.tb-btn')]
  const cs = getComputedStyle(b[2])
  const water = b[2].querySelector('.water')
  return {
    buttonCount: b.length,
    waterLayers: b[2].querySelectorAll('.wv').length,
    restWaterTransform: getComputedStyle(water).transform,
    closeColor: cs.color,
    hasRedRule: [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.cssText && r.cssText.includes('e81123')) } catch { return false } }),
  }
})()`)

/* 帧序：把水面上升钉在 4 个进度点（translateY 100% → 20%），
   这样静态截图也能看出"水在涨"以及水面是波浪形 */
const frames = []
for (const pct of [100, 72, 48, 20]) {
  await evaluate(`(() => {
    let s = document.getElementById('pin')
    if (!s) { s = document.createElement('style'); s.id = 'pin'; document.head.appendChild(s) }
    s.textContent = '.tb-btn:nth-child(1) .water{transition:none!important;transform:translateY(${pct}%)!important}'
  })()`)
  await sleep(140)
  frames.push(await shot(`10-rise-${String(pct).padStart(3, '0')}.png`, CLIP))
}
await evaluate(`document.getElementById('pin').remove()`)

/* 把 4 帧横向拼成一条胶片，一张图看完整个上升过程 */
const stripDataUrl = await evaluate(`(async () => {
  const srcs = ${JSON.stringify(frames.map((f) => 'data:image/png;base64,' + f.data))}
  const imgs = await Promise.all(srcs.map((s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s })))
  const gap = 18, pad = 14
  const w = imgs.reduce((a, i) => a + i.width, 0) + gap * (imgs.length - 1) + pad * 2
  const h = imgs[0].height + pad * 2
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d')
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h)
  let ox = pad
  for (const i of imgs) { x.drawImage(i, ox, pad, i.width, i.height); ox += i.width + gap }
  return c.toDataURL('image/png')
})()`)
const stripPath = path.join(SHOT_DIR, '11-water-filmstrip.png')
fs.writeFileSync(stripPath, Buffer.from(stripDataUrl.split(',')[1], 'base64'))

/* 自然悬停（真跑过渡）：最小化键与关闭键各一张，确认关闭键无红色 */
await evaluate(`document.getElementById('pin2') || null`)
const pts = await evaluate(`[...document.querySelectorAll('.tb-btn')].map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } })`)

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0].x, y: pts[0].y })
await sleep(1000)
report.minHover = await evaluate(`(() => {
  const b = document.querySelectorAll('.tb-btn')[0]
  const w = b.querySelector('.water')
  return { waterTransform: getComputedStyle(w).transform, iconColor: getComputedStyle(b).color, btnBg: getComputedStyle(b).backgroundColor }
})()`)
report.minHoverShot = (await shot('12-hover-min.png', CLIP)).path

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[2].x, y: pts[2].y })
await sleep(1000)
report.closeHover = await evaluate(`(() => {
  const b = document.querySelectorAll('.tb-btn')[2]
  return {
    btnBg: getComputedStyle(b).backgroundColor,
    iconColor: getComputedStyle(b).color,
    waterPresent: !!b.querySelector('.water'),
    waterBg: getComputedStyle(b.querySelector('.water'), '::after').backgroundColor,
  }
})()`)
report.closeHoverShot = (await shot('13-hover-close.png', CLIP)).path

report.fullHoverShot = (await shot('14-hover-full.png')).path

report.errors = errors
report.stripPath = stripPath
console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
process.exit(0)
