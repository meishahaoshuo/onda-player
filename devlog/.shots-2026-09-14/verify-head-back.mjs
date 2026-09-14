import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9333
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
fs.mkdirSync(SHOT_DIR, { recursive: true })
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-cdp-'))

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

async function shot(name, clip) {
  const opts = { format: 'png' }
  if (clip) opts.clip = { ...clip, scale: 3 }
  const s = await send('Page.captureScreenshot', opts)
  const p = path.join(SHOT_DIR, name)
  fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
  return p
}

const PROBE = `(() => {
  const b = document.querySelector('.head-back')
  if (!b) return { error: '未找到 .head-back' }
  const cs = getComputedStyle(b)
  const r = b.getBoundingClientRect()
  const search = document.querySelector('.search-box')
  const sr = search ? search.getBoundingClientRect() : null
  return {
    disabled: b.disabled,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    searchRect: sr ? { x: Math.round(sr.x), w: Math.round(sr.width) } : null,
    gapToSearch: sr ? Math.round(sr.x - r.right) : null,
    borderTop: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
    bg: cs.backgroundColor,
    color: cs.color,
    radius: cs.borderRadius,
    opacity: cs.opacity,
    theme: document.documentElement.getAttribute('data-theme'),
  }
})()`

await send('Runtime.enable')
await send('Page.enable')

// 浅色主题（与用户截图一致）
await send('Page.navigate', { url: URL_APP })
await sleep(2500)
await evaluate(`localStorage.setItem('settings.themeMode','light')`)
await send('Page.navigate', { url: URL_APP })
await sleep(3000)

const report = {}

// 造专辑数据 → 打开专辑 → 进入详情（canGoBack = true）
report.setup = await evaluate(`(async () => {
  await __musicTest.stressAlbums(12)
  await new Promise(r => setTimeout(r, 600))
  const nav = [...document.querySelectorAll('.nav-item')].find(e => e.textContent.includes('专辑'))
  if (!nav) return { error: '未找到专辑导航' }
  nav.click()
  await new Promise(r => setTimeout(r, 900))
  const card = document.querySelector('.album-card')
  if (!card) return { error: '未找到专辑卡片', html: document.querySelector('.nav-item')?.outerHTML?.slice(0,200) }
  card.click()
  await new Promise(r => setTimeout(r, 1200))
  return { detailKey: document.querySelector('.head-back')?.disabled === false, title: document.querySelector('.view-header h1')?.textContent }
})()`)

report.light_enabled = await evaluate(PROBE)
report.shot_light_detail = await shot('head-back-light-detail.png', { x: 0, y: 0, width: 1440, height: 72 })

// 悬停态：用真实 CDP 鼠标移动，才能命中 :hover
const rect = await evaluate(`(() => { const b = document.querySelector('.head-back').getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 } })()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
await sleep(500)
report.light_hover = await evaluate(PROBE)
report.shot_light_hover = await shot('head-back-light-hover.png', { x: rect.x - 120, y: 0, width: 420, height: 72 })

// 置灰态：回到最上层（歌曲）
await evaluate(`(async () => {
  const nav = [...document.querySelectorAll('.nav-item')].find(e => e.textContent.includes('歌曲'))
  nav.click()
  await new Promise(r => setTimeout(r, 1200))
  return true
})()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 400 })
await sleep(300)
report.light_disabled = await evaluate(PROBE)

// 深色主题
await evaluate(`localStorage.setItem('settings.themeMode','dark')`)
await send('Page.navigate', { url: URL_APP })
await sleep(3000)
report.dark_setup = await evaluate(`(async () => {
  await __musicTest.stressAlbums(6)
  await new Promise(r => setTimeout(r, 600))
  const nav = [...document.querySelectorAll('.nav-item')].find(e => e.textContent.includes('专辑'))
  nav.click()
  await new Promise(r => setTimeout(r, 900))
  document.querySelector('.album-card')?.click()
  await new Promise(r => setTimeout(r, 1200))
  return true
})()`)
report.dark_enabled = await evaluate(PROBE)
report.shot_dark_detail = await shot('head-back-dark-detail.png', { x: 0, y: 0, width: 1440, height: 72 })

report.consoleErrors = consoleErrors
report.exceptions = exceptions

console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
process.exit(0)
