import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9365
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-ui4-')
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
await evaluate(`__musicTest.addBulkSongs(12)`)
await evaluate(`(async () => { for (let i = 0; i < 60; i++) { const s = __musicTest.status(); if (s.songs > 0 && !s.progress.running) return; await new Promise((r) => setTimeout(r, 200)) } })()`)

// 1) 设置页：预设名 + 行分隔线
await evaluate(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.trim() === '设置').click()`)
await sleep(600)
report.settings = await evaluate(`(() => {
  const names = [...document.querySelectorAll('.accent-swatch')].map((b) => b.title)
  const hairlines = [...document.querySelectorAll('.opt-row + .opt-row')].length
  const cur = document.querySelector('.accent-current')?.textContent ?? null
  return { presets: names, accentCurrent: cur, hairlines }
})()`)
let shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/ui-settings.png', Buffer.from(shot.data, 'base64'))

// 2) 添加歌曲弹层：勾选两首看选中态
await evaluate(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.trim() === '歌单').click()`)
await sleep(700)
await evaluate(`__musicTest.pl('create', '演示歌单')`)
await evaluate(`document.querySelector('.pl-card')?.click()`)
await sleep(1400)
await evaluate(`document.querySelector('.add-enter, [class*="add"]')`)
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('添加歌曲'))?.click()`)
await sleep(700)
report.addModal = await evaluate(`(() => {
  const modal = document.querySelector('.add-modal')
  if (!modal) return { open: false }
  // 勾选第二行
  const rows = [...modal.querySelectorAll('.add-row')]
  const cb = rows[1]?.querySelector('.add-check')
  if (cb) { cb.click() }
  return {
    open: true,
    rows: rows.length,
    checkedStyled: cb ? getComputedStyle(cb).appearance === 'none' || cb.classList.contains('add-check') : false,
    checkedRow: rows[1]?.classList.contains('checked') ?? null,
    chips: modal.querySelectorAll('.add-state').length,
    bodyOpen: document.body.classList.contains('modal-open'),
    blobPaused: (() => { const b = document.querySelector('.blob'); return b ? getComputedStyle(b).animationPlayState : null })(),
  }
})()`)
shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/ui-add-modal.png', Buffer.from(shot.data, 'base64'))

// 3) 文件夹页：行按钮隐藏
await evaluate(`document.querySelector('.add-close')?.click()`)
await sleep(400)
await evaluate(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.trim() === '文件夹').click()`)
await sleep(700)
await evaluate(`document.querySelector('.root-card')?.click()`)
await sleep(500)
report.folders = await evaluate(`(() => ({
  rows: document.querySelectorAll('.song-row').length,
  rowActions: document.querySelectorAll('.song-row .row-actions').length,
}))()`)
shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/ui-folders.png', Buffer.from(shot.data, 'base64'))

console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
