import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 查 html 的 background 到底被哪条规则决定 —— 直接遍历样式表，不靠模拟。 */

const PORT = 9379
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-css-'))
const proc = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
   '--no-first-run', '--no-default-browser-check', '--mute-audio', '--no-proxy-server',
   '--window-size=1120,700', 'http://localhost:5180/'],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = l.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('CDP 未就绪')
}
const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pend = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (m, p = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method: m, params: p }))
  return new Promise((res, rej) => pend.set(i, (x) => (x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result))))
}
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  return r.exceptionDetails ? { __ERR: String(r.exceptionDetails.exception?.description ?? '') } : r.result.value
}
await send('Page.enable'); await send('Runtime.enable')
for (let i = 0; i < 60; i++) { if ((await ev(`!!document.querySelector('.app-shell')`)) === true) break; await sleep(300) }

await ev(`document.documentElement.classList.add('desktop-glass')`)
await sleep(300)

console.log('html classList =', await ev(`document.documentElement.className`))
console.log('matches("html.desktop-glass") =', await ev(`document.documentElement.matches('html.desktop-glass')`))
console.log('html 计算背景 =', await ev(`getComputedStyle(document.documentElement).backgroundColor`))
console.log('')
console.log('=== 样式表里所有涉及 desktop-glass 或 html 背景的规则 ===')
console.log(await ev(`(() => {
  const out = []
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    const walk = (list, base) => {
      for (const r of list) {
        if (r.cssRules) { walk(r.cssRules, base + ' @' + (r.conditionText ?? r.name ?? '')); continue }
        const t = r.selectorText
        if (!t) continue
        if (t.includes('desktop-glass') || (t === 'html' || t === ':root' || t.includes('html,'))) {
          out.push((base ? base + '  ' : '') + t + ' { ' + (r.style.background || r.style.backgroundColor || '(无 background)') + ' }')
        }
      }
    }
    walk(rules, '')
  }
  return out.join('\\n')
})()`))

ws.close(); proc.kill()
console.log('\ndone')
