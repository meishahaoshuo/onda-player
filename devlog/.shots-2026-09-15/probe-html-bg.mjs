import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs'

/**
 * 决定性小测：`getComputedStyle(html).backgroundColor` 到底可不可信？
 *
 * Chromium 对根元素有个特殊行为 —— 背景会「传播到画布」，于是计算值可能报的是
 * 画布色而不是元素自身的背景。做法：给 html 打**内联** `background: transparent`
 * （优先级最高），若计算值仍是白的，就说明这个指标不可信，只能靠截图的 alpha 判断。
 * 同时用 `Emulation.setDefaultBackgroundColorOverride` 把默认画布色设成透明，
 * 这样截图才会带真实 alpha（否则 Chromium 会把透明处压成不透明白）。
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9377
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-probe2-'))
const proc = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
   '--no-first-run', '--no-default-browser-check', '--mute-audio', '--no-proxy-server',
   '--window-size=1120,700', 'http://localhost:5180/'],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function ws_url() {
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
const ws = new WebSocket(await ws_url())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pend = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise((res, rej) => pend.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))))
}
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  return r.exceptionDetails ? { __ERR: String(r.exceptionDetails.exception?.description ?? '') } : r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
for (let i = 0; i < 60; i++) {
  if ((await ev(`!!document.querySelector('.app-shell')`)) === true) break
  await sleep(300)
}

console.log('① 什么都没做时，html 计算背景 =', await ev(`getComputedStyle(document.documentElement).backgroundColor`))
await ev(`document.documentElement.style.background = 'transparent'`)
await sleep(200)
console.log('② 打上内联 transparent 后   =', await ev(`getComputedStyle(document.documentElement).backgroundColor`),
  ' ← 若仍是白，说明这个指标报的是「画布色」，不可信')

await ev(`document.documentElement.style.background = ''`)
await ev(`document.documentElement.dataset.theme = 'dark'`)
await ev(`document.documentElement.classList.add('desktop-glass')`)
await sleep(300)

console.log('③ 不设默认画布色，直接截图 → 页面底色 alpha：')
let shot = await send('Page.captureScreenshot', { format: 'png' })
let { data, info } = await sharp(Buffer.from(shot.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
console.log('   (350,400) alpha =', data[(400 * info.width + 350) * info.channels + 3])

await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
await sleep(300)
console.log('④ 把默认画布色设为透明后截图 → 页面底色 alpha：')
shot = await send('Page.captureScreenshot', { format: 'png' })
;({ data, info } = await sharp(Buffer.from(shot.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
for (const [n, x, y] of [['侧栏', 120, 400], ['内容区', 350, 400], ['设置面板', 700, 300]]) {
  if (x >= info.width || y >= info.height) continue
  const i = (y * info.width + x) * info.channels
  console.log('   ' + n.padEnd(8) + ' rgba(' + data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ',' + data[i + 3] + ')')
}
fs.writeFileSync('D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-15\\probe-alpha.png', Buffer.from(shot.data, 'base64'))

ws.close()
proc.kill()
console.log('\ndone')
