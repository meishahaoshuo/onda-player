import { useUiStore } from '@/stores/ui'
import { paletteCache } from './paletteCache'

/**
 * 专辑网格 → 详情页的「引力坍缩（Gravity Collapse）」过渡编排器。
 *
 * 设计要点：
 * 1. 骨架：点击瞬间，**周边卡片被吸入点击点**（位移 + 缩小 + 旋转 + 淡出），
 *    详情页从被点卡片的矩形**析出放大**接管整页 —— 万物坍缩进一点，新世界从这一点长出来。
 * 2. 时序由**波前驱动**：卡片"何时被吸走"取决于它到点击点的距离（越近越先被吞），
 *    详情内容也按到点击点的距离依次浮现，而不是写死的 index × 常数。
 * 3. 全程 WAAPI：动画在层叠中优先级高于普通声明，天然压过卡片的 :hover transform。
 * 4. **先量后动**：所有矩形必须在任何变换开始之前测量，否则量到的是"变换中途"的矩形，
 *    飞行落点会错位。被点击的卡片不参与坍缩（它的封面已交给飞行克隆），
 *    这样返回时它的矩形始终可信。
 * 5. 详情层析出/折叠用 `translate + scale`（transform-origin 钉在被点卡片左上角），
 *    返回时层只做几何折叠；折叠期间不得再改变层的布局矩形，否则封面克隆的起飞矩形会失真。
 */

/* ---------- 时序常量（毫秒；lite 档整体 ×0.7） ---------- */
const WAVE_SPEED = 2.2 // px/ms：波速，延迟 = 到点击点距离 / 波速
const MAX_WAVE_DELAY = 240 // 波前延迟上限
const REVEAL_DUR = 260 // 详情内容单元素浮现时长
const SUCK_DUR = 420 // 周边卡片被吸入时长
const BLOOM_DUR = 460 // 详情层从卡片析出放大时长
const FOLD_DUR = 420 // 返回时详情层折叠回卡片时长
const COVER_ENTER = 540 // 封面飞入时长
const COVER_EXIT = 320 // 封面飞回时长
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

/* ---------- 规模上限（大歌库性能护栏） ---------- */
const MAX_COLLAPSE_CARDS = 24 // 只动视口内卡片
const MAX_WAVE_ROWS = 30 // 只给前 30 行算波前延迟，其余直接显示

/* 分组基准延迟：波前不是唯一因素，结构顺序也要保住 */
const BASE_DELAY = { back: 80, header: 140, row: 180 }

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface Origin {
  cardEl: HTMLElement
  coverEl: HTMLElement
  click: { x: number; y: number }
  albumKey: string
  coverId: string | null
  rect: Box
  cardRect: Box
  src: string
}

interface CollapseRecord {
  anim: Animation
  delay: number
  to: Keyframe
}

let origin: Origin | null = null
const gridRecs = new Map<HTMLElement, CollapseRecord>()
/** 被点击卡片的淡出动画（它的封面已交给飞行克隆，本体让位） */
let originCardEl: HTMLElement | null = null
let originCardAnim: Animation | null = null
/** 详情内被波前接管的内容元素（返回时统一收起） */
let waveEls: { el: HTMLElement; delay: number }[] = []

/** lite 档：时长 ×0.7 */
let lite = (navigator.hardwareConcurrency ?? 8) <= 2

/* ---------- 工具 ---------- */

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function dur(ms: number): number {
  return lite ? ms * 0.7 : ms
}

