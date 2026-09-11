import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9345
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

const ws = new WebSocket(await getWsUrl())
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
    exceptions.push(msg.params.exceptionDetails?.exception?.description ?? 'exception')
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
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
  if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
async function barGeo() {
  return evaluate(
    `(() => { const b = document.querySelector('.player-bar').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })()`,
  )
}
async function shot(name) {
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

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_APP })
await sleep(2500)

const report = {}

// 新 profile 默认「标准条」；切成用户实际使用的胶囊形态
await evaluate(`localStorage.setItem('settings.playerStyle', 'capsule')`)
await send('Page.navigate', { url: URL_APP })
await sleep(2500)

report.songs = await evaluate(`__musicTest.resetTest()`)
report.withCover = await evaluate(`__musicTest.addCoverSong()`)
await evaluate(`(async () => {
  for (let i = 0; i < 60; i++) {
    const s = __musicTest.status()
    if (s.songs > 0 && !s.progress.running) return
    await new Promise((r) => setTimeout(r, 200))
  }
})()`)
await evaluate(`__musicTest.playAt(0)`)
await sleep(800)
report.playing = await evaluate(`(() => {
  const d = document.querySelector('.pt-dust')
  return { barPaused: document.querySelector('.player-bar').className.includes('bar-paused'), playState: getComputedStyle(d).animationPlayState }
})()`)
// 定向流动：播放中同一层的光尘 transform 必须随时间变化
report.flow = await evaluate(`(async () => {
  const d = document.querySelector('.pt-dust')
  const cs = getComputedStyle(d)
  const a = cs.transform
  const anim = cs.animationName
  await new Promise((r) => setTimeout(r, 1200))
  const b = getComputedStyle(d).transform
  return { animationName: anim, a, b, flowing: a !== b }
})()`)
report.seeked = await evaluate(`(async () => {
  __musicTest.toggle()
  await new Promise((r) => setTimeout(r, 220))
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.42)
  await new Promise((r) => setTimeout(r, 420))
  return __musicTest.playerState()
})()`)

// ---------- 结构 / 令牌断言 ----------
report.audit = await evaluate(`(() => {
  const layer = document.querySelector('.capsule-particles')
  const field = document.querySelector('.pt-field')
  const wash = document.querySelector('.pt-wash')
  const dusts = [...document.querySelectorAll('.capsule-particles .pt-dust')]
  const cs = getComputedStyle(layer)
  const dotsPerLayer = dusts.map((d) => getComputedStyle(d).boxShadow.split(/,(?![^(]*\\))/).length)
  return {
    // 已被否掉的东西必须彻底消失
    removedClean:
      !document.querySelector('.pt-streak') &&
      !document.querySelector('.pt-ride') &&
      !document.querySelector('.pt-sweep') &&
      !document.querySelector('.pt-halo') &&
      !document.querySelector('.capsule-particles .pt'),
    layers: dusts.length,
    dotsPerLayer,
    dotTotal: dotsPerLayer.reduce((a, b) => a + b, 0),
    zIndex: cs.zIndex,
    borderRadius: cs.borderRadius,
    overflow: cs.overflow,
    pointerEvents: cs.pointerEvents,
    maskImage: getComputedStyle(field).maskImage,
    ptFall: getComputedStyle(field).getPropertyValue('--pt-fall').trim(),
    wash: { exists: !!wash, opacity: getComputedStyle(wash).opacity },
    cpP: Number(layer.style.getPropertyValue('--cp-p')),
    fc: layer.style.getPropertyValue('--fc').trim(),
    // 光尘实际画出来的颜色（在 .pt-dust 上取，不能用 body 探针 —— 那是 :root 的兜底值）
    dustShadow: getComputedStyle(dusts[0]).boxShadow.slice(0, 80),
    dustSizeSource: getComputedStyle(dusts[0]).width,
    dustBlur: getComputedStyle(document.documentElement).getPropertyValue('--dust-blur').trim(),
    dustSpread: getComputedStyle(document.documentElement).getPropertyValue('--dust-spread').trim(),
    dustOpacity: getComputedStyle(document.documentElement).getPropertyValue('--dust-opacity').trim(),
    noFilter: cs.filter === 'none' && getComputedStyle(dusts[0]).filter === 'none',
  }
})()`)

report.shotLightRest = await shot('dust-light-rest.png')
{
  const s = await send('Page.captureScreenshot', { format: 'png' })
  report.shotLightPage = path.join(SHOT_DIR, 'dust-light-page-1x.png')
  fs.writeFileSync(report.shotLightPage, Buffer.from(s.data, 'base64'))
}

// ---------- 拖拽：只在顶端边框生效，且必须真的横向拖动 ----------
const geo = await barGeo()
const edgeY = geo.y + 2 /* 顶端边框细带（top:-3px / height:9px） */
const midY = geo.y + 34 /* 条中部：按钮/文字区，绝不该开始拖拽 */

await evaluate(`(async () => {
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.42)
  await new Promise((r) => setTimeout(r, 420))
})()`)

