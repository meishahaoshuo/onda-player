import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs'

/**
 * 逐条隔离 box-shadow：给胶囊只留一条阴影，量四缘峰值亮度，
 * 弄清「外框高光」到底是哪几条声明叠出来的。
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9391
const SHOTS = 'D:/项目/音乐播放器/devlog/.shots-2026-09-15'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-ring3-'))
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
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const f = `${SHOTS}/${name}`
  fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'))
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const k = info.width / 1120, W = info.width, C = info.channels
  const lum = (lx, ly) => {
    const x = Math.round(lx * k), y = Math.round(ly * k)
    const i = (y * W + x) * C
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  const peak = (from, step, n, fixed, axis) => {
    let m = 0
    for (let i = 0; i < n; i++) {
      const v = from + i * step
      const l = axis === 'x' ? lum(v, fixed) : lum(fixed, v)
      if (l > m) m = l
    }
    return m
  }
  return {
    top: peak(616, 0.5, 12, 560, 'y'),
    bottom: peak(681, 0.5, 12, 560, 'y'),
    left: peak(178, 0.5, 12, 651, 'x'),
    right: peak(936, 0.5, 12, 651, 'x'),
  }
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 700, deviceScaleFactor: 2, mobile: false })
await sleep(4500)
await evalIn(`document.documentElement.dataset.theme = 'dark';`)
await sleep(800)

const layers = [
  ['1 顶部硬高光 0.8', 'inset 0 1.5px 1px rgba(255,255,255,0.8)'],
  ['2 顶部软光 0.07', 'inset 0 3px 14px rgba(255,255,255,0.07)'],
  ['3 底部内光 0.1', 'inset 0 -10px 22px rgba(255,255,255,0.1)'],
  ['4 底部暗线 0.24', 'inset 0 -1px 0 rgba(0,0,0,0.24)'],
  ['5 外投影 54px', '0 22px 54px rgba(0,0,0,0.5)'],
  ['6 外投影 16px', '0 4px 16px rgba(0,0,0,0.2)'],
  ['全开（现状）', ''],
]

console.log('=== 逐层隔离：各层单独作用时的四缘峰值亮度 ===')
console.log('  （内容区背景约 10~19；材质本身边缘约 50）')
console.log('  层                        上缘      下缘      左缘      右缘')
for (const [label, val] of layers) {
  await evalIn(`(() => { const bar = document.querySelector('.player-bar.capsule'); bar.style.boxShadow = ${JSON.stringify(val)}; return 1; })()`)
  await sleep(450)
  const r = await shot('ring-layer-' + label.split(' ')[0] + '.png')
  console.log('  ' + label.padEnd(24) + r.top.toFixed(0).padStart(7) + r.bottom.toFixed(0).padStart(10) + r.left.toFixed(0).padStart(10) + r.right.toFixed(0).padStart(10))
}
await evalIn(`document.querySelector('.player-bar.capsule').style.boxShadow='';`)

proc.kill()
process.exit(0)
