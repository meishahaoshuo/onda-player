import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9359
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-bar-')
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

// 标准条 + 数据
await evaluate(`localStorage.setItem('settings.playerStyle', 'standard')`)
await send('Page.navigate', { url: 'http://localhost:5180/' })
await sleep(2200)
await evaluate(`__musicTest.resetTest()`)
await evaluate(`__musicTest.addCoverSong()`)
await evaluate(`(async () => { for (let i = 0; i < 60; i++) { const s = __musicTest.status(); if (s.songs > 0 && !s.progress.running) return; await new Promise((r) => setTimeout(r, 200)) } })()`)
await evaluate(`__musicTest.playAt(0)`)
await sleep(900)

const report = {}
report.standard = await evaluate(`(() => {
  const bar = document.querySelector('.player-bar')
  const times = document.querySelector('.ps-times')
  const kids = times ? [...times.children] : []
  const btns = [...document.querySelectorAll('.buttons .icon-btn, .buttons .play-btn')]
  const play = document.querySelector('.play-btn')
  const fill = document.querySelector('.ps-fill')
  const left0 = Math.min(...btns.map((b) => b.getBoundingClientRect().x))
  const right1 = Math.max(...btns.map((b) => b.getBoundingClientRect().right))
  const barR = bar.getBoundingClientRect()
  const ctlR = document.querySelector('.controls').getBoundingClientRect()
  return {
    barH: Math.round(barR.height),
    timesChildren: kids.length,
    badge: times?.querySelector('.badge')?.textContent ?? null,
    cur: times?.querySelector('.ps-cur')?.textContent,
    dur: times?.querySelector('.ps-dur')?.textContent,
    playRadius: play ? getComputedStyle(play).borderRadius : null,
    playBg: play ? getComputedStyle(play).backgroundColor : null,
    fillBg: fill ? getComputedStyle(fill).backgroundColor.slice(0, 30) : null,
    spread: btns.length === 5 && Math.abs(left0 - ctlR.left) < 6 && Math.abs(ctlR.right - right1) < 6,
    ctlW: Math.round(ctlR.width),
    btnCount: btns.length,
  }
})()`)
let shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/bar-light.png', Buffer.from(shot.data, 'base64'))

// 深色主题
await evaluate(`localStorage.setItem('settings.themeMode', 'dark')`)
await send('Page.navigate', { url: 'http://localhost:5180/' })
await sleep(2200)
await evaluate(`(async () => { if (!__musicTest.playerState().currentPath) await __musicTest.playAt(0) }())`)
await sleep(700)
shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/bar-dark.png', Buffer.from(shot.data, 'base64'))

// 胶囊零影响
await evaluate(`localStorage.setItem('settings.playerStyle', 'capsule')`)
await send('Page.navigate', { url: 'http://localhost:5180/' })
await sleep(2200)
report.capsule = await evaluate(`(() => {
  const bar = document.querySelector('.player-bar')
  const play = document.querySelector('.play-btn')
  const times = document.querySelector('.ps-times')
  return {
    capsule: bar?.classList.contains('capsule'),
    barH: Math.round(bar?.getBoundingClientRect().height ?? 0),
    timesHidden: times ? getComputedStyle(times).display === 'none' : 'n/a',
    playRadius: play ? getComputedStyle(play).borderRadius : null,
    playBg: play ? getComputedStyle(play).backgroundColor : null,
    particles: !!document.querySelector('.capsule-particles'),
  }
})()`)
shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 320, y: 780, width: 800, height: 120, scale: 1.5 } })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/bar-capsule.png', Buffer.from(shot.data, 'base64'))

console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
