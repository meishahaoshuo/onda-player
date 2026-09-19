import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs'

/**
 * 定位「深色模式页面底色被抬成 #454545」的白底到底来自哪一层。
 *
 * 做法：不加任何覆盖地读运行时状态 ——
 *   1. html 的**内联**背景色（index.html 首帧脚本写的，内联优先级最高）
 *   2. html / body 的计算背景
 *   3. 直接截图取样：内容区空白处到底渲染成什么颜色
 * 再强制 data-theme=dark 复测一次，看「页面基底」是否压过了那层白。
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9383
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-whitesrc-'))
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
await send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 700, deviceScaleFactor: 2, mobile: false })
await sleep(4000)

/** 截图并取某个坐标的像素 */
async function pixelAt(file, lx, ly) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const k = info.width / 1120
  const x = Math.round(lx * k), y = Math.round(ly * k)
  const i = (y * info.width + x) * info.channels
  return '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

const state1 = await evalIn(`(() => {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  return {
    theme: html.dataset.theme,
    lsm: localStorage.getItem('settings.themeMode'),
    htmlInlineBg: html.style.backgroundColor || '(未设置)',
    htmlComputedBg: cs.backgroundColor,
    bodyComputedBg: getComputedStyle(document.body).backgroundColor,
    bgBase: cs.getPropertyValue('--bg-base').trim(),
    glassClass: html.className,
  };
})()`)

console.log('=== ① 页面加载后（未做任何覆盖）===')
console.log('  data-theme        ', state1.theme)
console.log('  localStorage 主题  ', state1.lsm)
console.log('  html 内联背景      ', state1.htmlInlineBg)
console.log('  html 计算背景      ', state1.htmlComputedBg)
console.log('  body 计算背景      ', state1.bodyComputedBg)
console.log('  --bg-base         ', state1.bgBase)
console.log('  html class        ', JSON.stringify(state1.glassClass))
console.log('')
console.log('  内容区空白像素     ', await pixelAt('devlog/.shots-2026-09-15/white-src-1.png', 400, 420))

// ② 强制深色（模拟用户选「深色」时的状态）
await evalIn(`(() => {
  const html = document.documentElement;
  html.dataset.theme = 'dark';
  document.body.style.background = '';   // 清掉可能的内联覆盖
  return 1;
})()`)
await sleep(900)

const state2 = await evalIn(`(() => {
  const html = document.documentElement;
  return {
    theme: html.dataset.theme,
    htmlInlineBg: html.style.backgroundColor || '(未设置)',
    htmlComputedBg: getComputedStyle(html).backgroundColor,
    bodyComputedBg: getComputedStyle(document.body).backgroundColor,
    bgBase: getComputedStyle(html).getPropertyValue('--bg-base').trim(),
  };
})()`)

console.log('')
console.log('=== ② 强制 data-theme=dark 之后 ===')
console.log('  html 内联背景      ', state2.htmlInlineBg)
console.log('  html 计算背景      ', state2.htmlComputedBg)
console.log('  body 计算背景      ', state2.bodyComputedBg)
console.log('  --bg-base         ', state2.bgBase)
console.log('')
console.log('  内容区空白像素     ', await pixelAt('devlog/.shots-2026-09-15/white-src-2.png', 400, 420))
console.log('  侧栏像素           ', await pixelAt('devlog/.shots-2026-09-15/white-src-2.png', 120, 400))

proc.kill()
process.exit(0)
