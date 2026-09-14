/**
 * 方案 D 图标改版验收：
 *  1) 五个图标（歌单/新建歌单/顺序播放/播放队列/排序）的真实 in-situ 特写
 *  2) 「图标体检台」——按出货参数在 18 / 14 / 12px 三档真实渲染，检查小尺寸可辨性
 *  3) 程序化断言：五个 path 两两不同（防再次撞脸）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9341
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-icons-'))

const proc = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, '--no-first-run',
   '--no-default-browser-check', '--mute-audio', '--no-proxy-server', `--window-size=${W},${H}`, URL_APP],
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
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception')
}
const send = (method, params = {}) => {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => { pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result))) })
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'))
}
/** 局部特写：clip 用 CSS 像素，scale 放大以便肉眼比对笔画 */
const shotClip = async (name, r, scale = 4) => {
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale },
  })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
/* headless 默认 prefers-reduced-motion:reduce，会拦掉全部动效过渡 */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

const STUB = `
(() => {
  const orig = window.matchMedia.bind(window)
  window.matchMedia = (q) => (String(q).includes('prefers-reduced-motion') ? { matches: false, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, onchange: null } : orig(q))
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' } },
    transformCallback: (cb) => { const i = Math.floor(Math.random() * 1e9); window['_' + i] = cb; return i },
    unregisterListener: () => {},
    invoke: async (c) => {
      const s = String(c)
      if (s.includes('is_maximized') || s.includes('is_minimized')) return false
      if (s.includes('outer_position')) return { x: 100, y: 100 }
      if (s.includes('inner_size')) return { width: ${W}, height: ${H} }
      return 0
    },
  }
})()`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(4600)

const report = {}

/* ---------- 造数据：注入 4 张合成专辑 + 一个有歌的歌单 ---------- */
report.setup = await evaluate(`(async () => {
  await window.__musicTest.stressAlbums(6)
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const { usePlaylistStore } = await import('/src/stores/playlist.ts')
  const lib = useLibraryStore()
  const pl = usePlaylistStore()
  const existing = pl.playlists.find((p) => p.name === '验证歌单')
  const paths = lib.songs.slice(0, 8).map((s) => s.path)
  if (existing) pl.addSongs(existing.id, paths)
  else pl.create('验证歌单', paths)
  await new Promise((r) => setTimeout(r, 400))
  return { songs: lib.songs.length, playlists: pl.playlists.length }
})()`)

const R = `(el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } }`

