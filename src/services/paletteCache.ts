import { useLibraryStore } from '@/stores/library'
import { sampleCoverColors } from './palette'

/**
 * 封面取色预取 + 缓存：让页面过渡在「开场瞬间」就能拿到封面颜色，
 * 也让播放条的进度光粒子能拿到封面的明亮饱和色。
 *
 * 由来：详情页的环境光晕原本是挂载后才异步取色，颜色必然迟到半拍。
 * 所以在列表页提前把可视区封面的主色算好，点击时直接取用。
 *
 * 策略：
 * - 一次采样同时产出 base 主色与 bright 明亮色（palette.sampleCoverColors），
 *   不做完整渐变合成；
 * - LRU 64 项、并发 3、队列 FIFO，hover 可插队；
 * - 取色失败只留空（下次再试），调用方一律走 fallback，绝不阻断过渡；
 * - brightColors() 一定 resolve（失败/超时/无彩色都给空数组），绝不挂住调用方。
 */

const CACHE_LIMIT = 64
const CONCURRENCY = 3
/** 等待取色的上限：超过就按「无彩色」返回，避免取色队列卡住调用方 */
const WAIT_TIMEOUT = 4000

interface Entry {
  base: string
  /** 封面原始明亮饱和色（最多 3 个；空数组 = 灰阶/单色封面） */
  bright: string[]
}

const cache = new Map<string, Entry>()
const queue: string[] = []
/** 正在等待同一个封面取色结果的调用方 */
const waiters = new Map<string, ((bright: string[]) => void)[]>()
let inflight = 0

function evict() {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** 结算某个封面的等待者（取色成功、失败、超时都走这里） */
function settle(coverId: string, bright: string[]) {
  const list = waiters.get(coverId)
  if (!list) return
  waiters.delete(coverId)
  for (const resolve of list) resolve(bright)
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
        if (!url) {
          settle(coverId, [])
          return
        }
        const blob = await (await fetch(url)).blob()
        const { base, bright } = await sampleCoverColors(blob)
        cache.set(coverId, { base, bright })
        settle(coverId, bright)
        evict()
      } catch {
        /* 取色失败：留空，下次再取 */
        settle(coverId, [])
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

  /** 已缓存则返回封面原始明亮色（未缓存 null；空数组 = 该封面无彩色）。 */
  brightOf(coverId: string | null | undefined): string[] | null {
    return coverId ? cache.get(coverId)?.bright ?? null : null
  },

  /** 取封面明亮色：未缓存自动入队，等就绪后 resolve（同一封面并发调用共享一次取色）。 */
  brightColors(coverId: string | null | undefined): Promise<string[]> {
    if (!coverId) return Promise.resolve([])
    const hit = cache.get(coverId)
    if (hit) return Promise.resolve(hit.bright)
    const pending = waiters.get(coverId)
    if (pending) return new Promise((resolve) => pending.push(resolve))
    const list: ((bright: string[]) => void)[] = []
    waiters.set(coverId, list)
    const p = new Promise<string[]>((resolve) => {
      list.push(resolve)
      setTimeout(() => settle(coverId, []), WAIT_TIMEOUT)
    })
    enqueue(coverId)
    pump()
    return p
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
