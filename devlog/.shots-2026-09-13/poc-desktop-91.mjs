/* 9.1 桌面端验证：read_head 二进制通道 / media:// Range / 真实播放 / lrc / FSA 复核 / 持久化标记 */
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const ws = new WebSocket(list[0].webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const send = (m, p = {}) => new Promise((res) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); const h = (ev) => { const d = JSON.parse(ev.data); if (d.id === i) { ws.removeEventListener('message', h); res(d.result) } }; ws.addEventListener('message', h) })
await send('Runtime.enable')
const evalP = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); console.error('RAW:', JSON.stringify(r).slice(0, 400)); return r }

console.log('== 2. read_head (binary ipc) ==')
console.log(JSON.stringify((await evalP(
  "(async () => { try { const b = await window.__TAURI_INTERNALS__.invoke('read_head', { path: 'D:/onda-test-music/demo.wav' }); return { kind: b.constructor.name, bytes: b.byteLength, riff: String.fromCharCode(...new Uint8Array(b).slice(0,4)) } } catch (e) { return { err: String(e) } } })()"
)).result?.value))

console.log('== 3. media:// Range ==')
console.log(JSON.stringify((await evalP(
  "(async () => { try { const r = await fetch('http://media.localhost/?p=' + encodeURIComponent('D:/onda-test-music/demo.wav'), { headers: { Range: 'bytes=1000000-1000099' } }); const buf = await r.arrayBuffer(); return { status: r.status, cr: r.headers.get('content-range'), ar: r.headers.get('accept-ranges'), ct: r.headers.get('content-type'), bytes: buf.byteLength } } catch (e) { return { err: String(e) } } })()"
)).result?.value))

console.log('== 4. audio playback ==')
console.log(JSON.stringify((await evalP(
  "(async () => { try { const a = new Audio('http://media.localhost/?p=' + encodeURIComponent('D:/onda-test-music/demo.wav')); await new Promise((res, rej) => { a.addEventListener('loadedmetadata', res, { once: true }); a.addEventListener('error', () => rej(new Error('audio error')), { once: true }) }); const dur = a.duration; await a.play(); await new Promise(r => setTimeout(r, 2500)); const out = { duration: Math.round(dur*10)/10, currentTime: Math.round(a.currentTime*100)/100, paused: a.paused }; a.pause(); return out } catch (e) { return { err: String(e) } } })()"
)).result?.value))

console.log('== 5. read_text_file (lrc) ==')
console.log(JSON.stringify((await evalP(
  "(async () => { try { return await window.__TAURI_INTERNALS__.invoke('read_text_file', { path: 'D:/onda-test-music/demo.lrc' }) } catch (e) { return { err: String(e) } } })()"
)).result?.value))

console.log('== 6. FSA 复核：showDirectoryPicker 调用（无手势应报 SecurityError = API 活着）==')
console.log(JSON.stringify((await evalP(
  "(async () => { try { await window.showDirectoryPicker({ mode: 'read' }); return 'dialog-opened?!(不应走到)' } catch (e) { return { name: e.name, msg: String(e).slice(0, 120) } } })()"
)).result?.value))

console.log('== 7. 持久化标记（重启后复查）==')
console.log(JSON.stringify((await evalP(
  "(async () => { try { localStorage.setItem('poc-restart-marker', String(Date.now())); const req = indexedDB.open('poc-persist', 1); return await new Promise((res) => { req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const db2 = req.result; const t = db2.transaction('kv', 'readwrite').objectStore('kv').put('ok', 'm'); t.onsuccess = () => { db2.close(); res({ ls: localStorage.getItem('poc-restart-marker') != null, idb: true }) }; t.onerror = () => { db2.close(); res({ ls: true, idb: false }) } }; req.onerror = () => res({ ls: true, idb: 'open-failed' }) }) } catch (e) { return { err: String(e) } } })()"
)).result?.value))

ws.close()
process.exit(0)
