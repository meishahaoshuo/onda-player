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

/* ---------- 时序常量（毫秒；lite 档整体 ×0.7，再乘全局 SPEED） ---------- */
const WAVE_SPEED = 2.2 // px/ms：波速，延迟 = 到点击点距离 / 波速
const MAX_WAVE_DELAY = 240 // 波前延迟上限
const REVEAL_DUR = 260 // 详情内容单元素浮现时长
const SUCK_DUR = 420 // 周边卡片被吸入时长
const BLOOM_DUR = 460 // 详情层从卡片析出放大时长
const FOLD_DUR = 420 // 返回时详情层折叠回卡片时长
const COVER_ENTER = 540 // 封面飞入时长
const COVER_EXIT = 320 // 封面飞回时长
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

/**
 * 全局时间缩放：原始参数偏快，用户要求「优雅丝滑」，整体放慢到 1.35×
 * （实测进入 547ms → 约 740ms，返回 495ms → 约 670ms）。
 *
 * 只改 `dur()` 一处即可让**所有**时长等比缩放 —— 上面这些常量、内联的
 * `dur(160)` / `dur(200)` / `dur(233)`，以及经 `dur()` 包装的波前延迟
 * （`WAVE_SPEED` / `MAX_WAVE_DELAY` / `BASE_DELAY` 的产物）全部覆盖，
 * 因此相位关系不会被打乱。**后续再调速度只动这一个数**，
 * 不要去逐个改上面的常量（会破坏彼此的相对节奏）。
 */
const SPEED = 1.35

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
/** 本次编排的网格/内容选择器：专辑、艺术家、歌单共用编排器时由 beginAlbumEnter 传入 */
let activeCardSel = '.album-card, .artist-card'
let activeGridSel = '.album-grid'
let waveSel = { info: '.header-info', rows: '.track-row, .disc-title' }
const gridRecs = new Map<HTMLElement, CollapseRecord>()
/** 被点击卡片的淡出动画（它的封面已交给飞行克隆，本体让位） */
let originCardEl: HTMLElement | null = null
let originCardAnim: Animation | null = null
/** 详情内被波前接管的内容元素（返回时统一收起） */
let waveEls: { el: HTMLElement; delay: number }[] = []

/**
 * 代际号：每次开始新过渡 / 强制清理时自增。
 * 异步续段（await 之后的代码）在恢复执行时核对自己的代际，
 * 不一致说明已被导航打断或被新过渡接管，必须立即收手 —— 这是连点/侧边栏抢断竞态的总闸。
 */
let epoch = 0
/** 本模块创建过的所有动画登记表：任何清理路径都能把它们一网打尽，
    避免「gridRecs 被覆盖后旧 fill 动画失去引用、永久挂在卡片上」的孤儿态 */
const allAnims = new Set<Animation>()

/** 登记动画。注意：finish 的动画可能仍以 fill 持有元素样式（如坍缩终态 opacity:0），
    所以只在被 cancel 时才从登记表移除，finish 不移除。 */
function track<T extends Animation>(anim: T): T {
  allAnims.add(anim)
  anim.finished.then(
    () => {},
    () => allAnims.delete(anim),
  )
  return anim
}

/** 强制复位网格卡片：取消元素上的一切动画（含孤儿 fill）并清掉行内残留。
    在「开始新过渡」与「强制清理」时调用，保证卡片回到自然态 —— 先量后动永远成立。 */
function resetGridCards(): void {
  for (const el of document.querySelectorAll<HTMLElement>(activeCardSel)) {
    for (const a of el.getAnimations()) a.cancel()
    el.style.transform = ''
    el.style.opacity = ''
  }
}

/** lite 档：时长 ×0.7 */
let lite = (navigator.hardwareConcurrency ?? 8) <= 2

/* ---------- 工具 ---------- */

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function dur(ms: number): number {
  return lite ? ms * 0.7 * SPEED : ms * SPEED
}

