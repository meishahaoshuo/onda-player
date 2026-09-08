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

const FLIGHT_MS = 860
const STAGGER_MS = 130
const JITTER_MS = 40
/** 批间等待：按飞行时长比例，避免上一批未消失就叠下一批造成视觉拥挤与掉帧 */
const BATCH_GAP = 420
/** 飞行封面边长 */
const START_SIZE = 72
/** 每批最多起飞张数 */
const BATCH_CAP = 6
/** 单次扫描会话累计起飞上限（大库防雪崩，超出只做脉动提示） */
const SESSION_CAP = 24
/** 触达黑洞时刻占比 */
const LAND_AT = 0.72
/** coverUrl 等待上限：动画不拖扫描节奏 */
const SOURCE_TIMEOUT = 300
/** 黑洞容器边长（视口正中心） */
const BH_SIZE = 176

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/* ================= 黑洞（悬浮建库涡旋） ================= */

let bh: HTMLElement | null = null
let bhDisk: HTMLElement | null = null
let bhCollapsing = false

/** 扫描会话内创建黑洞：视口正中心，多层吸积盘 + 光子环 + 事件视界 */
function ensureBlackHole(): HTMLElement | null {
  if (bhCollapsing) return null
  if (bh) return bh
  const el = document.createElement('div')
  el.className = 'absorb-blackhole'
  Object.assign(el.style, {
    position: 'fixed',
    left: `calc(50% - ${BH_SIZE / 2}px)`,
    top: `calc(50% - ${BH_SIZE / 2}px)`,
    width: `${BH_SIZE}px`,
    height: `${BH_SIZE}px`,
    zIndex: '45', // 低于歌词页（50）：歌词页打开时黑洞被自然遮盖
    pointerEvents: 'none',
  } as CSSStyleDeclaration)

  /* 外层弥散光晕：纯径向渐变（不用 filter blur——旋转/呼吸动画会让 filter 每帧重算） */
  const halo = document.createElement('div')
  Object.assign(halo.style, {
    position: 'absolute',
    inset: '-86px',
    borderRadius: '50%',
    background:
      'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 26%, transparent) 0%, color-mix(in srgb, var(--accent) 13%, transparent) 38%, color-mix(in srgb, var(--accent) 5%, transparent) 62%, transparent 78%)',
    willChange: 'transform, opacity',
  } as CSSStyleDeclaration)

  /* 内辉光：贴盘的亮环底衬 */
  const glow = document.createElement('div')
  Object.assign(glow.style, {
    position: 'absolute',
    inset: '-14px',
    borderRadius: '50%',
    background:
      'radial-gradient(closest-side, transparent 44%, color-mix(in srgb, var(--accent) 34%, transparent) 58%, transparent 74%)',
  } as CSSStyleDeclaration)

  /* 外吸积盘：多段 conic + 细密物质流条纹（repeating-conic），慢速正转。
     conic 渐变本身连续，条纹提供丝状质感，无需 filter blur */
  const diskOuter = document.createElement('div')
  Object.assign(diskOuter.style, {
    position: 'absolute',
    inset: '0',
    borderRadius: '50%',
    backgroundImage:
      'repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--accent) 22%, transparent) 0deg, transparent 2.4deg, transparent 6deg), ' +
      'conic-gradient(from 20deg, transparent 0deg, color-mix(in srgb, var(--accent) 60%, transparent) 38deg, color-mix(in srgb, var(--accent) 18%, transparent) 80deg, transparent 118deg, color-mix(in srgb, var(--accent) 34%, transparent) 178deg, transparent 226deg, color-mix(in srgb, var(--accent) 50%, transparent) 292deg, transparent 360deg)',
    maskImage: 'radial-gradient(closest-side, transparent 32%, #000 54%, #000 84%, transparent 100%)',
    WebkitMaskImage:
      'radial-gradient(closest-side, transparent 32%, #000 54%, #000 84%, transparent 100%)',
    willChange: 'transform',
  } as unknown as CSSStyleDeclaration)

  /* 内吸积盘：更亮更细的段（含白热混色），反向快转——与外盘形成层次差 */
  const diskInner = document.createElement('div')
  Object.assign(diskInner.style, {
    position: 'absolute',
    inset: '26px',
    borderRadius: '50%',
    backgroundImage:
      'repeating-conic-gradient(from 0deg, color-mix(in srgb, #ffffff 14%, transparent) 0deg, transparent 1.6deg, transparent 5deg), ' +
      'conic-gradient(from 200deg, transparent 0deg, color-mix(in srgb, var(--accent) 82%, transparent) 55deg, transparent 120deg, color-mix(in srgb, var(--accent) 52%, transparent) 210deg, transparent 275deg, color-mix(in srgb, #ffffff 34%, var(--accent)) 322deg, transparent 360deg)',
    maskImage: 'radial-gradient(closest-side, transparent 22%, #000 48%, #000 86%, transparent 100%)',
    WebkitMaskImage:
      'radial-gradient(closest-side, transparent 22%, #000 48%, #000 86%, transparent 100%)',
    willChange: 'transform',
  } as unknown as CSSStyleDeclaration)

  /* 光子环：贴视界的锐利亮环（白热→accent 渐变）+ 向外的辉光 */
  const photon = document.createElement('div')
  Object.assign(photon.style, {
    position: 'absolute',
    inset: '42px',
    borderRadius: '50%',
    background:
      'radial-gradient(closest-side, transparent 54%, color-mix(in srgb, #ffffff 70%, var(--accent)) 61%, color-mix(in srgb, var(--accent) 78%, transparent) 68%, color-mix(in srgb, var(--accent) 26%, transparent) 76%, transparent 84%)',
  } as CSSStyleDeclaration)

  /* 事件视界：纯黑核心 + 内缘微光（引力红移感） */
  const core = document.createElement('div')
  Object.assign(core.style, {
    position: 'absolute',
    inset: '46px',
    borderRadius: '50%',
    background:
      'radial-gradient(closest-side, #010206 0%, #04060e 58%, #090c1c 84%, rgba(9, 12, 28, 0.45) 95%, transparent 100%)',
    boxShadow:
      '0 0 40px color-mix(in srgb, var(--accent) 34%, transparent), 0 0 12px color-mix(in srgb, var(--accent) 22%, transparent), inset 0 0 16px rgba(0, 0, 0, 0.95), inset 0 1px 1px rgba(255, 255, 255, 0.06)',
  } as CSSStyleDeclaration)

  el.append(halo, glow, diskOuter, diskInner, photon, core)
  document.body.appendChild(el)
  bh = el
  bhDisk = diskOuter

  // 浮现（Q 弹）
  el.animate(
    [
      { transform: 'scale(0.45)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 500, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'both' },
  )
  // 光晕呼吸
  halo.animate(
    [
      { opacity: 0.55, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.07)' },
      { opacity: 0.55, transform: 'scale(1)' },
    ],
    { duration: 4200, easing: 'ease-in-out', iterations: Infinity },
  )
  // 双层吸积盘反向旋转（外慢内快，层次差）
  diskOuter.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
    duration: 11000,
    easing: 'linear',
    iterations: Infinity,
  })
  diskInner.animate([{ transform: 'rotate(360deg)' }, { transform: 'rotate(0deg)' }], {
    duration: 6800,
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

/** 等最后一批封面真正吸完（不是固定时长），再看情况收尾 */
async function waitUntilIdle(maxWaitMs = 2600): Promise<void> {
  const t0 = Date.now()
  while (inFlight > 0 && Date.now() - t0 < maxWaitMs) {
    await wait(60)
  }
  await wait(90) // 让最后一张的落点脉动走完一小拍
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
/** 当前仍在飞行的封面数（每张 cleanup 时 -1）：用于精确判定「吸完了」而非固定等待 */
let inFlight = 0
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
      // 批间留白：等上一批基本吸完再起下一批（避免堆叠拥挤与瞬时高负载）
      await wait(BATCH_GAP)
      await waitUntilIdle(flightMs)
    }
  } finally {
    pumping = false
    if (sessionEnding) {
      await waitUntilIdle()
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
 * 半径 280~470px，尝试多次保证起点落在视口内；全部失败则缩小半径钳进视口。
 */
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
    // 只提示 transform/opacity：filter 逐帧变化会让浏览器每帧重新光栅化（掉帧主因）
    willChange: 'transform, opacity',
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
      // 不含 filter：模糊逐帧插值是掉帧主因，"被卷入"靠螺旋收敛 + 透明度收束表达
      transform: `translate(${(x - from.x).toFixed(1)}px, ${(y - from.y).toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`,
      opacity: t === 0 ? 0 : t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.58) / 0.42),
      offset: t,
      easing: 'cubic-bezier(0.45, 0, 0.75, 0.6)',
    }
  })
  inFlight++
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

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    el.remove()
    inFlight--
    if (inFlight < 0) inFlight = 0
  }
  anim.finished.then(cleanup, cleanup)
  window.setTimeout(cleanup, flightMs + 400)
  // 尾段提前移除：最后 15% 已不可见，早撤早让出图层（视觉无差别）
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
          void waitUntilIdle().then(() => {
            collapseBlackHole()
            sessionEnding = false
          })
        }
      }
    },
  )
}
