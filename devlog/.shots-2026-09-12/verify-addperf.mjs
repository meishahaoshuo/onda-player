import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9371
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-perf-')
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
await evaluate(`__musicTest.addCoverSong()`)
await evaluate(`(async () => { for (let i = 0; i < 60; i++) { const s = __musicTest.status(); if (s.songs > 0 && !s.progress.running) return; await new Promise((r) => setTimeout(r, 200)) } })()`)
const plId = await evaluate(`__musicTest.pl('create', '光斑验证').then((p) => p.id)`)
await evaluate(`__musicTest.pl('add', ${JSON.stringify(plId)})`)

// 打开歌单详情（有封面 → 光斑存在），确认 blob 动画运行中
await evaluate(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.trim() === '歌单').click()`)
await sleep(700)
await evaluate(`document.querySelector('.pl-card')?.click()`)
await sleep(1500)
report.before = await evaluate(`(() => {
  const b = document.querySelector('.blob')
  return { blobExists: !!b, playState: b ? getComputedStyle(b).animationPlayState : null, bodyOpen: document.body.classList.contains('modal-open') }
})()`)

// 通过 ui 标记打开添加弹层（模拟右键菜单消费后的状态）
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().playlistAddSongs = ${JSON.stringify(plId)}
}())`)
await sleep(1200)
report.after = await evaluate(`(() => {
  const flag = window.__flag ?? 'consumed?'
  return { flag }
  const b = document.querySelector('.blob')
  const row = [...document.querySelectorAll('.add-row')][0]
  row?.click()
  return {
    addOpen: !!document.querySelector('.add-modal'),
    bodyOpen: document.body.classList.contains('modal-open'),
    blobPaused: b ? getComputedStyle(b).animationPlayState : null,
    rowSelected: row?.classList.contains('checked') ?? null,
    rowBg: row ? getComputedStyle(row).backgroundImage.slice(0, 50) : null,
  }
})()`)
await sleep(300)
report.afterClick = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.add-row')][0]
  return { selected: row?.classList.contains('checked') ?? null, cnt: document.querySelector('.cnt')?.textContent ?? null }
})()`)
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/ui-add-glow.png', Buffer.from(shot.data, 'base64'))
console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
