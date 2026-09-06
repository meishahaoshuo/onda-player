import { useUiStore } from '@/stores/ui'

/**
 * 歌曲封面飞入底部播放栏：点击播放某首歌时，把行内小封面克隆出来，
 * 沿上拱的弧线飞向播放栏的小封面，落点瞬间播放栏封面弹性一跳完成"接住"。
 * 与页面切换编排器（pageTransition）互斥：编排器运行期间跳过飞行，只做落点弹跳。
 */

const FLIGHT_MS = 520
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const POP_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function playerCoverEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.player-bar .cover')
}

/** 播放栏封面弹跳：scale 1 → 1.14 → 1，模拟"接住"飞来的封面 */
export function popPlayerCover(): void {
  const target = playerCoverEl()
  if (!target) return
  target.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.14)', offset: 0.4 },
      { transform: 'scale(1)' },
    ],
    { duration: 380, easing: POP_EASE },
  )
}

/**
 * 从 fromEl（行内封面元素或其容器）起飞。找不到可用封面图时只做落点弹跳。
 * 调用方在触发播放的同一次点击里调用（飞行的起点矩形必须在布局变化前测量）。
 */
export function flyToPlayer(fromEl: Element | null): void {
  popPlayerCover()
  if (!fromEl || reduced()) return
  if (useUiStore().dolly !== 'idle') return // 页面切换编排中，不叠加飞行

  const img = (fromEl.matches('img') ? fromEl : fromEl.querySelector('img')) as HTMLImageElement | null
  if (!img || !img.currentSrc) return
  const target = playerCoverEl()
  if (!target) return

  const from = img.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  if (from.width < 4 || from.height < 4 || to.width < 4 || to.height < 4) return
  if (from.bottom < 0 || from.top > window.innerHeight) return

  const s = to.width / from.width
  // transform-origin 用中心：缩放围绕中心，平移到目标中心即可对齐
  const tx = to.left + to.width / 2 - (from.left + from.width / 2)
  const ty = to.top + to.height / 2 - (from.top + from.height / 2)
  // 弧线拱高随距离变化：越远拱得越高，斜飞更自然
  const arc = Math.min(72, Math.max(28, Math.hypot(tx, ty) * 0.16))
  // 朝飞行方向轻微倾斜
  const rot = tx >= 0 ? 7 : -7

  const flying = img.cloneNode(true) as HTMLElement
  flying.classList.add('cover-flight')
  flying.style.borderRadius = getComputedStyle(img).borderRadius

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
    willChange: 'transform, opacity',
    boxShadow: 'var(--shadow-2)',
  } as CSSStyleDeclaration)

  document.querySelectorAll('.cover-flight').forEach((n) => n.remove())
  document.body.appendChild(flying)

  const anim = flying.animate(
    [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      {
        transform: `translate(${(tx * 0.55).toFixed(1)}px, ${(ty * 0.55 - arc).toFixed(1)}px) scale(${(1 - (1 - s) * 0.55).toFixed(3)}) rotate(${rot}deg)`,
        opacity: 1,
        offset: 0.5,
      },
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(0deg)`,
        opacity: 1,
        offset: 0.84,
      },
      { transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(0deg)`, opacity: 0 },
    ],
    { duration: FLIGHT_MS, easing: EASE },
  )
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
