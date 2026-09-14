import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9343
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1280
const H = 800
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-album-batch-'))

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
const shotClip = async (name, clip) => {
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })

const STUB = `window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},transformCallback:(cb)=>{const i=Math.floor(Math.random()*1e9);window['_'+i]=cb;return i},unregisterListener:()=>{},invoke:async(c)=>{const s=String(c);if(s.includes('is_maximized')||s.includes('is_minimized'))return false;if(s.includes('outer_position'))return{x:100,y:100};if(s.includes('inner_size'))return{width:${W},height:${H}};return 0}}`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(4200)

const report = {}

/** 轮询等待选择器出现（dev server 重编译后首帧可能还没挂上） */
const waitFor = async (sel, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    const n = await evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
    if (n > 0) return n
    await sleep(250)
  }
  return 0
}

const SEED = `(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const db = await import('/src/services/db.ts')
  const lib = useLibraryStore()
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 512, 512)
  grad.addColorStop(0, '#d9a441'); grad.addColorStop(0.55, '#b56f2a'); grad.addColorStop(1, '#4a2b16')
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512)
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.font = '600 54px serif'; g.fillText('独一无二', 48, 420)
  const coverId = 'demo-cover-batch'
  await db.putCover(coverId, await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)))
  const base = {
    rootId: 'demo', album: '独一无二', albumArtist: '罗志祥', artist: '罗志祥',
    genre: '流行', year: null, discNo: 1, sampleRateHz: 44100, bitsPerSample: 16,
    bitrateKbps: 320, container: 'flac', fileSize: 8 * 1024 * 1024, mtimeMs: 0,
    hasCover: true, coverId, embeddedLyrics: null,
  }
  const titles = ['独一无二', '怕安静', '小丑鱼', '黑眼圈', '最后的风度']
  titles.forEach((t, i) => {
    lib.songs.push({ ...base,
      path: 'demo/独一无二/' + String(i + 1).padStart(2, '0') + ' ' + t + '.flac',
      fileName: t + '.flac', title: t, trackNo: i + 1, durationSec: 100 + i * 30 })
  })
  await new Promise((r) => setTimeout(r, 200))
  return { albumKey: lib.albums.find((a) => a.name === '独一无二')?.key ?? null, songs: lib.songs.length }
})()`
report.setup = await evaluate(SEED)

/* 顺带造一个歌单，供「添加到歌单」点击 */
await evaluate(`(async () => { const rec = await window.__musicTest.pl('create', '测试歌单'); window.__plId = rec?.id ?? rec; return window.__plId })()`)

report.enter = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const ui = useUiStore()
  const lib = useLibraryStore()
  ui.activeView = 'albums'
  ui.detailKey = lib.albums.find((x) => x.name === '独一无二').key
  await new Promise((r) => setTimeout(r, 1800))
  return { detailKey: ui.detailKey }
})()`)
report.buttonsFound = await waitFor('.album-actions .action-btn')

const HEADER_PROBE = `(() => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) } }
  const card = document.querySelector('.album-header')
  const cover = document.querySelector('.album-header .header-cover')
  const title = document.querySelector('.album-title')
  const btns = [...document.querySelectorAll('.album-actions .action-btn')].map((b) => ({
    text: b.textContent.trim(),
    icon: [...b.querySelectorAll('svg path')].map((p) => (p.getAttribute('d') || '').slice(0, 24)).join('|'),
    primary: b.classList.contains('primary'),
  }))
  return {
    card: R(card), cover: R(cover), title: R(title),
    titleMinusCoverTop: cover && title ? Math.round(title.getBoundingClientRect().top - cover.getBoundingClientRect().top) : null,
    side: R(document.querySelector('.album-sideinfo')),
    buttons: btns,
    rows: [...document.querySelectorAll('.album-sideinfo .row')].map((r) => (r.querySelector('.k')?.textContent || '').trim() + '=' + (r.querySelector('.v')?.textContent || '').trim()),
  }
})()`

report.header = await evaluate(HEADER_PROBE)
report.headerRect = await evaluate(`(() => { const b = document.querySelector('.album-header')?.getBoundingClientRect(); return b ? { x: 0, y: Math.max(0, b.top - 10), width: ${W}, height: Math.round(b.height + 20) } : null })()`)
if (report.headerRect) await shotClip('110-album-actions.png', report.headerRect)

/* 点「批量操作」 */
report.enterBatch = await evaluate(`(async () => {
  const btns = [...document.querySelectorAll('.album-actions .action-btn')]
  btns[1].click()
  await new Promise((r) => setTimeout(r, 400))
  return {
    barText: document.querySelector('.batch-bar')?.textContent?.replace(/\\s+/g, ' ').trim(),
    checks: document.querySelectorAll('.row-check').length,
    picked: document.querySelectorAll('.track-row.picked').length,
    btnLabel: btns[1].textContent.trim(),
    numbersHidden: document.querySelectorAll('.track-row .track-no .row-check').length > 0
      && ![...document.querySelectorAll('.track-row .track-no')].some((el) => /^\\d+$/.test(el.textContent.trim())),
  }
})()`)
await shot('111-batch-mode.png')

/* 勾选：点行 / 全选 / 反选 */
report.pick = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.track-row')]
  rows[0].click(); rows[2].click()
  await new Promise((r) => setTimeout(r, 200))
  const a = { count: document.querySelector('.batch-count')?.textContent.trim(), picked: document.querySelectorAll('.track-row.picked').length,
              playing: document.querySelectorAll('.track-row.playing').length }
  const links = [...document.querySelectorAll('.batch-links .mini-link')]
  links[0].click()   // 全选
  await new Promise((r) => setTimeout(r, 150))
  const b = { count: document.querySelector('.batch-count')?.textContent.trim(), picked: document.querySelectorAll('.track-row.picked').length }
  links[1].click()   // 反选
  await new Promise((r) => setTimeout(r, 150))
  const c = { count: document.querySelector('.batch-count')?.textContent.trim(), picked: document.querySelectorAll('.track-row.picked').length }
  links[1].click()   // 再反选 → 回到全选
  await new Promise((r) => setTimeout(r, 150))
  const d = { count: document.querySelector('.batch-count')?.textContent.trim(), picked: document.querySelectorAll('.track-row.picked').length }
  return { afterRowClick: a, afterSelectAll: b, afterInvert: c, afterInvertAgain: d }
})()`)

