/**
 * 设置页验证：分类间面板宽度是否恒定、快捷键列表上间距、关于面板文案（含桌面/网页两种形态）。
 * 用法：node verify-settings.mjs [web|desktop]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MODE = process.argv[2] === 'desktop' ? 'desktop' : 'web'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = MODE === 'desktop' ? 9369 : 9367
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `onda-set-${MODE}-`))

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
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

if (MODE === 'desktop') {
  const STUB = `
  (() => {
    const orig = window.matchMedia.bind(window)
    window.matchMedia = (q) => (String(q).includes('prefers-reduced-motion') ? { matches: false, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, onchange: null } : orig(q))
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: (cb) => { const i = Math.floor(Math.random()*1e9); window['_'+i] = cb; return i },
      unregisterListener: () => {},
      invoke: async (c) => {
        const s = String(c)
        if (s.includes('plugin:app|version')) return '0.2.2'
        if (s.includes('is_maximized') || s.includes('is_minimized')) return false
        if (s.includes('outer_position')) return { x: 100, y: 100 }
        if (s.includes('inner_size')) return { width: ${W}, height: ${H} }
        return 0
      },
    }
  })()`
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
}
await send('Page.navigate', { url: URL_APP })
await sleep(4600)

const report = { mode: MODE }
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().navigate('settings')
  await new Promise((r) => setTimeout(r, 900))
})()`)

const TABS = ['外观', '快捷键', '音乐文件夹', '数据', '关于']
report.tabs = []
for (let i = 0; i < TABS.length; i++) {
  const label = TABS[i]
  await evaluate(`(async () => {
    const btns = [...document.querySelectorAll('.settings-nav .nav-card')]
    btns.find((x) => x.textContent.includes(${JSON.stringify(label)}))?.click()
    await new Promise((r) => setTimeout(r, 600))
  })()`)
  if (label === '关于') await shot(`131-settings-about-${MODE}.png`)
  if (label === '快捷键') await shot(`132-settings-hotkeys-${MODE}.png`)
  report.tabs.push(await evaluate(`(() => {
    const sec = document.querySelector('.panel-section')
    const vb = document.querySelector('.view-body')
    const sub = sec.querySelector('.panel-sub')
    const list = sec.querySelector('.hotkey-list')
    const b = sec.getBoundingClientRect()
    return {
      tab: ${JSON.stringify(label)},
      panelW: +b.width.toFixed(1),
      clientW: vb.clientWidth,
      有滚动条: vb.offsetWidth - vb.clientWidth > 0,
      快捷键列表上间距: list && sub ? +(list.getBoundingClientRect().top - sub.getBoundingClientRect().bottom).toFixed(1) : null,
    }
  })()`))
}

report.about = await evaluate(`(() => {
  const sec = document.querySelector('.panel-section')
  const ver = sec.querySelector('.about-brand-ver')?.textContent?.trim() ?? null
  const sub = sec.querySelector('.panel-sub')?.textContent?.trim() ?? null
  const env = sec.querySelector('.install-row .opt-name')?.textContent?.trim() ?? null
  const envDesc = sec.querySelector('.install-row .opt-desc')?.textContent?.trim() ?? null
  const items = [...sec.querySelectorAll('.about-list li')].map((li) => li.textContent.trim())
  const installBtn = !!sec.querySelector('.install-btn')
  const all = sec.textContent
  return {
    副标题: sub, 版本行: ver, 运行形态: env, 形态说明: envDesc, 有安装按钮: installBtn,
    条目数: items.length, 条目: items,
    含SaltPlayer: all.includes('Salt Player'),
    含网页版本地: all.includes('网页版本地音乐播放器'),
  }
})()`)

report.exceptions = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
