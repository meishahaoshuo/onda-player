import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9334
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
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
    `--window-size=${W},${H}`,
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

async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const p = path.join(SHOT_DIR, name)
  fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
  return p
}

await send('Runtime.enable')
await send('Page.enable')
/* 强制视口 = 用户截图里的窗口尺寸（--window-size 在 headless 下会扣掉窗口边框） */
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })

/* ---- 注入 Tauri 运行时桩：让 isDesktop 为真，从而渲染自绘标题栏（真实桌面形态） ---- */
const STUB = `
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' } },
  transformCallback: (cb) => { const id = Math.floor(Math.random()*1e9); window['_' + id] = cb; return id },
  unregisterListener: () => {},
  invoke: async (cmd) => {
    if (String(cmd).includes('is_maximized')) return false
    if (String(cmd).includes('is_minimized')) return false
    if (String(cmd).includes('outer_position')) return { x: 100, y: 100 }
    if (String(cmd).includes('inner_size')) return { width: ${W}, height: ${H} }
    return 0
  }
}
`
const stub = await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })

/* ===================== 第一轮：桌面形态 ===================== */
await send('Page.navigate', { url: URL_APP })
await sleep(3800)

const report = {}

const MEASURE = `(() => {
  const q = (s) => document.querySelector(s)
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), cx: +(b.left + b.width/2).toFixed(1), cy: +(b.top + b.height/2).toFixed(1) } }
  const box = q('.search-box')
  const h1 = q('.view-header h1')
  const tb = q('.titlebar')
  const head = q('.view-header')
  const bx = r(box), hx = r(h1), tx = r(tb), hd = r(head)
  return {
    viewport: [window.innerWidth, window.innerHeight],
    windowCenter: +(window.innerWidth / 2).toFixed(1),
    headerRect: hd,
    contentCenter: hd ? +(hd.left + hd.w / 2).toFixed(1) : null,
    search: bx,
    searchCenterDelta: bx && hd ? +(bx.cx - (hd.left + hd.w / 2)).toFixed(2) : null,
    title: hx,
    titleGapToSearch: bx && hx ? +(bx.left - hx.right).toFixed(2) : null,
    titleClipped: h1 ? h1.scrollWidth > h1.clientWidth + 1 : null,
    titleText: h1 ? h1.textContent : null,
    titlebar: tx,
    titlebarButtonCount: document.querySelectorAll('.titlebar .tb-btn').length,
    buttonRects: [...document.querySelectorAll('.titlebar .tb-btn')].map(b => { const x = r(b); return { x: x.x, y: x.y, w: x.w, h: x.h, cy: x.cy } }),
    /* 四者垂直中心是否同轴：品牌 logo / 品牌文字 / 板块标题 / 搜索框 / 窗口控制钮 */
    vAlign: {
      brandLogo: r(q('.brand-logo'))?.cy ?? null,
      brandName: r(q('.brand-name'))?.cy ?? null,
      title: hx?.cy ?? null,
      search: bx?.cy ?? null,
      controls: r(q('.titlebar .tb-controls'))?.cy ?? null,
      firstBtn: r(q('.titlebar .tb-btn'))?.cy ?? null,
    },
    closeFlush: (() => {
      const c = q('.titlebar .tb-close')
      if (!c) return null
      const b = c.getBoundingClientRect()
      return { gapTop: +b.top.toFixed(1), gapRight: +(window.innerWidth - b.right).toFixed(1), gapBottom: +(window.innerHeight - b.bottom).toFixed(1) }
    })(),
    desktopGlass: document.documentElement.classList.contains('desktop-glass'),
    searchRightVsTitlebarLeft: bx && tx ? +(tx.left - bx.right).toFixed(2) : null,
  }
})()`

report.desktop_header = await evaluate(MEASURE)
report.desktop_shot = await shot('01-desktop-header.png')

/* 聚焦态：搜索框加宽后是否吃到标题 */
report.desktop_focus = await evaluate(`(async () => {
  const input = document.querySelector('.search-input')
  input.focus()
  document.querySelector('.search-box').classList.add('__probe')
  await new Promise(r => setTimeout(r, 500))
  const box = document.querySelector('.search-box').getBoundingClientRect()
  const h1 = document.querySelector('.view-header h1').getBoundingClientRect()
  document.querySelector('.search-box').classList.remove('__probe')
  return {
    focusedWidth: +box.width.toFixed(1),
    searchLeft: +box.left.toFixed(1),
    titleRight: +h1.right.toFixed(1),
    gap: +(box.left - h1.right).toFixed(2),
  }
})()`)
report.desktop_focus_shot = await shot('02-desktop-header-focus.png')

await evaluate(`document.querySelector('.search-input').blur()`)