function box(el: HTMLElement): Box {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * 过渡不得越过的**顶部裁切线** = 网格所在滚动宿主的顶边（即顶栏带下缘，62px）。
 *
 * 为什么需要：卡片被滚出视口一部分时（`.view-body` 把它裁掉半截），
 * 它的 `getBoundingClientRect().top` 会跑到顶栏底下（实测 −48px）。
 * 折叠层是「按卡片矩形 translate + scale」，飞行克隆是 `position: fixed`
 * 挂在 body 上 —— 两者都会照着这个越界的矩形飞到**顶栏之上**把它盖住
 * （实测折叠层顶边最低 −29.7px、58 帧压住顶栏，且是不透明的）。
 */
function topClipLine(): number {
  const host = document.querySelector<HTMLElement>('.view-body')
  const t = host?.getBoundingClientRect().top ?? 0
  return t > 0 ? t : 0
}

/**
 * 飞行克隆的宿主：铺满视口、但在顶栏下缘用 `clip-path` 裁一刀。
 *
 * **关键取舍**：上一版是"把目标矩形夹紧"来避免越界，结果落点被抬高，
 * 收尾时真实卡片一出现就"弹回原位"（用户反馈）。正确做法是**裁掉越界的部分**，
 * 落点仍照真实卡片矩形算 —— 这样克隆被裁的位置与网格被裁的位置完全一致，收尾零跳变。
 * 折叠层同理由 App.vue 的 `.detail-clip` 容器裁（那里用 overflow:hidden）。
 *
 * 容器必须铺满视口（inset:0）：`clip-path` 可能让它成为 fixed 子元素的包含块，
 * 届时克隆的视口坐标要相对它算；它从 0 起，坐标才不会整体偏移。
 */
function flightHost(): HTMLElement {
  let host = document.querySelector<HTMLElement>('.page-flight-clip')
  if (!host) {
    host = document.createElement('div')
    host.className = 'page-flight-clip'
    Object.assign(host.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      right: '0',
      bottom: '0',
      zIndex: '70',
      pointerEvents: 'none',
    } as CSSStyleDeclaration)
    document.body.appendChild(host)
  }
  host.style.clipPath = `inset(${Math.max(0, topClipLine())}px 0 0 0)`
  return host
}

function distance(b: Box, p: { x: number; y: number }): number {
  return Math.hypot(b.left + b.width / 2 - p.x, b.top + b.height / 2 - p.y)
}

/** 源封面的形状按克隆宽度等比换算成圆角值（% 保持 %，px 等比缩放）。
    getComputedStyle 对百分比圆角会原样返回 "50%"，对像素值返回 px——两种都要正确处理。 */
function cloneRadiusFor(shapeEl: HTMLElement, srcW: number, dstW: number): string {
  const r = getComputedStyle(shapeEl).borderRadius
  if (r.includes('%')) return r
  const px = parseFloat(r) || 0
  return `${((px / srcW) * dstW).toFixed(1)}px`
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
  /** 网格容器/卡片选择器（歌单等复用时传入） */
  gridSel?: string
  cardSel?: string
  /** 详情内容波前选择器：信息区与行 */
  waveInfo?: string
  waveRows?: string
}): void {
  const ui = useUiStore()
  if (ui.dolly !== 'idle') return // 过渡进行中：忽略连点
  activeGridSel = o.gridSel ?? '.album-grid'
  activeCardSel = o.cardSel ?? '.album-card, .artist-card'
  waveSel = { info: o.waveInfo ?? '.header-info', rows: o.waveRows ?? '.track-row, .disc-title' }
  epoch++ // 开启新代际：上一段未完成的异步续段（若有）就此作废
  // 先强制复位所有网格卡片（清掉磁吸残留与任何孤儿动画），再测量 —— 先量后动永远成立
  resetGridCards()
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
  if (!reduced()) {
    collapseGrid(o.cardEl, o.click)
    hideOriginCard(o.cardEl)
  }
  ui.openDetail(o.albumKey)
}

/** 周边卡片被吸入点击点：越近越先被吞，带一点旋转（被"拽"进去的失控感） */
function collapseGrid(cardEl: HTMLElement, click: { x: number; y: number }) {
  const grid = cardEl.closest(activeGridSel)
  if (!grid) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  let n = 0
  for (const card of grid.querySelectorAll<HTMLElement>(activeCardSel)) {
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
    const anim = track(
      card.animate([{ transform: 'none', opacity: 1 }, to], {
        duration: dur(SUCK_DUR),
        delay: dur(delay),
        easing: EASE,
        fill: 'forwards',
      }),
    )
    gridRecs.set(card, { anim, delay, to })
  }
}

