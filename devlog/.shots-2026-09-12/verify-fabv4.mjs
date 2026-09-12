import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9357
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-fabv4-')
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
await evaluate(`__musicTest.addBulkSongs(30)`)
await evaluate(`(async () => { for (let i = 0; i < 60; i++) { const s = __musicTest.status(); if (s.songs >= 30 && !s.progress.running) return; await new Promise((r) => setTimeout(r, 200)) } })()`)
await evaluate(`__musicTest.playAt(0)`)
await sleep(600)

const report = {}
for (const v of ['scale', 'yoyo', 'float', 'balloon']) {
  await evaluate(`localStorage.setItem('settings.locateFabStyle', '${v}')`)
  await send('Page.navigate', { url: 'http://localhost:5180/' })
  await sleep(2200)
  const r = await evaluate(`(async () => {
    for (let i = 0; i < 20; i++) { if (__musicTest.playerState().currentPath) break; await new Promise((r0) => setTimeout(r0, 150)) }
    if (!__musicTest.playerState().currentPath) await __musicTest.playAt(0)
    await new Promise((r0) => setTimeout(r0, 400))
    const host = document.querySelector('.scroll-host')
    host.scrollTop = 900
    await new Promise((r0) => setTimeout(r0, 350))
    const fab = document.querySelector('.locate-fab')
    return {
      fab: !!fab,
      cls: fab?.className ?? null,
      w: fab ? Math.round(fab.getBoundingClientRect().width) : null,
      down: fab?.classList.contains('down') ?? null,
    }
  })()`)
  report[v] = r
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 1040, y: 480, width: 400, height: 420, scale: 2 } })
  fs.writeFileSync(`D:/项目/音乐播放器/devlog/.shots-2026-09-12/fabv4-${v}.png`, Buffer.from(shot.data, 'base64'))
}
console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