/* 悬停态截图：关闭键（应变红）与最大化键（应为浅色圆角底） */
const btnPts = await evaluate(`(() => {
  const b = [...document.querySelectorAll('.titlebar .tb-btn')].map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), title: e.getAttribute('title') } })
  return b
})()`)
report.buttonPoints = btnPts

if (btnPts.length === 3) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btnPts[2].x, y: btnPts[2].y })
  await sleep(350)
  report.hover_close_style = await evaluate(`(() => {
    const el = document.querySelector('.titlebar .tb-close')
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius }
  })()`)
  report.hover_close_shot = await shot('08-hover-close.png')

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btnPts[1].x, y: btnPts[1].y })
  await sleep(350)
  report.hover_max_style = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.titlebar .tb-btn')][1]
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius }
  })()`)
  report.hover_max_shot = await shot('09-hover-max.png')

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 400 })
  await sleep(200)
}

report.desktop_longtitle = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().activeView = 'favorites'
  await new Promise(r => setTimeout(r, 900))
  const h1 = document.querySelector('.view-header h1')
  const box = document.querySelector('.search-box').getBoundingClientRect()
  const h = h1.getBoundingClientRect()
  const unscrolledWidth = h1.scrollWidth
  return {
    titleText: h1.textContent,
    titleRect: [+h.left.toFixed(1), +h.right.toFixed(1), +h.width.toFixed(1)],
    titleScrollWidth: unscrolledWidth,
    titleClipped: h1.scrollWidth > h1.clientWidth + 1,
    searchLeft: +box.left.toFixed(1),
    gap: +(box.left - h.right).toFixed(2),
    overlap: box.left < h.right,
  }
})()`)
report.desktop_longtitle_shot = await shot('06-desktop-longtitle.png')

report.desktop_longtitle_focus = await evaluate(`(async () => {
  document.querySelector('.search-input').focus()
  await new Promise(r => setTimeout(r, 500))
  const h1 = document.querySelector('.view-header h1')
  const box = document.querySelector('.search-box').getBoundingClientRect()
  const h = h1.getBoundingClientRect()
  return {
    focusedWidth: +box.width.toFixed(1),
    searchLeft: +box.left.toFixed(1),
    titleRight: +h.right.toFixed(1),
    gap: +(box.left - h.right).toFixed(2),
    overlap: box.left < h.right,
  }
})()`)
report.desktop_longtitle_focus_shot = await shot('07-desktop-longtitle-focus.png')

await evaluate(`document.querySelector('.search-input').blur()`)

/* 打开歌词页：标题栏应当消失，歌词页自己的按钮应当可点 */
report.lyrics = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  ui.lyricsOpen = true
  await new Promise(r => setTimeout(r, 900))
  const tools = [...document.querySelectorAll('.top-tools .tool-btn')]
  const probes = tools.map((b) => {
    const r = b.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      title: b.getAttribute('title'),
      rect: [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      topElement: hit ? (hit.closest('.tool-btn') ? 'tool-btn(OK)' : hit.className || hit.tagName) : null,
      clickable: !!(hit && hit.closest('.tool-btn')),
    }
  })
  return {
    lyricsOpen: ui.lyricsOpen,
    titlebarPresent: !!document.querySelector('.titlebar'),
    windowBtnCount: document.querySelectorAll('.tb-btn').length,
    toolProbes: probes,
    allToolsClickable: probes.every((p) => p.clickable),
  }
})()`)
report.lyrics_shot = await shot('03-lyrics-desktop.png')

/* 真的点一次退出按钮，验证能正常关闭歌词页 */
report.lyrics_close = await evaluate(`(async () => {
  const btn = [...document.querySelectorAll('.top-tools .tool-btn')].find(b => b.getAttribute('title') === '退出全屏歌词')
  if (!btn) return { error: '未找到退出按钮' }
  btn.click()
  await new Promise(r => setTimeout(r, 1600))
  const { useUiStore } = await import('/src/stores/ui.ts')
  return {
    lyricsOpenAfterClick: useUiStore().lyricsOpen,
    titlebarBack: !!document.querySelector('.titlebar'),
  }
})()`)
report.after_close_shot = await shot('04-after-lyrics-close.png')

/* ===================== 第二轮：浏览器形态（移除桩） ===================== */
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stub.identifier })
await send('Page.navigate', { url: URL_APP })
await sleep(3200)

report.web_header = await evaluate(MEASURE)
report.web_hasTitlebar = await evaluate(`!!document.querySelector('.titlebar')`)
report.web_shot = await shot('05-web-header.png')

report.consoleErrors = consoleErrors
report.exceptions = exceptions
report.shotDir = SHOT_DIR

console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
process.exit(0)
