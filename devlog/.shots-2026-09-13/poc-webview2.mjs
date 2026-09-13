/* Tauri PoC：连接 WebView2 远程调试端口，自动化验证四个关键点中可自动化的部分
   用法：node devlog/.shots-2026-09-13/poc-webview2.mjs [--phase2]
   phase1: 能力探测 + 写 IndexedDB 标记
   phase2: （重启应用后）读 IndexedDB 标记验证持久化 */
const PORT = 9223
const phase2 = process.argv.includes('--phase2')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page' && t.url.includes('5180'))
    if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break }
  } catch {}
  await sleep(500)
}
if (!wsUrl) { console.log(JSON.stringify({ connect: false })); process.exit(1) }

const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const send = (m, p = {}) => new Promise((res) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method: m, params: p }))
  const h = (ev) => { const d = JSON.parse(ev.data); if (d.id === i) { ws.removeEventListener('message', h); res(d.result) } }
  ws.addEventListener('message', h)
})
await send('Runtime.enable')
await sleep(3000)

const expr = phase2 ? `(() => {
  return new Promise((resolve) => {
    const req = indexedDB.open('poc-persistence-test')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('kv').objectStore('kv').get('marker')
      tx.onsuccess = () => { db.close(); resolve({ persisted: tx.result === 'tauri-poc-ok' }) }
      tx.onerror = () => { db.close(); resolve({ persisted: false, err: 'read-failed' }) }
    }
    req.onerror = () => resolve({ persisted: false, err: 'open-failed' })
  })
})()` : `(() => {
  return new Promise((resolve) => {
    const out = {
      ua: navigator.userAgent,
      showDirectoryPicker: typeof window.showDirectoryPicker === 'function',
      mediaSession: typeof navigator.mediaSession !== 'undefined',
      mediaSessionPlay: false,
      idb: 'indexedDB' in window,
      localStorage: (() => { try { localStorage.setItem('poc', '1'); return localStorage.getItem('poc') === '1' } catch { return false } })(),
      backdropFilterSupport: CSS.supports('backdrop-filter', 'blur(10px)'),
      appRendered: !!document.querySelector('.sidebar'),
      brandName: document.querySelector('.brand-name')?.textContent ?? null,
      flac: document.createElement('audio').canPlayType('audio/flac'),
      opus: document.createElement('audio').canPlayType('audio/ogg; codecs=opus'),
    }
    if (out.mediaSession) {
      try { navigator.mediaSession.setActionHandler('play', () => {}); out.mediaSessionPlay = true } catch {}
    }
    if (!out.idb) { resolve(out); return }
    const req = indexedDB.open('poc-persistence-test', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('kv', 'readwrite').objectStore('kv').put('tauri-poc-ok', 'marker')
      tx.onsuccess = () => { db.close(); resolve({ ...out, markerWritten: true }) }
      tx.onerror = () => { db.close(); resolve({ ...out, markerWritten: false }) }
    }
    req.onerror = () => resolve({ ...out, markerWritten: false })
  })
})()`

const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(r.result?.value ?? r, null, 2))
ws.close()
process.exit(0)