/** 被点击的卡片淡出让位：它的封面已由飞行克隆接管，同时保证它的矩形不被变换污染 */
function hideOriginCard(cardEl: HTMLElement) {
  originCardAnim?.cancel()
  originCardEl = cardEl
  originCardAnim = track(
    cardEl.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: dur(240),
      easing: EASE,
      fill: 'forwards',
    }),
  )
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
  const my = epoch // 记下代际：await 恢复后若已被打断/接管，立即收手

  // 先量后动：此刻详情层与头图都还没有任何变换，量到的才是最终落点
  const layerBox = box(root)
  const cover = root.querySelector<HTMLElement>('.header-cover')
  const coverBox = cover ? box(cover) : null
  planWave(root, o.click)

  bloomLayerIn(root, layerBox, o.cardRect)
  runWave()
  if (cover && coverBox) await flyCover(o, cover, coverBox)
  if (epoch !== my) return // 期间发生了清理或新过渡：dolly 的归属已移交，不得再动
  useUiStore().endDolly()
}

/** 详情层从被点卡片的矩形析出放大接管整页（transform-origin 钉在卡片左上角） */
function bloomLayerIn(root: HTMLElement, layerBox: Box, cardBox: Box) {
  const s = Math.max(cardBox.width / layerBox.width, cardBox.height / layerBox.height)
  const tx = cardBox.left - layerBox.left
  const ty = cardBox.top - layerBox.top
  track(
    root.animate(
      [
        { transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`, transformOrigin: '0 0' },
        { transform: 'none', transformOrigin: '0 0' },
      ],
      { duration: dur(BLOOM_DUR), easing: EASE },
    ),
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
  pick(waveSel.info, BASE_DELAY.header)
  const rows = [...root.querySelectorAll<HTMLElement>(waveSel.rows)]
  for (const el of rows.slice(0, MAX_WAVE_ROWS)) {
    waveEls.push({ el, delay: BASE_DELAY.row + Math.min(MAX_WAVE_DELAY, distance(box(el), click) / WAVE_SPEED) })
  }
  // 超出上限的行直接显示，避免永远停在初始 opacity:0
  for (const el of rows.slice(MAX_WAVE_ROWS)) el.style.opacity = '1'
}

/** 内容按"到点击点的距离"依次浮现：离坍缩点越近的内容越早出现 */
function runWave() {
  for (const { el, delay } of waveEls) {
    track(
      el.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], {
        duration: dur(REVEAL_DUR),
        delay: dur(delay),
        easing: EASE,
        fill: 'both',
      }),
    )
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
  // 克隆形状与源封面一致（圆保持圆、方保持方），不做形状形变动画
  flying.style.borderRadius = cloneRadiusFor(o.coverEl, o.rect.width, t.width)
  // 投影直接用落点封面的真实投影：交接瞬间阴影零跳变（重投影在淡出时会压出一次亮度跳变）
  flying.style.boxShadow = getComputedStyle(target).boxShadow || 'none'

  Object.assign(flying.style, {
    position: 'fixed',
    margin: '0',
    left: `${t.left}px`,
    top: `${t.top}px`,
    width: `${t.width}px`,
    height: `${t.height}px`,
    objectFit: 'cover',
    zIndex: '70',
    pointerEvents: 'none',
    willChange: 'transform',
    transformOrigin: `${oX}px ${oY}px`,
  } as CSSStyleDeclaration)
  const start = `translate(${tx}px, ${ty}px) scale(${s})`
  flying.style.transform = start

  document.querySelectorAll('.page-flight').forEach((n) => n.remove())
  target.style.opacity = '0'
  flightHost().appendChild(flying)

  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (target.matches('img') && !(target as HTMLImageElement).complete && o.src) {
        ;(target as HTMLImageElement).src = o.src
      }
      // 单帧交接：目标立即全显、克隆同帧移除——不做交叉淡出，
      // 任何像素差都只占 1 帧，不会出现 120ms 的重影闪烁
      target.style.opacity = '1'
      flying.remove()
      resolve()
    }
    const anim = track(
      flying.animate([{ transform: start }, { transform: 'translate(0, 0) scale(1)' }], {
        duration: dur(COVER_ENTER),
        easing: EASE,
        fill: 'both',
      }),
    )
    anim.onfinish = finish
    window.setTimeout(finish, dur(COVER_ENTER + 260))
  })
}

/* ---------- 阶段三：返回（对称反向） ---------- */

export async function playAlbumExit(root: HTMLElement | null): Promise<void> {
  const ui = useUiStore()
  const o = origin
  if (!o || !root || reduced()) {
    clearTransitionState()
    ui.closeDetail()
    ui.endDolly()
    return
  }
  const my = epoch
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
  if (epoch !== my) return // 期间被导航/新过渡接管：收尾（closeDetail/endDolly）交给接管者
  clearTransitionState()
  ui.closeDetail()
  ui.endDolly()
}

/** 内容按波前反序收起（远的先消失，波退回坍缩点） */
function collapseContent(root: HTMLElement) {
  const maxDelay = Math.max(1, ...waveEls.map((w) => w.delay))
  for (const { el, delay } of waveEls) {
    track(
      el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px)' }], {
        duration: dur(160),
        delay: dur(((maxDelay - delay) / maxDelay) * 80),
        easing: EASE,
        fill: 'forwards',
      }),
    )
  }
  for (const g of root.querySelectorAll<HTMLElement>('.disc-group')) {
    track(g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur(160), easing: EASE, fill: 'forwards' }))
  }
}

/** 详情层折叠回被点卡片的矩形再收缩消失（页面被"吸回"坍缩点）；只做几何折叠，不改布局矩形 */
function foldLayerOut(root: HTMLElement, layerBox: Box, cardBox: Box) {
  const s = Math.max(cardBox.width / layerBox.width, cardBox.height / layerBox.height)
  const tx = cardBox.left - layerBox.left
  const ty = cardBox.top - layerBox.top
  track(
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
    ),
  )
}

/** 网格反向归位：从坍缩点喷回原位，延迟取反（远的先回来） */
function restoreGrid(): Promise<void> {
  const jobs: Promise<unknown>[] = []
  for (const [card, rec] of gridRecs) {
    rec.anim.cancel()
    const anim = track(
      card.animate([rec.to, { transform: 'none', opacity: 1 }], {
        duration: dur(SUCK_DUR),
        delay: dur((MAX_WAVE_DELAY - rec.delay) * 0.6),
        easing: EASE,
        fill: 'both',
      }),
    )
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
  const back = track(
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: dur(200),
      delay: dur(delayMs),
      easing: EASE,
      fill: 'both',
    }),
  )
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
  // 克隆形状与落点（详情封面）一致，不做形状形变动画
  flying.style.borderRadius = getComputedStyle(target).borderRadius
  // 投影用被点卡片封面的真实投影：落回网格时阴影零跳变
  flying.style.boxShadow = getComputedStyle(o.coverEl).boxShadow || 'none'

  Object.assign(flying.style, {
    position: 'fixed',
    margin: '0',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    objectFit: 'cover',
    zIndex: '70',
    pointerEvents: 'none',
    willChange: 'transform',
    transformOrigin: `${oX}px ${oY}px`,
  } as CSSStyleDeclaration)

  document.querySelectorAll('.page-flight').forEach((n) => n.remove())
  target.style.opacity = '0'
  flightHost().appendChild(flying)

  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      // 单帧交接（同 flyCover）：目标立即全显、克隆同帧移除
      target.style.opacity = '1'
      flying.remove()
      resolve()
    }
    const anim = track(
      flying.animate([{ transform: 'none' }, { transform: `translate(${tx}px, ${ty}px) scale(${s})` }], {
        duration: dur(COVER_EXIT),
        easing: EASE,
        fill: 'forwards',
      }),
    )
    anim.onfinish = finish
    window.setTimeout(finish, dur(COVER_EXIT + 260))
  })
}

/** 清理模块状态：切换视图 / 详情被外部关闭（如点侧边栏） / 网格卸载时调用。
    会取消本模块创建的一切动画（含孤儿 fill）并强制复位网格卡片。 */
export function clearTransitionState(): void {
  epoch++ // 让仍在飞的异步续段（enter 的 endDolly / exit 的收尾）全部作废
  origin = null
  waveEls = []
  for (const [, rec] of gridRecs) rec.anim.cancel()
  gridRecs.clear()
  originCardEl = null
  originCardAnim?.cancel()
  originCardAnim = null
  for (const a of allAnims) a.cancel()
  allAnims.clear()
  document.querySelectorAll('.page-flight').forEach((n) => n.remove())
  resetGridCards()
}
