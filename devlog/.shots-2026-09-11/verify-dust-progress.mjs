import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9342
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

async function barGeo() {
  return evaluate(
    `(() => { const b = document.querySelector('.player-bar').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })()`,
  )
}

async function shotBar(name) {
  const r = await barGeo()
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

/** 整条胶囊（不含外扩边距、1x）：用于两张进度不同的截图做差分，定量证明 mask 收边 */
async function shotBarExact(name) {
  const r = await barGeo()
  const clip = {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.w),
    height: Math.round(r.h),
    scale: 1,
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

// 新 profile 默认「标准条」；切成用户实际使用的胶囊形态
await evaluate(`localStorage.setItem('settings.playerStyle', 'capsule')`)
await send('Page.navigate', { url: URL_APP })
await sleep(2500)
report.styleReady = await evaluate(`(async () => {
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('.capsule-particles')) return true
    await new Promise(r => setTimeout(r, 150))
  }
  return false
})()`)
if (!report.styleReady) throw new Error('粒子层未渲染：找不到 .capsule-particles')

// ---------- 准备数据：一首带封面的歌，暂停并 seek 到 42% ----------
report.songs = await evaluate(`__musicTest.resetTest()`)
report.withCover = await evaluate(`__musicTest.addCoverSong()`)
await evaluate(`(async () => {
  for (let i = 0; i < 60; i++) {
    const s = __musicTest.status()
    if (s.songs > 0 && !s.progress.running) return
    await new Promise(r => setTimeout(r, 200))
  }
})()`)
await evaluate(`__musicTest.playAt(0)`)
await sleep(800)
report.playingState = await evaluate(`(() => {
  const pt = document.querySelector('.capsule-particles .pt')
  return {
    barPausedClass: document.querySelector('.player-bar').className.includes('bar-paused'),
    animationPlayState: getComputedStyle(pt).animationPlayState,
    animationName: getComputedStyle(pt).animationName,
    opacity: getComputedStyle(pt).opacity,
  }
})()`)
report.seeked = await evaluate(`(async () => {
  __musicTest.toggle()
  await new Promise(r => setTimeout(r, 220))
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.42)
  await new Promise(r => setTimeout(r, 420))
  return __musicTest.playerState()
})()`)
report.pausedState = await evaluate(`(() => {
  const pt = document.querySelector('.capsule-particles .pt')
  return {
    barPausedClass: document.querySelector('.player-bar').className.includes('bar-paused'),
    animationPlayState: getComputedStyle(pt).animationPlayState,
    opacity: getComputedStyle(pt).opacity,
  }
})()`)

// ---------- 结构与令牌断言 ----------
report.audit = await evaluate(`(() => {
  const layer = document.querySelector('.capsule-particles')
  const field = document.querySelector('.pt-field')
  const wash = document.querySelector('.pt-wash')
  const pts = [...document.querySelectorAll('.capsule-particles .pt')]
  const halo = document.querySelector('.capsule-particles .pt-halo')
  const cs = getComputedStyle(layer)
  const first = pts[0]
  const accentProbe = document.createElement('div')
  accentProbe.style.color = 'var(--accent)'
  document.body.appendChild(accentProbe)
  const accent = getComputedStyle(accentProbe).color
  accentProbe.remove()
  return {
    legacyGone: !document.querySelector('.capsule-glow') && !document.querySelector('.cg-edge'),
    count: pts.length,
    zIndex: cs.zIndex,
    borderRadius: cs.borderRadius,
    overflow: cs.overflow,
    pointerEvents: cs.pointerEvents,
    maskImage: getComputedStyle(field).maskImage,
    ptFall: getComputedStyle(field).getPropertyValue('--pt-fall').trim(),
    pull: cs.getPropertyValue('--pull').trim(),
    wash: wash
      ? {
          exists: true,
          opacity: getComputedStyle(wash).opacity,
          background: getComputedStyle(wash).backgroundImage.slice(0, 120),
          fill: getComputedStyle(wash).backgroundColor,
        }
      : { exists: false },
    colors: [...new Set(pts.map((p) => p.style.getPropertyValue('--fc').trim()))],
    firstBg: getComputedStyle(first).backgroundColor,
    firstSize: getComputedStyle(first).width + ' x ' + getComputedStyle(first).height,
    firstBoxShadow: getComputedStyle(first).boxShadow,
    haloBg: getComputedStyle(halo).backgroundImage.slice(0, 90),
    haloOpacity: getComputedStyle(halo).opacity,
    accentColor: accent,
    dustTokens: ['--dust-size', '--dust-opacity', '--dust-bloom', '--dust-halo-opacity', '--dust-mix', '--dust-tint'].map((t) => ({
      token: t,
      value: getComputedStyle(document.documentElement).getPropertyValue(t).trim(),
    })),
    filterFree: getComputedStyle(first).filter === 'none' && cs.filter === 'none',
  }
})()`)

// ---------- 截图：浅色 常态 / 悬停 / 拖拽 ----------
const geo = await barGeo()
const hoverX = geo.x + geo.w * 0.42
const hoverY = geo.y + 6
await moveMouse(20, 20)
await sleep(300)
report.shotLightRest = await shotBar('dust-light-rest.png')
{
  const s = await send('Page.captureScreenshot', { format: 'png' })
  report.shotLightPage = path.join(SHOT_DIR, 'dust-light-page-1x.png')
  fs.writeFileSync(report.shotLightPage, Buffer.from(s.data, 'base64'))
}

await moveMouse(hoverX, hoverY)
await sleep(460)
report.hovered = await evaluate(`(() => {
  const layer = document.querySelector('.capsule-particles')
  const field = document.querySelector('.pt-field')
  const halo = layer.querySelector('.pt-halo')
  const pts = [...layer.querySelectorAll('.pt')]
  const layerRect = layer.getBoundingClientRect()
  const haloRect = halo.getBoundingClientRect()
  return {
    pull: getComputedStyle(layer).getPropertyValue('--pull').trim(),
    ptFall: getComputedStyle(field).getPropertyValue('--pt-fall').trim(),
    maskImage: getComputedStyle(field).maskImage,
    haloOpacity: getComputedStyle(halo).opacity,
    haloCenterX: Math.round(haloRect.x + haloRect.width / 2 - layerRect.x),
    pointerOffsetX: ${Math.round(hoverX)} - Math.round(layerRect.x),
    particleTranslates: pts.slice(0, 4).map((p) => getComputedStyle(p).translate),
    nonZeroTranslates: pts.filter((p) => parseFloat(getComputedStyle(p).translate) !== 0).length,
  }
})()`)
report.shotLightHover = await shotBar('dust-light-hover.png')

// 拖拽：按下 42% → 拖到 72%（顺带回归 seek 精度）
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(hoverX), y: Math.round(hoverY), button: 'left', clickCount: 1, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(geo.x + geo.w * 0.72), y: Math.round(hoverY), button: 'left', buttons: 1 })
await sleep(300)
report.dragging = await evaluate(`(() => {
  const bar = document.querySelector('.player-bar')
  const layer = document.querySelector('.capsule-particles')
  const field = document.querySelector('.pt-field')
  return {
    ringDragging: bar.className.includes('ring-dragging'),
    cpP: layer.style.getPropertyValue('--cp-p'),
    ptFall: getComputedStyle(field).getPropertyValue('--pt-fall').trim(),
  }
})()`)
report.shotLightDrag = await shotBar('dust-light-drag.png')
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(geo.x + geo.w * 0.72), y: Math.round(hoverY), button: 'left', buttons: 0 })
await sleep(220)

