import { useUiStore } from '@/stores/ui'

/**
 * 歌曲封面飞入底部播放栏 ——「卡带 · 滑门入仓」编排。
 * 封面全程保持方形（卡带本来就是方的），不做圆形变形：
 * 1. 拿起（0–16%）：封面轻轻浮起放大，带一点预旋；
 * 2. 变形（16–42%）：四周浮现卡带外壳框，左右两个卷带轮淡入并开始转动，
 *    封面成为卡带的"标签"，整体沿弧线滑向播放栏；
 * 3. 入仓（42–66%）：播放栏封面位出现玻璃"仓门"向两侧滑开，卡带顺着仓口滑入，播放栏微沉；
 * 4. 启动（66–100%）：仓门合拢把卡带"吞"进去，卷轮转完大半圈收住，仓门淡出交出真实封面 pop。
 *
 * 与页面切换编排器（pageTransition）互斥：编排期间跳过飞行，只做落点弹跳。
 */

const FLIGHT_MS = 900
/** 卡带滑入仓位的时刻（占比）：仓门/下沉/弹跳都与此对齐 */
const LAND_AT = 0.66
const EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)'

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function playerCoverEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.player-bar .cover')
}

/** 播放栏封面弹跳：接住卡带——放大、歪头、回正 */
export function popPlayerCover(): void {
  const target = playerCoverEl()
  if (!target) return
  target.animate(
    [
      { transform: 'scale(1) rotate(0deg)' },
      { transform: 'scale(1.16) rotate(-3deg)', offset: 0.35 },
      { transform: 'scale(0.97) rotate(2deg)', offset: 0.7 },
      { transform: 'scale(1) rotate(0deg)' },
    ],
    { duration: 460, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  )
}

/** 播放栏整体下沉回弹：像卡带机承受了入仓的重量 */
function dipPlayerBar(delayMs: number): void {
  const bar = document.querySelector<HTMLElement>('.player-bar')
  if (!bar) return
  bar.animate(
    [
      { transform: 'translateY(0)' },
      { transform: 'translateY(2.5px)', offset: 0.45 },
      { transform: 'translateY(0)' },
    ],
    { duration: 300, delay: delayMs, easing: 'ease-out' },
  )
}

/** 卡带外壳框：套在封面四周的深色边框，让方形封面读作"卡带" */
function makeShell(): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'absolute',
    inset: '-10% -13%',
    borderRadius: '12px',
    background: 'var(--bg-panel)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'var(--shadow-1)',
    opacity: '0',
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  return el
}

/** 卷带轮：卡带窗里的两个小转轮（带轮齿高光的圆盘，旋转可见） */
function makeReel(): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'absolute',
    top: '50%',
    width: '26%',
    aspectRatio: '1',
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    background:
      'radial-gradient(circle, rgba(0,0,0,0.42) 0 34%, transparent 35%), conic-gradient(rgba(255,255,255,0.95) 0 34deg, rgba(255,255,255,0.28) 34deg 360deg)',
    border: '2px solid rgba(255,255,255,0.85)',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    opacity: '0',
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  return el
}

/**
 * 仓门：盖在播放栏封面位上的两片玻璃板，滑开迎接卡带、合拢后再淡出。
 * 开合用单个动画的 offset 关键帧表达，避免同属性双动画的 fill 竞争。
 */
function makeDoor(to: DOMRect): { root: HTMLElement; left: HTMLElement; right: HTMLElement } {
  const root = document.createElement('div')
  root.className = 'player-door'
  Object.assign(root.style, {
    position: 'fixed',
    left: `${to.left - 5}px`,
    top: `${to.top - 5}px`,
    width: `${to.width + 10}px`,
    height: `${to.height + 10}px`,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    zIndex: '71',
    pointerEvents: 'none',
    opacity: '0',
  } as CSSStyleDeclaration)
  const mk = (side: 'l' | 'r') => {
    const el = document.createElement('div')
    Object.assign(el.style, {
      background: 'var(--queue-bg)',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
      borderTop: '1px solid var(--glass-border)',
      borderBottom: '1px solid var(--glass-border)',
      borderRadius: side === 'l' ? '9px 2px 2px 9px' : '2px 9px 9px 2px',
      borderLeft: side === 'l' ? '1px solid var(--glass-border)' : 'none',
      borderRight: side === 'r' ? '1px solid var(--glass-border)' : 'none',
    } as unknown as CSSStyleDeclaration)
    return el
  }
  const left = mk('l')
  const right = mk('r')
  root.append(left, right)
  return { root, left, right }
}

