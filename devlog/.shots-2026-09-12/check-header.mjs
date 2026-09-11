import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9349
const userDataDir = fs.mkdtempSync(os.tmpdir() + '/onda-chk-')
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, '--no-first-run', '--mute-audio', '--window-size=1440,900', 'http://localhost:5180/'], { stdio: 'ignore' })
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
await send('Runtime.enable')
await sleep(2500)
const r = await send('Runtime.evaluate', { expression: `(() => {
  const h = document.querySelector('.view-header')
  if (!h) return { header: false }
  const cs = getComputedStyle(h)
  const rules = []
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && rule.selectorText.includes('view-header') && rule.style && rule.style.background) {
          rules.push(rule.selectorText + ' -> ' + rule.style.background.slice(0, 80))
        }
      }
    } catch {}
  }
  return {
    cls: h.className,
    position: cs.position,
    zIndex: cs.zIndex,
    background: cs.background.slice(0, 160),
    backdropFilter: cs.backdropFilter,
    glassBgVar: cs.getPropertyValue('--glass-bg').slice(0, 120),
    theme: document.documentElement.dataset.theme,
    rules,
  }
})()`, returnByValue: true })
console.log(JSON.stringify(r.result.value, null, 2))
ws.close(); proc.kill()
