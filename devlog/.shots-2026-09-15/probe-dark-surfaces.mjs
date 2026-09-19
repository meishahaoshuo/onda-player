import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 深色模式下「各区域表面色是否一致」的排查探针。
 *
 * 不猜，全部读计算样式：把外壳各层（侧栏 / 内容区 / 顶栏 / 列表 / 设置面板 /
 * 播放条 / 窗口钮）的 background-color 与 backdrop-filter 都量出来，
 * 再叠加 `html.desktop-glass`（桌面端才有的半透明基底）复量一次 ——
 * 桌面端的不一致多半就出在「各层 alpha 不同、叠在同一个 Acrylic 背景上」。
 *
 * 跑之前确保 5180 在（用你自己开着的那个即可）。
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9374
const URL_APP = 'http://localhost:5180/'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-dark-'))

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--no-proxy-server',
    '--window-size=1084,736',
    URL_APP,
  ],
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
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
const send = (method, params = {}) => {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)))
  })
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __ERR: String(r.exceptionDetails.exception?.description ?? '').slice(0, 300) }
  return r.result.value
}
const click = async (x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    })
    await sleep(30)
  }
}
const clickSel = async (sel) => {
  const p = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
  })()`)
  if (p) await click(p.x, p.y)
  await sleep(400)
}

await send('Page.enable')
await send('Runtime.enable')
for (let i = 0; i < 60; i++) {
  if ((await evaluate(`!!document.querySelector('.app-shell')`)) === true) break
  await sleep(300)
}

/* ---------- 强制深色：点设置 → 点「深色」 ---------- */
await clickSel('.sidebar .nav-item:nth-child(1)')
await evaluate(`(() => { const el=[...document.querySelectorAll('.sidebar *')].find(e=>e.textContent.trim()==='设置'); if(el) el.click(); return true })()`)
await sleep(900)
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('*')].find(e => e.textContent.trim() === '深色' && e.children.length <= 2)
  if (btn) (btn.closest('button') ?? btn).click()
  return true
})()`)
await sleep(700)

const PROBE = `(() => {
  const rows = []
  const seen = new Set()
  const push = (label, el) => {
    if (!el || seen.has(el)) return
    seen.add(el)
    const s = getComputedStyle(el)
    rows.push({
      区域: label,
      元素: el.className.toString().split(' ').slice(0, 2).join('.') || el.tagName.toLowerCase(),
      bg: s.backgroundColor,
      模糊: s.backdropFilter === 'none' ? '-' : s.backdropFilter,
      透明: s.backgroundColor.includes('rgba') && !s.backgroundColor.endsWith(', 1)'),
    })
  }
  push('html', document.documentElement)
  push('body', document.body)
  push('外壳', document.querySelector('.app-shell'))
  push('侧栏', document.querySelector('.sidebar'))
  push('侧栏滚动区', document.querySelector('.sidebar .sidebar-scroll') ?? document.querySelector('.sidebar nav'))
  push('内容区', document.querySelector('.content'))
  push('顶栏', document.querySelector('.view-header'))
  push('滚动宿主', document.querySelector('.view-body'))
  const bodyKid = document.querySelector('.view-body > *')
  push('滚动宿主内首层', bodyKid)
  push('设置面板', document.querySelector('.settings-panel') ?? document.querySelector('.view-body > * > *'))
  const card = [...document.querySelectorAll('.view-body *')].find((e) => {
    const s = getComputedStyle(e)
    return s.borderRadius !== '0px' && s.backgroundColor !== 'rgba(0, 0, 0, 0)'
  })
  push('首个圆角卡片', card)
  push('播放条', document.querySelector('.player-bar'))
  push('播放条胶囊', document.querySelector('.player-bar .capsule') ?? document.querySelector('.capsule'))
  push('窗口钮条', document.querySelector('.titlebar'))
  push('环境光层', document.querySelector('.ambient-layer'))
  return { glass: document.documentElement.classList.contains('desktop-glass'), rows }
})()`

console.log('=== ① 浏览器形态（无 desktop-glass，基底不透明）===')
let r = await evaluate(PROBE)
console.log('desktop-glass =', r.glass)
console.table(r.rows)

await evaluate(`document.documentElement.classList.add('desktop-glass')`)
await sleep(400)
console.log('\n=== ② 模拟桌面端（挂上 desktop-glass，基底转半透明 + Acrylic）===')
r = await evaluate(PROBE)
console.log('desktop-glass =', r.glass)
console.table(r.rows)

ws.close()
proc.kill()
console.log('\ndone')
