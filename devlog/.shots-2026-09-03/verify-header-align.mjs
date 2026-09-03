import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9334
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-03'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-cdp-'))

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,900',
    URL_APP,
  ],
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

const wsUrl = await getWsUrl()
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let msgId = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails?.exception?.description ?? JSON.stringify(msg.params).slice(0, 300))
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
  }
}

function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : res(msg.result)))
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)))
  }
  return r.result.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_APP })
await sleep(3500)

const report = {}

// 注入测试数据（3 WAV + 1 MP3 with cover + LRC）
report.step1_reset = await evaluate(`__musicTest.resetTest()`)

// 等扫描完成（库状态 songs>0）
await evaluate(`(async () => {
  for (let i = 0; i < 50; i++) {
    const s = __musicTest.status()
    if (s.songs > 0 && !s.progress.running) return
    await new Promise(r => setTimeout(r, 200))
  }
})()`)

// 核心断言：表头列与行列 x 坐标对齐
report.step2_align = await evaluate(`(() => {
  const header = document.querySelector('.list-header')
  const row = document.querySelector('.song-row')
  if (!header) return { error: '未找到 .list-header' }
  if (!row) return { error: '未找到 .song-row' }
  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), w: Math.round(r.width), text: el.textContent.trim().slice(0, 12) }
  }
  const cols = ['col-cover', 'col-title', 'col-artist', 'col-album', 'col-duration']
  const hdr = cols.map((c) => {
    const el = header.querySelector('.' + c)
    return { col: c, ...(el ? rectOf(el) : { x: -1, w: 0, text: 'MISSING' }) }
  })
  const rowCols = cols.map((c) => {
    const el = row.querySelector('.' + c)
    return { col: c, ...(el ? rectOf(el) : { x: -1, w: 0, text: el?.textContent?.trim().slice(0, 12) ?? 'MISSING' }) }
  })
  const align = cols.map(c => {
    const h = hdr.find(o => o.col === c)
    const r2 = rowCols.find(o => o.col === c)
    return { col: c, dx: h.x - r2.x, headerText: h.text, rowText: r2.text }
  })
  return {
    headerChildrenCount: header.children.length,
    headerChildren: [...header.children].map(c => c.className || c.tagName),
    hdr, rowCols, align,
    allAligned: align.every(a => Math.abs(a.dx) <= 1),
    summary: align.map(a => a.col + ':Δx=' + a.dx + ' [' + a.headerText + ' ↔ ' + a.rowText + ']').join(' | '),
  }
})()`)

report.step3_status = await evaluate(`__musicTest.status()`)

// 截图
const shot = await send('Page.captureScreenshot', { format: 'png' })
const shotPath = path.join(SHOT_DIR, 'songs-header-after-fix.png')
fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))

report.consoleErrors = consoleErrors
report.exceptions = exceptions
report.screenshot = shotPath

console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
process.exit(0)