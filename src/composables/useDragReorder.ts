/**
 * 长按拖拽排序（Pointer 版，替代原生 HTML5 DnD）：
 * - 按住 250ms 后进入拖拽；未满长按就移动/松手则当作普通点击；
 * - 拖动项轻微抬升（背景提亮 + 轻缩放，不用投影，避免与整体风格割裂），
 *   其余项按目标位平滑让位（transform 补间，rAF 节流）；
 * - 松手回调 onReorder(from, to)，由外部更新数据源后重渲染；
 * - pointerup / pointercancel / 窗口失焦都会完整复位，不残留拖拽态；
 * - 拖拽结束后的短窗口内抑制 click，防止松手误触。
 * 仅支持纵向列表；列表项高度需一致。
 */

import { ref } from 'vue'

const HOLD_MS = 250
const MOVE_CANCEL_PX = 6
const SUPPRESS_MS = 200

export interface DragReorderOptions {
  onReorder: (from: number, to: number) => void
  /** 长按触发时长（默认 250ms） */
  holdMs?: number
}

export function useDragReorder(opts: DragReorderOptions) {
  const draggingIndex = ref<number | null>(null)

  let pressTimer = 0
  let moveRaf = 0
  let active = false
  let dragging = false
  let fromIndex = -1
  let targetIndex = -1
  let startY = 0
  let lastY = 0
  let itemEl: HTMLElement | null = null
  let itemHeight = 0
  let itemGap = 0
  let scrollEl: HTMLElement | null = null
  let suppressUntil = 0

  function isClickSuppressed(): boolean {
    return performance.now() < suppressUntil
  }

  function siblings(): HTMLElement[] {
    if (!itemEl?.parentElement) return []
    return [...itemEl.parentElement.children].filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c !== itemEl,
    )
  }

  function measure() {
    if (!itemEl) return
    const r = itemEl.getBoundingClientRect()
    itemHeight = r.height
    const sibs = siblings()
    if (sibs.length > 0) {
      itemGap = Math.max(0, sibs[0].getBoundingClientRect().top - r.bottom)
    }
  }

  /** 让其它项平移让位：from→target 之间的项按方向移动一格 */
  function applyDisplacement() {
    const sibs = siblings()
    const step = itemHeight + itemGap
    sibs.forEach((sib, idx) => {
      const orig = idx >= fromIndex ? idx + 1 : idx
      let shift = 0
      if (fromIndex < targetIndex && orig > fromIndex && orig <= targetIndex) shift = -step
      else if (fromIndex > targetIndex && orig >= targetIndex && orig < fromIndex) shift = step
      sib.style.transition = 'transform 160ms var(--ease-out)'
      sib.style.transform = shift ? `translateY(${shift}px)` : ''
    })
    if (itemEl) {
      itemEl.style.transform = `translateY(${lastY - startY}px) scale(1.015)`
    }
  }

  function scheduleApply() {
    if (moveRaf) return
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0
      if (!dragging) return
      targetIndex = findTargetIndex(lastY - startY)
      applyDisplacement()
      autoScroll(lastY)
    })
  }

  function findTargetIndex(dy: number): number {
    const step = itemHeight + itemGap
    const moved = Math.round(dy / step)
    const max = fromIndex + siblings().length
    return Math.min(max, Math.max(0, fromIndex + moved))
  }

  /* ---------- 边缘自动滚动 ---------- */
  function autoScroll(clientY: number) {
    if (!scrollEl) {
      scrollEl =
        (itemEl?.closest<HTMLElement>('.view-body, .nav, .queue-list') as HTMLElement | null) ?? null
    }
    if (!scrollEl) return
    const r = scrollEl.getBoundingClientRect()
    const edge = 56
    const speed = 8
    if (clientY < r.top + edge && scrollEl.scrollTop > 0) scrollEl.scrollTop -= speed
    else if (clientY > r.bottom - edge && scrollEl.scrollTop < scrollEl.scrollHeight) scrollEl.scrollTop += speed
  }

  /* ---------- 完整复位：任何退出路径都走这里，不残留拖拽态 ---------- */
  function reset() {
    window.clearTimeout(pressTimer)
    cancelAnimationFrame(moveRaf)
    moveRaf = 0
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    window.removeEventListener('blur', onUp)
    if (dragging && itemEl) {
      // 复位拖动项与让位项的全部行内样式
      itemEl.style.transform = ''
      itemEl.style.cursor = ''
      itemEl.style.zIndex = ''
      itemEl.style.willChange = ''
      for (const sib of siblings()) {
        sib.style.transition = ''
        sib.style.transform = ''
      }
    }
    if (dragging) suppressUntil = performance.now() + SUPPRESS_MS
    dragging = false
    active = false
    draggingIndex.value = null
    itemEl = null
    scrollEl = null
  }

  function onMove(e: PointerEvent) {
    if (!active) return
    lastY = e.clientY
    if (!dragging) {
      if (Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) reset()
      return
    }
    e.preventDefault()
    scheduleApply()
  }

  function onUp() {
    if (!dragging) {
      reset()
      return
    }
    const to = targetIndex
    // 先记参数再复位
    reset()
    if (to !== fromIndex) opts.onReorder(fromIndex, to)
  }

  /** 绑定到每个可拖项的 pointerdown（模板：@pointerdown="onItemPointerdown(i, $event)"） */
  function onItemPointerdown(index: number, e: PointerEvent) {
    if (e.button !== 0) return
    if (isClickSuppressed()) return
    itemEl = e.currentTarget as HTMLElement
    fromIndex = index
    targetIndex = index
    startY = e.clientY
    lastY = e.clientY
    active = true
    measure()
    window.clearTimeout(pressTimer)
    pressTimer = window.setTimeout(() => {
      if (!active) return
      dragging = true
      draggingIndex.value = index
      if (itemEl) {
        itemEl.style.cursor = 'grabbing'
        itemEl.style.willChange = 'transform'
      }
      measure()
    }, opts.holdMs ?? HOLD_MS)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
  }

  function dispose() {
    reset()
  }

  return { draggingIndex, onItemPointerdown, isClickSuppressed, dispose }
}
