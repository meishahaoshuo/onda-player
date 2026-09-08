import { watch } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'

/**
 * 添加文件夹时「封面被吸入黑洞」动画：
 * 扫描开始后，播放栏上方中央浮现一个旋转吸积盘的黑洞；
 * 每落库一批歌，对应封面（同专辑去重）从黑洞四周的随机环带上
 * 沿极坐标螺旋向心汇聚——越近转得越快、缩得越急、微微模糊，
 * 全部吸完后黑洞坍缩消失。像整批歌被建库引力收编。
 *
 * 工程防线与 coverFlight 同构：reduced-motion / 页面过渡互斥（ui.dolly）/
 * 歌词页跳过 / 后台标签跳过；批与张双重限流防大库雪崩。
 */

const FLIGHT_MS = 900
const STAGGER_MS = 130
const JITTER_MS = 40
/** 飞行封面边长 */
const START_SIZE = 40
/** 每批最多起飞张数 */
const BATCH_CAP = 6
/** 单次扫描会话累计起飞上限（大库防雪崩，超出只做脉动提示） */
const SESSION_CAP = 24
/** 触达黑洞时刻占比 */
const LAND_AT = 0.72
const BLUR_MAX = 2.5
/** coverUrl 等待上限：动画不拖扫描节奏 */
const SOURCE_TIMEOUT = 300

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/* ================= 黑洞（悬浮建库涡旋） ================= */

let bh: HTMLElement | null = null
let bhDisk: HTMLElement | null = null
let bhCollapsing = false

/** 扫描会话内创建黑洞：播放栏上方中央，accent 色吸积盘旋转 + 暗核 */
function ensureBlackHole(): HTMLElement | null {
  if (bhCollapsing) return null
  if (bh) return bh
  const bar = document.querySelector<HTMLElement>('.player-bar')
  if (!bar) return null
  const el = document.createElement('div')
  el.className = 'absorb-blackhole'
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: `${Math.round(bar.getBoundingClientRect().height + 28)}px`,
    width: '76px',
    height: '76px',
    marginLeft: '-38px',
    zIndex: '45', // 低于歌词页（50）：歌词页打开时黑洞被自然盖住
    pointerEvents: 'none',
  } as CSSStyleDeclaration)

  // 吸积盘：accent 色 conic 渐变环，无限旋转
  const disk = document.createElement('div')
  Object.assign(disk.style, {
    position: 'absolute',
    inset: '-9px',
    borderRadius: '50%',
    background:
      'conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--accent) 62%, transparent) 42deg, transparent 100deg, color-mix(in srgb, var(--accent) 26%, transparent) 175deg, transparent 235deg, color-mix(in srgb, var(--accent) 48%, transparent) 305deg, transparent 360deg)',
    filter: 'blur(3px)',
    maskImage: 'radial-gradient(closest-side, transparent 32%, #000 56%, #000 76%, transparent 100%)',
    WebkitMaskImage:
      'radial-gradient(closest-side, transparent 32%, #000 56%, #000 76%, transparent 100%)',
  } as unknown as CSSStyleDeclaration)

  // 暗核：事件视界
  const core = document.createElement('div')
  Object.assign(core.style, {
    position: 'absolute',
    inset: '9px',
    borderRadius: '50%',
    background: 'radial-gradient(closest-side, #04050b 0%, #0e1126 52%, rgba(14, 17, 38, 0) 76%)',
    boxShadow: '0 0 26px color-mix(in srgb, var(--accent) 32%, transparent)',
  } as CSSStyleDeclaration)

  el.append(disk, core)
  document.body.appendChild(el)
  bh = el
  bhDisk = disk

  // 浮现（Q 弹）
  el.animate(
    [
      { transform: 'scale(0.4)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 420, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'both' },
  )
  // 吸积盘无限旋转
  disk.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
    duration: 5200,
    easing: 'linear',
    iterations: Infinity,
  })
  return el
}

function blackholeCenter(): { x: number; y: number } | null {
  if (!bh) return null
  const r = bh.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** 封面触达时的黑洞脉动（吸入重量感） */
function pulseBlackHole(): void {
  bh?.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.07)' },
      { transform: 'scale(1)' },
    ],
    { duration: 240, easing: 'ease-out' },
  )
}

/** 扫描会话收尾：吸积盘加速 + 整体坍缩消失 */
function collapseBlackHole(): void {
  const el = bh
  if (!el) return
  bhCollapsing = true
  bh = null
  el.animate(
    [
      { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'scale(0.22) rotate(150deg)', opacity: 0 },
    ],
    { duration: 460, easing: 'ease-in', fill: 'forwards' },
  )
    .finished.then(() => el.remove(), () => el.remove())
  window.setTimeout(() => {
    bhCollapsing = false
  }, 600)
}

/* ================= 封面飞行：四面八方螺旋向心 ================= */