function box(el: HTMLElement): Box {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function distance(b: Box, p: { x: number; y: number }): number {
  return Math.hypot(b.left + b.width / 2 - p.x, b.top + b.height / 2 - p.y)
}

/** 首帧探针：过渡期间平均帧率不足 50fps 则后续降级到 lite */
function probeFps() {
  if (lite) return
  const t0 = performance.now()
  let frames = 0
  const tick = () => {
    frames++
    const spent = performance.now() - t0
    if (spent < 260) requestAnimationFrame(tick)
    else if (frames / (spent / 1000) < 50) lite = true
  }
  requestAnimationFrame(tick)
}

/* ---------- 阶段一：点击瞬间（网格仍在前台） ---------- */

export function beginAlbumEnter(o: {
  cardEl: HTMLElement
  coverEl: HTMLElement
  click: { x: number; y: number }
  albumKey: string
  coverId: string | null
}): void {
  const ui = useUiStore()
  if (ui.dolly !== 'idle') return // 过渡进行中：忽略连点
  const img = (o.coverEl.matches('img') ? o.coverEl : o.coverEl.querySelector('img')) as HTMLImageElement | null
  origin = {
    cardEl: o.cardEl,
    coverEl: o.coverEl,
    click: o.click,
    albumKey: o.albumKey,
    coverId: o.coverId,
    rect: box(o.coverEl),
    cardRect: box(o.cardEl),
    src: img ? img.currentSrc || img.getAttribute('src') || '' : '',
  }
  ui.startDolly()
  clearInlineTransforms(o.cardEl) // 清掉磁吸引力场的行内 transform 残留，避免返回归位后复现
  if (!reduced()) {
    collapseGrid(o.cardEl, o.click)
    hideOriginCard(o.cardEl)
  }
  ui.openDetail(o.albumKey)
}

/** 清掉网格卡片的行内 transform（磁吸引力场的残留） */
function clearInlineTransforms(cardEl: HTMLElement) {
  const grid = cardEl.closest('.album-grid')
  if (!grid) return
  for (const c of grid.querySelectorAll<HTMLElement>('.album-card')) c.style.transform = ''
}

/** 周边卡片被吸入点击点：越近越先被吞，带一点旋转（被"拽"进去的失控感） */
function collapseGrid(cardEl: HTMLElement, click: { x: number; y: number }) {
  const grid = cardEl.closest('.album-grid')
  if (!grid) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  let n = 0
  for (const card of grid.querySelectorAll<HTMLElement>('.album-card')) {
    if (card === cardEl) continue // 被点击的卡片交给飞行克隆，不参与坍缩
    const r = card.getBoundingClientRect()
    const visible = r.bottom > -40 && r.top < vh + 40 && r.right > -40 && r.left < vw + 40
    if (!visible || n >= MAX_COLLAPSE_CARDS) continue
    n++
    const b = { left: r.left, top: r.top, width: r.width, height: r.height }
    const d = distance(b, click)
    const delay = Math.min(MAX_WAVE_DELAY, d / WAVE_SPEED)
    const dx = click.x - (r.left + r.width / 2)
    const dy = click.y - (r.top + r.height / 2)
    const rot = (n % 2 ? 1 : -1) * (8 + Math.min(10, d / 80))
    const to: Keyframe = {
      transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.22) rotate(${rot.toFixed(1)}deg)`,
      opacity: 0,
    }
    const anim = card.animate([{ transform: 'none', opacity: 1 }, to], {
      duration: dur(SUCK_DUR),
      delay: dur(delay),
      easing: EASE,
      fill: 'forwards',
    })
    gridRecs.set(card, { anim, delay, to })
  }
}

/** 被点击的卡片淡出让位：它的封面已由飞行克隆接管，同时保证它的矩形不被变换污染 */
function hideOriginCard(cardEl: HTMLElement) {
  originCardAnim?.cancel()
  originCardEl = cardEl
  originCardAnim = cardEl.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: dur(240),
    easing: EASE,
    fill: 'forwards',
  })
}

/* ---------- 阶段二：详情页挂载后 ---------- */

export async function playAlbumEnter(root: HTMLElement | null): Promise<void> {
  const o = origin
  if (!root) return
  if (!o || reduced()) {
    root.classList.add('revealed')
    useUiStore().endDolly()
    return
  }
  probeFps()

  // 先量后动：此刻详情层与头图都还没有任何变换，量到的才是最终落点
  const layerBox = box(root)
  const cover = root.querySelector<HTMLElement>('.header-cover')
  const coverBox = cover ? box(cover) : null
  planWave(root, o.click)

  bloomLayerIn(root, layerBox, o.cardRect)
  runWave()
  if (cover && coverBox) await flyCover(o, cover, coverBox)
  useUiStore().endDolly()
}

/** 详情层从被点卡片的矩形析出放大接管整页（transform-origin 钉在卡片左上角） */
function bloomLayerIn(root: HTMLElement, layerBox: Box, cardBox: Box) {
  const s = Math.max(cardBox.width / layerBox.width, cardBox.height / layerBox.height)
  const tx = cardBox.left - layerBox.left
  const ty = cardBox.top - layerBox.top
  root.animate(
    [
      { transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`, transformOrigin: '0 0' },
      { transform: 'none', transformOrigin: '0 0' },
    ],
    { duration: dur(BLOOM_DUR), easing: EASE },
  )
}

/** 统计内容元素与各自的波前延迟（只算不跑） */
function planWave(root: HTMLElement, click: { x: number; y: number }) {
  waveEls = []
  const pick = (sel: string, base: number) => {
    for (const el of root.querySelectorAll<HTMLElement>(sel)) {
      const delay = base + Math.min(MAX_WAVE_DELAY, distance(box(el), click) / WAVE_SPEED)
      waveEls.push({ el, delay })
    }
  }
  pick('.back-btn', BASE_DELAY.back)
  pick('.header-info', BASE_DELAY.header)
  const rows = [...root.querySelectorAll<HTMLElement>('.track-row, .disc-title')]
  for (const el of rows.slice(0, MAX_WAVE_ROWS)) {
    waveEls.push({ el, delay: BASE_DELAY.row + Math.min(MAX_WAVE_DELAY, distance(box(el), click) / WAVE_SPEED) })
  }
  // 超出上限的行直接显示，避免永远停在初始 opacity:0
  for (const el of rows.slice(MAX_WAVE_ROWS)) el.style.opacity = '1'
}

