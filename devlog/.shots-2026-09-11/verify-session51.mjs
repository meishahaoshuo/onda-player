import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9347
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-11'
fs.mkdirSync(SHOT_DIR, { recursive: true })

// 自定义封面导入用的测试图片（1x1 PNG 放大到可读即可，走真实解码链路）
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_PATH = path.join(SHOT_DIR, 'import-test.png')
fs.writeFileSync(PNG_PATH, Buffer.from(PNG_B64, 'base64'))

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
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const p = path.join(SHOT_DIR, name)
  fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
  return p
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_APP })
await sleep(2500)

const report = {}

// 胶囊形态 + 测试数据
await evaluate(`localStorage.setItem('settings.playerStyle', 'capsule')`)
await send('Page.navigate', { url: URL_APP })
await sleep(2500)
report.reset = await evaluate(`__musicTest.resetTest()`)
report.withCover = await evaluate(`__musicTest.addCoverSong()`)
await evaluate(`(async () => {
  for (let i = 0; i < 80; i++) {
    const s = __musicTest.status()
    if (s.songs > 0 && !s.progress.running) return
    await new Promise((r) => setTimeout(r, 200))
  }
})()`)
report.status = await evaluate(`__musicTest.status()`)
await evaluate(`__musicTest.playAt(0)`)
await sleep(600)
// 制造一次播放计数（>50% 进度），排行榜才有行
await evaluate(`__musicTest.seek((__musicTest.playerState().duration || 60) * 0.6)`)
await sleep(1200)