// ---------- 深色主题 ----------
await evaluate(`(async () => {
  document.documentElement.setAttribute('data-theme', 'dark')
  await new Promise(r => setTimeout(r, 500))
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.42)
  await new Promise(r => setTimeout(r, 420))
})()`)
await moveMouse(20, 20)
await sleep(300)
report.shotDarkRest = await shotBar('dust-dark-rest.png')
await moveMouse(hoverX, hoverY)
await sleep(460)
report.shotDarkHover = await shotBar('dust-dark-hover.png')
report.darkAudit = await evaluate(`(() => {
  const layer = document.querySelector('.capsule-particles')
  const pt = layer.querySelector('.pt')
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    dustSize: getComputedStyle(document.documentElement).getPropertyValue('--dust-size').trim(),
    dustOpacity: getComputedStyle(document.documentElement).getPropertyValue('--dust-opacity').trim(),
    dustBloom: getComputedStyle(document.documentElement).getPropertyValue('--dust-bloom').trim(),
    particleBg: getComputedStyle(pt).backgroundColor,
    particleShadow: getComputedStyle(pt).boxShadow,
  }
})()`)

// ---------- 换歌换色：换到另一张色相完全不同的封面，粒子颜色应随之改变 ----------
report.bulk = await evaluate(`__musicTest.addBulkSongs(2)`)
await evaluate(`(async () => {
  for (let i = 0; i < 60; i++) {
    const s = __musicTest.status()
    if (s.songs > 0 && !s.progress.running) return
    await new Promise(r => setTimeout(r, 200))
  }
})()`)
report.colorSwitch = await evaluate(`(async () => {
  const readColors = () =>
    [...new Set([...document.querySelectorAll('.capsule-particles .pt')].map((p) => p.style.getPropertyValue('--fc').trim()))]
  const before = readColors()
  const beforePath = __musicTest.playerState().currentPath
  const n = __musicTest.status().songs
  let after = before
  let playedTitle = null
  for (let i = 0; i < n; i++) {
    await __musicTest.playAt(i)
    await new Promise((r) => setTimeout(r, 900))
    const st = __musicTest.playerState()
    if (st.currentPath && st.currentPath !== beforePath) {
      after = readColors()
      playedTitle = st.title
      break
    }
  }
  __musicTest.toggle()
  await new Promise((r) => setTimeout(r, 200))
  return { before, after, playedTitle, changed: JSON.stringify(before) !== JSON.stringify(after) }
})()`)

