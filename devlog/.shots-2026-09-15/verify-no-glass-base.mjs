import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 验证「窗口透出桌面」移除后，页面基底是否恢复为不透明实色。
 *
 * 关键在于：旧的 `html.desktop-glass body { background: color-mix(... 76%, transparent) }`
 * 会让 body 的计算背景变成 **rgba(10,10,10,0.76)**（有 alpha）。
 * 所以只要给 html 强行打上 .desktop-glass 类，再读 body 的计算背景：
 *   - 报 rgb(10, 10, 10)        → 规则已移除，基底实色（期望）
 *   - 报 rgba(10, 10, 10, 0.76) → 规则还在（失败）
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9381
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-noglass-'))
const proc = spawn(
  CHROME,
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
}
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise((res) => pend.set(i, res))
}
const evalIn = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await sleep(3500)

const probe = `(() => {
  const cs = (el) => getComputedStyle(el);
  const html = document.documentElement;
  const out = {};
  html.dataset.theme = 'dark';
  out.dark = {
    bodyBg: cs(document.body).backgroundColor,
    htmlBg: cs(html).backgroundColor,
    bgBase: cs(html).getPropertyValue('--bg-base').trim(),
    sidebar: cs(html).getPropertyValue('--bg-sidebar').trim(),
    hover: cs(html).getPropertyValue('--bg-hover').trim(),
  };
  // 强行补上已废弃的类：规则若还在，body 背景会带 alpha
  html.classList.add('desktop-glass');
  out.withGlassClass = {
    bodyBg: cs(document.body).backgroundColor,
    htmlBg: cs(html).backgroundColor,
  };
  html.classList.remove('desktop-glass');
  html.dataset.theme = 'light';
  out.light = {
    bodyBg: cs(document.body).backgroundColor,
    bgBase: cs(html).getPropertyValue('--bg-base').trim(),
  };
  return out;
})()`

const r = await evalIn(probe)
const re = /^rgba?\(([^)]+)\)$/
const alphaOf = (s) => {
  const m = s.match(re)
  if (!m) return null
  const parts = m[1].split(',').map((v) => v.trim())
  return parts.length === 4 ? Number(parts[3]) : 1
}

console.log('=== 深色主题 ===')
console.log('  --bg-base        ', r.dark.bgBase)
console.log('  body 计算背景    ', r.dark.bodyBg, '  alpha =', alphaOf(r.dark.bodyBg))
console.log('  侧栏令牌          ', r.dark.sidebar)
console.log('  顶栏悬停令牌      ', r.dark.hover)
console.log('')
console.log('=== 强行补上 .desktop-glass 类后（关键判定）===')
console.log('  body 计算背景    ', r.withGlassClass.bodyBg, '  alpha =', alphaOf(r.withGlassClass.bodyBg))
const a = alphaOf(r.withGlassClass.bodyBg)
console.log('  判定：', a === 1 ? '✅ 规则已移除，基底恒为实色' : '❌ 规则仍在（alpha=' + a + '）')
console.log('')
console.log('=== 浅色主题 ===')
console.log('  --bg-base        ', r.light.bgBase)
console.log('  body 计算背景    ', r.light.bodyBg, '  alpha =', alphaOf(r.light.bodyBg))

proc.kill()
process.exit(0)
