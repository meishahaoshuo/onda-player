import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9369
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-plhdr2-')
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, '--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', 'http://localhost:5180/'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page' && t.url.includes('5180'))
    if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break }
  } catch {}
  await sleep(500)
}
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const send = (m, p = {}) => new Promise((res) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); const h = (ev) => { const d = JSON.parse(ev.data); if (d.id === i) { ws.removeEventListener('message', h); res(d.result) } }; ws.addEventListener('message', h) })
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value
await send('Runtime.enable')
await send('Page.enable')
await sleep(2000)

const report = {}
await evaluate(`__musicTest.resetTest()`)
await evaluate(`__musicTest.addBulkSongs(6)`)
await evaluate(`(async () => { for (let i = 0; i < 60; i++) { const s = __musicTest.status(); if (s.songs > 0 && !s.progress.running) return; await new Promise((r) => setTimeout(r, 200)) } })()`)
const plId = await evaluate(`__musicTest.pl('create', '头部测试').then((p) => p.id)`)
await evaluate(`__musicTest.pl('add', ${JSON.stringify(plId)})`)

// 进详情：确认按钮行已消失
await evaluate(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.trim() === '歌单').click()`)
await sleep(700)
await evaluate(`document.querySelector('.pl-card')?.click()`)
await sleep(1400)
report.header = await evaluate(`(() => ({
  actionsGone: !document.querySelector('.pl-actions'),
  name: document.querySelector('.pl-name')?.textContent ?? null,
}))()`)
const shot1 = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/pl-header-large.png', Buffer.from(shot1.data, 'base64'))

// 关闭详情，截歌单网格
await evaluate(`document.querySelector('.header-close')?.click()`)
await sleep(1200)
const shotGrid = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/pl-grid-large.png', Buffer.from(shotGrid.data, 'base64'))

// 侧边栏歌单项右键 → 菜单含新条目；点「添加歌曲」→ 弹层自动打开
const item = await evaluate(`(() => { const el = document.querySelector('.nav-item.playlist-item'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
await evaluate(`document.querySelector('.nav-item.playlist-item')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: ${item.x}, clientY: ${item.y} }))`)
await sleep(500)
report.menu = await evaluate(`(() => ({ items: [...document.querySelectorAll('.playlist-menu .menu-item')].map((m) => m.textContent.trim()) }))()`)
await evaluate(`[...document.querySelectorAll('.playlist-menu .menu-item')].find((m) => m.textContent.includes('添加歌曲'))?.click()`)
await sleep(1500)
report.addFlow = await evaluate(`(() => ({
  addModalOpen: !!document.querySelector('.add-modal'),
  detailName: document.querySelector('.pl-name')?.textContent ?? null,
  view: document.querySelector('.nav-item.active')?.textContent.trim() ?? null,
}))()`)
const shot2 = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/pl-add-flow.png', Buffer.from(shot2.data, 'base64'))

console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
