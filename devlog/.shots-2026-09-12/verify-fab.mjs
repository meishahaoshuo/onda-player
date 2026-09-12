import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9351
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-fab-')
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
await sleep(2500)

const report = {}
await evaluate(`__musicTest.resetTest()`)
await evaluate(`__musicTest.addBulkSongs(30)`)
await evaluate(`(async () => { for (let i = 0; i < 60; i++) { const s = __musicTest.status(); if (s.songs >= 30 && !s.progress.running) return; await new Promise((r) => setTimeout(r, 200)) } })()`)
await evaluate(`__musicTest.playAt(0)`)
await sleep(800)

// 播放行在视野内 → 球不显示
report.atTop = await evaluate(`(() => ({
  fab: !!document.querySelector('.locate-fab'),
  scroll: document.querySelector('.scroll-host').scrollTop,
}))()`)

// 滚下去让第 0 行离开视野 → 球浮现
await evaluate(`document.querySelector('.scroll-host').scrollTop = 900`)
await sleep(400)
report.afterScroll = await evaluate(`(() => {
  const fab = document.querySelector('.locate-fab')
  const core = fab?.querySelector('.lf-core')
  const ripple = fab?.querySelector('.lf-ripple')
  return {
    fab: !!fab,
    size: fab ? fab.getBoundingClientRect().width : null,
    coreColor: core ? getComputedStyle(core).backgroundColor : null,
    rippleAnim: ripple ? getComputedStyle(ripple).animationName : null,
    dustCount: fab ? fab.querySelectorAll('.lf-dust').length : 0,
    scroll: document.querySelector('.scroll-host').scrollTop,
  }
})()`)
await send('Page.enable')
const fabShot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:/项目/音乐播放器/devlog/.shots-2026-09-12/fab-20px.png', Buffer.from(fabShot.data, 'base64'))

// 点击 → 平滑滚动回第 0 行附近 → 球自动隐藏
await evaluate(`document.querySelector('.locate-fab')?.click()`)
await sleep(1200)
report.afterClick = await evaluate(`(() => {
  const host = document.querySelector('.scroll-host')
  return { scroll: Math.round(host.scrollTop), fab: !!document.querySelector('.locate-fab') }
})()`)

await send('Page.enable')
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('D:\\\\项目\\\\音乐播放器\\\\devlog\\\\.shots-2026-09-12\\\\fab-located.png'.replace(/\\\\/g, '\\'), Buffer.from(shot.data, 'base64'))
console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
