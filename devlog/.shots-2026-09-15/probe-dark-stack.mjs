import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 深色模式下「各区域表面色」排查 · v2
 *
 * v1 的教训：外壳容器本身都是 `background: transparent`，真正上色的是里层元素，
 * 所以按选择器读容器属性只会读到一片 rgba(0,0,0,0)。
 *
 * v2 改成**按屏幕坐标取图层栈**：在若干关键位置调 `elementsFromPoint`，
 * 把该点从顶到底每一层的 background-color / background-image / backdrop-filter
 * 全打出来 —— 这样能直接看出「同一屏上不同区域的合成结果为什么不一样」。
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9375
const URL_APP = 'http://localhost:5180/'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-dark2-'))

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
const evaluate = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  return r.exceptionDetails ? { __ERR: String(r.exceptionDetails.exception?.description ?? '').slice(0, 200) } : r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
for (let i = 0; i < 60; i++) {
  if ((await evaluate(`!!document.querySelector('.app-shell')`)) === true) break
  await sleep(300)
}

/* 强制深色 */
await evaluate(`(() => { const el=[...document.querySelectorAll('.sidebar *')].find(e=>e.textContent.trim()==='设置'); if(el) el.click(); return true })()`)
await sleep(800)
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('*')].find(e => e.textContent.trim() === '深色' && e.children.length <= 2)
  if (btn) (btn.closest('button') ?? btn).click()
  return true
})()`)
await sleep(700)

const STACK = (x, y) => `(() => {
  const cls = (el) => (el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0,2).join('.') : '') || el.tagName.toLowerCase()
  return document.elementsFromPoint(${x}, ${y}).slice(0, 7).map((el) => {
    const s = getComputedStyle(el)
    const img = s.backgroundImage === 'none' ? '' : s.backgroundImage.replace(/\\s+/g, ' ').slice(0, 78)
    return cls(el) + '  bg=' + s.backgroundColor + (img ? '  img=' + img : '') + (s.backdropFilter === 'none' ? '' : '  blur=' + s.backdropFilter)
  })
})()`

const POINTS = [
  ['侧栏中部', 120, 420],
  ['内容区空白', 470, 430],
  ['设置面板内', 700, 430],
  ['顶栏', 640, 25],
  ['播放条', 540, 680],
]

for (const mode of ['浏览器形态', '模拟桌面端（desktop-glass）']) {
  if (mode.startsWith('模拟')) {
    await evaluate(`document.documentElement.classList.add('desktop-glass')`)
    await sleep(400)
  }
  console.log('\n========== ' + mode + ' ==========')
  console.log('html bg =', await evaluate(`getComputedStyle(document.documentElement).backgroundColor`))
  console.log('body bg =', await evaluate(`getComputedStyle(document.body).backgroundColor`))
  for (const [label, x, y] of POINTS) {
    console.log('\n【' + label + '】(' + x + ',' + y + ')')
    for (const line of await evaluate(STACK(x, y))) console.log('   ' + line)
  }
}

ws.close()
proc.kill()
console.log('\ndone')
