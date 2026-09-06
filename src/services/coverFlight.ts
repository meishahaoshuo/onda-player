import { useUiStore } from '@/stores/ui'

/**
 * 歌曲封面飞入底部播放栏 ——「黑胶落盘」编排：
 * 1. 起飞（0–22%）：方形封面翘起放大，微微抬升；
 * 2. 变身（22–50%）：遮罩渐变为圆形黑胶（浮现唱纹与中心唱片标），沿弧线旋向播放栏，转速渐快；
 * 3. 落盘（50–72%）：垂直下落嵌入播放栏封面位，播放栏整体下沉回弹（承受唱片重量），封面 squash；
 * 4. 定格（72–100%）：唱片转满一圈收住，交接给真实封面 pop。
 *
 * 与页面切换编排器（pageTransition）互斥：编排期间跳过飞行，只做落点弹跳。
 */

const FLIGHT_MS = 820
/** 落盘时刻（占总时长比例）：弹跳与播放栏下沉在此对齐 */
const LAND_AT = 0.72

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function playerCoverEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.player-bar .cover')
}

/** 播放栏封面弹跳：接住唱片——放大、歪头、回正 */
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

/** 播放栏整体下沉回弹：像唱片机承受了唱片的重量 */
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

/** 黑胶唱纹叠层：picture-disc 式的同心环高光，叠在专辑图上 */
function makeGrooves(): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'absolute',
    inset: '0',
    borderRadius: '50%',
    background:
      'repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.10) 0 1px, rgba(0,0,0,0.05) 1px 2px, transparent 2px 5px)',
    opacity: '0',
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  return el
}

/** 中心唱片标：唱机标签的小圆盘 */
function makeLabel(): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '34%',
    height: '34%',
    transform: 'translate(-50%, -50%)',
    borderRadius: '50%',
    background: 'radial-gradient(circle, var(--accent) 0%, var(--accent-strong) 78%)',
    boxShadow: '0 0 0 2px rgba(0,0,0,0.18)',
    opacity: '0',
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  return el
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
  // 弧线拱高随距离变化；悬停点在目标正上方，落下段近似垂直
  const arc = Math.min(96, Math.max(40, Math.hypot(tx, ty) * 0.2))
  const hoverX = tx * 0.92
  const hoverY = ty - arc
  // 朝飞行方向顺转，一整圈收住
  const dir = tx >= 0 ? 1 : -1
  const spin = 360 * dir

  const startRadius = getComputedStyle(img).borderRadius

  // 克隆外壳（方形→圆形的形变载体）+ 内嵌图 + 唱纹 + 中心标
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
    overflow: 'hidden',
    boxShadow: 'var(--shadow-2)',
  } as CSSStyleDeclaration)
  const cloneImg = document.createElement('img')
  cloneImg.src = img.currentSrc
  Object.assign(cloneImg.style, {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  } as CSSStyleDeclaration)
  const grooves = makeGrooves()
  const label = makeLabel()
  flying.append(cloneImg, grooves, label)

  document.querySelectorAll('.cover-flight').forEach((n) => n.remove())
  document.body.appendChild(flying)

  // 主编排：四段关键帧（easing 写在上一帧，控制下一段的节奏）
  const anim = flying.animate(
    [
      // 起飞：原位
      {
        transform: 'translate(0, 0) scale(1) rotate(0deg)',
        borderRadius: startRadius,
        offset: 0,
        easing: 'ease-out',
      },
      // 翘起完成，即将变身
      {
        transform: `translate(${(tx * 0.06).toFixed(1)}px, ${(ty * 0.06 - 16).toFixed(1)}px) scale(1.14) rotate(${(14 * dir).toFixed(1)}deg)`,
        borderRadius: startRadius,
        offset: 0.22,
        easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      },
      // 变身黑胶、飞抵播放栏正上方悬停（转速最快的瞬间）
      {
        transform: `translate(${hoverX.toFixed(1)}px, ${hoverY.toFixed(1)}px) scale(${(s * 1.25).toFixed(3)}) rotate(${(300 * dir).toFixed(1)}deg)`,
        borderRadius: '50%',
        offset: 0.5,
        easing: 'cubic-bezier(0.55, 0, 0.85, 0.36)',
      },
      // 落盘：垂直下落 + squash（压扁回弹的重量感）
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${(s * 1.1).toFixed(3)}, ${(s * 0.88).toFixed(3)}) rotate(${(350 * dir).toFixed(1)}deg)`,
        borderRadius: '50%',
        offset: LAND_AT,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      // 收住定格
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(${spin}deg)`,
        borderRadius: '50%',
        opacity: 1,
        offset: 0.9,
      },
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(${spin}deg)`,
        borderRadius: '50%',
        opacity: 0,
      },
    ],
    { duration: FLIGHT_MS, fill: 'both' },
  )

  // 唱纹与中心标在「变身」段浮现
  const revealMs = FLIGHT_MS * 0.28
  const revealDelay = FLIGHT_MS * 0.22
  for (const el of [grooves, label]) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: revealMs,
      delay: revealDelay,
      fill: 'both',
      easing: 'ease-out',
    })
  }

  // 落盘时刻的对齐表演：播放栏下沉 + 封面弹跳
  const landDelay = Math.round(FLIGHT_MS * LAND_AT - 40)
  dipPlayerBar(landDelay)
  window.setTimeout(() => popPlayerCover(), landDelay)

  const cleanup = () => flying.remove()
  anim.finished.then(cleanup, cleanup)
  window.setTimeout(cleanup, FLIGHT_MS + 300)
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
