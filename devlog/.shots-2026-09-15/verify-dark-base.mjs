import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs'

/**
 * 验证「桌面端深色模式页面底色被白画布抬亮」的修复。
 *
 * 判据两条：
 *  ① `html` 挂上 .desktop-glass 后的计算背景必须**透明**（原来是 Canvas 白）
 *  ② 截图里页面底色区域的 **alpha 必须 < 255** —— 半透明才说明 Acrylic 能透出来；
 *     修复前那里是不透明白（alpha 255），这才有后面 24% 白渗出来把底色抬到 #454545
 *
 * 再叠一层验证：把截图合成到一个「模拟 Acrylic 底色」上，量各区域亮度是否收敛。
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9376
const URL_APP = 'http://localhost:5180/'
const OUT = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-15'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-darkfix-'))

const proc = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
   '--no-first-run', '--no-default-browser-check', '--mute-audio', '--no-proxy-server',
   '--window-size=1120,700', URL_APP],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function getWsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('CDP 未就绪')
}
const ws = new WebSocket(await getWsUrl())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)))
  })
}
const evaluate = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  return r.exceptionDetails ? { __ERR: String(r.exceptionDetails.exception?.description ?? '').slice(0, 200) } : r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
for (let i = 0; i < 60; i++) {
  if ((await evaluate(`!!document.querySelector('.app-shell')`)) === true) break
  await sleep(300)
}

/* 深色 + 桌面形态 */
await evaluate(`(() => { const el=[...document.querySelectorAll('.sidebar *')].find(e=>e.textContent.trim()==='设置'); if(el) el.click(); return true })()`)
await sleep(800)
await evaluate(`(() => {
  const b = [...document.querySelectorAll('*')].find(e => e.textContent.trim() === '深色' && e.children.length <= 2)
  if (b) (b.closest('button') ?? b).click()
  return true
})()`)
await sleep(600)
await evaluate(`document.documentElement.classList.add('desktop-glass')`)
await sleep(400)

const theme = await evaluate(`document.documentElement.dataset.theme`)
const htmlBg = await evaluate(`getComputedStyle(document.documentElement).backgroundColor`)
const bodyBg = await evaluate(`getComputedStyle(document.body).backgroundColor`)
console.log('① 主题 =', theme)
console.log('   html 计算背景 =', htmlBg, htmlBg.includes('0, 0, 0, 0') || htmlBg === 'rgba(0, 0, 0, 0)' ? '→ 已透明 OK' : '→ !! 仍不透明')
console.log('   body 计算背景 =', bodyBg)

/* ② 截图（保留 alpha） */
const res = await send('Page.captureScreenshot', { format: 'png' })
const raw = Buffer.from(res.data, 'base64')
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'dark-base-alpha.png'), raw)

const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const K = info.width / 1120
const pts = [
  ['侧栏 中部', 120, 420], ['内容区 左空白', 350, 400], ['内容区 下空白', 640, 640],
  ['设置面板 内', 700, 300], ['顶栏 空白处', 760, 30], ['播放条 胶囊', 540, 680],
]
console.log('\n② 页面各区域底色（alpha 是关键：255 = 不透明白，< 255 = 半透明）')
const rows = []
for (const [n, lx, ly] of pts) {
  const x = Math.round(lx * K), y = Math.round(ly * K)
  if (x >= info.width || y >= info.height) { console.log('  ' + n + ' 越界'); continue }
  const i = (y * info.width + x) * info.channels
  const a = data[i + 3]
  const hex = '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  rows.push([n, a, hex])
  console.log('  ' + n.padEnd(14) + ' rgba(' + data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ',' + a + ')   ' + hex)
}

/* 合成到「模拟 Acrylic 底色」上，看亮度是否收敛 */
const SIM = { r: 0x3a, g: 0x3a, b: 0x3a }
console.log('\n③ 合成到模拟 Acrylic 底色 #3A3A3A 后的实际观感')
const lums = []
for (const [n, a, hex] of rows) {
  const idx = pts.findIndex((p) => p[0] === n)
  const lx = pts[idx][1], ly = pts[idx][2]
  const x = Math.round(lx * K), y = Math.round(ly * K)
  const i = (y * info.width + x) * info.channels
  const af = data[i + 3] / 255
  const r = Math.round(data[i] * af + SIM.r * (1 - af))
  const g = Math.round(data[i + 1] * af + SIM.g * (1 - af))
  const b = Math.round(data[i + 2] * af + SIM.b * (1 - af))
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  lums.push(lum)
  console.log('  ' + n.padEnd(14) + ' #' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() + '   亮度 ' + lum.toFixed(1))
}
console.log('\n  亮度极差 = ' + (Math.max(...lums) - Math.min(...lums)).toFixed(1) +
  '（修复前实测是 42 → 97，极差 55）')

ws.close()
proc.kill()
console.log('\ndone')
