import { watch } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'

/**
 * 添加文件夹时「封面随水流漩涡卷入播放器」动画：
 * 扫描开始后，视口正中心浮现一个俯视水面的漩涡——深色漏斗口 + 缓慢旋转的
 * 螺旋水纹 + 一道固定水面高光；每落库一批歌，对应封面（同专辑去重）从漩涡
 * 四周的随机环带上沿极坐标螺旋向心汇聚（与水纹同向，像被水流带走），
 * 全部卷入后漩涡抽空消失。
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

/* ================= 漩涡（俯视排水口） ================= */

let bh: HTMLElement | null = null
let bhSwirl: HTMLElement | null = null
let bhCollapsing = false

/** 阿基米德螺旋采样点（124 画布，中心 62，2 圈）：水纹路径 */
const SPIRAL_D =
  'M68 62 L69 66 L67.1 70.8 L62 74.3 L54.8 74.4 L47.8 70.2 L43.5 62 L44.2 51.7 ' +
  'L50.7 42.4 L62 37.2 L75.4 38.7 L87.1 47.5 L93 62 L90.7 78.6 L79.6 92.5 L62 99.3 ' +
  'L42.3 96.1 L26.1 82.7 L18.5 62 L22.5 39.2 L38.1 20.7 L62 12.2 L87.9 17.1 L108.7 35 L118 62'

/** 扫描会话内创建漩涡：视口正中心，深色漏斗口 + 旋转水纹 + 固定水面高光 */
function ensureBlackHole(): HTMLElement | null {
  if (bhCollapsing) return null
  if (bh) return bh
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

  /* 水面弥散：外围被搅动的水光（纯径向渐变，不用 filter blur） */
  const halo = document.createElement('div')
  Object.assign(halo.style, {
    position: 'absolute',
    inset: '-80px',
    borderRadius: '50%',
    background:
      'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 20%, transparent) 0%, color-mix(in srgb, var(--accent) 10%, transparent) 36%, color-mix(in srgb, var(--accent) 4%, transparent) 60%, transparent 76%)',
    willChange: 'transform, opacity',
  } as CSSStyleDeclaration)

  /* 螺旋水纹：两条对称的 accent 色水流线，慢速旋转（水面被搅动的方向） */
  const swirl = document.createElement('div')
  Object.assign(swirl.style, {
    position: 'absolute',
    inset: '0',
    willChange: 'transform',
  } as CSSStyleDeclaration)
  swirl.innerHTML =
    `<svg viewBox="0 0 124 124" width="100%" height="100%" aria-hidden="true">` +
    `<g fill="none" stroke-linecap="round" style="stroke: var(--accent)">` +
    `<path d="${SPIRAL_D}" stroke-width="1.8" opacity="0.5"/>` +
    `<path d="${SPIRAL_D}" stroke-width="1.3" opacity="0.34" transform="rotate(180 62 62)"/>` +
    `<path d="${SPIRAL_D}" stroke-width="1" opacity="0.2" transform="rotate(150 62 62)"/>` +
    `</g></svg>`

  /* 漏斗口：由深到浅的排水口（比纯黑温和，且带主题色倾向） */
  const funnel = document.createElement('div')
  Object.assign(funnel.style, {
    position: 'absolute',
    inset: '44px',
    borderRadius: '50%',
    background:
      'radial-gradient(circle, color-mix(in srgb, var(--accent) 78%, #000000) 0%, ' +
      'color-mix(in srgb, var(--accent) 34%, #05070f) 58%, ' +
      'color-mix(in srgb, var(--accent) 12%, #05070f) 82%, transparent 100%)',
  } as CSSStyleDeclaration)

  /* 口沿：水面张力的一圈细亮边 */
  const rim = document.createElement('div')
  Object.assign(rim.style, {
    position: 'absolute',
    inset: '41px',
    borderRadius: '50%',
    background:
      'radial-gradient(closest-side, transparent 60%, color-mix(in srgb, #ffffff 42%, var(--accent)) 70%, transparent 80%)',
  } as CSSStyleDeclaration)

  /* 水面高光：斜上方打光，随水旋转不动（反光是固定的） */
  const gloss = document.createElement('div')
  Object.assign(gloss.style, {
    position: 'absolute',
    inset: '44px',
    borderRadius: '50%',
    background: 'linear-gradient(200deg, rgba(255, 255, 255, 0.26), transparent 46%)',
  } as CSSStyleDeclaration)

  el.append(halo, swirl, funnel, rim, gloss)
  document.body.appendChild(el)
  bh = el
  bhSwirl = swirl

  // 浮现（Q 弹）
  el.animate(
    [
      { transform: 'scale(0.45)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 500, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'both' },
  )
  // 水面呼吸
  halo.animate(
    [
      { opacity: 0.6, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.06)' },
      { opacity: 0.6, transform: 'scale(1)' },
    ],
    { duration: 4600, easing: 'ease-in-out', iterations: Infinity },
  )
  // 水纹缓慢旋转（顺时针，与封面卷入同向）
  swirl.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
    duration: 14000,
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

/** 封面触达时的水面凹陷（被投入东西的凹陷感） */
function pulseBlackHole(): void {
  bh?.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.06)' },
      { transform: 'scale(1)' },
    ],
    { duration: 260, easing: 'ease-out' },
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

/** 扫描会话收尾：水被抽空——漩涡加速旋转并旋出消失 */
function collapseBlackHole(): void {
  const el = bh
  if (!el) return
  bhCollapsing = true
  bh = null
  // 水纹在坍缩时加速旋转（水被抽走）
  bhSwirl?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(120deg)' }], {
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
  // 统一顺时针：与水纹旋转同向，像被水流带着走（反向会与水面视觉打架）
  const dir = 1
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
