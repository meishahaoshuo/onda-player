/**
 * 设置页 5 个分类的实拍 + 排版度量，用来找真实的排版问题（不靠猜）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9365
const URL_APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\devlog\\.shots-2026-09-14'
const W = 1084
const H = 736
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-set-'))

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
await send('Page.navigate', { url: URL_APP })
await sleep(4600)

await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().navigate('settings')
  await new Promise((r) => setTimeout(r, 900))
})()`)

const TABS = ['外观', '快捷键', '音乐文件夹', '数据', '关于']
const report = { tabs: [] }

for (let i = 0; i < TABS.length; i++) {
  const label = TABS[i]
  await evaluate(`(async () => {
    const btns = [...document.querySelectorAll('.settings-nav .nav-card')]
    const b = btns.find((x) => x.textContent.includes(${JSON.stringify(label)}))
    b?.click()
    await new Promise((r) => setTimeout(r, 600))
  })()`)
  await shot(`130-settings-${i}-${label}.png`)
  const m = await evaluate(`(() => {
    const sec = document.querySelector('.panel-section')
    const nav = document.querySelector('.settings-nav')
    const panel = document.querySelector('.settings-panel')
    if (!sec) return null
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }
    const cs = getComputedStyle(sec)
    const title = sec.querySelector('.panel-title')
    const sub = sec.querySelector('.panel-sub')
    const kids = [...sec.children]
    const rows = [...sec.querySelectorAll('.opt-row')]
    // 面板内所有直接子块的纵向间距，找不一致
    const gaps = []
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect()
      const b = kids[i].getBoundingClientRect()
      gaps.push({ from: kids[i - 1].className, to: kids[i].className, gap: +(b.top - a.bottom).toFixed(1) })
    }
    // 是否有元素溢出面板
    const sr = sec.getBoundingClientRect()
    const overflow = [...sec.querySelectorAll('*')].filter((el) => {
      const b = el.getBoundingClientRect()
      return b.width > 0 && (b.right > sr.right + 0.5 || b.left < sr.left - 0.5)
    }).slice(0, 5).map((el) => ({ cls: el.className || el.tagName, right: +el.getBoundingClientRect().right.toFixed(1) }))
    return {
      panelRect: r(sec),
      navRect: r(nav),
      panelBox: r(panel),
      内边距: cs.padding,
      标题字号: title ? getComputedStyle(title).fontSize : null,
      标题到副标题: title && sub ? +(sub.getBoundingClientRect().top - title.getBoundingClientRect().bottom).toFixed(1) : null,
      副标题到首个内容: sub && kids[2] ? +(kids[2].getBoundingClientRect().top - sub.getBoundingClientRect().bottom).toFixed(1) : null,
      滚动宿主: (() => { const vb = document.querySelector('.view-body'); return { clientW: vb.clientWidth, offsetW: vb.offsetWidth, 有滚动条: vb.offsetWidth - vb.clientWidth > 0, scrollH: vb.scrollHeight, clientH: vb.clientHeight } })(),
      快捷键列表上间距: (() => { const l = sec.querySelector('.hotkey-list'); const sub = sec.querySelector('.panel-sub'); if (!l || !sub) return null; return +(l.getBoundingClientRect().top - sub.getBoundingClientRect().bottom).toFixed(1) })(),
      选项行数: rows.length,
      选项行高: rows.map((x) => +x.getBoundingClientRect().height.toFixed(1)),
      块间距: gaps,
      溢出元素: overflow,
    }
  })()`)
  report.tabs.push({ tab: label, ...m })
}

report.exceptions = errors
console.log(JSON.stringify(report, null, 2))
ws.close()
proc.kill()
