import { watch } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { popPlayerCover } from './coverFlight'

/**
 * 添加文件夹时「封面被吸入播放器黑洞」动画：
 * 扫描中每落库一批歌，对应封面（同专辑去重）从触发按钮附近陆续飞向
 * 播放栏封面位，沿优雅弧线临近时加速缩小 + 微螺旋 + 微模糊消失，
 * 落点处播放栏轻 dip 回弹——像被黑洞吸进去。
 *
 * 工程防线与 coverFlight 同构：reduced-motion / 页面过渡互斥（ui.dolly）/
 * 歌词页跳过 / 后台标签跳过；批与张双重限流防大库雪崩。
 */

const FLIGHT_MS = 840
/** 触达播放栏封面位的时刻占比 */
const LAND_AT = 0.72
const STAGGER_MS = 120
const JITTER_MS = 40
/** 飞行封面边长（播放栏真实封面 52px） */
const START_SIZE = 40
/** 每批最多起飞张数 */
const BATCH_CAP = 6
/** 单次扫描会话累计起飞上限（大库防雪崩，超出只做落点提示） */
const SESSION_CAP = 24
const BLUR_MAX = 2.5
const SPIN_MAX = 38
/** coverUrl 等待上限：动画不拖扫描节奏 */
const SOURCE_TIMEOUT = 300

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function playerCoverEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.player-bar .cover')
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/* ---------- 模块状态 ---------- */
let sinkInstalled = false
/** 本会话已起飞总数（scanning 落 false 时清零） */
let sessionFlights = 0
/** 会话级去重：同 coverId 只飞一次 */
const flownCoverIds = new Set<string>()
/** 待处理批队列 */
let queue: string[][] = []
let pumping = false
let lastDipAt = 0
/** 起飞点（触发按钮位置，系统对话框打开前测量） */
let origin: { x: number; y: number } | null = null
/** 下一次扫描开始时清空去重表 */
let clearFlownOnNextEnqueue = false
/** lite 档：低核数设备收敛时长 */
const lite = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2
const flightMs = lite ? Math.round(FLIGHT_MS * 0.75) : FLIGHT_MS
const staggerMs = lite ? 90 : STAGGER_MS

/** DEV 调试探针（CDP 断言用；生产构建不含） */
function reportDebug(): void {
  if (!import.meta.env.DEV) return
  ;(window as any).__absorbDebug = () => ({
    queueLen: queue.length,
    flying: document.querySelectorAll('.absorb-flight').length,
    sessionFlights,
    flown: flownCoverIds.size,
  })
}

/** 记录起飞原点：调用方在系统文件夹选择器打开前传入触发事件 */
export function setOriginFromEvent(e?: MouseEvent): void {
  if (!e) {
    origin = null
    return
  }
  const el = e.currentTarget as HTMLElement | null
  if (!el) {
    origin = null
    return
  }
  const r = el.getBoundingClientRect()
  origin = { x: r.left + 12, y: r.top + 12 }
}

/** 起飞点：无记录时从屏幕左侧中部随机散布（覆盖文件夹页/设置页两个触发视图） */
function pickOrigin(): { x: number; y: number } {
  if (origin) return origin
  return {
    x: 96 + (Math.random() - 0.5) * 96,
    y: window.innerHeight * (0.32 + Math.random() * 0.24),
  }
}

/** 批入口：三道硬闸门直接弃（进度条兜底，无损失），过了才排队 */
function enqueue(coverIds: string[]): void {
  if (reduced() || document.hidden) return
  const ui = useUiStore()
  if (ui.dolly !== 'idle') return
  if (ui.lyricsOpen) return
  if (!playerCoverEl()) return
  if (clearFlownOnNextEnqueue) {
    flownCoverIds.clear()
    sessionFlights = 0
    clearFlownOnNextEnqueue = false
  }
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
      await wait(160) // 批间呼吸：上一批消失后再起飞下一批
    }
  } finally {
    pumping = false
  }
}