/** 内容按"到点击点的距离"依次浮现：离坍缩点越近的内容越早出现 */
function runWave() {
  for (const { el, delay } of waveEls) {
    el.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], {
      duration: dur(REVEAL_DUR),
      delay: dur(delay),
      easing: EASE,
      fill: 'both',
    })
  }
}

/** 封面 FLIP 飞行：从卡片飞到详情头部大图（沿用原有的交接手法，避免双层半透明导致亮度坍缩） */
function flyCover(o: Origin, target: HTMLElement, t: Box): Promise<void> {
  if (t.width < 1 || t.height < 1) return Promise.resolve()

  const flying = o.coverEl.cloneNode(true) as HTMLElement
  flying.classList.add('page-flight')
  const s = o.rect.width / t.width
  const oX = ((o.click.x - o.rect.left) / o.rect.width) * t.width
  const oY = ((o.click.y - o.rect.top) / o.rect.height) * t.height
  const tx = o.rect.left - t.left - oX * (1 - s)
  const ty = o.rect.top - t.top - oY * (1 - s)
  const radius = parseFloat(getComputedStyle(target).borderRadius) || 0

  Object.assign(flying.style, {
    position: 'fixed',
    margin: '0',
    left: `${t.left}px`,
    top: `${t.top}px`,
    width: `${t.width}px`,
    height: `${t.height}px`,
    borderRadius: `${radius}px`,
    objectFit: 'cover',
    zIndex: '70',
    pointerEvents: 'none',
    willChange: 'transform',
    transformOrigin: `${oX}px ${oY}px`,
    boxShadow: '0 20px 48px rgba(0, 0, 0, 0.3)',
  } as CSSStyleDeclaration)
  const start = `translate(${tx}px, ${ty}px) scale(${s})`
  flying.style.transform = start

  document.querySelectorAll('.page-flight').forEach((n) => n.remove())
  target.style.opacity = '0'
  document.body.appendChild(flying)

  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (target.matches('img') && !(target as HTMLImageElement).complete && o.src) {
        ;(target as HTMLImageElement).src = o.src
      }
      target.style.transition = 'opacity 120ms linear'
      target.style.opacity = '1'
      flying.style.transition = 'opacity 120ms linear'
      flying.style.opacity = '0'
      window.setTimeout(() => {
        flying.remove()
        target.style.transition = ''
        resolve()
      }, 130)
    }
    const anim = flying.animate([{ transform: start }, { transform: 'translate(0, 0) scale(1)' }], {
      duration: dur(COVER_ENTER),
      easing: EASE,
      fill: 'both',
    })
    anim.onfinish = finish
    window.setTimeout(finish, dur(COVER_ENTER) + 260)
  })
}

/* ---------- 阶段三：返回（对称反向） ---------- */

export async function playAlbumExit(root: HTMLElement | null): Promise<void> {
  const o = origin
  if (!o || !root) {
    clearTransitionState()
    return
  }
  if (reduced()) {
    clearTransitionState()
    return
  }
  // 同样先量后动：此刻层未折叠、源卡片未被变换，两个矩形都可信
  const layerBox = box(root)
  const cover = root.querySelector<HTMLElement>('.header-cover')
  const from = cover ? box(cover) : null
  const to = box(o.coverEl)

  collapseContent(root)
  foldLayerOut(root, layerBox, o.cardRect)
  const hasFlight = !!(cover && from)
  // 卡片在封面落定前后淡回（与克隆的 130ms 淡出交叉），不能等全部归位后再出现——否则落点处会有一段真空期
  restoreOriginCard(hasFlight ? COVER_EXIT - 100 : 0)
  await Promise.all([restoreGrid(), hasFlight ? flyCoverBack(o, cover as HTMLElement, from as Box, to) : Promise.resolve()])
  clearTransitionState()
}

/** 内容按波前反序收起（远的先消失，波退回坍缩点） */
function collapseContent(root: HTMLElement) {
  const maxDelay = Math.max(1, ...waveEls.map((w) => w.delay))
  for (const { el, delay } of waveEls) {
    el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px)' }], {
      duration: dur(160),
      delay: dur(((maxDelay - delay) / maxDelay) * 80),
      easing: EASE,
      fill: 'forwards',
    })
  }
  for (const g of root.querySelectorAll<HTMLElement>('.disc-group')) {
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur(160), easing: EASE, fill: 'forwards' })
  }
}

