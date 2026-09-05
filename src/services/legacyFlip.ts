/**
 * 旧版共享元素过渡（FLIP）：封面从卡片矩形飞向详情头部大图。
 *
 * 仅艺术家页 / 歌单页仍在使用（它们在自己内部渲染详情，走的是另一套结构）。
 * 专辑页已改用 pageTransition 的「相机推进」编排器；这两个页面的详情
 * 若后续也改成覆盖层结构，应直接复用编排器并删除本文件。
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

export function capturePageTransition(cover: HTMLElement | null, clickPoint?: { x: number; y: number }) {
  if (!cover) return
  const r = cover.getBoundingClientRect()
  const img: HTMLImageElement | null = cover.matches('img')
    ? (cover as HTMLImageElement)
    : cover.querySelector('img')
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

  document.querySelectorAll('.page-flight').forEach((n) => n !== flying && n.remove())
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
      duration: FLIP_DURATION,
      easing: FLIP_EASING,
      fill: 'both',
    })
    anim.onfinish = finish
    window.setTimeout(finish, FLIP_DURATION + 240)
  })
}