async function flyBatch(ids: string[]): Promise<void> {
  if (sessionFlights >= SESSION_CAP) {
    popPlayerCover() // 超限只做一次轻量落点提示
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

function flyOne(src: string, isLast: boolean): void {
  const target = playerCoverEl()
  if (!target) return
  const to = target.getBoundingClientRect()
  if (to.width < 4 || to.height < 4) return
  const from = pickOrigin()

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

  // 目标中心位移（从起点中心出发）
  const tx = to.left + to.width / 2 - from.x
  const ty = to.top + to.height / 2 - from.y
  const dist = Math.hypot(tx, ty)
  const arc = Math.min(110, Math.max(48, dist * 0.16))
  const dir = tx >= 0 ? 1 : -1 // 从哪侧飞决定螺旋方向

  const anim = el.animate(
    [
      // 0.00 从原点浮现
      {
        transform: 'translate(0px, 0px) scale(0.7) rotate(0deg)',
        opacity: 0,
        filter: 'blur(0px)',
        offset: 0,
        easing: 'ease-out',
      },
      // 0.14 浮起（透明度快速到位）
      {
        transform: `translate(${(tx * 0.04).toFixed(1)}px, ${(ty * 0.04 - 18).toFixed(1)}px) scale(1.06) rotate(${5 * dir}deg)`,
        opacity: 1,
        filter: 'blur(0px)',
        offset: 0.14,
        easing: 'ease-in-out',
      },
      // 0.38 弧线过拱顶（抬升，姿态朝向黑洞）
      {
        transform: `translate(${(tx * 0.42 - 14 * dir).toFixed(1)}px, ${(ty * 0.38 - arc).toFixed(1)}px) scale(1.1) rotate(${12 * dir}deg)`,
        filter: 'blur(0px)',
        offset: 0.38,
        easing: 'cubic-bezier(0.4, 0, 0.7, 0.4)',
      },
      // 0.58 滑入途中，横向内收（螺旋的切向分量）+ 开始缩小
      {
        transform: `translate(${(tx * 0.78 - 10 * dir).toFixed(1)}px, ${(ty * 0.76 - arc * 0.3).toFixed(1)}px) scale(0.82) rotate(${22 * dir}deg)`,
        filter: 'blur(0.6px)',
        offset: 0.58,
        easing: 'ease-in',
      },
      // 0.72 触达封面位（加速段完成，明显缩小）
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(0.42) rotate(${SPIN_MAX * dir}deg)`,
        filter: `blur(${(BLUR_MAX * 0.6).toFixed(1)}px)`,
        opacity: 0.9,
        offset: LAND_AT,
        easing: 'ease-in',
      },
      // 0.88 螺旋过冲：角度超一点 + 接近消失
      {
        transform: `translate(${(tx + 3 * dir).toFixed(1)}px, ${ty.toFixed(1)}px) scale(0.18) rotate(${(SPIN_MAX + 8) * dir}deg)`,
        filter: `blur(${BLUR_MAX}px)`,
        opacity: 0.35,
        offset: 0.88,
        easing: 'ease-in',
      },
      // 1.00 完全吸入
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(0.1) rotate(${(SPIN_MAX + 14) * dir}deg)`,
        filter: `blur(${BLUR_MAX}px)`,
        opacity: 0,
        offset: 1,
      },
    ],
    { duration: flightMs, fill: 'both' },
  )

  // 落点表演：轻 dip 节流（批内 6 张不连抖 6 次）；批末张落定后 pop 接住
  const landDelay = Math.round(flightMs * LAND_AT)
  window.setTimeout(() => {
    if (Date.now() - lastDipAt > 180) {
      lastDipAt = Date.now()
      const bar = document.querySelector<HTMLElement>('.player-bar')
      bar?.animate(
        [
          { transform: 'translateY(0)' },
          { transform: 'translateY(1.6px)', offset: 0.45 },
          { transform: 'translateY(0)' },
        ],
        { duration: 260, easing: 'ease-out' },
      )
    }
  }, landDelay)
  if (isLast) window.setTimeout(() => popPlayerCover(), landDelay + 120)

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
  // 扫描会话收尾：弃掉未消费的批、清会话计数；去重表在下次扫描开始时清
  watch(
    () => library.scanning,
    (on, was) => {
      if (was && !on) {
        queue = []
        sessionFlights = 0
        pumping = false
        clearFlownOnNextEnqueue = true
      }
    },
  )
}
