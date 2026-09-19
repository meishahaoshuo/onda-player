import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs'

/**
 * 量测胶囊播放条的四缘剖面（深色 + 液态玻璃）。
 *
 * 胶囊几何（1120×700 视口）：宽 min(760, 100vw-24) = 760，高 66，bottom 16 →
 *   左缘 x=180，右缘 x=940，上缘 y=618，下缘 y=684（CSS px）
 * 由「有边框 vs 无边框」处才出现的亮线判定那圈高光是否还在。
 *
 * 用法：node measure-capsule-ring.mjs <输出png名>
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9387
const OUT = process.argv[2] || 'capsule-ring.png'
const SHOTS = 'D:/项目/音乐播放器/devlog/.shots-2026-09-15'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-ring-'))
const proc = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
   '--no-first-run', '--no-default-browser-check', '--mute-audio', '--no-proxy-server',
   '--window-size=1120,700', 'http://localhost:5180/'],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = l.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('CDP 未就绪')
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pend = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
}
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise((res) => pend.set(i, res))
}
const evalIn = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 700, deviceScaleFactor: 2, mobile: false })
await sleep(4500)

// 切深色
await evalIn(`document.documentElement.dataset.theme = 'dark';`)
await sleep(800)

// 胶囊的真实几何
const geo = await evalIn(`(() => {
  const bar = document.querySelector('.player-bar.capsule');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  const cs = getComputedStyle(bar);
  return {
    x: r.x, y: r.y, w: r.width, h: r.height,
    border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
    shadow: cs.boxShadow,
  };
})()`)

console.log('=== 胶囊几何 ===')
console.log(JSON.stringify(geo, null, 2))

const shot = await send('Page.captureScreenshot', { format: 'png' })
const file = `${SHOTS}/${OUT}`
fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const k = info.width / 1120
const at = (lx, ly) => {
  const x = Math.round(lx * k), y = Math.round(ly * k)
  const i = (y * info.width + x) * info.channels
  return { hex: '#' + [data[i], data[i+1], data[i+2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), lum: 0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2] }
}

const midY = geo.y + geo.h / 2
const midX = geo.x + geo.w / 2

function profile(label, from, step, n, fixed, axis) {
  const out = []
  for (let i = 0; i < n; i++) {
    const v = from + i * step
    const p = axis === 'x' ? at(v, fixed) : at(fixed, v)
    out.push({ pos: Number(v.toFixed(1)), ...p })
  }
  const peak = out.reduce((a, b) => (b.lum > a.lum ? b : a))
  const inner = out[out.length - 1].lum
  console.log(`  ${label.padEnd(10)} 峰值 ${peak.hex} 亮度 ${peak.lum.toFixed(1)} @${peak.pos}   最内点 ${inner.toFixed(1)}   对比度 +${(peak.lum - inner).toFixed(1)}`)
  return out
}

console.log('')
console.log('=== 四缘剖面（跨过边界向外各取 4 CSS px）===')
const res = {}
res.top = profile('上缘', geo.y - 2, 0.5, 10, midX, 'y')
res.bottom = profile('下缘', geo.y + geo.h - 2, 0.5, 10, midX, 'y')
res.left = profile('左缘', geo.x - 2, 0.5, 10, midY, 'x')
res.right = profile('右缘', geo.x + geo.w - 2, 0.5, 10, midY, 'x')

console.log('')
console.log('=== 原始档位（上缘逐点）===')
for (const p of res.top) console.log('  y=' + p.pos + '  ' + p.hex + '  ' + p.lum.toFixed(1))

proc.kill()
process.exit(0)
