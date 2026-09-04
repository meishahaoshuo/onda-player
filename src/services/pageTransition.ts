/**
 * 通用共享元素过渡（FLIP）：从「点击的图片元素」（卡片封面）平滑放大/飞向「详情页目标图片」（头部大图）。
 * 起点由列表页点击时捕获（capturePageTransition），终点由详情页挂载后提供（playPageTransition）。
 *
 * 关键：`transform-origin` 设为**点击点**（相对目标盒换算），并补偿 translate，
 * 使封面从用户点击处「生长」而非从中心缩放——末帧仍精确落在目标封面矩形。
 */

interface TransitionOrigin {
  node: HTMLElement
  left: number
  top: number
  width: number
  height: number
  src: string
  clickX: number
  clickY: number
}

let origin: TransitionOrigin | null = null

const FLIP_DURATION = 540
const FLIP_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

/** 点击卡片时捕获封面作为共享元素起点（封面元素 + 点击坐标）。 */
export function capturePageTransition(cover: HTMLElement | null, clickPoint?: { x: number; y: number }) {
  if (!cover) return
  const r = cover.getBoundingClientRect()
  const img: HTMLImageElement | null = cover.matches('img') ? (cover as HTMLImageElement) : cover.querySelector('img')
  origin = {
    node: (cover.matches('img') ? cover : (cover.querySelector('img') ?? cover)).cloneNode(true) as HTMLElement,
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    src: img ? img.currentSrc || img.getAttribute('src') || '' : '',
    clickX: clickPoint?.x ?? r.left + r.width / 2,
    clickY: clickPoint?.y ?? r.top + r.height / 2,
  }
}

/** 详情页挂载后：把共享元素从起点 FLIP 到目标头部封面；返回 Promise，落定后 resolve。 */
export function playPageTransition(target: HTMLElement | null): Promise<void> {
  const o = origin
  origin = null
  if (!o || !target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return Promise.resolve()
  }
  const t = target.getBoundingClientRect()
  if (t.width < 1 || t.height < 1) return Promise.resolve()

  const flying = o.node.cloneNode(true) as HTMLElement
  flying.classList.add('page-flight')

  const s = o.width / t.width
  const oX = ((o.clickX - o.left) / o.width) * t.width
  const oY = ((o.clickY - o.top) / o.height) * t.height
  const tx = o.left - t.left - oX * (1 - s)
  const ty = o.top - t.top - oY * (1 - s)
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

  // 清理可能残留的同批飞行元素
  document.querySelectorAll('.page-flight').forEach((n) => n !== flying && n.remove())
  // 目标封面飞行期间隐藏，避免重叠
  target.style.opacity = '0'
  document.body.appendChild(flying)

  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      // 交接：目标立即不透明，克隆淡出（避免两者同时半透明导致亮度坍缩）
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
    const anim = flying.animate(
      [{ transform: start }, { transform: 'translate(0, 0) scale(1)' }],
      { duration: FLIP_DURATION, easing: FLIP_EASING, fill: 'both' },
    )
    anim.onfinish = finish
    window.setTimeout(finish, FLIP_DURATION + 240)
  })
}
