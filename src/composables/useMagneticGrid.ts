import { onBeforeUnmount, onMounted, type Ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'

const MAGNET_RADIUS = 240
const MAGNET_STRENGTH = 0.05

/**
 * 封面网格磁吸引力场（专辑页 / 艺术家页共用）：
 * 光标靠近（MAGNET_RADIUS 内）卡片被轻微吸向光标，离开即弹回。
 * 与页面过渡（引力坍缩）同一叙事：平时就有引力场，点击才坍缩。
 *
 * 性能护栏：矩形缓存 + rAF 节流，只写半径内卡片的 transform；
 * reduced-motion 与页面过渡期间（dolly ≠ idle）自动停用。
 */
export function useMagneticGrid(gridEl: Ref<HTMLElement | null>, cardSelector: string) {
  const ui = useUiStore()
  const rects = new Map<HTMLElement, { cx: number; cy: number }>()
  const active = new Set<HTMLElement>()
  let raf = 0
  let evt: MouseEvent | null = null
  let scrollEl: HTMLElement | null = null
  let scrollTimer = 0

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  /** 重算矩形缓存：挂载 / 滚动停止 / 窗口缩放 / 过渡归位后调用 */
  function refreshRects() {
    rects.clear()
    for (const card of gridEl.value?.querySelectorAll<HTMLElement>(cardSelector) ?? []) {
      const r = card.getBoundingClientRect()
      rects.set(card, { cx: r.left + r.width / 2, cy: r.top + r.height / 2 })
    }
  }

  function frame() {
    raf = 0
    const e = evt
    if (!e) return
    const next = new Set<HTMLElement>()
    rects.forEach((p, card) => {
      const dx = e.clientX - p.cx
      const dy = e.clientY - p.cy
      const d = Math.hypot(dx, dy)
      if (d >= MAGNET_RADIUS) return
      const pull = 1 - d / MAGNET_RADIUS
      next.add(card)
      card.style.transform = `translate(${(dx * pull * MAGNET_STRENGTH).toFixed(1)}px, ${(dy * pull * MAGNET_STRENGTH).toFixed(1)}px)`
    })
    active.forEach((card) => {
      if (!next.has(card)) {
        card.style.transform = ''
        active.delete(card)
      }
    })
    next.forEach((card) => active.add(card))
  }

  function onMouseMove(e: MouseEvent) {
    if (reduced() || ui.dolly !== 'idle') return
    if (rects.size === 0) refreshRects()
    evt = e
    if (!raf) raf = requestAnimationFrame(frame)
  }

  function clearMagnet() {
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    active.forEach((card) => (card.style.transform = ''))
    active.clear()
  }

  function onScroll() {
    window.clearTimeout(scrollTimer)
    scrollTimer = window.setTimeout(refreshRects, 200)
  }

  onMounted(() => {
    scrollEl = (gridEl.value?.closest('.view-body') as HTMLElement | null) ?? null
    scrollEl?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
  })

  onBeforeUnmount(() => {
    scrollEl?.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
    window.clearTimeout(scrollTimer)
    clearMagnet()
  })

  // 过渡归位（dolly 回到 idle）后矩形可能变化，刷新缓存
  watch(
    () => ui.dolly,
    (v) => {
      if (v === 'idle') refreshRects()
    },
  )

  return { onMouseMove, onMouseLeave: clearMagnet, refreshRects, clearMagnet }
}