/**
 * 从 fromEl（行内封面元素或其容器）起飞。找不到可用封面图时只做落点弹跳。
 * 调用方在触发播放的同一次点击里调用（飞行的起点矩形必须在布局变化前测量）。
 */
export function flyToPlayer(fromEl: Element | null): void {
  const img = fromEl
    ? ((fromEl.matches('img') ? fromEl : fromEl.querySelector('img')) as HTMLImageElement | null)
    : null
  const target = playerCoverEl()

  // 无可飞封面 / 减动效 / 页面过渡编排中：只做落点弹跳
  if (!fromEl || !img || !img.currentSrc || !target || reduced() || useUiStore().dolly !== 'idle') {
    popPlayerCover()
    return
  }

  const from = img.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  if (from.width < 4 || from.height < 4 || to.width < 4 || to.height < 4) {
    popPlayerCover()
    return
  }
  if (from.bottom < 0 || from.top > window.innerHeight) {
    popPlayerCover()
    return
  }

  const s = to.width / from.width
  // transform-origin 用中心：缩放围绕中心，平移到目标中心即可对齐
  const tx = to.left + to.width / 2 - (from.left + from.width / 2)
  const ty = to.top + to.height / 2 - (from.top + from.height / 2)
  // 弧线拱高随距离变化；滑入段从拱顶顺下来近似切向入仓
  const arc = Math.min(96, Math.max(40, Math.hypot(tx, ty) * 0.2))
  // 姿态朝向飞行方向，优雅小角度，不做整圈旋转
  const dir = tx >= 0 ? 1 : -1

  const startRadius = getComputedStyle(img).borderRadius

  /* ---------- 飞行载体：外壳框 + 封面 + 两卷轮 ---------- */
  const flying = document.createElement('div')
  flying.className = 'cover-flight'
  Object.assign(flying.style, {
    position: 'fixed',
    margin: '0',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    zIndex: '70',
    pointerEvents: 'none',
    willChange: 'transform',
    borderRadius: startRadius,
    boxShadow: 'var(--shadow-2)',
  } as CSSStyleDeclaration)
  const cloneImg = document.createElement('img')
  cloneImg.src = img.currentSrc
  Object.assign(cloneImg.style, {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    borderRadius: startRadius,
  } as CSSStyleDeclaration)
  const shell = makeShell()
  const reelL = makeReel()
  const reelR = makeReel()
  reelL.style.left = '27%'
  reelR.style.left = '73%'
  flying.append(shell, cloneImg, reelL, reelR)
  // 外壳在封面后面，卷轮在封面前面（卡带窗的感觉）
  shell.style.zIndex = '-1'

  /* ---------- 仓门 ---------- */
  const door = makeDoor(to)

  document.querySelectorAll('.cover-flight, .player-door').forEach((n) => n.remove())
  document.body.append(flying, door.root)

  /* ---------- 主编排（900ms，offset 驱动四阶段） ---------- */
  const anim = flying.animate(
    [
      // 拿起：原位
      {
        transform: 'translate(0px, 0px) scale(1) rotate(0deg)',
        offset: 0,
        easing: 'ease-out',
      },
      // 浮起完成
      {
        transform: `translate(${(tx * 0.05).toFixed(1)}px, ${(ty * 0.05 - 14).toFixed(1)}px) scale(1.1) rotate(${(4 * dir).toFixed(1)}deg)`,
        offset: 0.16,
        easing: 'ease-in-out',
      },
      // 变形完成、滑行过拱顶（姿态朝向目标）
      {
        transform: `translate(${(tx * 0.55).toFixed(1)}px, ${(ty * 0.45 - arc).toFixed(1)}px) scale(1.16) rotate(${(7 * dir).toFixed(1)}deg)`,
        offset: 0.42,
        easing: 'cubic-bezier(0.3, 0, 0.35, 1)',
      },
      // 顺着仓口滑入到位
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${(s * 1.06).toFixed(3)}) rotate(0deg)`,
        offset: LAND_AT,
        easing: 'ease-out',
      },
      // 嵌入仓位
      { transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(0deg)`, offset: 0.8 },
      // 交给真实封面
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(0deg)`,
        opacity: 0,
        offset: 1,
      },
    ],
    { duration: FLIGHT_MS, fill: 'both' },
  )

  /* ---------- 卡带部件的节奏 ---------- */
  const envelope = (delay: number, peak: number, out: number) => [
    { opacity: 0, offset: 0 },
    { opacity: 1, offset: peak },
    { opacity: 1, offset: out },
    { opacity: 0, offset: 0.97 },
  ]
  // 外壳与卷轮在「变形」段浮现，入仓后随整体淡出
  for (const el of [shell, reelL, reelR]) {
    el.animate(envelope(0, 0.24, 0.78), { duration: FLIGHT_MS, fill: 'both', easing: 'ease-out' })
  }
  // 卷轮持续转动：变形段起步 → 落仓后转完大半圈"上带"
  for (const reel of [reelL, reelR]) {
    reel.animate(
      [
        { transform: 'translate(-50%, -50%) rotate(0deg)', offset: 0 },
        { transform: 'translate(-50%, -50%) rotate(28deg)', offset: 0.24 },
        { transform: `translate(-50%, -50%) rotate(${180 + 28 * dir}deg)`, offset: 0.86 },
        { transform: `translate(-50%, -50%) rotate(${168 + 28 * dir}deg)`, offset: 1 },
      ],
      { duration: FLIGHT_MS, fill: 'both', easing: 'linear' },
    )
  }
  // 封面标签圆角收平（卡带标签是直角贴纸的感觉）
  cloneImg.animate(
    [
      { borderRadius: startRadius, offset: 0 },
      { borderRadius: '7px', offset: 0.26 },
      { borderRadius: '7px', offset: 1 },
    ],
    { duration: FLIGHT_MS, fill: 'both', easing: 'ease-out' },
  )

  /* ---------- 仓门的开合节奏 ---------- */
  door.root.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.38 },
      { opacity: 1, offset: 0.9 },
      { opacity: 0, offset: 1 },
    ],
    { duration: FLIGHT_MS, fill: 'both', easing: 'ease-out' },
  )
  const doorSlide = (side: 'l' | 'r') => {
    const open = side === 'l' ? 'translateX(-104%)' : 'translateX(104%)'
    return [
      { transform: 'translateX(0)', offset: 0, easing: 'ease-in-out' },
      { transform: open, offset: 0.61, easing: 'ease-in-out' },
      { transform: open, offset: 0.71, easing: 'ease-in-out' },
      { transform: 'translateX(0)', offset: 0.88 },
    ]
  }
  door.left.animate(doorSlide('l'), { duration: FLIGHT_MS, fill: 'both' })
  door.right.animate(doorSlide('r'), { duration: FLIGHT_MS, fill: 'both' })

  /* ---------- 落仓时刻的对齐表演 ---------- */
  const landDelay = Math.round(FLIGHT_MS * LAND_AT) - 30
  dipPlayerBar(landDelay)
  window.setTimeout(() => popPlayerCover(), Math.round(FLIGHT_MS * 0.86))

  const cleanup = () => {
    flying.remove()
    door.root.remove()
  }
  anim.finished.then(cleanup, cleanup)
  window.setTimeout(cleanup, FLIGHT_MS + 400)
}

/**
 * 事件接入辅助：行点击时从 e.currentTarget（行元素）里找带 data-flight-cover
 * 标记的封面容器；点在封面自身上时也能通过 closest 兜底找到。
 */
export function flyToPlayerFromRow(e: MouseEvent): void {
  const row = e.currentTarget as Element | null
  const el =
    row?.querySelector('[data-flight-cover]') ??
    (e.target as Element | null)?.closest?.('[data-flight-cover]') ??
    null
  flyToPlayer(el)
}
