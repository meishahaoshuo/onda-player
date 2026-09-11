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
// 随机漫游：同一层的 transform 随时间变化，且各层同时刻的 transform 互不相同
report.flow = await evaluate(`(async () => {
  const d = document.querySelector('.pt-dust')
  const cs = getComputedStyle(d)
  const a = cs.transform
  const anim = cs.animationName
  await new Promise((r) => setTimeout(r, 1200))
  const b = getComputedStyle(d).transform
  const all = [...document.querySelectorAll('.pt-dust')].map((x) => getComputedStyle(x).transform)
  const distinct = new Set(all).size
  return { animationName: anim, a, b, flowing: a !== b, layers: all.length, distinctTransforms: distinct }
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

// ---------- 点/拖：空白处可用，控件不抢；光尘只在拖拽时出现在播放头附近 ----------
const geo = await barGeo()
const blankY = geo.y + 34 /* 条中部：标题/艺术家右侧的空白带 */
const playBtnX = geo.x + geo.w * 0.5 /* 中间播放键（控件） */
const coverX = geo.x + 40 /* 左侧封面（控件） */

await evaluate(`(async () => {
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.42)
  await new Promise((r) => setTimeout(r, 420))
})()`)

// 常态：无光尘、无辉光、空白处是「抓手」光标
report.restState = await evaluate(`(() => ({
  dustOpacity: getComputedStyle(document.querySelector('.pt-dusts')).opacity,
  glowOpacity: getComputedStyle(document.querySelector('.player-bar'), '::after').opacity,
  glowShadow: getComputedStyle(document.querySelector('.player-bar'), '::after').boxShadow,
  barCursor: getComputedStyle(document.querySelector('.player-bar')).cursor,
  bandCursor: getComputedStyle(document.querySelector('.capsule-progress')).cursor,
}))()`)

// 点空白处 → 跳到该位置
const tBlankBefore = await evaluate(`__musicTest.playerState().currentTime`)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(geo.x + geo.w * 0.7), y: Math.round(blankY), button: 'left', clickCount: 1, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(geo.x + geo.w * 0.7), y: Math.round(blankY), button: 'left', buttons: 0 })
await sleep(360)
const tBlankAfter = await evaluate(`__musicTest.playerState().currentTime`)
report.blankClick = { before: tBlankBefore, after: tBlankAfter, seeked: tBlankAfter > tBlankBefore + 0.2 }

// 点控件（模式按钮：只切播放模式、不影响时钟）→ 绝不能 seek
await evaluate(`(async () => {
  const st = __musicTest.playerState()
  __musicTest.seek(st.duration * 0.42)
  await new Promise((r) => setTimeout(r, 420))
})()`)
const btn = await evaluate(
  `(() => { const b = document.querySelector('.player-bar .controls .icon-btn').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } })()`,
)
const tCtrlBefore = await evaluate(`__musicTest.playerState().currentTime`)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', buttons: 0 })
await sleep(300)
const ctrlState = await evaluate(`(() => { const s = __musicTest.playerState(); return { t: s.currentTime, playing: s.playing } })()`)
report.controlClick = {
  before: tCtrlBefore,
  after: ctrlState.t,
  noSeek: Math.abs(ctrlState.t - tCtrlBefore) < 0.08,
  stillPaused: !ctrlState.playing,
}

// 从空白处按下并横移 → 进入拖拽：进度跟手、光尘团出现并挂在播放头、整条发光、光标变抓住
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(geo.x + geo.w * 0.42), y: Math.round(blankY), button: 'left', clickCount: 1, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(geo.x + geo.w * 0.72), y: Math.round(blankY), button: 'left', buttons: 1 })
await sleep(280)
report.dragging = await evaluate(`(() => {
  const bar = document.querySelector('.player-bar')
  const layer = document.querySelector('.capsule-particles')
  const dusts = document.querySelector('.pt-dusts')
  const lr = layer.getBoundingClientRect()
  return {
    ringDragging: bar.className.includes('ring-dragging'),
    cpP: layer.style.getPropertyValue('--cp-p'),
    dustOpacity: getComputedStyle(dusts).opacity,
    dustTranslateX: Math.round(parseFloat(dusts.getBoundingClientRect().x - lr.x)),
    headX: Math.round(parseFloat(layer.style.getPropertyValue('--cp-x')) || 0),
    glowOpacity: getComputedStyle(bar, '::after').opacity,
    glowShadow: getComputedStyle(bar, '::after').boxShadow,
    cursor: getComputedStyle(bar).cursor,
  }
})()`)
report.shotLightDrag = await shot('dust-light-drag.png')
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(geo.x + geo.w * 0.72), y: Math.round(blankY), button: 'left', buttons: 0 })
await sleep(320)
report.afterRelease = await evaluate(`(() => ({
  dustOpacity: getComputedStyle(document.querySelector('.pt-dusts')).opacity,
  glowOpacity: getComputedStyle(document.querySelector('.player-bar'), '::after').opacity,
}))()`)

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
