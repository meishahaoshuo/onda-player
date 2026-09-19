/**
 * README 配图生成脚本（2026-09-19）
 *
 * 为什么需要它：README 里不能放空库截图 —— 空态只有一个「还没有音乐文件」的插画，
 * 看不出这个播放器长什么样。本脚本往 OPFS 写一批**自造 MP3**，走完整的
 * 扫描 → 入库 → 封面 → 歌词链路，再逐视图截图。
 *
 * 两个必须遵守的约束（踩过）：
 *  1. **封面必须内嵌进 MP3 文件**。歌词页/专辑详情的大封面走 `extractHiResCover()`，
 *     那是从音频文件里抽图，不是读 IndexedDB 的缩略图 —— 只在库里换图的话，
 *     大图上出现的还是文件里那张。
 *  2. **标签必须写 UTF-16**。ID3v2.3 的 0x00 编码是 ISO-8859-1，中文写进去会乱码；
 *     用 0x01 + BOM 才对（帧长度仍是普通整数，v2.4 的 synchsafe 帧长是个坑，避开了）。
 *
 * 产物：docs/screenshots/*.png（README 直接引用）
 * 运行：先 `npm run dev`，再 `node devlog/.shots-2026-09-19/readme-shots.mjs`
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9373
const APP = 'http://localhost:5180/'
const SHOT_DIR = 'D:\\项目\\音乐播放器\\docs\\screenshots'
const W = 1440
const H = 900

/* ------------------------------------------------------------------ *
 * CDP 脚手架（与 devlog 既有 verify-*.mjs 同一套写法：裸 WebSocket，无依赖）
 * ------------------------------------------------------------------ */

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda-shots-'))
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
    `--window-size=${W},${H}`,
    APP,
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
const consoleErrors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? 'exception')
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
}