/* ---------- 模块状态 ---------- */
let sinkInstalled = false
/** 本会话已起飞总数（扫描结束清零） */
let sessionFlights = 0
/** 会话级去重：同 coverId 只飞一次 */
const flownCoverIds = new Set<string>()
/** 待处理批队列 */
let queue: string[][] = []
let pumping = false
let lastPulseAt = 0
/** 扫描已结束：泵空后坍缩黑洞 */
let sessionEnding = false
/** 下一次扫描开始时清空去重表 */
let clearFlownOnNextEnqueue = false
/** lite 档：低核数设备收敛时长 */
const lite = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2
const flightMs = lite ? Math.round(FLIGHT_MS * 0.75) : FLIGHT_MS
const staggerMs = lite ? 100 : STAGGER_MS

/** DEV 调试探针（CDP 断言用；生产构建不含） */
function reportDebug(): void {
  if (!import.meta.env.DEV) return
  ;(window as any).__absorbDebug = () => ({
    queueLen: queue.length,
    flying: document.querySelectorAll('.absorb-flight').length,
    sessionFlights,
    flown: flownCoverIds.size,
    blackhole: !!bh,
  })
}

/** 批入口：三道硬闸门直接弃（进度条兜底，无损失），过了才排队 */
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
  if (!ensureBlackHole()) return
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
      await wait(150) // 批间呼吸
    }
  } finally {
    pumping = false
    if (sessionEnding) {
      // 等最后一批飞完再坍缩
      await wait(flightMs + 320)
      collapseBlackHole()
      sessionEnding = false
    }
  }
}

async function flyBatch(ids: string[]): Promise<void> {
  if (sessionFlights >= SESSION_CAP) {
    pulseBlackHole() // 超限只做一次脉动提示
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

/**
 * 起飞点：黑洞四周的随机环带（四面八方汇聚）。
 * 半径 230~410px，尝试多次保证起点落在视口内；全部失败则缩小半径钳进视口。
 */
function pickRingOrigin(c: { x: number; y: number }): { x: number; y: number } {
  const margin = 34
  const clampX = (v: number) => Math.min(window.innerWidth - margin, Math.max(margin, v))
  const clampY = (v: number) => Math.min(window.innerHeight - margin, Math.max(margin, v))
  const θ = Math.random() * Math.PI * 2
  for (let i = 0; i < 8; i++) {
    const r = 230 + Math.random() * 180
    const x = c.x + Math.cos(θ + (Math.random() - 0.5) * 0.5) * r
    const y = c.y + Math.sin(θ + (Math.random() - 0.5) * 0.5) * r
    if (x > margin && x < window.innerWidth - margin && y > margin && y < window.innerHeight - margin) {
      return { x, y }
    }
  }
  const r = 120 + Math.random() * 90
  return { x: clampX(c.x + Math.cos(θ) * r), y: clampY(c.y + Math.sin(θ) * r) }
}

function flyOne(src: string, isLast: boolean): void {
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
    borderRadius: '8px',
    zIndex: '70',
    pointerEvents: 'none',
    willChange: 'transform, opacity, filter',
    boxShadow: 'var(--shadow-2)',
  } as CSSStyleDeclaration)
  const img = document.createElement('img')
  img.src = src
  Object.assign(img.style, {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    borderRadius: '8px',
  } as CSSStyleDeclaration)
  el.appendChild(img)
  document.body.appendChild(el)

  /* 极坐标螺旋向心：r 平方衰减（近核急缩），θ 平方加速绕行（越近转越快）。
     绕行方向随机，总绕行角 110°~180°，每个 keyframe 是轨迹上的一个极坐标采样点。 */
  const dx = from.x - c.x
  const dy = from.y - c.y
  const r0 = Math.hypot(dx, dy)
  const θ0 = Math.atan2(dy, dx)
  const dir = Math.random() < 0.5 ? -1 : 1
  const spinTotal = (110 + Math.random() * 70) * dir

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
      opacity: t === 0 ? 0 : t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.62) / 0.38),
      filter: `blur(${(BLUR_MAX * t * t).toFixed(2)}px)`,
      offset: t,
      easing: 'cubic-bezier(0.45, 0, 0.75, 0.6)',
    }
  })
  const anim = el.animate(frames, { duration: flightMs, fill: 'both' })

  // 触达时刻黑洞脉动（吸入重量感，节流）
  window.setTimeout(() => {
    if (Date.now() - lastPulseAt > 180) {
      lastPulseAt = Date.now()
      pulseBlackHole()
    }
  }, Math.round(flightMs * LAND_AT))
  // 批末张落定：黑洞吃撑了多脉一下
  if (isLast) window.setTimeout(() => pulseBlackHole(), Math.round(flightMs * 0.88))

  const cleanup = () => el.remove()
  anim.finished.then(cleanup, cleanup)
  window.setTimeout(cleanup, flightMs + 400)
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
        // 新扫描会话开始：清去重表与计数
        flownCoverIds.clear()
        sessionFlights = 0
        sessionEnding = false
        return
      }
      if (was && !on) {
        // 扫描结束：弃掉未消费的批，泵空后坍缩黑洞
        queue = []
        sessionFlights = 0
        sessionEnding = true
        if (!pumping) {
          wait(flightMs + 320).then(() => {
            collapseBlackHole()
            sessionEnding = false
          })
        }
      }
    },
  )
}