/** 详情层折叠回被点卡片的矩形再收缩消失（页面被"吸回"坍缩点）；只做几何折叠，不改布局矩形 */
function foldLayerOut(root: HTMLElement, layerBox: Box, cardBox: Box) {
  const s = Math.max(cardBox.width / layerBox.width, cardBox.height / layerBox.height)
  const tx = cardBox.left - layerBox.left
  const ty = cardBox.top - layerBox.top
  root.animate(
    [
      { transform: 'none', opacity: 1, transformOrigin: '0 0' },
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`,
        opacity: 1,
        offset: 0.55,
        transformOrigin: '0 0',
      },
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${(s * 0.5).toFixed(4)})`,
        opacity: 0,
        transformOrigin: '0 0',
      },
    ],
    { duration: dur(FOLD_DUR), easing: EASE, fill: 'forwards' },
  )
}

/** 网格反向归位：从坍缩点喷回原位，延迟取反（远的先回来） */
function restoreGrid(): Promise<void> {
  const jobs: Promise<unknown>[] = []
  for (const [card, rec] of gridRecs) {
    rec.anim.cancel()
    const anim = card.animate([rec.to, { transform: 'none', opacity: 1 }], {
      duration: dur(SUCK_DUR),
      delay: dur((MAX_WAVE_DELAY - rec.delay) * 0.6),
      easing: EASE,
      fill: 'both',
    })
    jobs.push(
      anim.finished.then(
        () => anim.cancel(),
        () => anim.cancel(),
      ),
    )
  }
  gridRecs.clear()
  return Promise.all(jobs).then(() => undefined)
}

/** 让被点卡片淡回（delay ≈ 飞行时长 - 100ms）：与克隆落定后的淡出交叉衔接，落点处不出现真空 */
function restoreOriginCard(delayMs = 0) {
  const el = originCardEl
  if (!el) return
  originCardEl = null
  originCardAnim?.cancel()
  originCardAnim = null
  const back = el.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: dur(200),
    delay: dur(delayMs),
    easing: EASE,
    fill: 'both',
  })
  back.finished.then(
    () => back.cancel(),
    () => back.cancel(),
  )
}

function flyCoverBack(o: Origin, target: HTMLElement, from: Box, to: Box): Promise<void> {
  if (to.width < 1 || from.width < 1) return Promise.resolve()

  const flying = target.cloneNode(true) as HTMLElement
  flying.classList.add('page-flight')
  const s = to.width / from.width
  // transform-origin 相对克隆自身（from 尺寸）；落点矩形 to 是新鲜测量，比进动画时缓存的 o.rect 可靠
  const oX = ((o.click.x - to.left) / to.width) * from.width
  const oY = ((o.click.y - to.top) / to.height) * from.height
  // 终态必须让克隆外框精确盖住 to：local(0,0) → from.left + oX(1-s) + tx = to.left
  const tx = to.left - from.left - oX * (1 - s)
  const ty = to.top - from.top - oY * (1 - s)
  // 克隆终态被缩放 s 倍，圆角要预除 s 才能落定后与卡片封面一致
  const radius = parseFloat(getComputedStyle(o.coverEl).borderRadius) || 0

  Object.assign(flying.style, {
    position: 'fixed',
    margin: '0',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    borderRadius: `${(radius / s).toFixed(1)}px`,
    objectFit: 'cover',
    zIndex: '70',
    pointerEvents: 'none',
    willChange: 'transform',
    transformOrigin: `${oX}px ${oY}px`,
    boxShadow: '0 20px 48px rgba(0, 0, 0, 0.3)',
  } as CSSStyleDeclaration)

  document.querySelectorAll('.page-flight').forEach((n) => n.remove())
  target.style.opacity = '0'
  document.body.appendChild(flying)

  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      target.style.opacity = '1'
      flying.style.transition = 'opacity 120ms linear'
      flying.style.opacity = '0'
      window.setTimeout(() => {
        flying.remove()
        resolve()
      }, 130)
    }
    const anim = flying.animate([{ transform: 'none' }, { transform: `translate(${tx}px, ${ty}px) scale(${s})` }], {
      duration: dur(COVER_EXIT),
      easing: EASE,
      fill: 'forwards',
    })
    anim.onfinish = finish
    window.setTimeout(finish, dur(COVER_EXIT) + 260)
  })
}

/** 清理模块状态：切换视图 / 网格卸载时调用，避免残留动画引用已销毁的 DOM */
export function clearTransitionState(): void {
  origin = null
  waveEls = []
  for (const [, rec] of gridRecs) rec.anim.cancel()
  gridRecs.clear()
  originCardEl = null
  originCardAnim?.cancel()
  originCardAnim = null
  document.querySelectorAll('.page-flight').forEach((n) => n.remove())
}
