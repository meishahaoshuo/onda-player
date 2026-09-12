import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9361
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-lyr-')
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
await evaluate(`__musicTest.addCoverSong()`)
await evaluate(`(async () => { for (let i = 0; i < 60; i++) { const s = __musicTest.status(); if (s.songs > 0 && !s.progress.running) return; await new Promise((r) => setTimeout(r, 200)) } })()`)
await evaluate(`__musicTest.playAt(0)`)
await sleep(1000)
// 打开歌词页（点播放条封面）
await evaluate(`document.querySelector('.player-bar .cover')?.click()`)
await sleep(1600)

const report = {}
report.layout = await evaluate(`(() => {
  const times = document.querySelector('.progress-times')
  const ctrls = document.querySelector('.controls')
  const play = document.querySelector('.ctrl-btn.play')
  const btns = [...document.querySelectorAll('.controls > .ctrl-btn, .controls > .volume-wrap')]
  const c = ctrls?.getBoundingClientRect()
  const first = btns[0]?.getBoundingClientRect()
  const last = btns[btns.length - 1]?.getBoundingClientRect()
  return {
    badge: times?.querySelector('.badge')?.textContent ?? null,
    timesKids: times ? times.children.length : 0,
    spread: c && first && last ? Math.abs(first.x - c.x) < 8 && Math.abs(c.right - last.right) < 10 : null,
    playRadius: play ? getComputedStyle(play).borderRadius : null,
    playBg: play ? getComputedStyle(play).backgroundColor : null,
    playColor: play ? getComputedStyle(play).color : null,
  }
})()`)
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/lyrics-apple.png', Buffer.from(shot.data, 'base64'))
console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
