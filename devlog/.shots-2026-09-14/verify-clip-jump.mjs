/**
 * 验证「裁掉越界部分」而非「挪动落点」：
 *   - 折叠层 / 飞行克隆的 top 全程 >= 顶栏下缘（62）
 *   - 克隆收尾落点与真实卡片封面的位置偏差 ≈ 0（不能有"弹回原位"的跳变）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9361
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-clipjump-'))

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
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
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

/** 采样器：同时记录 cli 容器内所有克隆、以及详情层，附带各自的 rect */
const sampler = async (ms) => (await send('Runtime.evaluate', {
  expression: `(async () => {
    const band = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-band-h')) || 62
    const samples = { clones: [], layers: [] }
    const t0 = performance.now()
    return await new Promise((resolve) => {
      const tick = () => {
        const now = Math.round(performance.now() - t0)
        for (const el of document.querySelectorAll('.page-flight')) {
          const b = el.getBoundingClientRect()
          samples.clones.push({ t: now, top: +b.top.toFixed(1), left: +b.left.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) })
        }
        for (const el of document.querySelectorAll('.detail-layer')) {
          const b = el.getBoundingClientRect()
          samples.layers.push({ t: now, top: +b.top.toFixed(1) })
        }
        if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick)
        else resolve({ band, ...samples })
      }
      requestAnimationFrame(tick)
    })
  })()`,
  awaitPromise: true,
  returnByValue: true,
})).result.value

const minTop = (arr) => (arr.length ? Math.min(...arr.map((x) => x.top)) : null)

const report = {}
await evaluate(`(async () => { await window.__musicTest.stressAlbums(18); await new Promise((r) => setTimeout(r, 600)) })()`)

/* 环境：切专辑页、下滚让首行被裁切，并校验「裁切线」两个来源一致 */
report.env = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().navigate('albums')
  await new Promise((r) => setTimeout(r, 900))
  const host = document.querySelector('.view-body')
  host.scrollTop = 110
  await new Promise((r) => setTimeout(r, 500))
  const band = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-band-h'))
  const cards = [...document.querySelectorAll('.album-card')]
  const ht = host.getBoundingClientRect().top
  const cut = cards.filter((c) => { const b = c.getBoundingClientRect(); return b.top < ht - 1 && b.bottom > ht + 30 })
  if (!cut.length) return { ok: false }
  const el = cut[0]
  const cover = el.querySelector('img, .cover-fallback')
  const cb = cover.getBoundingClientRect()
  return {
    ok: true,
    viewBodyTop: +ht.toFixed(1),
    bandVar: band,
    裁切线与变量一致: Math.abs(ht - band) < 0.6,
    cardTop: +el.getBoundingClientRect().top.toFixed(1),
    coverRectBefore: { top: +cb.top.toFixed(1), left: +cb.left.toFixed(1), w: +cb.width.toFixed(1), h: +cb.height.toFixed(1) },
    click: { x: Math.round(el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2), y: Math.round(ht + 24) },
  }
})()`)

const e0 = report.env
if (!e0.ok) { console.log(JSON.stringify({ ...report, note: '未找到被裁切卡片' }, null, 2)); ws.close(); proc.kill(); process.exit(0) }

/* 进入（采样克隆） */
let p = sampler(1000)
await sleep(60)
await realClick(e0.click.x, e0.click.y)
const enterRes = await p
report.enter = { band: enterRes.band, cloneFrames: enterRes.clones.length, cloneMinTop: minTop(enterRes.clones) }
await sleep(700)

/* 退出（采样克隆 + 详情层） */
const back = await evaluate(`(() => { const b = document.querySelector('.head-back'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
p = sampler(1500)
await sleep(60)
await realClick(back.x, back.y)
await sleep(400)
await shot('112-clip-clone-mid.png')
const exitRes = await p
const lastClone = exitRes.clones.length ? exitRes.clones[exitRes.clones.length - 1] : null
report.exit = {
  band: exitRes.band,
  cloneFrames: exitRes.clones.length,
  cloneMinTop: minTop(exitRes.clones),
  layerFrames: exitRes.layers.length,
  layerMinTop: minTop(exitRes.layers),
  lastClone,
}

/* 收尾：真实卡片封面回到的位置 —— 与克隆最后一帧对比，即"跳跃量" */
await sleep(600)
report.landing = await evaluate(`(() => {
  const host = document.querySelector('.view-body')
  const cards = [...document.querySelectorAll('.album-card')]
  const ht = host.getBoundingClientRect().top
  const el = cards.find((c) => { const b = c.getBoundingClientRect(); return b.top < ht - 1 && b.bottom > ht + 30 }) ?? cards[0]
  const cover = el.querySelector('img, .cover-fallback')
  const cb = cover.getBoundingClientRect()
  return { realCoverRect: { top: +cb.top.toFixed(1), left: +cb.left.toFixed(1), w: +cb.width.toFixed(1), h: +cb.height.toFixed(1) } }
})()`)

const rc = report.landing.realCoverRect
const lc = report.exit.lastClone
report.verdict = {
  剪影越界帧: exitRes.clones.filter((x) => x.top < exitRes.band - 0.5).length + exitRes.layers.filter((x) => x.top < exitRes.band - 0.5).length,
  克隆落点与真实封面偏差: lc ? { dTop: +(rc.top - lc.top).toFixed(1), dLeft: +(rc.left - lc.left).toFixed(1), dW: +(rc.w - lc.w).toFixed(1), dH: +(rc.h - lc.h).toFixed(1) } : null,
}

report.finalState = await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const ui = useUiStore()
  const card = document.querySelector('.album-card')
  return { detailKey: ui.detailKey, dolly: ui.dolly, layer: !!document.querySelector('.detail-layer'), flights: document.querySelectorAll('.page-flight').length, cardOpacity: card ? +Number(getComputedStyle(card).opacity).toFixed(2) : null }
})()`)
report.exceptions = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
