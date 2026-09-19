import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs'

/**
 * 端到端验证「切换主题时，html 那层首帧底色会跟着走」。
 *
 * 修复前：index.html 的防闪脚本只在页面加载时写一次 html 内联背景，
 * 运行中切主题不重写 —— 深色模式下 html 永远停在一块白上，
 * 页面基底只要带一点透明度就会透出它（曾经的 #454545）。
 * 修复后：settings store 的 watchEffect 里与 data-theme 一起同步。
 *
 * 做法：进设置页 → 点「浅色」→ 点「深色」，每次都读
 *   html 内联背景 / body 计算背景 / 内容区与侧栏的实际像素。
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9385
const SHOTS = 'D:/项目/音乐播放器/devlog/.shots-2026-09-15'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-themesync-'))
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
await sleep(4500)

async function snapshot(tag) {
  const st = await evalIn(`(() => {
    const html = document.documentElement;
    return {
      theme: html.dataset.theme,
      htmlInline: html.style.backgroundColor || '(未设置)',
      htmlComputed: getComputedStyle(html).backgroundColor,
      bodyComputed: getComputedStyle(document.body).backgroundColor,
    };
  })()`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const file = `${SHOTS}/theme-sync-${tag}.png`
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const k = info.width / 1120
  const px = (lx, ly) => {
    const x = Math.round(lx * k), y = Math.round(ly * k)
    const i = (y * info.width + x) * info.channels
    return '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  return { ...st, contentPx: px(300, 655), sidebarPx: px(120, 600) }
}

// 进设置页
await evalIn(`(() => {
  const items = [...document.querySelectorAll('.nav-item')];
  const target = items.find((el) => el.textContent.includes('设置'));
  if (target) target.click();
  return !!target;
})()`)
await sleep(1200)

const results = []
let s = await snapshot('0-initial')
results.push(['初始（跟随系统，headless 为浅色）', s])

for (const [idx, label, tag] of [[2, '浅色', '1-light'], [1, '深色', '2-dark'], [0, '回到跟随系统', '3-system']]) {
  await evalIn(`(() => {
    const btns = [...document.querySelectorAll('.theme-option')];
    if (!btns[${idx}]) return 'missing';
    btns[${idx}].click();
    return 'clicked:' + btns[${idx}].textContent.trim().slice(0, 12);
  })()`)
  await sleep(1000)
  s = await snapshot(tag)
  results.push([`点击「${label}」后`, s])
}

console.log('=== 主题切换时 html 首帧底色是否同步 ===')
for (const [label, r] of results) {
  console.log('')
  console.log('【' + label + '】 data-theme = ' + r.theme)
  console.log('   html 内联背景   ' + r.htmlInline)
  console.log('   html 计算背景   ' + r.htmlComputed)
  console.log('   body 计算背景   ' + r.bodyComputed)
  console.log('   内容区像素      ' + r.contentPx + '   侧栏像素 ' + r.sidebarPx)
}

const dark = results.find((r) => r[1].theme === 'dark')[1]
console.log('')
console.log('=== 判定 ===')
console.log('  深色下 html 内联背景 =', dark.htmlInline, '→', /rgb\(10,\s*10,\s*10\)/.test(dark.htmlInline) ? '✅ 已同步为 #0a0a0a' : '❌ 仍是白的')
console.log('  深色下内容区像素 =', dark.contentPx, '→', dark.contentPx === '#0A0A0A' ? '✅ 真近黑' : '❌ 泛白')
console.log('  深色下侧栏像素 =', dark.sidebarPx, '→ 应比内容区亮（层次正）')

proc.kill()
process.exit(0)
