/**
 * 主题色改按键式后的验证：
 *  - 9 个按键（8 预设 + 自定义），顺序与命名正确、末尾是自定义
 *  - 逐个点击 → accentColor 与实际 --accent 同步变化
 *  - 自定义按键：整键可点（取色 input 覆盖整键）、选中自定义色时高亮
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9371
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-accent-'))

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
  await sleep(260)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
await send('Page.navigate', { url: URL_APP })
await sleep(4600)

const report = {}
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  const { useSettingsStore } = await import('/src/stores/settings.ts')
  useSettingsStore().setAccentColor('')
  useUiStore().navigate('settings')
  await new Promise((r) => setTimeout(r, 900))
})()`)

report.structure = await evaluate(`(() => {
  const keys = [...document.querySelectorAll('.accent-keys .accent-key')]
  const box = document.querySelector('.accent-keys').getBoundingClientRect()
  return {
    按键数: keys.length,
    顺序: keys.map((k) => k.textContent.trim()),
    每个按键宽: keys.map((k) => +k.getBoundingClientRect().width.toFixed(0)),
    行数: new Set(keys.map((k) => Math.round(k.getBoundingClientRect().top))).size,
    容器高: +box.height.toFixed(1),
    末尾是自定义: keys[keys.length - 1].classList.contains('accent-key-custom'),
    defaultForKey: !!keys[0].querySelector('.accent-key-dot.default'),
    自定义内有取色input: !!keys[keys.length - 1].querySelector('input[type=color]'),
  }
})()`)

/* 自定义按键：整键是否可点（命中测试应落在 color input 上） */
report.customHit = await evaluate(`(() => {
  const el = document.querySelector('.accent-key-custom')
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { hitTag: hit?.tagName, hitType: hit?.getAttribute?.('type') ?? null, 整键可点: hit?.tagName === 'INPUT' && hit?.getAttribute('type') === 'color' }
})()`)

/* 逐个点击：accenColor 与 --accent 实值是否同步 */
const keys = await evaluate(`(() => [...document.querySelectorAll('.accent-keys .accent-key')].map((k) => {
  const r = k.getBoundingClientRect()
  return { label: k.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
}))()`)

const clicks = []
for (const k of keys) {
  if (k.label === '自定义') continue // 会弹系统取色器，跳过点击
  await realClick(k.x, k.y)
  clicks.push(await evaluate(`(async () => {
    const { useSettingsStore } = await import('/src/stores/settings.ts')
    const s = useSettingsStore()
    const on = [...document.querySelectorAll('.accent-keys .accent-key')].filter((e) => e.classList.contains('on')).map((e) => e.textContent.trim())
    return {
      label: ${JSON.stringify(k.label)},
      accentColor: s.accentColor || '(默认)',
      cssAccent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      高亮的按键: on,
    }
  })()`))
}
report.clicks = clicks

/* 设一个预设之外的颜色 → 「自定义」应高亮 */
report.customSelected = await evaluate(`(async () => {
  const { useSettingsStore } = await import('/src/stores/settings.ts')
  useSettingsStore().setAccentColor('#00b3a4')
  await new Promise((r) => setTimeout(r, 400))
  const on = [...document.querySelectorAll('.accent-keys .accent-key')].filter((e) => e.classList.contains('on')).map((e) => e.textContent.trim())
  return { 高亮的按键: on, 自定义高亮: on.includes('自定义'), 高亮数量: on.length }
})()`)
await shot('140-accent-keys-custom.png')

/* 回到默认后再拍一张 */
await evaluate(`(async () => {
  const { useSettingsStore } = await import('/src/stores/settings.ts')
  useSettingsStore().setAccentColor('')
  await new Promise((r) => setTimeout(r, 500))
})()`)
await shot('141-accent-keys-default.png')

report.layout = await evaluate(`(() => {
  const sec = document.querySelector('.panel-section')
  const sr = sec.getBoundingClientRect()
  const overflow = [...document.querySelectorAll('.accent-keys .accent-key')].filter((el) => {
    const b = el.getBoundingClientRect()
    return b.right > sr.right - 26 + 0.5
  }).map((el) => el.textContent.trim())
  return { 面板宽: +sr.width.toFixed(1), 溢出面板的按键: overflow }
})()`)

report.exceptions = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