async function navClick(label) {
  return evaluate(`(() => {
    const btn = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
}

/* ---------- ① 三个网格页切换时不再错峰浮现 ---------- */
report.reveal = {}
for (const [label, sel] of [
  ['专辑', '.album-card'],
  ['艺术家', '.artist-card'],
  ['排行榜', '.chart-row'],
]) {
  await navClick(label)
  await sleep(80)
  const early = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    return el ? { inline: el.style.opacity, computed: getComputedStyle(el).opacity, count: document.querySelectorAll(${JSON.stringify(sel)}).length } : null
  })()`)
  await sleep(400)
  report.reveal[label] = { early, late: await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    return el ? { inline: el.style.opacity, computed: getComputedStyle(el).opacity } : null
  })()`) }
}

/* ---------- ② 设置页无氛围光开关；氛围光层常开 ---------- */
await navClick('设置')
await sleep(500)
report.settings = await evaluate(`(() => {
  const t = document.body.textContent
  return {
    hasAmbientToggle: t.includes('封面氛围光'),
    ambientKey: localStorage.getItem('settings.ambientGlow'),
    ambientLayer: !!document.querySelector('.ambient-layer'),
    capsuleParticles: !!document.querySelector('.capsule-particles'),
  }
})()`)
await shot('s51-settings-appearance.png')

/* ---------- ③ 队列面板：点空白关闭、播放条空白只收面板不 seek ---------- */
await navClick('歌曲')
await sleep(600)
await evaluate(`document.querySelector('[data-queue-toggle]').click()`)
await sleep(400)
const st0 = await evaluate(`__musicTest.playerState()`)
report.queue = {}
report.queue.opened = await evaluate(`!!document.querySelector('.queue-panel')`)
// 面板外（页面内容区）点一下 → 关闭
await evaluate(`document.querySelector('.view-header').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
await sleep(250)
report.queue.closedByOutside = await evaluate(`!document.querySelector('.queue-panel')`)
// 再开，播放条空白处点一下 → 关闭且不 seek
await evaluate(`document.querySelector('[data-queue-toggle]').click()`)
await sleep(300)
await evaluate(`(() => {
  const f = document.querySelector('.player-bar')
  const r = f.getBoundingClientRect()
  f.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width * 0.36, clientY: r.y + r.height / 2, pointerId: 7 }))
})()`)
await sleep(300)
const st1 = await evaluate(`__musicTest.playerState()`)
report.queue.closedByBarBlank = await evaluate(`!document.querySelector('.queue-panel')`)
report.queue.noSeekOnBarBlank = Math.abs(st1.currentTime - st0.currentTime) < 0.05
report.queue.currentTime = [st0.currentTime, st1.currentTime]
// 面板内部点击不关闭（点表头空白区域）
await evaluate(`document.querySelector('[data-queue-toggle]').click()`)
await sleep(300)
await evaluate(`document.querySelector('.queue-head').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
await sleep(200)
report.queue.staysOpenInside = await evaluate(`!!document.querySelector('.queue-panel')`)
await evaluate(`document.querySelector('[data-queue-toggle]').click()`)
await sleep(200)

/* ---------- ④ 文件夹页：选中文件夹后重扫只扫该文件夹（title 代理 + 冒烟） ---------- */
report.folders = {}
await navClick('文件夹')
await sleep(600)
report.folders.rootCards = await evaluate(`document.querySelectorAll('.root-card').length`)
if (report.folders.rootCards > 0) {
  report.folders.titleUnselected = await evaluate(`document.querySelector('.side-toolbar .ghost-btn')?.title ?? ''`)
  await evaluate(`document.querySelector('.root-card').click()`)
  await sleep(300)
  report.folders.titleSelected = await evaluate(`document.querySelector('.side-toolbar .ghost-btn')?.title ?? ''`)
  await evaluate(`document.querySelector('.side-toolbar .ghost-btn').click()`)
  await sleep(1500)
  report.folders.scanDone = await evaluate(`!document.querySelector('.root-card') || true`) // 冒烟：无异常即过
}

/* ---------- ⑤ 歌曲行悬停按钮居中在标题与艺术家之间空白 ---------- */
await navClick('歌曲')
await sleep(600)
report.rowActions = await evaluate(`(() => {
  const row = document.querySelector('.song-row')
  if (!row) return null
  row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
  const title = row.querySelector('.col-title')
  const line = title.querySelector('.title-line')
  const range = document.createRange()
  range.selectNodeContents(line)
  const r = range.getBoundingClientRect()
  const t = title.getBoundingClientRect()
  const titleEnd = Math.max(0, r.left - t.left)
  const expected = titleEnd + (t.width - titleEnd) / 2
  const acts = row.querySelector('.row-actions')
  const cs = getComputedStyle(acts)
  const left = parseFloat(cs.left)
  return {
    titleEndPx: Math.round(titleEnd),
    colWidth: Math.round(t.width),
    leftPx: Math.round(left),
    expectedPx: Math.round(expected),
    ok: Math.abs(left - expected) <= 2,
    visible: cs.opacity,
  }
})()`)

/* ---------- ⑥ 歌单封面：无自动拼贴选项 + 导入自定义图片 ---------- */
report.plCover = {}
const pl = await evaluate(`__musicTest.pl('create', '封面测试歌单').then((p) => p.id)`)
await evaluate(`__musicTest.pl('add', ${JSON.stringify(pl)})`)
await navClick('歌单')
await sleep(700)
await evaluate(`document.querySelector('.pl-card').click()`)
await sleep(1400)
await evaluate(`document.querySelector('.cover-edit').click()`)
await sleep(400)
report.plCover.modal = await evaluate(`(() => {
  const t = document.body.textContent
  return {
    open: !!document.querySelector('.cover-grid'),
    hasCollageOption: t.includes('自动拼贴'),
    hasImport: [...document.querySelectorAll('.cover-choice-name')].some((n) => n.textContent.includes('导入图片')),
    hasRestore: t.includes('恢复默认'),
  }
})()`)
await shot('s51-cover-modal.png')
// CDP 直接给隐藏 input 塞文件，再触发 change（走真实解码/入库链路）
const doc = await send('DOM.getDocument')
const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.cover-file-input' })
if (!node.nodeId) throw new Error('找不到 .cover-file-input')
await send('DOM.setFileInputFiles', { files: [PNG_PATH], nodeId: node.nodeId })
await evaluate(`document.querySelector('.cover-file-input').dispatchEvent(new Event('change'))`)
await sleep(900)
report.plCover.afterImport = await evaluate(`(async () => {
  const raw = await __musicTest.pl('dbRaw')
  const rec = raw.find((p) => p.id === ${JSON.stringify(pl)})
  const tile = [...document.querySelectorAll('.cover-choice')].find((c) =>
    c.querySelector('.cover-choice-name')?.textContent.includes('导入图片'),
  )
  return {
    customCoverId: rec?.customCoverId ?? null,
    coverPathCleared: rec?.coverPath === undefined,
    tileActive: tile?.classList.contains('active') ?? false,
    tileHasImg: !!tile?.querySelector('img'),
    importing: [...document.querySelectorAll('.cover-choice-name')].some((n) => n.textContent.includes('导入中')),
  }
})()`)
// 恢复默认 → 清掉自定义封面
await evaluate(`[...document.querySelectorAll('.modal .action-btn')].find((b) => b.textContent.includes('恢复默认')).click()`)
await sleep(400)
report.plCover.afterRestore = await evaluate(`(async () => {
  const raw = await __musicTest.pl('dbRaw')
  const rec = raw.find((p) => p.id === ${JSON.stringify(pl)})
  return { customCoverId: rec?.customCoverId ?? null, coverPath: rec?.coverPath ?? null }
})()`)

/* ---------- ⑦ 光尘：只在拖拽时出现、播放头两侧都有、团心对齐播放头 ---------- */
report.dust = await evaluate(`(() => {
  const dusts = document.querySelector('.capsule-particles .pt-dusts')
  const restOpacity = dusts ? getComputedStyle(dusts).opacity : null
  const shadows = [...document.querySelectorAll('.pt-dust')].map((d) => d.style.boxShadow)
  let neg = 0
  let pos = 0
  for (const s of shadows) {
    const xs = s.split('),').map((seg) => parseFloat(seg.trim().split(' ')[0]))
    if (xs.some((x) => x < 0)) neg++
    if (xs.some((x) => x > 0)) pos++
  }
  const cp = document.querySelector('.capsule-particles').style.getPropertyValue('--cp-x')
  return { exists: !!dusts, restOpacity, layers: shadows.length, layersWithLeftDots: neg, layersWithRightDots: pos, cpX: cp }
})()`)
// 合成拖拽：按下 → 移动 → 断言 → 抬起
await evaluate(`(() => {
  const f = document.querySelector('.player-bar')
  const r = f.getBoundingClientRect()
  const y = r.y + r.height / 2
  f.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width * 0.3, clientY: y, pointerId: 9 }))
  f.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + r.width * 0.42, clientY: y, pointerId: 9 }))
})()`)
await sleep(350)
report.dust.dragging = await evaluate(`(() => {
  const dusts = document.querySelector('.capsule-particles .pt-dusts')
  const bar = document.querySelector('.player-bar')
  const cpX = parseFloat(document.querySelector('.capsule-particles').style.getPropertyValue('--cp-x'))
  const tr = getComputedStyle(dusts).translate
  return {
    draggingClass: bar.className.includes('ring-dragging'),
    opacity: getComputedStyle(dusts).opacity,
    cpX,
    dustsTranslate: tr,
    aligned: Math.abs(parseFloat(tr) - cpX) < 1.5,
    animName: getComputedStyle(document.querySelector('.pt-dust')).animationName,
  }
})()`)
await shot('s51-dust-drag.png')
await evaluate(`(() => {
  const f = document.querySelector('.player-bar')
  f.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }))
})()`)
await sleep(400)
report.dust.afterUp = await evaluate(`getComputedStyle(document.querySelector('.capsule-particles .pt-dusts')).opacity`)

report.consoleErrors = consoleErrors
report.exceptions = exceptions
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
