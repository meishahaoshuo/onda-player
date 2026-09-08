import { watch } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

/**
 * 添加文件夹时「封面随水流漩涡卷入播放器」动画：
 * 扫描开始后，视口正中心浮现一个漩涡（六种样式可选，设置里可切换并预览）；
 * 每落库一批歌，对应封面（同专辑去重）从漩涡四周的随机环带上沿极坐标螺旋
 * 向心汇聚（与水纹同向，像被水流带走），全部卷入后漩涡抽空消失。
 *
 * 工程防线与 coverFlight 同构：reduced-motion / 页面过渡互斥（ui.dolly）/
 * 歌词页跳过 / 后台标签跳过；批与张双重限流防大库雪崩。
 */

export type AbsorbStyle = 'drain' | 'streamline' | 'ripple' | 'band' | 'glass' | 'ink'

/** 样式清单（设置页展示与预览用） */
export const ABSORB_STYLES: { key: AbsorbStyle; name: string; desc: string }[] = [
  { key: 'drain', name: '俯视排水口', desc: '漏斗口 + 螺旋水纹' },
  { key: 'streamline', name: '极简流线', desc: '三条细流线，最克制' },
  { key: 'ripple', name: '涟漪漩涡', desc: '螺旋 + 内收涟漪环' },
  { key: 'band', name: '双层水带', desc: '粗水臂，水量感强' },
  { key: 'glass', name: '液态玻璃', desc: '半透水膜 + 高光' },
  { key: 'ink', name: '水墨漩涡', desc: '墨色晕染，呼应澜' },
]

const FLIGHT_MS = 860
const STAGGER_MS = 130
const JITTER_MS = 40
/** 批间等待：避免上一批未消失就叠下一批造成视觉拥挤与掉帧 */
const BATCH_GAP = 420
/** 飞行封面边长 */
const START_SIZE = 104
/** 每批最多起飞张数 */
const BATCH_CAP = 6
/** 单次扫描会话累计起飞上限（大库防雪崩） */
const SESSION_CAP = 24
/** 触达漩涡时刻占比 */
const LAND_AT = 0.72
/** coverUrl 等待上限：动画不拖扫描节奏 */
const SOURCE_TIMEOUT = 300
/** 漩涡容器边长（视口正中心） */
const BH_SIZE = 176

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/* ================= 漩涡样式构建 ================= */

/** 阿基米德螺旋采样点（124 画布，中心 62，2 圈） */
const SPIRAL_D =
  'M68 62 L69 66 L67.1 70.8 L62 74.3 L54.8 74.4 L47.8 70.2 L43.5 62 L44.2 51.7 ' +
  'L50.7 42.4 L62 37.2 L75.4 38.7 L87.1 47.5 L93 62 L90.7 78.6 L79.6 92.5 L62 99.3 ' +
  'L42.3 96.1 L26.1 82.7 L18.5 62 L22.5 39.2 L38.1 20.7 L62 12.2 L87.9 17.1 L108.7 35 L118 62'

let gradientSeq = 0

function layer(style: Record<string, string>): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, style as unknown as CSSStyleDeclaration)
  return el
}

/** 螺旋水纹 SVG：paths 描述每条水纹的粗细/透明度/旋转角 */
function spiral(opts: {
  arms: { w: number; op: number; rot?: number }[]
  color?: string
  gradient?: boolean
}): HTMLElement {
  const box = document.createElement('div')
  Object.assign(box.style, {
    position: 'absolute',
    inset: '0',
    willChange: 'transform',
  } as CSSStyleDeclaration)
  const color = opts.color ?? 'var(--accent)'
  let defs = ''
  let stroke = color
  if (opts.gradient) {
    const id = `absArm${++gradientSeq}`
    defs =
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" style="stop-color:#ffffff;stop-opacity:.9"/>` +
      `<stop offset="55%" style="stop-color:${color}"/>` +
      `<stop offset="100%" style="stop-color:${color};stop-opacity:.15"/>` +
      `</linearGradient></defs>`
    stroke = `url(#${id})`
  }
  const paths = opts.arms
    .map(
      (a) =>
        `<path d="${SPIRAL_D}" stroke-width="${a.w}" opacity="${a.op}"${
          a.rot ? ` transform="rotate(${a.rot} 62 62)"` : ''
        }/>`,
    )
    .join('')
  box.innerHTML =
    `<svg viewBox="0 0 124 124" width="100%" height="100%" aria-hidden="true">${defs}` +
    `<g fill="none" stroke-linecap="round" style="stroke:${stroke}">${paths}</g></svg>`
  return box
}

interface VortexBuilt {
  layers: HTMLElement[]
  /** 旋转层（顺时针为默认，与水/封面同向） */
  spin: { el: HTMLElement; duration: number }[]
  halo?: HTMLElement
  /** 内收涟漪环（ripple 样式专用） */
  inhale?: HTMLElement[]
}

