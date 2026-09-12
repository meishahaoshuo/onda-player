import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9375
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-diag-')
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

await evaluate(`__musicTest.resetTest()`)
await evaluate(`__musicTest.addBulkSongs(6)`)
await evaluate(`(async () => { for (let i = 0; i < 60; i++) { const s = __musicTest.status(); if (s.songs > 0 && !s.progress.running) return; await new Promise((r) => setTimeout(r, 200)) } })()`)
await evaluate(`__musicTest.pl('create', '诊断')`)

// 侧栏右键 → 菜单
const item = await evaluate(`(() => { const el = document.querySelector('.nav-item.playlist-item'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
await evaluate(`window.__logs = []; window.addEventListener('error', (e) => window.__logs.push('ERR: ' + e.message));`)
await evaluate(`document.querySelector('.nav-item.playlist-item')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: ${item.x}, clientY: ${item.y} }))`)
await sleep(500)
await evaluate(`[...document.querySelectorAll('.playlist-menu .menu-item')].find((m) => m.textContent.includes('添加歌曲'))?.click()`)
// 3 秒内每 200ms 轮询弹层是否出现过
let everOpen = false
for (let i = 0; i < 15; i++) {
  await sleep(200)
  everOpen = everOpen || (await evaluate(`!!document.querySelector('.add-modal')`))
}
await sleep(500)
const report = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  return {
    flag: ui.playlistAddSongs,
    view: ui.activeView,
    detailKey: ui.detailKey,
    modal: !!document.querySelector('.add-modal'), coverPicker: !!document.querySelector('.cover-grid'),
    rows: document.querySelectorAll('.add-row').length,
    errors: window.__logs ?? [],
  }
})()`)
report.everOpen = everOpen
report.rowSel = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.add-row')].find((r) => !r.classList.contains('added'))
  if (!row) return { row: false }
  row.click()
  return { clicked: true }
})()`)
await sleep(300)
report.rowSel = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.add-row')].find((r) => !r.classList.contains('added'))
  return {
    checked: row?.classList.contains('checked') ?? null,
    bg: row ? getComputedStyle(row).backgroundColor : null,
    radius: row ? getComputedStyle(row).borderRadius : null,
  }
})()`)
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/ui-add-row-active.png', Buffer.from(shot.data, 'base64'))
console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
