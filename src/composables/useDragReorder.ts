/**
 * 长按拖拽排序（Pointer 版，替代原生 HTML5 DnD）：
 * - 按住 250ms 后进入拖拽；未满长按就移动/松手则当作普通点击；
 * - 拖动项跟手浮动（位移 + 放大 + 投影），其余项按目标位平滑让位（transition 补间）；
 * - 松手回调 onReorder(from, to)，由外部更新数据源后重渲染；
 * - isDragging 期间应抑制 click（模板里用 wasRecentDrag() 判断）。
 * 仅支持纵向列表；列表项高度需一致。
 */

import { ref } from 'vue'

const HOLD_MS = 250
const MOVE_CANCEL_PX = 6

export interface DragReorderOptions {
  onReorder: (from: number, to: number) => void
  /** 长按触发时长（默认 250ms） */
  holdMs?: number
}

export function useDragReorder(opts: DragReorderOptions) {
  const draggingIndex = ref<number | null>(null)

  let pressTimer = 0
  let active = false
  let dragging = false
  let fromIndex = -1
  let targetIndex = -1
  let startY = 0
  let itemEl: HTMLElement | null = null
  let itemHeight = 0
  let itemGap = 0
  /** 拖拽刚结束的标记：click 判定用（事件在 pointerup 后触发） */
  let suppressClickUntil = 0

  function isClickSuppressed(): boolean {
    return performance.now() < suppressClickUntil
  }

  function siblings(): HTMLElement[] {
    if (!itemEl?.parentElement) return []
    return [...itemEl.parentElement.children].filter(
      (c): c is HTMLElement => c !== itemEl && c instanceof HTMLElement,
    )
  }

  function measure() {
    if (!itemEl) return
    const r = itemEl.getBoundingClientRect()
    itemHeight = r.height
    const sibs = siblings()
    if (sibs.length > 0) {
      itemGap = sibs[0].getBoundingClientRect().top - r.bottom
      if (itemGap < 0) itemGap = 0
    }
  }

  /** 让其它项平移让位：from→target 之间的项按方向移动一格 */
  function applyDisplacement(dy: number) {
    const sibs = siblings()
    const step = itemHeight + itemGap
    sibs.forEach((sib, idx) => {
      const orig = idx >= fromIndex ? idx + 1 : idx
      let shift = 0
      if (fromIndex < targetIndex && orig > fromIndex && orig <= targetIndex) shift = -step
      else if (fromIndex > targetIndex && orig >= targetIndex && orig < fromIndex) shift = step
      sib.style.transition = 'transform 180ms var(--ease-out)'
      sib.style.transform = shift ? `translateY(${shift}px)` : ''
    })
    // 拖动项跟手：整体位移 + 拖拽视觉
    if (itemEl) {
      itemEl.style.transition = 'none'
      itemEl.style.transform = `translateY(${dy}px) scale(1.03)`
    }
  }

  function findTargetIndex(dy: number): number {
    const step = itemHeight + itemGap
    const moved = Math.round(dy / step)
    const max = fromIndex + siblings().length
    return Math.min(max, Math.max(0, fromIndex + moved))
  }

  function onMove(e: PointerEvent) {
    if (!active) return
    if (!dragging) {
      if (Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) {
        cleanupPress()
        teardownListeners()
      }
      return
    }
    e.preventDefault()
    const dy = e.clientY - startY
    targetIndex = findTargetIndex(dy)
    applyDisplacement(dy)
    autoScroll(e.clientY)
  }

  function onUp() {
    cleanupPress()
    teardownListeners()
    if (!dragging) return
    const to = targetIndex
    suppressClickUntil = performance.now() + 350
    // 复位视觉（数据更新后 Vue 重渲染接管最终位置）
    if (itemEl) itemEl.style.transform = ''
    for (const sib of siblings()) {
      sib.style.transition = ''
      sib.style.transform = ''
    }
    dragging = false
    draggingIndex.value = null
    if (to !== fromIndex) opts.onReorder(fromIndex, to)
  }

  /* ---------- 边缘自动滚动：拖到滚动容器上下边缘时缓慢滚动 ---------- */
  let scrollEl: HTMLElement | null = null
  let scrollRaf = 0

  function autoScroll(clientY: number) {
    if (!scrollEl) {
      scrollEl =
        (itemEl?.closest<HTMLElement>('.view-body, .sidebar .nav, .queue-list') as HTMLElement | null) ??
        null
    }
    if (!scrollEl) return
    const r = scrollEl.getBoundingClientRect()
    const edge = 56
    cancelAnimationFrame(scrollRaf)
    const step = () => {
      if (!dragging) return
      const speed = 9
      if (clientY < r.top + edge && scrollEl!.scrollTop > 0) scrollEl!.scrollTop -= speed
      else if (clientY > r.bottom - edge) scrollEl!.scrollTop += speed
      else return
      scrollRaf = requestAnimationFrame(step)
    }
    scrollRaf = requestAnimationFrame(step)
  }

  /* ---------- 生命周期 ---------- */

  function cleanupPress() {
    window.clearTimeout(pressTimer)
    pressTimer = 0
  }

  function onMoveWrapped(e: PointerEvent) {
    onMove(e)
  }
  function onUpWrapped() {
    onUp()
  }

  function teardownListeners() {
    window.removeEventListener('pointermove', onMoveWrapped)
    window.removeEventListener('pointerup', onUpWrapped)
    cancelAnimationFrame(scrollRaf)
  }

  /** 绑定到每个可拖项的 pointerdown（模板：@pointerdown="onItemPointerdown(i, $event)"） */
  function onItemPointerdown(index: number, e: PointerEvent) {
    if (e.button !== 0) return
    // 已处于拖拽补偿期：吞掉这次按压，避免误点
    if (isClickSuppressed()) {
      e.preventDefault()
      return
    }
    itemEl = e.currentTarget as HTMLElement
    fromIndex = index
    targetIndex = index
    startY = e.clientY
    active = true
    dragging = false
    measure()
    cleanupPress()
    pressTimer = window.setTimeout(() => {
      if (!active) return
      dragging = true
      draggingIndex.value = index
      itemEl!.style.cursor = 'grabbing'
      itemEl!.style.zIndex = '5'
      measure()
    }, opts.holdMs ?? HOLD_MS)
    window.addEventListener('pointermove', onMoveWrapped, { passive: false })
    window.addEventListener('pointerup', onUpWrapped)
  }

  function dispose() {
    cleanupPress()
    teardownListeners()
    active = false
    dragging = false
    draggingIndex.value = null
  }

  return { draggingIndex, onItemPointerdown, isClickSuppressed, dispose }
}
