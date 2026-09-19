import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 托盘浮层菜单的界面验证。
 *
 * 浮层在真机上由「右键托盘」唤起，无法自动化触发；但它本身只是一个网页，
 * 直接打开 `?tray=1` 就能渲染，再用 DEV 预览钩子 `onda:tray-preview` 注入假状态，
 * 就能把它的布局、图标、两套主题都量清楚并截图。
 *
 * 跑之前先确保 `npm run dev` 在 5180 上（注意只监听 IPv6 回环，必须用 localhost）。
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9371
const URL_APP = 'http://localhost:5180/index.html?tray=1'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-15'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-tray-'))

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--no-proxy-server',
    '--window-size=900,900',
    URL_APP,
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('CDP 未就绪')
}

const ws = new WebSocket(await getWsUrl())
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let msgId = 0
const pending = new Map()
const consoleErrors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(String(m.params.exceptionDetails?.exception?.description ?? 'exception').slice(0, 200))
  }
}
const send = (method, params = {}) => {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)))
  })
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __ERR: String(r.exceptionDetails.exception?.description ?? '').slice(0, 300) }
  return r.result.value
}

await send('Page.enable')
await send('Runtime.enable')

/**
 * 把视口锁到浮层窗口的真实宽度 268（Rust 侧 TRAY_MENU_W）。
 * 不锁的话块级元素会撑满浏览器视口，量出来的行宽全是假的。
 */
await send('Emulation.setDeviceMetricsOverride', {
  width: 268,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})

/* ---------- 等组件挂载 ---------- */
let mounted = false
for (let i = 0; i < 60; i++) {
  mounted = await evaluate(`!!document.querySelector('.tray-menu')`)
  if (mounted === true) break
  await sleep(300)
}
console.log('组件挂载:', mounted === true ? 'OK' : '!! 失败')
if (mounted !== true) {
  process.exit(1)
}

/* ---------- 假状态注入 ---------- */
const BASE = {
  title: '示例曲目名称',
  artist: '示例歌手',
  coverId: null,
  playing: true,
  favorited: true,
  mode: 'loop',
  pinned: true,
  theme: 'light',
}
async function preview(over = {}, backdrop = '#e9e9ec') {
  const s = { ...BASE, ...over }
  await evaluate(`document.body.style.background = ${JSON.stringify(backdrop)}`)
  await evaluate(
    `window.dispatchEvent(new CustomEvent('onda:tray-preview', { detail: ${JSON.stringify(s)} }))`,
  )
  await sleep(220)
}

/* ---------- 量测 ---------- */
const METRICS = `(() => {
  const q = (s) => document.querySelector(s)
  const rect = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } }
  const card = q('.tm-card')
  return {
    theme: document.documentElement.dataset.theme,
    rootH: q('.tray-menu')?.offsetHeight ?? null,
    card: card ? rect(card) : null,
    cardShadow: card ? getComputedStyle(card).boxShadow : null,
    cardBg: card ? getComputedStyle(card).backgroundColor : null,
    headTitle: q('.tm-title')?.textContent ?? null,
    headArtist: q('.tm-artist')?.textContent ?? null,
    idle: q('.tray-menu')?.classList.contains('is-idle') ?? null,
    cbtns: [...document.querySelectorAll('.tm-cbtn')].map((b) => ({ dis: b.disabled, ...rect(b) })),
    rows: [...document.querySelectorAll('.tm-row')].map((r) => ({
      text: r.textContent.trim(),
      disabled: r.disabled,
      clipped: r.scrollWidth > r.clientWidth + 1,
      ...rect(r),
    })),
    clippedLabels: [...document.querySelectorAll('.tm-label, .tm-title, .tm-artist')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent.trim()),
    seps: document.querySelectorAll('.tm-sep').length,
    scrollX: document.documentElement.scrollWidth > window.innerWidth,
    cardRight: card ? Math.round(card.getBoundingClientRect().right) : null,
    cardBottom: card ? Math.round(card.getBoundingClientRect().bottom) : null,
  }
})()`

