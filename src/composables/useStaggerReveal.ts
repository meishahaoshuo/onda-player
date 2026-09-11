/**
 * 条目错峰浮现：IntersectionObserver 监听条目进入视口，进入时用 WAAPI
 * 播放一段「上浮 + 淡入」，同一批次按序错峰（delay = 批内序号 × step）。
 *
 * 用 WAAPI 而不是 CSS class + transition 的原因：专辑/艺术家网格的卡片
 * 会被磁吸力场写入行内 transform，行内样式会压过 class 里的 transform，
 * 两者打架；WAAPI 动画在层叠中优先级最高，动画结束后不留残留。
 */

const DURATION = 340
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

/**
 * 「列表首屏错峰浮现」的会话级闸门。
 *
 * 必须是**模块作用域**：写进组件的 `<script setup>` 会被编译进 `setup()`，
 * 变成每个组件实例各一份，于是每次挂载都会重播——SongList 随左侧板块切换
 * 反复挂载，就会出现「前 14 行重新浮现、其余行瞬间出现」的半刷新观感。
 * 用模块变量保证整个会话只播一次，切板块一律直接显示。
 */
let listRevealPlayed = false

/** 领取一次首屏浮现机会：本次会话第一次调用返回 true，之后恒为 false。 */
export function claimListReveal(): boolean {
  if (listRevealPlayed) return false
  listRevealPlayed = true
  return true
}

export interface StaggerRevealOptions {
  /** 批内相邻条目的延迟步长 */
  step?: number
  /** 单个条目延迟上限 */
  maxDelay?: number
}

export function useStaggerReveal(
  getRoot: () => HTMLElement | null,
  itemSelector: string,
  opts: StaggerRevealOptions = {},
) {
  const step = opts.step ?? 40
  const maxDelay = opts.maxDelay ?? 280

  let observer: IntersectionObserver | null = null
  const revealed = new WeakSet<Element>()

  function reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function revealBatch(items: Element[]) {
    items.forEach((el, i) => {
      revealed.add(el)
      observer?.unobserve(el)
      const delay = Math.min(i * step, maxDelay)
      const anim = el.animate(
        [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: DURATION, delay, easing: EASE, fill: 'both' },
      )
      // 动画结束后清场：不留 fill 残留，也不留 refresh 时埋下的行内 opacity
      anim.finished.then(
        () => {
          ;(el as HTMLElement).style.opacity = ''
          anim.cancel()
        },
        () => {},
      )
    })
  }

  /** （重新）登记当前所有未浮现的条目。数据变化后调用。 */
  function refresh() {
    const root = getRoot()
    if (!root || reduced()) return
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          const fresh = entries.filter((e) => e.isIntersecting && !revealed.has(e.target)).map((e) => e.target)
          if (fresh.length > 0) revealBatch(fresh)
        },
        { rootMargin: '0px 0px -6% 0px', threshold: 0.05 },
      )
    }
    for (const el of root.querySelectorAll(itemSelector)) {
      if (revealed.has(el)) continue
      // 观察回调在下一帧才来，先同步藏住，避免「先闪现再隐藏再浮现」
      ;(el as HTMLElement).style.opacity = '0'
      observer.observe(el)
    }
  }

  function disconnect() {
    observer?.disconnect()
    observer = null
  }

  return { refresh, disconnect }
}
