import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9338
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-back-'))

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

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })

const STUB = `window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},transformCallback:(cb)=>{const i=Math.floor(Math.random()*1e9);window['_'+i]=cb;return i},unregisterListener:()=>{},invoke:async(c)=>{const s=String(c);if(s.includes('is_maximized')||s.includes('is_minimized'))return false;if(s.includes('outer_position'))return{x:100,y:100};if(s.includes('inner_size'))return{width:${W},height:${H}};return 0}}`
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
await send('Page.navigate', { url: URL_APP })
await sleep(4200)

const report = {}
report.setup = await evaluate(`(async () => {
  await window.__musicTest.stressAlbums(4)
  return { albums: (await import('/src/stores/library.ts')).useLibraryStore().albums.length }
})()`)

const PROBE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) } }
  const back = document.querySelector('.head-back')
  const win = document.querySelector('.titlebar .tb-btn:last-child')
  const layer = document.querySelector('.detail-layer')
  const h1 = document.querySelector('.view-header h1')
  const search = document.querySelector('.search-box')
  const rb = r(back), rw = r(win), rl = r(layer)
  const overlap = rb && rw ? Math.min(rb.right, rw.right) - Math.max(rb.left, rw.left) : null
  const hit = rb ? document.elementFromPoint(Math.round((rb.left + rb.right) / 2), Math.round((rb.top + rb.bottom) / 2)) : null
  return {
    hasTopBarBack: !!back,
    backRect: rb,
    winCloseRect: rw,
    overlapWWithWindowBtn: overlap !== null && overlap > 0 ? overlap : 0,
    backHitSelf: !!(hit && hit.closest('.head-back')),
    legacyHeaderClose: !!document.querySelector('.header-close'),
    detailLayerTop: rl ? rl.top : null,
    headerTitleVisible: h1 ? h1.textContent : null,
    headerTitleRect: r(h1),
    searchVisible: !!search,
    searchRect: r(search),
  }
})()`

const openDetail = (view, keyExpr) => `(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const ui = useUiStore()
  const lib = useLibraryStore()
  const key = ${keyExpr}
  ui.activeView = '${view}'
  ui.detailKey = key
  await new Promise((r) => setTimeout(r, 1500))
  return { detailKey: ui.detailKey }
})()`

/* ---------- 专辑详情 ---------- */
report.albumOpen = await evaluate(openDetail('albums', '(lib.albums[0].key)'))
report.albumProbe = await evaluate(PROBE)
await shot('30-album-detail-topbar.png')

/* 滚动回归：详情层高度从「整屏」变成「屏高 − 62」，确认滚动宿主与顶栏不受影响 */
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 320, deviceScaleFactor: 2, mobile: false })
await sleep(400)
report.scrollTest = await evaluate(`(async () => {
  const layer = document.querySelector('.detail-layer')
  const before = { clientH: layer.clientHeight, scrollH: layer.scrollHeight, scrollTop: layer.scrollTop }
  layer.scrollTop = 200
  await new Promise((r) => setTimeout(r, 300))
  const back = document.querySelector('.head-back').getBoundingClientRect()
  const bar = document.querySelector('.view-header').getBoundingClientRect()
  return {
    before,
    afterScrollTop: layer.scrollTop,
    scrollable: before.scrollH > before.clientH,
    scrollTopApplied: layer.scrollTop > 0,
    backRectTop: Math.round(back.top),
    barRectTop: Math.round(bar.top),
    layerTop: Math.round(layer.getBoundingClientRect().top),
  }
})()`)
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
await sleep(400)

/* 点顶栏返回：应真正走反向过渡并关闭详情 */
report.albumBack = await evaluate(`(async () => {
  const btn = document.querySelector('.head-back')
  if (!btn) return { error: '未找到顶栏返回钮' }
  btn.click()
  await new Promise((r) => setTimeout(r, 1800))
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  return {
    detailKeyAfterBack: ui.detailKey,
    layerGone: !document.querySelector('.detail-layer'),
    backGone: !document.querySelector('.head-back'),
    titleAfterBack: document.querySelector('.view-header h1')?.textContent ?? null,
  }
})()`)
await shot('31-album-after-back.png')

/* ---------- 艺术家详情 ---------- */
report.artistOpen = await evaluate(openDetail('artists', '(lib.artists[0].name)'))
report.artistProbe = await evaluate(PROBE)
await shot('32-artist-detail-topbar.png')

report.artistBack = await evaluate(`(async () => {
  const btn = document.querySelector('.head-back')
  if (!btn) return { error: '未找到顶栏返回钮' }
  btn.click()
  await new Promise((r) => setTimeout(r, 1800))
  const { useUiStore } = await import('/src/stores/ui.ts')
  return {
    detailKeyAfterBack: useUiStore().detailKey,
    layerGone: !document.querySelector('.detail-layer'),
    backGone: !document.querySelector('.head-back'),
  }
})()`)

/* 歌单板块的 detailKey 语义是「选中歌单」，不该出现返回钮 */
report.playlistNoBack = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { usePlaylistStore } = await import('/src/stores/playlist.ts')
  const ui = useUiStore()
  const pl = usePlaylistStore()
  ui.activeView = 'playlists'
  const id = pl.playlists[0]?.id ?? (await window.__musicTest.pl('create', '验证歌单'))
  await new Promise((r) => setTimeout(r, 300))
  ui.detailKey = id
  await new Promise((r) => setTimeout(r, 900))
  return { detailKey: ui.detailKey, backShown: !!document.querySelector('.head-back') }
})()`)

report.errors = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
process.exit(0)