function send(method, params = {}) {
  const id = ++msgId
  return new Promise((res, rej) => {
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (r.exceptionDetails) {
    throw new Error(`page eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  }
  return r.result.value
}

async function shot(name, clip) {
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, 'base64'))
  const kb = (fs.statSync(path.join(SHOT_DIR, name)).size / 1024).toFixed(0)
  console.log(`  ✓ ${name} (${kb} KB)`)
}

/** 等页面里某个表达式稳定为真 */
async function waitFor(expr, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await evaluate(expr)) return
    } catch {}
    await sleep(250)
  }
  throw new Error(`等待超时：${label}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: H,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url: APP })
await waitFor('!!window.__musicTest', '测试桥就绪')
await waitFor('!!document.querySelector(".sidebar")', '主应用挂载')
await sleep(1200)

/* ------------------------------------------------------------------ *
 * 演示数据：6 张专辑 / 18 首 / 6 位艺术家
 * ------------------------------------------------------------------ */

const SEED = String.raw`
(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')

  /* ---------- 自造专辑封面 ----------
     每张一个版式，风格拉开距离，专辑网格才有「真库」的观感。
     尺寸 700：歌词页大图约 300~420px 宽，够用又别把 OPFS 撑大。 */
  const ART = 700
  async function paintCover(spec) {
    const c = document.createElement('canvas')
    c.width = c.height = ART
    const x = c.getContext('2d')
    const S = ART
    const grad = (stops, vertical = true) => {
      const g = x.createLinearGradient(0, 0, vertical ? 0 : S, vertical ? S : 0)
      for (const [at, col] of stops) g.addColorStop(at, col)
      return g
    }
    const grain = (n = 2600, alpha = 0.05) => {
      for (let i = 0; i < n; i++) {
        x.fillStyle = 'rgba(255,255,255,' + (Math.random() * alpha).toFixed(3) + ')'
        x.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4)
      }
    }

    switch (spec.style) {
      case 'night': {
        x.fillStyle = grad([[0, '#0b1a3a'], [0.55, '#16305f'], [1, '#2a1b46']])
        x.fillRect(0, 0, S, S)
        const moon = x.createRadialGradient(S * 0.72, S * 0.26, 4, S * 0.72, S * 0.26, S * 0.46)
        moon.addColorStop(0, 'rgba(233,240,255,0.92)')
        moon.addColorStop(0.12, 'rgba(190,214,255,0.30)')
        moon.addColorStop(1, 'rgba(190,214,255,0)')
        x.fillStyle = moon
        x.fillRect(0, 0, S, S)
        x.strokeStyle = 'rgba(198,220,255,0.5)'
        x.lineWidth = 2.5
        for (let i = 0; i < 3; i++) {
          x.beginPath()
          x.arc(S * 0.16, S * 0.9, S * (0.34 + i * 0.2), -Math.PI * 0.72, -Math.PI * 0.3)
          x.stroke()
        }
        grain(3200, 0.07)
        break
      }
      case 'city': {
        x.fillStyle = grad([[0, '#dfe7f2'], [1, '#9fb4d0']])
        x.fillRect(0, 0, S, S)
        x.strokeStyle = 'rgba(40,62,96,0.22)'
        x.lineWidth = 2
        for (let i = 1; i < 7; i++) {
          x.beginPath(); x.moveTo(0, (S / 7) * i); x.lineTo(S, (S / 7) * i); x.stroke()
        }
        const cols = 9
        for (let i = 0; i < cols; i++) {
          const w = S / cols
          const h = S * (0.16 + 0.46 * ((i * 37) % 11) / 11)
          x.fillStyle = 'rgba(30,48,78,' + (0.30 + 0.42 * ((i * 17) % 7) / 7).toFixed(2) + ')'
          x.fillRect(i * w + w * 0.18, S - h - S * 0.1, w * 0.64, h)
        }
        x.fillStyle = 'rgba(233,90,74,0.9)'
        x.beginPath(); x.arc(S * 0.24, S * 0.22, S * 0.055, 0, Math.PI * 2); x.fill()
        break
      }
      case 'mist': {
        x.fillStyle = grad([[0, '#f4efe4'], [1, '#c3ccb8']])
        x.fillRect(0, 0, S, S)
        const layers = [
          ['rgba(126,143,124,0.34)', 0.60], ['rgba(92,110,96,0.44)', 0.68],
          ['rgba(59,77,66,0.62)', 0.78], ['rgba(31,46,40,0.86)', 0.9],
        ]
        layers.forEach(([col, base], li) => {
          x.fillStyle = col
          x.beginPath()
          x.moveTo(0, S)
          for (let i = 0; i <= 10; i++) {
            const px = (S / 10) * i
            const py = S * base - Math.sin(i * 1.15 + li * 2.1) * S * 0.075 - li * S * 0.012
            x.lineTo(px, py)
          }
          x.lineTo(S, S)
          x.closePath()
          x.fill()
        })
        x.fillStyle = 'rgba(255,255,255,0.34)'
        x.fillRect(0, S * 0.46, S, S * 0.075)
        grain(1800, 0.06)
        break
      }
      case 'sea': {
        x.fillStyle = grad([[0, '#ffd9bd'], [0.42, '#f5a98c'], [0.43, '#2f6e86'], [1, '#12414f']])
        x.fillRect(0, 0, S, S)
        x.fillStyle = 'rgba(255,246,224,0.95)'
        x.beginPath(); x.arc(S * 0.5, S * 0.42, S * 0.13, 0, Math.PI * 2); x.fill()
        x.strokeStyle = 'rgba(226,246,255,0.55)'
        x.lineWidth = 3
        for (let i = 0; i < 7; i++) {
          const y = S * (0.52 + i * 0.068)
          x.beginPath()
          for (let px = 0; px <= S; px += 6) {
            const py = y + Math.sin(px / 34 + i) * (2 + i * 1.2)
            px === 0 ? x.moveTo(px, py) : x.lineTo(px, py)
          }
          x.globalAlpha = 0.75 - i * 0.085
          x.stroke()
        }
        x.globalAlpha = 1
        break
      }
      case 'film': {
        x.fillStyle = grad([[0, '#e8d3ae'], [0.5, '#b98f5e'], [1, '#6b4626']])
        x.fillRect(0, 0, S, S)
        x.fillStyle = 'rgba(28,20,12,0.9)'
        x.fillRect(0, 0, S * 0.11, S)
        x.fillRect(S * 0.89, 0, S * 0.11, S)
        x.fillStyle = 'rgba(232,219,196,0.92)'
        for (let i = 0; i < 9; i++) {
          x.fillRect(S * 0.028, S * (0.035 + i * 0.106), S * 0.054, S * 0.05)
          x.fillRect(S * 0.918, S * (0.035 + i * 0.106), S * 0.054, S * 0.05)
        }
        const glow = x.createRadialGradient(S * 0.5, S * 0.5, 8, S * 0.5, S * 0.5, S * 0.4)
        glow.addColorStop(0, 'rgba(255,190,120,0.85)')
        glow.addColorStop(1, 'rgba(255,150,80,0)')
        x.fillStyle = glow
        x.fillRect(0, 0, S, S)
        grain(4200, 0.12)
        break
      }
      default: {
        x.fillStyle = grad([[0, '#08282c'], [1, '#031316']])
        x.fillRect(0, 0, S, S)
        x.strokeStyle = 'rgba(126,224,214,0.5)'
        for (let i = 1; i <= 7; i++) {
          x.lineWidth = 3.4 - i * 0.34
          x.beginPath()
          x.arc(S * 0.5, S * 0.42, i * S * 0.062, 0, Math.PI * 2)
          x.stroke()
        }
        x.strokeStyle = 'rgba(150,232,255,0.30)'
        x.lineWidth = 2
        for (let i = 0; i < 46; i++) {
          const sx = Math.random() * S
          const sy = Math.random() * S * 0.9
          x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx - S * 0.055, sy + S * 0.16); x.stroke()
        }
        break
      }
    }

    // 专辑名压在左下角：字号小、字距松，像正经封面而不是海报
    x.fillStyle = 'rgba(255,255,255,0.92)'
    x.font = '600 30px "Microsoft YaHei", sans-serif'
    x.letterSpacing = '6px'
    x.shadowColor = 'rgba(0,0,0,0.42)'
    x.shadowBlur = 12
    x.fillText(spec.album, S * 0.085, S * 0.925)
    x.shadowBlur = 0
    x.letterSpacing = '0px'

    return await new Promise((r) => c.toBlob((b) => r(b), 'image/png'))
  }

  /* ---------- 自造 MP3：ID3v2.3（UTF-16 文本帧 + APIC）+ CBR 32kbps 静音帧 ----------
     32kbps / 44.1kHz → 每帧 104 字节、26.122ms。用低码率是为了让「时长真实但文件小」：
     一首 4 分钟的歌约 1MB，18 首 ≈ 19MB，写进 OPFS 不会拖慢脚本。 */
  const FRAME_BYTES = 104
  const FRAME_MS = 26.122

  function utf16le(text) {
    const out = []
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      out.push(code & 0xff, (code >> 8) & 0xff)
    }
    out.push(0, 0) // UTF-16 的字符串结束符是两个 0
    return out
  }
  function textFrame(id, text) {
    const body = [0x01, 0xff, 0xfe, ...utf16le(text)] // 0x01 = UTF-16 + BOM
    const size = body.length
    return [
      ...[...id].map((ch) => ch.charCodeAt(0)),
      (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff, 0x00, 0x00,
      ...body,
    ]
  }
  const synch = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]

  async function makeMp3({ art, title, artist, album, genre, year, trackNo, sec, lyrics }) {
    const pic = new Uint8Array(await art.arrayBuffer())
    const body = [
      0x00,
      ...[...'image/png'].map((ch) => ch.charCodeAt(0)),
      0x00,
      0x03, // 图片类型：正面封面
      0x00,
      ...pic,
    ]
    /* USLT 内嵌歌词：网页形态读不到同目录 .lrc（readLrcFile 只有桌面分支），
       所以歌词必须内嵌 —— 恰好 scanner 也会把 USLT 收进 embeddedLyrics。
       字段顺序固定为 编码 → 语言(3) → 描述符 → 正文，顺序错了解析器读不出来。 */
    const uslt = [
      0x01, // 编码：UTF-16 + BOM
      0x63, 0x68, 0x69, // 语言：chi
      0xff, 0xfe, 0x00, 0x00, // 描述符：空
      0xff, 0xfe, ...utf16le(lyrics),
    ]
    const tagBody = [
      ...textFrame('TIT2', title),
      ...textFrame('TPE1', artist),
      ...textFrame('TALB', album),
      ...textFrame('TCON', genre),
      ...textFrame('TDRC', String(year)),
      ...textFrame('TRCK', String(trackNo)),
      0x55, 0x53, 0x4c, 0x54, // USLT
      (uslt.length >> 24) & 0xff, (uslt.length >> 16) & 0xff, (uslt.length >> 8) & 0xff, uslt.length & 0xff,
      0x00, 0x00,
      ...uslt,
      0x41, 0x50, 0x49, 0x43, // APIC
      (body.length >> 24) & 0xff, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff,
      0x00, 0x00,
      ...body,
    ]
    const tag = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, ...synch(tagBody.length), ...tagBody]

    const frames = Math.round((sec * 1000) / FRAME_MS)
    const audio = new Uint8Array(frames * FRAME_BYTES)
    for (let i = 0; i < frames; i++) {
      const o = i * FRAME_BYTES
      audio[o] = 0xff
      audio[o + 1] = 0xfb
      audio[o + 2] = 0x10 // MPEG-1 Layer III / 32kbps / 44.1kHz
      audio[o + 3] = 0x00
    }
    return new Blob([new Uint8Array(tag), audio], { type: 'audio/mpeg' })
  }

  /* ---------- 逐字歌词：增强型 LRC（<mm:ss.xx> 词标签）----------
     作者只写「一段」的绝对时间，这里把它当模板按整首歌长平铺重复
     （真实歌词本来也是主歌/副歌反复）—— 这样任意 seek 时刻都有一行正在唱，
     截图不必去凑某一行的窗口。 */
  function lrc({ title, artist, album, lines, sec }) {
    const head = '[ti:' + title + ']\n[ar:' + artist + ']\n[al:' + album + ']\n[by:Onda Player]\n'
    const span = Math.max(...lines.map(([t]) => t)) + 3.4
    const repeats = Math.max(1, Math.floor((sec * 0.88) / span))
    const fmt = (t) =>
      '[' + String(Math.floor(t / 60)).padStart(2, '0') + ':' + (t % 60).toFixed(2).padStart(5, '0') + ']'
    const out = []
    for (let r = 0; r < repeats; r++) {
      for (const [t, zh, en] of lines) {
        const at = sec * 0.045 + r * span + t
        let cursor = at
        const tagged = [...zh]
          .map((ch) => {
            const tag = fmt(cursor)
            cursor += 0.34
            return tag.replace('[', '<').replace(']', '>') + ch
          })
          .join('')
        out.push(fmt(at) + tagged)
        if (en) out.push(fmt(at + 0.02) + en)
      }
    }
    return head + out.join('\n') + '\n'
  }

  const ALBUMS = [
    {
      album: '夜航西飞', artist: '林与舟', genre: '后摇', year: 2024, style: 'night',
      tracks: [['夜航西飞', 268], ['潮汐线', 231], ['北纬三十度', 305]],
      lyrics: [
        [0.5, '起飞的灯把云层烫出一个洞', 'The runway lights burn a hole through the clouds'],
        [6.2, '我把音量调到刚好盖住引擎', 'I turn the volume up to just cover the engines'],
        [12.4, '舷窗外是没有人认领的夜色', 'Outside the window, an unclaimed night'],
        [18.8, '北纬三十度以北 风向不明', 'North of thirty degrees, the wind is unknown'],
        [25.6, '耳机里那条河还在流', 'In my headphones, that river still runs'],
        [32.2, '它比地图诚实 也比地图远', 'More honest than any map, and farther too'],
      ],
    },
    {
      album: '城市气象', artist: '白露电台', genre: '电子', year: 2025, style: 'city',
      tracks: [['城市气象', 214], ['玻璃幕墙', 196], ['末班地铁', 248]],
      lyrics: [
        [1.0, '预报说今天有雨 但没有下', 'The forecast said rain, but it never came'],
        [7.4, '玻璃幕墙把天空折成两半', 'The glass facade folds the sky in two'],
        [14.2, '一半给白昼 一半留给加班', 'Half for daylight, half kept for overtime'],
        [21.0, '末班地铁正在穿过城市的背面', 'The last train crosses the back of the city'],
        [28.4, '而我还在替一颗像素失眠', 'And I am still sleepless over one pixel'],
      ],
    },
    {
      album: '山雾手记', artist: '沈青禾', genre: '民谣', year: 2023, style: 'mist',
      tracks: [['山雾手记', 287], ['溪谷', 205], ['一盏灯', 233]],
      lyrics: [
        [0.8, '雾从谷底上来 先湿了裤脚', 'Fog climbs from the valley, wetting my cuffs first'],
        [7.0, '再湿了不敢说出口的那些话', 'Then wetting the words I never dared to say'],
        [13.8, '溪水认得我 比我自己还早', 'The creek knew me before I knew myself'],
        [20.6, '它绕开石头 也绕开了答案', 'It goes around the stones, and around the answer'],
        [27.9, '山下有人亮了一盏灯', 'Someone down the hill lit a single lamp'],
      ],
    },
    {
      album: '星期天的海', artist: '陈屿', genre: '独立流行', year: 2026, style: 'sea',
      tracks: [['星期天的海', 242], ['浪涌', 219], ['退潮', 264]],
      lyrics: [
        [0.6, '星期天的海是浅蓝色的', 'The Sunday sea is a pale blue'],
        [6.8, '风把心事吹成一条水平线', 'The wind flattens every worry into a horizon'],
        [13.4, '浪涌过来的时候我没有躲', 'When the swell came in, I did not move'],
        [20.2, '退潮之后沙滩上全是脚印', 'After the tide, the sand is full of footprints'],
        [27.5, '只有我的那只还朝着海', 'Only mine is still pointing at the sea'],
      ],
    },
    {
      album: '旧胶片', artist: '拾光乐队', genre: '独立摇滚', year: 2022, style: 'film',
      tracks: [['旧胶片', 226], ['暗房', 251], ['显影液', 198]],
      lyrics: [
        [0.4, '冲印一张照片要等一个下午', 'One print takes a whole afternoon'],
        [6.5, '等的时间比拍的时间更长', 'The waiting outlasts the shooting'],
        [12.9, '暗房里红灯亮着 谁都没说话', 'In the darkroom the red light burns, nobody speaks'],
        [19.7, '显影液里慢慢浮出那年夏天', 'That summer slowly surfaces in the developer'],
        [26.4, '浮出来的时候 夏天已经走了', 'By the time it surfaces, the summer is gone'],
      ],
    },
    {
      album: '回声与雨', artist: '木野', genre: '氛围', year: 2025, style: 'echo',
      tracks: [['回声与雨', 312], ['屋檐', 236], ['低气压', 279]],
      lyrics: [
        [1.2, '雨落在屋檐上 回声比雨更长', 'Rain on the eaves, the echo outlasts the rain'],
        [8.1, '低气压让所有声音都变钝', 'Low pressure blunts every sound'],
        [15.3, '我说了一句 山谷说了三遍', 'I said it once, the valley said it three times'],
        [22.6, '第三遍的时候 我已经忘了原话', 'By the third time, I forgot my own words'],
        [30.0, '雨还在下 回声已经停了', 'The rain goes on, the echo has stopped'],
      ],
    },
  ]

  /* ---------- 落盘 ---------- */
  const opfs = await navigator.storage.getDirectory()
  try { await opfs.removeEntry('demo-music', { recursive: true }) } catch {}
  const dir = await opfs.getDirectoryHandle('demo-music', { create: true })

  const write = async (name, blob) => {
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(blob)
    await w.close()
  }

  let n = 0
  for (const a of ALBUMS) {
    const art = await paintCover(a)
    for (let i = 0; i < a.tracks.length; i++) {
      const [title, sec] = a.tracks[i]
      const base = a.artist + ' - ' + title
      await write(base + '.mp3', await makeMp3({
        art, title, artist: a.artist, album: a.album, genre: a.genre, year: a.year, trackNo: i + 1, sec,
        lyrics: lrc({ title, artist: a.artist, album: a.album, lines: a.lyrics, sec }),
      }))
      n++
    }
  }

  /* ---------- 入库 ---------- */
  const library = useLibraryStore()
  await library.registerRoot(dir)
  // 强制全量（新根目录自然是空的，这一步只是保险）
  await library.rescan()

  return { roots: library.roots.length, songs: library.songs.length, albums: library.albums.length }
})()
`

console.log('→ 造演示库存（6 专辑 / 18 首，含封面与逐字歌词）…')
const seeded = await evaluate(SEED)
console.log('  ', JSON.stringify(seeded))
const lyricProbe = await evaluate(`(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const s = useLibraryStore().sortedSongs.find((x) => x.embeddedLyrics)
  return s ? { title: s.title, chars: s.embeddedLyrics.length, head: s.embeddedLyrics.slice(0, 64) } : null
})()`)
console.log('   内嵌歌词自检:', JSON.stringify(lyricProbe))
await sleep(600)

/* 重载：让封面预热、聚合视图都从干净状态起来 */
await send('Page.reload')
await waitFor('!!window.__musicTest', '测试桥就绪（重载后）')
await waitFor('!!document.querySelector(".sidebar")', '主应用挂载（重载后）')
await sleep(2000)

console.log('→ 铺统计数据（排行榜 / 最近在听）与歌单…')
await evaluate(`(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const lib = useLibraryStore()
  const s = lib.sortedSongs
  // 排行榜：次数拉开档次，前三名才有领奖台效果
  const counts = [23, 19, 16, 12, 11, 9, 8, 7, 6, 5, 5, 4, 4, 3, 2, 2, 1, 1]
  for (let i = 0; i < s.length; i++) {
    for (let k = 0; k < (counts[i] ?? 1); k++) window.__musicTest.recordPlay(s[i].path)
  }
  // 我喜欢的音乐
  const { useFavoritesStore } = await import('/src/stores/favorites.ts')
  const fav = useFavoritesStore()
  for (const idx of [0, 4, 7, 11]) fav.toggle(s[idx].path)
  // 歌单
  const { usePlaylistStore } = await import('/src/stores/playlist.ts')
  const pl = usePlaylistStore()
  const rec = pl.create('深夜通勤')
  pl.addSongs(rec.id, [s[0].path, s[1].path, s[3].path, s[6].path, s[9].path, s[12].path, s[15].path])
  return { songs: s.length, favorites: Object.keys(fav.addedAt).length, playlists: pl.playlists.length }
})()`)

const THEME = `(async (mode) => {
  const { useSettingsStore } = await import('/src/stores/settings.ts')
  useSettingsStore().setThemeMode(mode)
  await new Promise((r) => setTimeout(r, 420))
})`
const NAV = `(async (view) => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().navigate(view)
  await new Promise((r) => setTimeout(r, 900))
})`
/* 播放并停在「某一行歌词正被逐字点亮」的时刻：按标题找曲目，
   从内嵌歌词取出行时间轴，选第 which 行，落在它刷到 45% 的位置。 */
const PLAY = `(async (title, which) => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const lib = useLibraryStore()
  const index = lib.sortedSongs.findIndex((s) => s.title === title)
  await window.__musicTest.playAt(index)
  await new Promise((r) => setTimeout(r, 500))
  const song = lib.sortedSongs[index]
  const starts = [...String(song.embeddedLyrics || '').matchAll(/^\\[(\\d+):(\\d+(?:\\.\\d+)?)\\]/gm)]
    .map((m) => Number(m[1]) * 60 + Number(m[2]))
  const uniq = [...new Set(starts.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b)
  const lineStarts = uniq.filter((_, i) => i % 2 === 0)
  const at = which % lineStarts.length
  const start = lineStarts[at] ?? 0
  const next = lineStarts[at + 1] ?? start + 4
  window.__musicTest.seek(start + (next - start) * 0.45)
  await new Promise((r) => setTimeout(r, 800))
  return window.__musicTest.playerState()
})`

/* 截图前重新落位：从 seek 到截图之间播放仍在推进，逐字填充会在这段时间里刷完；
   所以每次拍歌词页之前把进度重新拨到「该行刷到 30%」处，等一小会儿再拍。 */
const RESEEK = `(async (which, delay) => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  const { usePlayerStore } = await import('/src/stores/player.ts')
  const song = usePlayerStore().current
  const starts = [...String(song?.embeddedLyrics || '').matchAll(/^\\[(\\d+):(\\d+(?:\\.\\d+)?)\\]/gm)]
    .map((m) => Number(m[1]) * 60 + Number(m[2]))
  const uniq = [...new Set(starts.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b)
  const lineStarts = uniq.filter((_, i) => i % 2 === 0)
  const at = which % lineStarts.length
  const start = lineStarts[at] ?? 0
  const next = lineStarts[at + 1] ?? start + 4
  window.__musicTest.seek(start + (next - start) * 0.3)
  await new Promise((r) => setTimeout(r, delay))
  return window.__musicTest.playerState()
})`

console.log('→ 截图…')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const songList = await evaluate(`(async () => {
  const { useLibraryStore } = await import('/src/stores/library.ts')
  return useLibraryStore().sortedSongs.map((s) => s.path)
})()`)

// 1) 歌曲列表（浅色，播放中）
let st = await evaluate(`${PLAY}('城市气象', 7)`)
await evaluate(`${NAV}('songs')`)
await sleep(900)
await shot('01-songs-light.png')
console.log('   player:', JSON.stringify({ title: st.title, playing: st.playing, t: st.currentTime, d: st.duration }))

// 2) 专辑网格
await evaluate(`${NAV}('albums')`)
await sleep(1500)
await shot('02-albums-light.png')

// 3) 播放条特写：裁剪矩形按元素实测（写死坐标会被圆角与投影切掉）。
//    取景放在专辑页 —— 网格在上半部，胶囊四周是空白，不会有列表文字穿过。
const bar = await evaluate(`(() => {
  const r = document.querySelector('.player-bar').getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})()`)
await shot('03-player-bar.png', {
  x: Math.max(0, Math.round(bar.x - 44)),
  y: Math.max(0, Math.round(bar.y - 40)),
  width: Math.round(bar.w + 88),
  height: Math.round(bar.h + 82),
})

// 4) 排行榜（前三名领奖台 + 播放次数榜）
await evaluate(`${NAV}('charts')`)
await sleep(1500)
await shot('04-charts-light.png')

// 5) 全屏歌词：双语 + 逐字点亮
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().lyricsOpen = true
  await new Promise((r) => setTimeout(r, 1600))
})()`)
st = await evaluate(`${RESEEK}(7, 300)`)
await shot('05-lyrics-light.png')

// 6) 歌词页色场：整页底色由**当前封面**取色派生，与主题无关 ——
//    换一首深色封面的曲子，色场随之换调
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().lyricsOpen = false
  await new Promise((r) => setTimeout(r, 700))
})()`)
st = await evaluate(`${PLAY}('低气压', 5)`)
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().lyricsOpen = true
  await new Promise((r) => setTimeout(r, 1700))
})()`)
st = await evaluate(`${RESEEK}(5, 300)`)
await shot('06-lyrics-colorfield.png')
await evaluate(`(async () => {
  const { useUiStore } = await import('/src/stores/ui.ts')
  useUiStore().lyricsOpen = false
  await new Promise((r) => setTimeout(r, 700))
})()`)

// 7) 深色主题：歌曲列表
await evaluate(`${THEME}('dark')`)
await evaluate(`${NAV}('songs')`)
await sleep(1200)
await shot('07-songs-dark.png')

// 8) 设置页（外观分类）
await evaluate(`${NAV}('settings')`)
await sleep(1100)
await shot('08-settings-light.png')

console.log('控制台错误：', consoleErrors.length ? consoleErrors.slice(0, 8) : '无')
console.log('完成，产物目录：', SHOT_DIR)

ws.close()
proc.kill()
try {
  fs.rmSync(userDataDir, { recursive: true, force: true })
} catch {}
process.exit(0)
