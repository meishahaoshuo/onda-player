import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9341
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-11'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-cdp-'))

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,900',
    URL_APP,
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5180'))
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('CDP 未就绪')
}

const wsUrl = await getWsUrl()
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let msgId = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails?.exception?.description ?? JSON.stringify(msg.params).slice(0, 300))
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
  }
}

function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : res(msg.result)))
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)))
  }
  return r.result.value
}

async function shotBar(name) {
  const r = await evaluate(
    `(() => { const b = document.querySelector('.player-bar').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })()`,
  )
  const clip = {
    x: Math.max(0, Math.round(r.x - 24)),
    y: Math.max(0, Math.round(r.y - 26)),
    width: Math.round(r.w + 48),
    height: Math.round(r.h + 48),
    scale: 2,
  }
  const s = await send('Page.captureScreenshot', { format: 'png', clip })
  const p = path.join(SHOT_DIR, name)
  fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
  return p
}

async function moveMouse(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), buttons: 0 })
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_APP })
await sleep(2500)

const report = {}

// 新 profile 默认是「标准条」；切成用户实际使用的浮动胶囊形态
await evaluate(`localStorage.setItem('settings.playerStyle', 'capsule')`)
await send('Page.navigate', { url: URL_APP })
await sleep(2500)
report.styleReady = await evaluate(`(async () => {
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('.capsule-glow')) return true
    await new Promise(r => setTimeout(r, 150))
  }
  return false
})()`)
if (!report.styleReady) throw new Error('胶囊形态未生效：找不到 .capsule-glow')

// ---------- 准备数据并进入「胶囊 + 已播 42%」状态 ----------
report.songs = await evaluate(`__musicTest.resetTest()`)
report.withCover = await evaluate(`__musicTest.addCoverSong()`)
await evaluate(`(async () => {
  for (let i = 0; i < 60; i++) {
    const s = __musicTest.status()
    if (s.songs > 0 && !s.progress.running) return
    await new Promise(r => setTimeout(r, 200))
  }
})()`)
report.play = await evaluate(`__musicTest.playAt(0)`)
await sleep(700)
// 暂停并 seek 到 42%（用测试桥的 store 接口 —— audio 元素是游离的 new Audio()）
report.seeked = await evaluate(`(async () => {
  __musicTest.toggle()
  await new Promise(r => setTimeout(r, 200))
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.42)
  await new Promise(r => setTimeout(r, 400))
  return __musicTest.playerState()
})()`)

// ---------- 结构 / 令牌 / 层叠断言 ----------
report.audit = await evaluate(`(() => {
  const el = document.querySelector('.capsule-glow')
  const bar = document.querySelector('.player-bar')
  if (!el) return { error: '未找到 .capsule-glow' }
  const cs = getComputedStyle(el)
  const soft = el.querySelector('.cg-soft')
  const tight = el.querySelector('.cg-tight')
  const edge = el.querySelector('.cg-edge')
  const hit = document.querySelector('.capsule-progress')
  const probe = document.createElement('div')
  probe.style.background = 'var(--bar-glow)'
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).backgroundColor
  const tokens = ['--bar-glow', '--bar-glow-mid', '--bar-glow-far', '--bar-glow-edge'].map((t) => ({
    token: t,
    value: getComputedStyle(document.documentElement).getPropertyValue(t).trim(),
  }))
  probe.remove()
  const b = bar.getBoundingClientRect()
  const g = el.getBoundingClientRect()
  const h = hit.getBoundingClientRect()
  return {
    barClass: bar.className,
    legacySvgGone: document.querySelector('.cp-svg') === null,
    zIndex: cs.zIndex,
    borderRadius: cs.borderRadius,
    transitionProperty: cs.transitionProperty,
    cpP: el.style.getPropertyValue('--cp-p'),
    softMask: getComputedStyle(soft).maskImage,
    tightMask: getComputedStyle(tight).maskImage,
    softOpacity: getComputedStyle(soft).opacity,
    tightOpacity: getComputedStyle(tight).opacity,
    edgeOpacity: getComputedStyle(edge).opacity,
    edgeBg: getComputedStyle(edge).backgroundColor,
    resolvedGlow: resolved,
    tokens,
    geom: {
      bar: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      glow: { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.width), h: Math.round(g.height) },
      hit: { x: Math.round(h.x), y: Math.round(h.y), w: Math.round(h.width), h: Math.round(h.height) },
    },
  }
})()`)

