import { watch } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'

/**
 * 「封面随液态玻璃漩涡卷入播放器」动画（添加文件夹 / 重新扫描时触发）：
 * 扫描开始后，视口正中心浮现液态玻璃漩涡（半透水膜 + 白色平滑螺旋 + 深核）；
 * 每落库一批歌，对应封面（同专辑去重）从漩涡四周的随机环带上沿极坐标螺旋
 * 向心汇聚（与水纹同向，像被水流带走），全部卷入后漩涡抽空消失。
 *
 * 工程防线与 coverFlight 同构：reduced-motion / 页面过渡互斥（ui.dolly）/
 * 歌词页跳过 / 后台标签跳过；批与张双重限流防大库雪崩。
 */

const FLIGHT_MS = 860
const STAGGER_MS = 130
const JITTER_MS = 40
/** 批间等待：避免上一批未消失就叠下一批造成视觉拥挤与掉帧 */
const BATCH_GAP = 420
/** 飞行封面边长 */
const START_SIZE = 128
/** 每批最多起飞张数 */
const BATCH_CAP = 6
/** 单次扫描会话累计起飞上限（大库防雪崩） */
const SESSION_CAP = 24
/** 触达漩涡时刻占比 */
const LAND_AT = 0.72
/** coverUrl 等待上限：动画不拖扫描节奏 */
const SOURCE_TIMEOUT = 300
/** 漩涡容器边长（视口正中心） */
const BH_SIZE = 216

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/* ================= 漩涡构建（液态玻璃） ================= */

/**
 * 平滑阿基米德螺旋路径：密采样（170 点）代替手绘折线，
 * 肉眼完全圆滑无棱角。画布 124×124，中心 62。
 */
function spiralPath(turns = 2.05, points = 170): string {
  const cx = 62
  const cy = 62
  const rStart = 4
  const rEnd = 57
  let d = ''
  for (let i = 0; i <= points; i++) {
    const t = i / points
    const a = t * turns * Math.PI * 2
    const r = rStart + (rEnd - rStart) * t
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2)
  }
  return d
}

const SPIRAL_D = spiralPath()

function layer(style: Record<string, string>): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, style as unknown as CSSStyleDeclaration)
  return el
}