/* ---------- 截图（裁到卡片范围，scale 2） ---------- */
async function shot(name) {
  const box = await evaluate(`(() => {
    const b = document.querySelector('.tm-card').getBoundingClientRect()
    return { x: Math.max(0, b.x - 18), y: Math.max(0, b.y - 18), width: b.width + 36, height: b.height + 36 }
  })()`)
  const res = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...box, scale: 2 },
  })
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(res.data, 'base64'))
  console.log('  截图', name, `${Math.round(box.width)}x${Math.round(box.height)}@2x`)
}

console.log('\n=== ① 空态（没有播放）· 浅色 ===')
await preview({ title: '', artist: '', playing: false, favorited: false, pinned: false }, '#e9e9ec')
const idle = await evaluate(METRICS)
console.log('  卡头标题:', JSON.stringify(idle.headTitle), '| is-idle =', idle.idle)
console.log('  控制按钮', idle.cbtns.map((b) => (b.dis ? '禁用' : '可用')).join(' '))
console.log('  「打开歌词页」行禁用:', idle.rows.find((r) => r.text === '打开歌词页')?.disabled)
await shot('tray-1-idle.png')

console.log('\n=== ② 播放中 · 浅色（含二级模式展开） ===')
await preview()
const play = await evaluate(METRICS)
console.log('  主题 =', play.theme, '| 卡片底色 =', play.cardBg)
console.log('  阴影 =', play.cardShadow)
console.log('  卡头 =', JSON.stringify(play.headTitle), '/', JSON.stringify(play.headArtist))
console.log('  卡片尺寸 =', play.card.w + '×' + play.card.h, '| 内容高 =', play.rootH)
console.log('  控制按钮 =', play.cbtns.map((b) => b.w + '×' + b.h).join(' '))
console.log('  列表项:')
for (const r of play.rows) console.log(`    ${r.w}×${r.h}  ${r.disabled ? '[禁用] ' : ''}${r.text}`)
console.log('  分隔线', play.seps, '条 | 横向溢出 =', play.scrollX, '| 卡片右缘', play.cardRight)
console.log('  被截断的文字:', play.clippedLabels.length ? play.clippedLabels : '（无）')
await shot('tray-2-playing.png')

console.log('\n=== ③ 展开「播放模式」二级菜单 ===')
// 用真实指针事件点「列表循环」那一行（不是 element.click()）
const modeRow = await evaluate(`(() => {
  const el = [...document.querySelectorAll('.tm-row')].find(r => r.querySelector('.tm-chev'))
  const b = el.getBoundingClientRect()
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
})()`)
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {
    type,
    x: modeRow.x,
    y: modeRow.y,
    button: 'left',
    clickCount: 1,
    buttons: type === 'mousePressed' ? 1 : 0,
  })
  await sleep(40)
}
await sleep(320)
const open = await evaluate(METRICS)
console.log('  展开后列表项:')
for (const r of open.rows) console.log(`    ${r.w}×${r.h}  ${r.text}`)
console.log('  高度变化:', play.card.h, '→', open.card.h, `(${open.card.h - play.card.h >= 0 ? '+' : ''}${open.card.h - play.card.h})`)
console.log('  勾选项数 =', await evaluate(`document.querySelectorAll('.tm-row.is-active').length`))
await shot('tray-3-mode-open.png')

console.log('\n=== ④ 播放中 · 深色 ===')
await preview({ theme: 'dark' }, '#1a1a1c')
const dark = await evaluate(METRICS)
console.log('  主题 =', dark.theme, '| 卡片底色 =', dark.cardBg)
console.log('  阴影 =', dark.cardShadow)
await shot('tray-4-dark.png')

console.log('\n=== 页面异常 ===')
console.log(consoleErrors.length ? consoleErrors : '（无）')

ws.close()
proc.kill()
console.log('\ndone')