// ---------- 截图：浅色 常态 / 悬停 / 拖拽 ----------
const barGeo = await evaluate(
  `(() => { const b = document.querySelector('.player-bar').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })()`,
)
report.shotLightRest = await shotBar('light-rest-42.png')
// 整页 1x：看氛围光在真实页面里的观感（不是放大细节）
{
  const s = await send('Page.captureScreenshot', { format: 'png' })
  report.shotLightFull = path.join(SHOT_DIR, 'light-page-1x.png')
  fs.writeFileSync(report.shotLightFull, Buffer.from(s.data, 'base64'))
}

const hoverX = barGeo.x + barGeo.w * 0.42
const hoverY = barGeo.y + 6
await moveMouse(hoverX, hoverY)
await sleep(420)
report.hovered = await evaluate(`(() => {
  const el = document.querySelector('.capsule-glow')
  return {
    soft: getComputedStyle(el.querySelector('.cg-soft')).opacity,
    tight: getComputedStyle(el.querySelector('.cg-tight')).opacity,
    edge: getComputedStyle(el.querySelector('.cg-edge')).opacity,
  }
})()`)
report.shotLightHover = await shotBar('light-hover.png')

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(hoverX), y: Math.round(hoverY), button: 'left', clickCount: 1, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(barGeo.x + barGeo.w * 0.72), y: Math.round(hoverY), button: 'left', buttons: 1 })
await sleep(260)
report.dragging = await evaluate(`(() => {
  const bar = document.querySelector('.player-bar')
  const el = document.querySelector('.capsule-glow')
  return { ringDragging: bar.className.includes('ring-dragging'), cpP: el.style.getPropertyValue('--cp-p') }
})()`)
report.shotLightDrag = await shotBar('light-drag-72.png')
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(barGeo.x + barGeo.w * 0.72), y: Math.round(hoverY), button: 'left', buttons: 0 })
await sleep(200)

// ---------- 深色主题 ----------
await evaluate(`(async () => {
  document.documentElement.setAttribute('data-theme', 'dark')
  await new Promise(r => setTimeout(r, 500))
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.42)
  await new Promise(r => setTimeout(r, 400))
})()`)
await moveMouse(10, 10)
await sleep(300)
report.shotDarkRest = await shotBar('dark-rest-42.png')
await moveMouse(hoverX, hoverY)
await sleep(420)
report.shotDarkHover = await shotBar('dark-hover.png')
report.darkAudit = await evaluate(`(() => {
  const el = document.querySelector('.capsule-glow')
  const probe = document.createElement('div')
  probe.style.background = 'var(--bar-glow)'
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).backgroundColor
  probe.remove()
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    resolvedGlow: resolved,
    cpP: el.style.getPropertyValue('--cp-p'),
    softMask: getComputedStyle(el.querySelector('.cg-soft')).maskImage,
    tightOpacity: getComputedStyle(el.querySelector('.cg-tight')).opacity,
  }
})()`)

// ---------- 平滑性：timeupdate（约 4Hz）是否被 --cp-p 过渡抹成连续推移 ----------
report.smoothing = await evaluate(`(async () => {
  const el = document.querySelector('.capsule-glow')
  __musicTest.playAt(0)
  await new Promise(r => setTimeout(r, 500))
  const seen = new Set()
  const samples = []
  for (let i = 0; i < 30; i++) {
    for (const a of el.getAnimations()) seen.add(a.transitionProperty)
    samples.push(Number(getComputedStyle(el).getPropertyValue('--cp-p')))
    await new Promise(r => setTimeout(r, 60))
  }
  __musicTest.toggle()
  const uniq = new Set(samples.map((v) => v.toFixed(4))).size
  return { transitionProps: [...seen], distinctValues: uniq, samples: samples.slice(0, 8) }
})()`)

report.consoleErrors = consoleErrors
report.exceptions = exceptions

console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
process.exit(0)