// 误触 1：在顶端边框点一下（不移动）→ 进度不动
const tBefore = await evaluate(`__musicTest.playerState().currentTime`)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(geo.x + geo.w * 0.8), y: Math.round(edgeY), button: 'left', clickCount: 1, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(geo.x + geo.w * 0.8), y: Math.round(edgeY), button: 'left', buttons: 0 })
await sleep(320)
const tAfter = await evaluate(`__musicTest.playerState().currentTime`)
report.edgeTap = { before: tBefore, after: tAfter, noSeek: Math.abs(tAfter - tBefore) < 0.08 }

// 误触 2：在条中部横向拖动 → 不进入拖拽
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(geo.x + geo.w * 0.3), y: Math.round(midY), button: 'left', clickCount: 1, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(geo.x + geo.w * 0.6), y: Math.round(midY), button: 'left', buttons: 1 })
await sleep(260)
report.midDrag = await evaluate(`(() => ({
  ringDragging: document.querySelector('.player-bar').className.includes('ring-dragging'),
  cpP: Number(document.querySelector('.capsule-particles').style.getPropertyValue('--cp-p')),
}))()`)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(geo.x + geo.w * 0.6), y: Math.round(midY), button: 'left', buttons: 0 })
await sleep(200)

// 真拖：从顶端边框按下并横移 → 必须生效且精确落位
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(geo.x + geo.w * 0.42), y: Math.round(edgeY), button: 'left', clickCount: 1, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(geo.x + geo.w * 0.72), y: Math.round(edgeY), button: 'left', buttons: 1 })
await sleep(280)
report.dragging = await evaluate(`(() => {
  const bar = document.querySelector('.player-bar')
  const layer = document.querySelector('.capsule-particles')
  return { ringDragging: bar.className.includes('ring-dragging'), cpP: layer.style.getPropertyValue('--cp-p') }
})()`)
report.shotLightDrag = await shot('dust-light-drag.png')
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(geo.x + geo.w * 0.72), y: Math.round(edgeY), button: 'left', buttons: 0 })
await sleep(220)

// ---------- 深色主题 ----------
await evaluate(`(async () => {
  document.documentElement.setAttribute('data-theme', 'dark')
  await new Promise((r) => setTimeout(r, 500))
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.42)
  await new Promise((r) => setTimeout(r, 420))
})()`)
report.shotDarkRest = await shot('dust-dark-rest.png')
report.darkAudit = await evaluate(`(() => {
  const layer = document.querySelector('.capsule-particles')
  const d = document.querySelector('.pt-dust')
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    dustShadow: getComputedStyle(d).boxShadow.slice(0, 90),
    dustBlur: getComputedStyle(document.documentElement).getPropertyValue('--dust-blur').trim(),
    cpP: layer.style.getPropertyValue('--cp-p'),
  }
})()`)

// ---------- 换歌换色：氛围光与光尘颜色应随封面改变 ----------
report.bulk = await evaluate(`__musicTest.addBulkSongs(2)`)
await evaluate(`(async () => {
  for (let i = 0; i < 60; i++) {
    const s = __musicTest.status()
    if (s.songs > 0 && !s.progress.running) return
    await new Promise((r) => setTimeout(r, 200))
  }
})()`)
const beforeFc = await evaluate(`document.querySelector('.capsule-particles').style.getPropertyValue('--fc')`)
const beforePath = await evaluate(`__musicTest.playerState().currentPath`)
let afterFc = beforeFc
let playedTitle = null
for (let i = 0; i < 6; i++) {
  await evaluate(`__musicTest.playAt(${i})`)
  await sleep(1200)
  const st = await evaluate(`(() => { const s = __musicTest.playerState(); return { path: s.currentPath, title: s.title } })()`)
  if (st.path && st.path !== beforePath) {
    playedTitle = st.title
    afterFc = await evaluate(`document.querySelector('.capsule-particles').style.getPropertyValue('--fc')`)
    break
  }
}
report.colorSwitch = { before: beforeFc, after: afterFc, playedTitle, changed: beforeFc !== afterFc }
await evaluate(`(async () => { __musicTest.toggle(); await new Promise((r) => setTimeout(r, 200)) })()`)

// ---------- 降级：reduced-motion 关掉漂移与呼吸；暂停即停 ----------
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await sleep(300)
report.reducedMotion = await evaluate(`(() => {
  const d = document.querySelector('.pt-dust')
  return { animationName: getComputedStyle(d).animationName, opacity: getComputedStyle(d).opacity }
})()`)
await send('Emulation.setEmulatedMedia', { features: [] })
await sleep(200)
report.pausedState = await evaluate(`(() => {
  const d = document.querySelector('.pt-dust')
  return {
    barPaused: document.querySelector('.player-bar').className.includes('bar-paused'),
    playState: getComputedStyle(d).animationPlayState,
    dustDim: getComputedStyle(document.querySelector('.capsule-particles')).getPropertyValue('--dust-dim').trim(),
  }
})()`)

// ---------- 回归：标准条形态下没有特效层 ----------
await evaluate(`localStorage.setItem('settings.playerStyle', 'standard')`)
await send('Page.navigate', { url: URL_APP })
await sleep(2600)
report.standardRegression = await evaluate(`({
  hasFxLayer: !!document.querySelector('.capsule-particles'),
  hasCapsuleClass: document.querySelector('.player-bar').className.includes('capsule'),
})`)

report.consoleErrors = consoleErrors
report.exceptions = exceptions
console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
process.exit(0)
