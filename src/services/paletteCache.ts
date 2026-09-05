import { useLibraryStore } from '@/stores/library'
import { coverBaseColor } from './palette'

/**
 * 封面主色预取 + 缓存：让页面过渡在「开场瞬间」就能拿到封面颜色。
 *
 * 由来：详情页的环境光晕原本是挂载后才异步取色，颜色必然迟到半拍。
 * 所以在列表页提前把可视区封面的主色算好，点击时直接取用。
 *
 * 策略：
 * - 只取 base 主色（复用 palette.coverBaseColor），不做完整渐变合成；
 * - LRU 64 项、并发 3、队列 FIFO，hover 可插队；
 * - 取色失败只留空（下次再试），调用方一律走 fallback，绝不阻断过渡。
 */

const CACHE_LIMIT = 64
const CONCURRENCY = 3

interface Entry {
  base: string
}

const cache = new Map<string, Entry>()
const queue: string[] = []
let inflight = 0

function evict() {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

async function pump() {
  if (!queue.length) return
  const library = useLibraryStore()
  while (inflight < CONCURRENCY && queue.length) {
    const coverId = queue.shift()
    if (!coverId || cache.has(coverId)) continue
    inflight++
    void (async () => {
      try {
        const url = await library.coverUrl(coverId)
        if (!url) return
        const blob = await (await fetch(url)).blob()
        cache.set(coverId, { base: await coverBaseColor(blob) })
        evict()
      } catch {
        /* 取色失败：留空，下次再取 */
      } finally {
        inflight--
        pump()
      }
    })()
  }
}

/** 主题兜底色：取色未命中时用（读 --ambient-fallback，缺失再退到 --accent-soft）。 */
function fallbackColor(): string {
  const s = getComputedStyle(document.documentElement)
  return s.getPropertyValue('--ambient-fallback').trim() || s.getPropertyValue('--accent-soft').trim() || 'transparent'
}

function enqueue(coverId: string, front = false) {
  if (cache.has(coverId) || queue.includes(coverId)) return
  if (front) queue.unshift(coverId)
  else queue.push(coverId)
}

export const paletteCache = {
  /** 已缓存则返回主色，否则 null（调用方自行降级）。 */
  get(coverId: string | null | undefined): string | null {
    return coverId ? cache.get(coverId)?.base ?? null : null
  },

  /** 一定返回可用颜色：命中缓存取主色，否则兜底主题色。 */
  colorOf(coverId: string | null | undefined): string {
    return paletteCache.get(coverId) ?? fallbackColor()
  },

  /** 把一批卡片（须带 data-cover-id）纳入预取队列；limit 控制单批上限。 */
  prime(els: Iterable<HTMLElement>, limit = 24, front = false) {
    let n = 0
    for (const el of els) {
      if (n >= limit) break
      const id = el.dataset.coverId
      if (!id) continue
      enqueue(id, front)
      n++
    }
    pump()
  },

  /** 立即为单个封面插队取色（hover 时用，优先级最高）。 */
  primeNow(coverId: string | null | undefined) {
    if (!coverId) return
    enqueue(coverId, true)
    pump()
  },
}