/* 收藏（全选 5 首）→ 收藏数 5；再点一次 → 取消收藏回到 0 */
report.favorite = await evaluate(`(async () => {
  const { useFavoritesStore } = await import('/src/stores/favorites.ts')
  const fav = useFavoritesStore()
  const btn = [...document.querySelectorAll('.batch-actions .action-btn')][0]
  const label0 = btn.textContent.trim()
  btn.click()
  await new Promise((r) => setTimeout(r, 250))
  const afterFirst = { total: fav.paths?.length ?? fav.list?.length ?? 'n/a', label: btn.textContent.trim() }
  btn.click()
  await new Promise((r) => setTimeout(r, 250))
  const afterSecond = { total: fav.paths?.length ?? fav.list?.length ?? 'n/a', label: btn.textContent.trim() }
  // 再收藏回来，便于看高亮
  btn.click()
  await new Promise((r) => setTimeout(r, 250))
  return { label0, afterFirst, afterSecond, finalTotal: fav.paths?.length ?? fav.list?.length ?? 'n/a' }
})()`)
await shot('112-batch-favorited.png')

/* 添加到歌单：面板展开 → 点第一个歌单 → 歌单歌曲数 = 已选 5、退出选择态 */
report.addToPlaylist = await evaluate(`(async () => {
  const btn = [...document.querySelectorAll('.batch-actions .action-btn')][1]
  btn.click()
  await new Promise((r) => setTimeout(r, 400))
  const menuOpen = !!document.querySelector('.add-menu')
  const items = [...document.querySelectorAll('.add-menu .add-item')].map((b) => b.textContent.trim())
  return { menuOpen, items }
})()`)
await shot('113-batch-add-menu.png')

report.addCommit = await evaluate(`(async () => {
  const { usePlaylistStore } = await import('/src/stores/playlist.ts')
  const store = usePlaylistStore()
  document.querySelector('.add-menu .add-item').click()
  await new Promise((r) => setTimeout(r, 500))
  const pl = store.playlists.find((p) => p.id === window.__plId) ?? store.playlists[0]
  return {
    songCount: pl?.songPaths?.length ?? null,
    menuClosed: !document.querySelector('.add-menu'),
    barGone: !document.querySelector('.batch-bar'),
    btnLabel: document.querySelectorAll('.album-actions .action-btn')[1].textContent.trim(),
  }
})()`)

/* 重新进入批量态 → Esc 退出 */
report.esc = await evaluate(`(async () => {
  const btn = [...document.querySelectorAll('.album-actions .action-btn')][1]
  btn.click()
  await new Promise((r) => setTimeout(r, 300))
  const entered = !!document.querySelector('.batch-bar')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 300))
  return { entered, goneAfterEsc: !document.querySelector('.batch-bar') }
})()`)

/* 播放全部：先设随机，点按钮后应固定为 loop 且队列=专辑全部歌曲
   （队列长度要在 click 后同步读——测试歌曲没有真实文件，load 会把不存在的条目逐个剔除） */
report.playAll = await evaluate(`(async () => {
  const { usePlayerStore } = await import('/src/stores/player.ts')
  const player = usePlayerStore()
  player.setPlayMode('shuffle')
  document.querySelector('.album-actions .action-btn.primary').click()
  const queueSync = player.queue.length
  const firstTitle = player.queue[0]?.title
  await new Promise((r) => setTimeout(r, 600))
  return { mode: player.playMode, queueSync, firstTitle, queueAfterLoad: player.queue.length }
})()`)

/* 深色主题下的批量态 + 二级面板 */
await evaluate(`localStorage.setItem('settings.themeMode','dark')`)
await send('Page.navigate', { url: URL_APP })
await sleep(4200)
await evaluate(SEED)
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const ui = useUiStore()
  ui.activeView = 'albums'
  ui.detailKey = useLibraryStore().albums.find((x) => x.name === '独一无二').key
  await new Promise((r) => setTimeout(r, 1800))
})()`)
await waitFor('.album-actions .action-btn')
report.darkBatch = await evaluate(`(async () => {
  document.querySelectorAll('.album-actions .action-btn')[1].click()
  await new Promise((r) => setTimeout(r, 300))
  document.querySelectorAll('.batch-links .mini-link')[0].click()
  await new Promise((r) => setTimeout(r, 200))
  document.querySelectorAll('.batch-actions .action-btn')[1].click()
  await new Promise((r) => setTimeout(r, 400))
  return {
    theme: document.documentElement.dataset.theme,
    picked: document.querySelectorAll('.track-row.picked').length,
    menuOpen: !!document.querySelector('.add-menu'),
  }
})()`)
await shot('114-batch-mode-dark.png')
await evaluate(`localStorage.setItem('settings.themeMode','light')`)

report.errors = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
process.exit(0)
