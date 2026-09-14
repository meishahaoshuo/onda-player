/**
 * 歌单图标改「磁带」验收：
 *  1) 侧栏「歌单」行与右侧「新建歌单」的紧邻对比（两者同为圆角矩形，这是最大风险点）
 *  2) 右键菜单子项 14px
 *  3) 深浅双主题
 *  4) 与侧栏邻居并排的体检台（歌曲/专辑/文件夹/新建/队列）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9343
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-tape-'))

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
const shotClip = async (name, r, scale = 4) => {
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale } })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
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
    invoke: async (c) => { const s = String(c); if (s.includes('is_maximized') || s.includes('is_minimized')) return false; if (s.includes('outer_position')) return { x: 100, y: 100 }; if (s.includes('inner_size')) return { width: ${W}, height: ${H} }; return 0 },
  }
})()`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(4600)

const report = {}
report.setup = await evaluate(`(async () => {
  await window.__musicTest.stressAlbums(6)
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const { usePlaylistStore } = await import('/src/stores/playlist.ts')
  const { useUiStore } = await import('/src/stores/ui.ts')
  const lib = useLibraryStore(), pl = usePlaylistStore()
  useUiStore().activeView = 'albums'
  const paths = lib.songs.slice(0, 8).map((s) => s.path)
  const ex = pl.playlists.find((p) => p.name === '验证歌单')
  if (ex) pl.addSongs(ex.id, paths); else pl.create('验证歌单', paths)
  await new Promise((r) => setTimeout(r, 600))
  return { playlists: pl.playlists.length }
})()`)

const SIDEBAR_PROBE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } }
  const list = [...document.querySelectorAll('.sidebar .nav-item')].find((b) => b.textContent.trim() === '歌单')
  const add = document.querySelector('.sidebar .add-playlist')
  if (add) { add.style.opacity = '1'; add.style.transform = 'none' }
  const svgOf = (e) => e?.querySelector('svg')
  return {
    listRect: r(list), addRect: r(add),
    gapX: list && add ? Math.round(add.getBoundingClientRect().left - list.getBoundingClientRect().right) : null,
    tapePath: svgOf(list)?.innerHTML ?? null,
    addPath: svgOf(add)?.innerHTML ?? null,
    sameShape: svgOf(list)?.innerHTML === svgOf(add)?.innerHTML,
    theme: document.documentElement.dataset.theme ?? null,
  }
})()`

await sleep(400)
report.sidebarLight = await evaluate(SIDEBAR_PROBE)
{
  const a = report.sidebarLight.listRect, b = report.sidebarLight.addRect
  await shotClip('70-tape-sidebar-light.png', { x: a.x - 8, y: a.y - 6, w: (b.x + b.w) - a.x + 16, h: Math.max(a.h, b.y + b.h - a.y) + 12 }, 5)
}
await shot('71-tape-sidebar-full-light.png')

/* ---------- 深色主题 ---------- */
report.dark = await evaluate(`(async () => {
  const { useSettingsStore } = await import('/src/stores/settings.ts')
  const s = useSettingsStore()
  s.themeMode = 'dark'
  await new Promise((r) => setTimeout(r, 800))
  return { theme: document.documentElement.dataset.theme ?? null, mode: s.themeMode }
})()`)
report.sidebarDark = await evaluate(SIDEBAR_PROBE)
{
  const a = report.sidebarDark.listRect, b = report.sidebarDark.addRect
  await shotClip('72-tape-sidebar-dark.png', { x: a.x - 8, y: a.y - 6, w: (b.x + b.w) - a.x + 16, h: Math.max(a.h, b.y + b.h - a.y) + 12 }, 5)
}
await shot('73-tape-sidebar-full-dark.png')

/* ---------- 回到浅色 ---------- */
await evaluate(`(async () => { const { useSettingsStore } = await import('/src/stores/settings.ts'); useSettingsStore().themeMode = 'light'; await new Promise((r) => setTimeout(r, 700)) })()`)

