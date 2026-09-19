import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs'

/**
 * 验证「webview 背景置透明」修复后的深色模式观感。
 *
 * 修复在 Rust/配置侧（window + webview 的 backgroundColor 全透明），浏览器里没法
 * 直接复现 —— 但可以用 `Emulation.setDefaultBackgroundColorOverride(alpha 0)`
 * **模拟出完全相同的条件**（webview 背后不再有不透明白），再量各区域是否收敛。
 *
 * 对照基线用用户截图里的真机实测值：
 *   页面底 #454545(69) / 侧栏 #303031(48) / 设置面板 #2A2A2C(42) → 极差 27
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9378
const OUT = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-15'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-fix-'))
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
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise((res, rej) => pend.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))))
}
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  return r.exceptionDetails ? { __ERR: String(r.exceptionDetails.exception?.description ?? '') } : r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
for (let i = 0; i < 60; i++) {
  if ((await ev(`!!document.querySelector('.app-shell')`)) === true) break
  await sleep(300)
}
/* 进设置页 + 深色 + 桌面形态 */
await ev(`(() => { const el=[...document.querySelectorAll('.sidebar *')].find(e=>e.textContent.trim()==='设置'); if(el) el.click(); return true })()`)
await sleep(800)
await ev(`(() => { const b=[...document.querySelectorAll('*')].find(e=>e.textContent.trim()==='深色'&&e.children.length<=2); if(b)(b.closest('button')??b).click(); return true })()`)
await sleep(600)
await ev(`document.documentElement.classList.add('desktop-glass')`)
await sleep(300)

/* 关键：模拟修复后的条件 —— webview 背后不再有不透明白 */
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
await sleep(300)

console.log('html 计算背景 =', await ev(`getComputedStyle(document.documentElement).backgroundColor`))
console.log('body 计算背景 =', await ev(`getComputedStyle(document.body).backgroundColor`))

const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'dark-fixed.png'), Buffer.from(shot.data, 'base64'))
const { data, info } = await sharp(Buffer.from(shot.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const K = info.width / 1120
const SIM = [0x3a, 0x3a, 0x3a]        // 模拟 Acrylic 磨砂底（深色 tint 下的桌面）
const BEFORE = { 侧栏: 48, 页面底: 69, 设置面板: 42 }

const pts = [
  ['侧栏', 120, 420],
  ['页面底（内容区空白）', 360, 430],
  ['设置面板（分区内）', 700, 430],
]
console.log('\n模拟「Acrylic 磨砂底 #3A3A3A」后的实际观感：')
const lums = []
for (const [n, lx, ly] of pts) {
  const x = Math.round(lx * K), y = Math.round(ly * K)
  const i = (y * info.width + x) * info.channels
  const a = data[i + 3] / 255
  const rgb = [0, 1, 2].map((k) => Math.round(data[i + k] * a + SIM[k] * (1 - a)))
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  lums.push(lum)
  const before = BEFORE[n] ?? BEFORE['页面底']
  console.log('  ' + n.padEnd(20) + ' #' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() +
    '  亮度 ' + lum.toFixed(1) + '   (修复前 ' + before + ')')
}
console.log('\n  亮度极差 = ' + (Math.max(...lums) - Math.min(...lums)).toFixed(1) + '  （修复前真机实测极差 = 27）')
console.log('  注：alpha 越低说明页面越「让位」给 Acrylic —— 侧栏 alpha 高是因为它自带玻璃层。')

ws.close()
proc.kill()
console.log('\ndone')
