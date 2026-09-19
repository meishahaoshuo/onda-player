import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs'

/**
 * 定位胶囊左右两侧那条残留的 1px 亮线是谁画的。
 *
 * 方法：在活页面里逐项把候选属性打成 none，各截一张图量左右缘峰值亮度。
 * 哪一项让峰值掉到背景水平，它就是元凶。
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9389
const SHOTS = 'D:/项目/音乐播放器/devlog/.shots-2026-09-15'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-ring2-'))
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
    top: peak(616, 0.5, 10, 560, 'y'),
    bottom: peak(682, 0.5, 10, 560, 'y'),
    left: peak(178, 0.5, 10, 651, 'x'),
    right: peak(936, 0.5, 10, 651, 'x'),
  }
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 700, deviceScaleFactor: 2, mobile: false })
await sleep(4500)
await evalIn(`document.documentElement.dataset.theme = 'dark';`)
await sleep(800)

// 该点上有哪些元素
const stack = await evalIn(`(() => {
  return document.elementsFromPoint(181, 651).map((el) => {
    const cs = getComputedStyle(el);
    return [el.tagName + '.' + (el.className || ''), cs.boxShadow.slice(0, 60), cs.backdropFilter].join(' | ');
  });
})()`)
console.log('=== 点 (181,651) 的元素栈 ===')
for (const s of stack) console.log('  ' + s)
console.log('')

const cases = [
  ['基线（不动）', ''],
  ['关掉 box-shadow', `bar.style.boxShadow = 'none';`],
  ['关掉 backdrop-filter', `bar.style.boxShadow=''; bar.style.backdropFilter = 'none'; bar.style.webkitBackdropFilter='none';`],
  ['关掉 background', `bar.style.backdropFilter=''; bar.style.webkitBackdropFilter=''; bar.style.background = 'none';`],
  ['关掉 ::after', `bar.style.background=''; bar.classList.add('__noafter'); const st=document.createElement('style'); st.textContent='.__noafter::after{display:none!important}'; document.head.appendChild(st);`],
]

console.log('=== 逐项关闭后的四缘峰值亮度（背景约 8~19）===')
console.log('  项                     上缘     下缘     左缘     右缘')
for (const [label, js] of cases) {
  await evalIn(`(() => { const bar = document.querySelector('.player-bar.capsule'); ${js} return 1; })()`)
  await sleep(500)
  const r = await shot('ring-case-' + label.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '') + '.png')
  console.log('  ' + label.padEnd(22) + r.top.toFixed(0).padStart(6) + r.bottom.toFixed(0).padStart(9) + r.left.toFixed(0).padStart(9) + r.right.toFixed(0).padStart(9))
  await evalIn(`(() => { const bar = document.querySelector('.player-bar.capsule'); bar.style.cssText=''; document.querySelectorAll('style').forEach(s=>{ if(s.textContent.includes('__noafter')) s.remove(); }); bar.classList.remove('__noafter'); return 1; })()`)
  await sleep(300)
}

proc.kill()
process.exit(0)