/* ---------- 1. 侧栏：歌单 + 新建歌单（上下紧挨，最易误触的一对） ---------- */
report.sidebar = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().activeView = 'albums'
  await new Promise((r) => setTimeout(r, 600))
  const r = ${R}
  const btns = [...document.querySelectorAll('.sidebar .nav-item')]
  const list = btns.find((b) => b.textContent.trim() === '歌单')
  const add = document.querySelector('.sidebar .add-playlist')
  if (add) { add.style.opacity = '1'; add.style.transform = 'none' }  /* 「+」常态 opacity:0，悬停 section-head 才显形；审计图强制显示 */
  await new Promise((r) => setTimeout(r, 300))
  const svgOf = (el) => el?.querySelector('svg')
  return {
    listRect: r(list),
    addRect: r(add),
    gapX: list && add ? Math.round(add.getBoundingClientRect().left - list.getBoundingClientRect().right) : null,
    listPath: svgOf(list)?.innerHTML ?? null,
    addPath: svgOf(add)?.innerHTML ?? null,
    sameShape: svgOf(list)?.innerHTML === svgOf(add)?.innerHTML,
  }
})()`)
if (report.sidebar.listRect) {
  const a = report.sidebar.listRect
  const b = report.sidebar.addRect
  await shotClip('60-icons-sidebar.png', { x: a.x - 8, y: a.y - 6, w: (b.x + b.w) - a.x + 16, h: b.y + b.h - a.y + 12 }, 5)
}

/* ---------- 2. 播放条：播放模式 + 播放队列 ---------- */
report.playerbar = await evaluate(`(() => {
  const r = ${R}
  const mode = document.querySelector('.player-bar .buttons .icon-btn')
  const queue = document.querySelector('[data-queue-toggle]')
  return {
    modeTitle: mode?.getAttribute('title'),
    modeRect: r(mode),
    queueRect: r(queue),
    modePath: mode?.querySelector('svg')?.innerHTML ?? null,
    queuePath: queue?.querySelector('svg')?.innerHTML ?? null,
  }
})()`)
if (report.playerbar.modeRect) {
  const m = report.playerbar.modeRect
  const q = report.playerbar.queueRect
  await shotClip('61-icons-playerbar.png', { x: m.x - 6, y: m.y - 6, w: q.x + q.w - m.x + 12, h: m.h + 12 }, 5)
}

/* ---------- 3. 右键菜单：添加到歌单（方框加号） + 歌单子项（书架） ----------
   menuState 是模块级 ref，直接调 openSongMenu 即可，不必依赖某一行渲染出来 */
report.contextMenu = await evaluate(`(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const { useSongActions } = await import('/src/composables/useSongActions.ts')
  const song = useLibraryStore().songs[0]
  if (!song) return { opened: false, why: 'empty library' }
  useSongActions().openSongMenu(new MouseEvent('contextmenu', { clientX: 400, clientY: 300 }), song)
  await new Promise((r) => setTimeout(r, 600))
  const menu = document.querySelector('.song-menu')
  if (!menu) return { opened: false, why: 'no .song-menu' }
  const sub = menu.querySelector('.menu-sub-wrap > .menu-item')
  if (!sub) return { opened: false, why: 'no submenu trigger' }
  const addPath = sub.querySelector('svg')?.innerHTML ?? null
  sub.click()
  await new Promise((r) => setTimeout(r, 600))
  const submenu = menu.querySelector('.submenu')
  const item = submenu?.querySelector('.sub-item')
  const second = submenu?.querySelectorAll('.sub-item')[1]
  const rr = menu.getBoundingClientRect()
  return {
    opened: true,
    addPath,
    submenuShown: !!submenu,
    subItemPath: item?.querySelector('svg')?.innerHTML ?? null,
    subItemText: item?.textContent?.trim() ?? null,
    secondItemText: second?.textContent?.trim() ?? null,
    rect: (() => { const sr = submenu ? submenu.getBoundingClientRect() : null; const right = sr ? Math.max(rr.right, sr.right) : rr.right; const bottom = sr ? Math.max(rr.bottom, sr.bottom) : rr.bottom; return { x: Math.round(rr.left) - 8, y: Math.round(rr.top) - 8, w: Math.round(right - rr.left) + 16, h: Math.round(bottom - rr.top) + 16 } })(),
  }
})()`)
if (report.contextMenu.opened) {
  await shotClip('62-icons-contextmenu.png', report.contextMenu.rect, 3)
  await evaluate(`import('/src/composables/useSongActions.ts').then((m) => m.useSongActions().closeSongMenu())`)
}

/* ---------- 3b. 顺序播放：切到该模式后拍 in-situ 实景 ---------- */
report.orderMode = await evaluate(`(async () => {
  const { usePlayerStore } = await import('/src/stores/player.ts')
  const r = ${R}
  usePlayerStore().setPlayMode('order')
  await new Promise((r) => setTimeout(r, 700))
  const mode = document.querySelector('.player-bar .buttons .icon-btn')
  const queue = document.querySelector('[data-queue-toggle]')
  return {
    title: mode?.getAttribute('title'),
    modeRect: r(mode),
    queueRect: r(queue),
    modePath: mode?.querySelector('svg')?.innerHTML ?? null,
  }
})()`)
if (report.orderMode.modeRect) {
  const m = report.orderMode.modeRect
  const q = report.orderMode.queueRect
  await shotClip('66-icons-ordermode.png', { x: m.x - 6, y: m.y - 6, w: q.x + q.w - m.x + 12, h: m.h + 12 }, 5)
}

/* ---------- 4. 歌单详情：排序按钮（新 sort 图标） ---------- */
report.sortBtn = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { usePlaylistStore } = await import('/src/stores/playlist.ts')
  const ui = useUiStore()
  const pl = usePlaylistStore()
  ui.activeView = 'playlists'
  ui.detailKey = pl.playlists.find((p) => p.name === '验证歌单')?.id ?? null
  document.body.click()
  await new Promise((r) => setTimeout(r, 900))
  const btn = document.querySelector('.sort-btn')
  if (!btn) return { found: false }
  const b = btn.getBoundingClientRect()
  return {
    found: true,
    text: btn.textContent.trim(),
    iconPath: btn.querySelector('svg')?.innerHTML ?? null,
    rect: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
  }
})()`)
await shot('63-playlists-sort.png')
if (report.sortBtn.found) {
  await shotClip('64-icons-sort.png', report.sortBtn.rect, 5)
}

/* ---------- 5. 图标体检台：五个图标在 18/14/12px 的真实渲染 ---------- */
report.audit = await evaluate(`(async () => {
  const { iconPaths } = await import('/src/components/icons.ts')
  const names = ['playlist', 'playlistAdd', 'order', 'queue', 'sort']
  const labels = { playlist: '歌单', playlistAdd: '新建歌单', order: '顺序播放', queue: '播放队列', sort: '排序' }
  const sizes = [18, 14, 12]
  const host = document.createElement('div')
  host.id = 'icon-audit'
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#0a0a0a;color:#fff;padding:22px 26px;font:12px/1.2 -apple-system,"Segoe UI",sans-serif;display:flex;gap:34px;align-items:flex-start'
  for (const n of names) {
    const col = document.createElement('div')
    col.style.cssText = 'display:flex;flex-direction:column;gap:14px;align-items:flex-start'
    for (const s of sizes) {
      const cell = document.createElement('div')
      cell.style.cssText = 'display:flex;align-items:center;gap:12px'
      cell.innerHTML = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="#c8d2ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconPaths[n] + '</svg>' +
        '<span style="color:#7d879c;font-size:11px;width:40px">' + s + 'px</span>'
      col.appendChild(cell)
    }
    const cap = document.createElement('div')
    cap.textContent = labels[n]
    cap.style.cssText = 'color:#8fa0c0;font-size:12px;margin-top:2px'
    col.appendChild(cap)
    host.appendChild(col)
  }
  document.body.appendChild(host)
  await new Promise((r) => setTimeout(r, 300))
  const b = host.getBoundingClientRect()
  const paths = names.map((n) => iconPaths[n])
  return {
    rect: { x: 0, y: 0, w: Math.round(b.width), h: Math.round(b.height) },
    paths,
    allDistinct: new Set(paths).size === paths.length,
  }
})()`)
await shotClip('65-icons-audit.png', report.audit.rect, 2)

report.consoleErrors = await evaluate(`(() => window.__consoleErrors ?? [])`).catch(() => [])
report.exceptions = errors
console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
