import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9334
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
fs.mkdirSync(SHOT_DIR, { recursive: true })
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-cdp2-'))

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
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
const ws = new WebSocket(await getWsUrl())
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) =>
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result))),
  )
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
async function shot(name, clip, scale = 4) {
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale } })
  const p = path.join(SHOT_DIR, name)
  fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
  return p
}

await send('Runtime.enable')
await send('Page.enable')

const out = {}

for (const theme of ['light', 'dark']) {
  await send('Page.navigate', { url: URL_APP })
  await sleep(2500)
  await evaluate(`localStorage.setItem('settings.themeMode','${theme}')`)
  await send('Page.navigate', { url: URL_APP })
  await sleep(3000)
  await evaluate(`(async () => {
    await __musicTest.stressAlbums(8)
    await new Promise(r => setTimeout(r, 600))
    ;[...document.querySelectorAll('.nav-item')].find(e => e.textContent.includes('专辑')).click()
    await new Promise(r => setTimeout(r, 900))
    document.querySelector('.album-card').click()
    await new Promise(r => setTimeout(r, 1300))
    return true
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 500 })
  await sleep(400)
  // 紧贴返回钮的裁切：同时看到与搜索框的关系
  out[`${theme}_tight`] = await shot(`head-back-${theme}-tight.png`, { x: 630, y: 4, width: 340, height: 70 }, 4)
}

console.log(JSON.stringify(out, null, 2))
ws.close()
proc.kill()
process.exit(0)
