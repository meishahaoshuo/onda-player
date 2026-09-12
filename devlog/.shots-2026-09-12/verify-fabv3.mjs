import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9353
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-fabv3-')
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

// 造数据：30 首歌 + 播放第 0 首（跨 reload 持久化）
await evaluate(`__musicTest.resetTest()`)
await evaluate(`__musicTest.addBulkSongs(30)`)
await evaluate(`(async () => { for (let i = 0; i < 60; i++) { const s = __musicTest.status(); if (s.songs >= 30 && !s.progress.running) return; await new Promise((r) => setTimeout(r, 200)) } })()`)
await evaluate(`__musicTest.playAt(0)`)
await sleep(600)

const report = {}
for (const v of ['compass', 'knob', 'tape']) {
  await evaluate(`localStorage.setItem('settings.locateFabStyle', '${v}')`)
  await send('Page.navigate', { url: 'http://localhost:5180/' })
  await sleep(2200)
  // 播放态：优先等恢复；恢复不出就重新播（测试环境不依赖恢复链路）
  const r = await evaluate(`(async () => {
    for (let i = 0; i < 20; i++) { if (__musicTest.playerState().currentPath) break; await new Promise((r0) => setTimeout(r0, 150)) }
    if (!__musicTest.playerState().currentPath) await __musicTest.playAt(0)
    await new Promise((r0) => setTimeout(r0, 400))
    const st = __musicTest.playerState()
    const st2 = __musicTest.status()
    const host = document.querySelector('.scroll-host')
    if (host) host.scrollTop = 900
    await new Promise((r0) => setTimeout(r0, 500))
    const fab = document.querySelector('.locate-fab')
    return {
      currentPath: st.currentPath,
      songs: st2.songs,
      scrollTop: host ? Math.round(host.scrollTop) : null,
      vh: host ? host.clientHeight : null,
      fab: !!fab,
    }
  })()`)
  report[v] = r
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 1040, y: 520, width: 400, height: 380, scale: 2 } })
  fs.writeFileSync(`D:/项目/音乐播放器/devlog/.shots-2026-09-12/fabv3-${v}.png`, Buffer.from(shot.data, 'base64'))
}

// 设置页切换冒烟：点「露珠」→ store 与 DOM class 同步
await evaluate(`localStorage.setItem('settings.locateFabStyle', 'compass')`)
await send('Page.navigate', { url: 'http://localhost:5180/' })
await sleep(2200)
await evaluate(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.trim() === '设置').click()`)
await sleep(500)
report.segButtons = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('.seg-choice-btn')].filter((b) => ['罗盘', '露珠', '旋钮', '卡带'].includes(b.textContent.trim()))
  return { count: btns.length, labels: btns.map((b) => b.textContent.trim()) }
})()`)
await evaluate(`[...document.querySelectorAll('.seg-choice-btn')].find((b) => b.textContent.trim() === '露珠').click()`)
await sleep(300)
report.switchToDrop = await evaluate(`({
  stored: localStorage.getItem('settings.locateFabStyle'),
  onBtn: [...document.querySelectorAll('.seg-choice-btn')].find((b) => b.textContent.trim() === '露珠')?.classList.contains('on'),
})`)

console.log(JSON.stringify(report, null, 2))
ws.close(); proc.kill()
