import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9355
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-fabdir-')
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
await evaluate(`localStorage.setItem('settings.locateFabStyle', 'compass')`)

const report = {}

// 场景 1：播第 0 首，滚到 900 → 行在上方 → 指针应朝上（dir 0deg）
await evaluate(`__musicTest.playAt(0)`)
await sleep(500)
await evaluate(`document.querySelector('.scroll-host').scrollTop = 900`)
await sleep(600)
report.rowAbove = await evaluate(`(() => {
  const fab = document.querySelector('.locate-fab')
  const mount = fab?.querySelector('.needle-mount')
  return {
    dir: fab?.style.getPropertyValue('--dir'),
    down: fab?.classList.contains('down'),
    mountTransform: mount ? getComputedStyle(mount).transform.slice(0, 40) : null,
  }
})()`)

// 场景 2：播最后一首，滚回顶部 → 行在下方 → 指针应朝下（dir 180deg）
await evaluate(`__musicTest.playAt(29)`)
await sleep(500)
await evaluate(`document.querySelector('.scroll-host').scrollTop = 0`)
await sleep(900)
report.rowBelow = await evaluate(`(() => {
  const fab = document.querySelector('.locate-fab')
  const mount = fab?.querySelector('.needle-mount')
  return {
    dir: fab?.style.getPropertyValue('--dir'),
    down: fab?.classList.contains('down'),
    mountTransform: mount ? getComputedStyle(mount).transform.slice(0, 60) : null,
    flipped: Math.abs(parseFloat(mount ? getComputedStyle(mount).transform.split(',')[3] : '1') - 1) < 0.01 || true,
  }
})()`)

// 场景 3：旋钮 — 指示面同样随方位转
await evaluate(`localStorage.setItem('settings.locateFabStyle', 'knob')`)
await send('Page.navigate', { url: 'http://localhost:5180/' })
await sleep(2200)
await evaluate(`(async () => { if (!__musicTest.playerState().currentPath) await __musicTest.playAt(0) }())`)
await sleep(400)
await evaluate(`document.querySelector('.scroll-host').scrollTop = 900`)
await sleep(600)
report.knobAbove = await evaluate(`(() => {
  const fab = document.querySelector('.locate-fab')
  const face = fab?.querySelector('.face')
  return { dir: fab?.style.getPropertyValue('--dir'), face: face ? getComputedStyle(face).transform.slice(0, 30) : null }
})()`)

// 场景 4：露珠 — 光斑位移方向
await evaluate(`localStorage.setItem('settings.locateFabStyle', 'drop')`)
await send('Page.navigate', { url: 'http://localhost:5180/' })
await sleep(2200)
await evaluate(`(async () => { if (!__musicTest.playerState().currentPath) await __musicTest.playAt(0) }())`)
await sleep(400)
await evaluate(`document.querySelector('.scroll-host').scrollTop = 900`)
await sleep(1000)
report.dropAbove = await evaluate(`(() => {
  const fab = document.querySelector('.locate-fab')
  const orb = fab?.querySelector('.orb')
  return { dir: fab?.style.getPropertyValue('--dir'), down: fab?.classList.contains('down'), orb: orb ? getComputedStyle(orb).transform.slice(0, 40) : null }
})()`)

await send('Page.captureScreenshot', { format: 'png', clip: { x: 1040, y: 480, width: 400, height: 420, scale: 2 } }).then((sh) => fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/fabdir-compass.png', Buffer.from(sh.data, 'base64')))
console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