// ---------- 降级：reduced-motion 关掉漂移 ----------
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await sleep(300)
report.reducedMotion = await evaluate(`(() => {
  const pt = document.querySelector('.capsule-particles .pt')
  return { animationName: getComputedStyle(pt).animationName, animationPlayState: getComputedStyle(pt).animationPlayState }
})()`)

// 静态（reduced-motion）+ 两个不同进度 → 差分截图，定量证明粒子只在已播区间
await evaluate(`(async () => {
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.25)
  await new Promise(r => setTimeout(r, 400))
})()`)
await moveMouse(20, 20)
await sleep(200)
report.diffA = await shotBarExact('dust-diff-25.png')
await evaluate(`(async () => {
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.85)
  await new Promise(r => setTimeout(r, 400))
})()`)
await sleep(200)
report.diffB = await shotBarExact('dust-diff-85.png')
await send('Emulation.setEmulatedMedia', { features: [] })

// ---------- 回归：标准条形态下没有粒子层 ----------
await evaluate(`localStorage.setItem('settings.playerStyle', 'standard')`)
await send('Page.navigate', { url: URL_APP })
await sleep(2600)
report.standardRegression = await evaluate(`({
  hasParticleLayer: !!document.querySelector('.capsule-particles'),
  hasCapsuleClass: document.querySelector('.player-bar').className.includes('capsule'),
  playerStyle: localStorage.getItem('settings.playerStyle'),
})`)

report.consoleErrors = consoleErrors
report.exceptions = exceptions

console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
process.exit(0)