/* ---------- 右键菜单子项 14px ---------- */
report.menu = await evaluate(`(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const { useSongActions } = await import('/src/composables/useSongActions.ts')
  const song = useLibraryStore().songs[0]
  useSongActions().openSongMenu(new MouseEvent('contextmenu', { clientX: 400, clientY: 300 }), song)
  await new Promise((r) => setTimeout(r, 600))
  const menu = document.querySelector('.song-menu')
  const sub = menu?.querySelector('.menu-sub-wrap > .menu-item')
  sub?.click()
  await new Promise((r) => setTimeout(r, 600))
  const submenu = menu?.querySelector('.submenu')
  const item = submenu?.querySelector('.sub-item')
  const rr = menu.getBoundingClientRect(), sr = submenu.getBoundingClientRect()
  return {
    opened: !!menu, submenuShown: !!submenu,
    subItemPath: item?.querySelector('svg')?.innerHTML ?? null,
    subItemSize: item?.querySelector('svg')?.getAttribute('width') ?? null,
    clip: { x: Math.round(rr.left) - 8, y: Math.round(rr.top) - 8, w: Math.round(Math.max(rr.right, sr.right) - rr.left) + 16, h: Math.round(Math.max(rr.bottom, sr.bottom) - rr.top) + 16 },
  }
})()`)
if (report.menu.opened) {
  await shotClip('74-tape-menu-14px.png', report.menu.clip, 3)
  await evaluate(`import('/src/composables/useSongActions.ts').then((m) => m.useSongActions().closeSongMenu())`)
}

/* ---------- 体检台：与侧栏邻居并排，深浅双底，18/14/12 三档 ---------- */
report.audit = await evaluate(`(async () => {
  const { iconPaths } = await import('/src/components/icons.ts')
  const { useSettingsStore } = await import('/src/stores/settings.ts')
  const rows = [
    { key: 'music', label: '歌曲' },
    { key: 'disc', label: '专辑' },
    { key: 'folder', label: '文件夹' },
    { key: 'playlist', label: '歌单(磁带)', hot: true },
    { key: 'playlistAdd', label: '新建歌单', hot: true },
    { key: 'queue', label: '播放队列' },
  ]
  const host = document.createElement('div')
  host.id = 'tape-audit'
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:18px 20px;font:12px/1.2 -apple-system,"Segoe UI",sans-serif;color:#1c1c1e'
  const mk = (bg, color, tag) => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:flex-start;gap:16px;background:' + bg + ';color:' + color + ';border-radius:12px;padding:14px 16px;margin-bottom:10px'
    const tagEl = document.createElement('div')
    tagEl.textContent = tag
    tagEl.style.cssText = 'font-size:11px;width:74px;opacity:.55;padding-top:14px'
    wrap.appendChild(tagEl)
    for (const r of rows) {
      const col = document.createElement('div')
      col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px'
      col.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconPaths[r.key] + '</svg>'
      const lbl = document.createElement('div')
      lbl.textContent = r.label
      lbl.style.cssText = 'font-size:11px;opacity:' + (r.hot ? '1' : '.5') + ';' + (r.hot ? 'color:#172554;font-weight:500' : '')
      col.appendChild(lbl)
      wrap.appendChild(col)
    }
    return wrap
  }
  host.appendChild(mk('#ffffff', '#1c1c1e', '浅色 · 18px'))
  host.appendChild(mk('#0a0a0a', '#e8eaf0', '深色 · 18px'))
  const row3 = document.createElement('div')
  row3.style.cssText = 'display:flex;align-items:center;gap:16px;background:#fff;border-radius:12px;padding:14px 16px;color:#1c1c1e'
  for (const s of [18, 14, 12]) {
    const c = document.createElement('div')
    c.style.cssText = 'display:flex;align-items:center;gap:8px'
    c.innerHTML = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconPaths.playlist + '</svg><span style="font-size:11px;opacity:.55">' + s + 'px</span>'
    row3.appendChild(c)
  }
  host.appendChild(row3)
  document.body.appendChild(host)
  await new Promise((r) => setTimeout(r, 300))
  const b = host.getBoundingClientRect()
  return { rect: { x: 0, y: 0, w: Math.round(b.width), h: Math.round(b.height) } }
})()`)
await shotClip('75-tape-audit.png', report.audit.rect, 3)

report.exceptions = errors
console.log(JSON.stringify(report, null, 2))

ws.close()
proc.kill()