/** 白色平滑螺旋水纹（三条 120° 对称臂，粗细一致、透明度递减） */
function spiralLayer(): HTMLElement {
  const box = layer({
    position: 'absolute',
    inset: '0',
    willChange: 'transform',
  })
  const arms = [
    { w: 2.2, op: 0.68, rot: 0 },
    { w: 2.2, op: 0.52, rot: 120 },
    { w: 2.2, op: 0.36, rot: 240 },
  ]
  const paths = arms
    .map(
      (a) =>
        `<path d="${SPIRAL_D}" stroke-width="${a.w}" opacity="${a.op}"${
          a.rot ? ` transform="rotate(${a.rot} 62 62)"` : ''
        }/>`,
    )
    .join('')
  box.innerHTML =
    `<svg viewBox="0 0 124 124" width="100%" height="100%" aria-hidden="true">` +
    `<g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
  return box
}

/* ================= 漩涡生命周期 ================= */

let vortex: HTMLElement | null = null
let vortexSwirl: HTMLElement | null = null
let bhCollapsing = false

/** 液态玻璃漩涡：水光 halo → 半透水膜 → 白螺旋 → 深核 → 固定高光 */
function ensureVortex(): HTMLElement | null {
  if (bhCollapsing) return null
  if (vortex) return vortex
  const el = document.createElement('div')
  el.className = 'absorb-vortex'
  Object.assign(el.style, {
    position: 'fixed',
    left: `calc(50% - ${BH_SIZE / 2}px)`,
    top: `calc(50% - ${BH_SIZE / 2}px)`,
    width: `${BH_SIZE}px`,
    height: `${BH_SIZE}px`,
    zIndex: '45', // 低于歌词页（50）：歌词页打开时被自然遮盖
    pointerEvents: 'none',
  } as CSSStyleDeclaration)

  const halo = layer({
    position: 'absolute',
    inset: '-88px',
    borderRadius: '50%',
    background:
      'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 12%, transparent) 0%, transparent 72%)',
    willChange: 'transform, opacity',
  })
  const film = layer({
    position: 'absolute',
    inset: '8px',
    borderRadius: '50%',
    background:
      'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 22%, rgba(255,255,255,.5)) 0%, color-mix(in srgb, var(--accent) 10%, transparent) 62%, transparent 78%)',
    boxShadow: 'inset 0 1px 1px color-mix(in srgb, #ffffff 70%, transparent)',
  })
  const spiral = spiralLayer()
  const core = layer({
    position: 'absolute',
    inset: '64px',
    borderRadius: '50%',
    background:
      'radial-gradient(circle, color-mix(in srgb, var(--accent) 70%, #05070f) 0%, transparent 74%)',
  })
  const gloss = layer({
    position: 'absolute',
    inset: '8px',
    borderRadius: '50%',
    background: 'linear-gradient(190deg, rgba(255, 255, 255, 0.3), transparent 38%)',
  })

  el.append(halo, film, spiral, core, gloss)
  document.body.appendChild(el)
  vortex = el
  vortexSwirl = spiral

  el.animate(
    [
      { transform: 'scale(0.45)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 500, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'both' },
  )
  halo.animate(
    [
      { opacity: 0.6, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.06)' },
      { opacity: 0.6, transform: 'scale(1)' },
    ],
    { duration: 4600, easing: 'ease-in-out', iterations: Infinity },
  )
  vortexSwirl?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
    duration: 16000,
    easing: 'linear',
    iterations: Infinity,
  })
  return el
}

function blackholeCenter(): { x: number; y: number } | null {
  if (!vortex) return null
  const r = vortex.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** 封面触达时的水面凹陷 */
function pulseVortex(): void {
  vortex?.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.06)' },
      { transform: 'scale(1)' },
    ],
    { duration: 260, easing: 'ease-out' },
  )
}

async function waitUntilIdle(maxWaitMs = 2600): Promise<void> {
  const t0 = Date.now()
  while (inFlight > 0 && Date.now() - t0 < maxWaitMs) await wait(60)
  await wait(90)
}

/** 收尾：水被抽空——水纹加速旋转并旋出消失 */
function collapseVortex(): void {
  const el = vortex
  if (!el) return
  bhCollapsing = true
  vortex = null
  vortexSwirl?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(120deg)' }], {
    duration: 420,
    easing: 'ease-in',
  })
  el.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(0.28)', opacity: 0 },
    ],
    { duration: 440, easing: 'ease-in', fill: 'forwards' },
  )
    .finished.then(() => el.remove(), () => el.remove())
  window.setTimeout(() => {
    bhCollapsing = false
  }, 600)
}

/* ================= 封面飞行：四面八方螺旋向心 ================= */

let sinkInstalled = false
let sessionFlights = 0
const flownCoverIds = new Set<string>()
let queue: string[][] = []
let pumping = false
let inFlight = 0
let lastPulseAt = 0
let sessionEnding = false
let clearFlownOnNextEnqueue = false
const lite = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2
const flightMs = lite ? Math.round(FLIGHT_MS * 0.75) : FLIGHT_MS
const staggerMs = lite ? 100 : STAGGER_MS

function reportDebug(): void {
  if (!import.meta.env.DEV) return
  ;(window as any).__absorbDebug = () => ({
    queueLen: queue.length,
    flying: document.querySelectorAll('.absorb-flight').length,
    sessionFlights,
    flown: flownCoverIds.size,
    vortex: !!vortex,
  })
}

function enqueue(coverIds: string[]): void {
  if (reduced() || document.hidden) return
  const ui = useUiStore()
  if (ui.dolly !== 'idle') return
  if (ui.lyricsOpen) return
  if (!document.querySelector('.player-bar')) return
  if (clearFlownOnNextEnqueue) {
    flownCoverIds.clear()
    sessionFlights = 0
    clearFlownOnNextEnqueue = false
  }
  if (!ensureVortex()) return
  queue.push(coverIds)
  void pump()
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (queue.length > 0) {
      const ids = queue.shift()!
      await flyBatch(ids)
      await wait(BATCH_GAP)
      await waitUntilIdle(flightMs)
    }
  } finally {
    pumping = false
    if (sessionEnding) {
      await waitUntilIdle()
      collapseVortex()
      sessionEnding = false
    }
  }
}

async function flyBatch(ids: string[]): Promise<void> {
  if (sessionFlights >= SESSION_CAP) {
    pulseVortex()
    return
  }
  const picks: string[] = []
  for (const id of ids) {
    if (flownCoverIds.has(id)) continue
    flownCoverIds.add(id)
    picks.push(id)
    if (picks.length >= BATCH_CAP) break
  }
  if (picks.length === 0) return
  sessionFlights += picks.length

  const lib = useLibraryStore()
  const srcs = await Promise.all(
    picks.map((id) =>
      Promise.race([
        Promise.resolve(lib.peekCoverUrl(id) ?? lib.coverUrl(id).catch(() => null)),
        wait(SOURCE_TIMEOUT).then(() => null),
      ]),
    ),
  )
  const last = srcs.length - 1
  srcs.forEach((src, i) => {
    if (!src) return
    window.setTimeout(() => flyOne(src, i === last), i * staggerMs + Math.random() * JITTER_MS * 2)
  })
}

/** 起飞点：漩涡四周的随机环带（四面八方汇聚） */
function pickRingOrigin(c: { x: number; y: number }): { x: number; y: number } {
  const margin = 44
  const clampX = (v: number) => Math.min(window.innerWidth - margin, Math.max(margin, v))
  const clampY = (v: number) => Math.min(window.innerHeight - margin, Math.max(margin, v))
  const θ = Math.random() * Math.PI * 2
  for (let i = 0; i < 8; i++) {
    const r = 320 + Math.random() * 220
    const x = c.x + Math.cos(θ + (Math.random() - 0.5) * 0.5) * r
    const y = c.y + Math.sin(θ + (Math.random() - 0.5) * 0.5) * r
    if (x > margin && x < window.innerWidth - margin && y > margin && y < window.innerHeight - margin) {
      return { x, y }
    }
  }
  const r = 170 + Math.random() * 120
  return { x: clampX(c.x + Math.cos(θ) * r), y: clampY(c.y + Math.sin(θ) * r) }
}

function flyOne(src: string | null, isLast: boolean): void {
  const c = blackholeCenter()
  if (!c) return
  const from = pickRingOrigin(c)

  const el = document.createElement('div')
  el.className = 'absorb-flight'
  Object.assign(el.style, {
    position: 'fixed',
    left: `${from.x - START_SIZE / 2}px`,
    top: `${from.y - START_SIZE / 2}px`,
    width: `${START_SIZE}px`,
    height: `${START_SIZE}px`,
    borderRadius: '12px',
    zIndex: '70',
    pointerEvents: 'none',
    willChange: 'transform, opacity',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-2)',
  } as CSSStyleDeclaration)
  if (src) {
    const img = document.createElement('img')
    img.src = src
    Object.assign(img.style, {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
    } as CSSStyleDeclaration)
    el.appendChild(img)
  } else {
    // 无封面：accent 渐变色块代替
    el.style.background =
      'linear-gradient(145deg, color-mix(in srgb, var(--accent) 85%, #ffffff), var(--accent))'
  }
  document.body.appendChild(el)

  const dx = from.x - c.x
  const dy = from.y - c.y
  const r0 = Math.hypot(dx, dy)
  const θ0 = Math.atan2(dy, dx)
  // 统一顺时针：与水纹同向
  const spinTotal = 110 + Math.random() * 70

  const offsets = [0, 0.18, 0.4, 0.62, 0.82, 1]
  const frames = offsets.map((t) => {
    const rot = spinTotal * t * t
    const th = θ0 + (rot * Math.PI) / 180
    const r = Math.max(6, r0 * (1 - t * t))
    const x = c.x + Math.cos(th) * r
    const y = c.y + Math.sin(th) * r
    const scale = 0.92 - 0.78 * t
    return {
      transform: `translate(${(x - from.x).toFixed(1)}px, ${(y - from.y).toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`,
      opacity: t === 0 ? 0 : t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.58) / 0.42),
      offset: t,
      easing: 'cubic-bezier(0.45, 0, 0.75, 0.6)',
    }
  })
  const anim = el.animate(frames, { duration: flightMs, fill: 'both' })
  inFlight++

  window.setTimeout(() => {
    if (Date.now() - lastPulseAt > 180) {
      lastPulseAt = Date.now()
      pulseVortex()
    }
  }, Math.round(flightMs * LAND_AT))
  if (isLast) window.setTimeout(() => pulseVortex(), Math.round(flightMs * 0.88))

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    el.remove()
    inFlight--
    if (inFlight < 0) inFlight = 0
  }
  anim.finished.then(cleanup, cleanup)
  window.setTimeout(cleanup, Math.round(flightMs * 0.92))
}

/** App onMounted 调用一次：订阅扫描批次 + 会话收尾 */
export function installAbsorbFlight(): void {
  if (sinkInstalled) return
  sinkInstalled = true
  reportDebug()
  const library = useLibraryStore()
  library.setScanBatchSink(enqueue)
  watch(
    () => library.scanning,
    (on, was) => {
      if (!was && on) {
        flownCoverIds.clear()
        sessionFlights = 0
        sessionEnding = false
        return
      }
      if (was && !on) {
        sessionFlights = 0
        sessionEnding = true
        // 不清 queue：重扫演出/慢落库的批要继续飞完，泵抽空后漩涡才收
        if (!pumping) {
          if (queue.length > 0) void pump()
          else {
            void waitUntilIdle().then(() => {
              collapseVortex()
              sessionEnding = false
            })
          }
        }
      }
    },
  )
}