const BUILDERS: Record<AbsorbStyle, () => VortexBuilt> = {
  /* A 俯视排水口：深色漏斗 + 三条水纹 + 口沿 + 固定高光 */
  drain: () => ({
    halo: layer({
      position: 'absolute',
      inset: '-80px',
      borderRadius: '50%',
      background:
        'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 20%, transparent) 0%, color-mix(in srgb, var(--accent) 10%, transparent) 36%, color-mix(in srgb, var(--accent) 4%, transparent) 60%, transparent 76%)',
      willChange: 'transform, opacity',
    }),
    layers: [
      spiral({ arms: [{ w: 1.8, op: 0.5 }, { w: 1.3, op: 0.34, rot: 180 }, { w: 1, op: 0.2, rot: 150 }] }),
      layer({
        position: 'absolute',
        inset: '44px',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, color-mix(in srgb, var(--accent) 78%, #000000) 0%, color-mix(in srgb, var(--accent) 34%, #05070f) 58%, color-mix(in srgb, var(--accent) 12%, #05070f) 82%, transparent 100%)',
      }),
      layer({
        position: 'absolute',
        inset: '41px',
        borderRadius: '50%',
        background:
          'radial-gradient(closest-side, transparent 60%, color-mix(in srgb, #ffffff 42%, var(--accent)) 70%, transparent 80%)',
      }),
      layer({
        position: 'absolute',
        inset: '44px',
        borderRadius: '50%',
        background: 'linear-gradient(200deg, rgba(255, 255, 255, 0.26), transparent 46%)',
      }),
    ],
    spin: [],
  }),

  /* B 极简流线：三条细流线，无实体核 */
  streamline: () => ({
    halo: layer({
      position: 'absolute',
      inset: '-72px',
      borderRadius: '50%',
      background:
        'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 12%, transparent) 0%, transparent 70%)',
      willChange: 'transform, opacity',
    }),
    layers: [
      spiral({ arms: [{ w: 1.4, op: 0.7 }, { w: 1.4, op: 0.5, rot: 120 }, { w: 1.4, op: 0.35, rot: 240 }] }),
      layer({
        position: 'absolute',
        inset: '56px',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, color-mix(in srgb, var(--accent) 26%, transparent) 0%, transparent 76%)',
      }),
    ],
    spin: [],
  }),

  /* C 涟漪漩涡：螺旋 + 向内收缩的涟漪环（与封面卷入同向） */
  ripple: () => ({
    halo: layer({
      position: 'absolute',
      inset: '-78px',
      borderRadius: '50%',
      background:
        'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 72%)',
      willChange: 'transform, opacity',
    }),
    layers: [
      spiral({ arms: [{ w: 2, op: 0.55 }, { w: 2, op: 0.55, rot: 180 }] }),
      layer({
        position: 'absolute',
        inset: '50px',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, color-mix(in srgb, var(--accent) 72%, #000000) 0%, color-mix(in srgb, var(--accent) 28%, #05070f) 70%, transparent 100%)',
      }),
    ],
    spin: [],
    inhale: [0, 1.15, 2.3].map((delay) =>
      layer({
        position: 'absolute',
        inset: '10px',
        borderRadius: '50%',
        border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
        opacity: '0',
        willChange: 'transform, opacity',
        animation: `absorb-inhale 3.4s ${delay}s ease-in infinite`,
      }),
    ),
  }),

  /* D 双层水带：两条粗渐变水臂 */
  band: () => ({
    halo: layer({
      position: 'absolute',
      inset: '-78px',
      borderRadius: '50%',
      background:
        'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 15%, transparent) 0%, transparent 70%)',
      willChange: 'transform, opacity',
    }),
    layers: [
      spiral({ arms: [{ w: 8, op: 0.85 }, { w: 8, op: 0.85, rot: 180 }], gradient: true }),
      layer({
        position: 'absolute',
        inset: '46px',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, color-mix(in srgb, var(--accent) 82%, #000000) 0%, color-mix(in srgb, var(--accent) 30%, #05070f) 66%, transparent 100%)',
      }),
    ],
    spin: [],
  }),

  /* E 液态玻璃：半透明水膜 + 白色细螺旋 + 小深核 */
  glass: () => ({
    halo: layer({
      position: 'absolute',
      inset: '-70px',
      borderRadius: '50%',
      background:
        'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 72%)',
      willChange: 'transform, opacity',
    }),
    layers: [
      layer({
        position: 'absolute',
        inset: '6px',
        borderRadius: '50%',
        background:
          'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 22%, rgba(255,255,255,.5)) 0%, color-mix(in srgb, var(--accent) 10%, transparent) 62%, transparent 78%)',
        boxShadow: 'inset 0 1px 1px color-mix(in srgb, #ffffff 70%, transparent)',
      }),
      spiral({ arms: [{ w: 1.6, op: 0.6 }, { w: 1.6, op: 0.6, rot: 180 }], color: '#ffffff' }),
      layer({
        position: 'absolute',
        inset: '52px',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, color-mix(in srgb, var(--accent) 70%, #05070f) 0%, transparent 74%)',
      }),
      layer({
        position: 'absolute',
        inset: '6px',
        borderRadius: '50%',
        background: 'linear-gradient(190deg, rgba(255, 255, 255, 0.3), transparent 38%)',
      }),
    ],
    spin: [],
  }),

  /* F 水墨漩涡：三层墨色晕染（由淡到浓） */
  ink: () => ({
    halo: layer({
      position: 'absolute',
      inset: '-76px',
      borderRadius: '50%',
      background:
        'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 12%, transparent) 0%, transparent 68%)',
      willChange: 'transform, opacity',
    }),
    layers: [
      spiral({
        arms: [{ w: 6, op: 0.18 }, { w: 2.5, op: 0.5 }, { w: 1.2, op: 0.8, rot: 150 }],
        color: 'color-mix(in srgb, var(--accent) 45%, #1b2340)',
      }),
      layer({
        position: 'absolute',
        inset: '48px',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, color-mix(in srgb, var(--accent) 55%, #05070f) 0%, transparent 72%)',
      }),
    ],
    spin: [],
  }),
}

/* ================= 漩涡生命周期 ================= */

let vortex: HTMLElement | null = null
let vortexSwirl: HTMLElement | null = null
let bhCollapsing = false

/** 一次性注入涟漪内收关键帧（ripple 样式用） */
function ensureKeyframes(): void {
  if (document.getElementById('absorb-kf')) return
  const st = document.createElement('style')
  st.id = 'absorb-kf'
  st.textContent =
    '@keyframes absorb-inhale{0%{transform:scale(1);opacity:0}25%{opacity:.7}100%{transform:scale(.3);opacity:0}}'
  document.head.appendChild(st)
}

function ensureVortex(style: AbsorbStyle = useSettingsStore().absorbStyle): HTMLElement | null {
  if (bhCollapsing) return null
  if (vortex) return vortex
  ensureKeyframes()
  const built = BUILDERS[style]()
  const el = document.createElement('div')
  el.className = 'absorb-vortex'
  el.dataset.style = style
  Object.assign(el.style, {
    position: 'fixed',
    left: `calc(50% - ${BH_SIZE / 2}px)`,
    top: `calc(50% - ${BH_SIZE / 2}px)`,
    width: `${BH_SIZE}px`,
    height: `${BH_SIZE}px`,
    zIndex: '45', // 低于歌词页（50）：歌词页打开时被自然遮盖
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  const all = built.halo ? [built.halo, ...built.layers] : built.layers
  if (built.inhale) all.push(...built.inhale)
  el.append(...all)
  document.body.appendChild(el)
  vortex = el
  // 第一个带螺旋 SVG 的层作为水纹（用于坍缩时加速旋转）
  vortexSwirl = built.layers.find((l) => l.querySelector('svg')) ?? null

  el.animate(
    [
      { transform: 'scale(0.45)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 500, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'both' },
  )
  built.halo?.animate(
    [
      { opacity: 0.6, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.06)' },
      { opacity: 0.6, transform: 'scale(1)' },
    ],
    { duration: 4600, easing: 'ease-in-out', iterations: Infinity },
  )
  vortexSwirl?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
    duration: 14000,
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
    style: vortex?.dataset.style ?? null,
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
    const r = 280 + Math.random() * 190
    const x = c.x + Math.cos(θ + (Math.random() - 0.5) * 0.5) * r
    const y = c.y + Math.sin(θ + (Math.random() - 0.5) * 0.5) * r
    if (x > margin && x < window.innerWidth - margin && y > margin && y < window.innerHeight - margin) {
      return { x, y }
    }
  }
  const r = 150 + Math.random() * 110
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
    borderRadius: '10px',
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
    // 无封面（预览且曲库为空）：accent 渐变色块代替
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

/* ================= 设置页预览 ================= */

/** 预览某一样式：直接演出一次「浮现 → 几张封面卷入 → 抽空消失」，无需扫描 */
export async function previewAbsorbStyle(style: AbsorbStyle): Promise<void> {
  if (reduced() || document.hidden) return
  const ui = useUiStore()
  if (ui.lyricsOpen || ui.dolly !== 'idle') return
  if (vortex) {
    // 已有演出（扫描或上一次预览）：立即收掉，避免叠加
    collapseVortex()
    await wait(200)
  }
  if (!ensureVortex(style)) return

  // 素材：曲库里已有的封面（最多 4 张），没有就用色块
  const lib = useLibraryStore()
  const ids = [...new Set(lib.songs.map((s) => s.coverId).filter(Boolean))].slice(0, 4) as string[]
  const srcs = await Promise.all(
    (ids.length ? ids : [null, null, null]).map((id) =>
      id
        ? Promise.race([
            Promise.resolve(lib.peekCoverUrl(id) ?? lib.coverUrl(id).catch(() => null)),
            wait(SOURCE_TIMEOUT).then(() => null),
          ])
        : Promise.resolve(null),
    ),
  )
  const last = srcs.length - 1
  srcs.forEach((src, i) => {
    window.setTimeout(() => flyOne(src, i === last), i * 150)
  })
  await waitUntilIdle(flightMs + 900)
  collapseVortex()
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
        queue = []
        sessionFlights = 0
        sessionEnding = true
        if (!pumping) {
          void waitUntilIdle().then(() => {
            collapseVortex()
            sessionEnding = false
          })
        }
      }
    },
  )
}
