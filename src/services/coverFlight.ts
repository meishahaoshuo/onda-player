import { watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'

/**
 * 歌曲封面 → 底部播放栏的换带动效（简化版）：
 * - 点歌行：行内封面化作卡带（外壳框），沿弧线飞向播放栏落位，带 squash 重量感；
 * - 任何方式切歌（下一曲/上一曲/队列等）：新封面从上方落入播放栏封面位；
 * - 落位时播放栏轻微下沉回弹，封面 pop 接住。
 * 与页面切换编排器（pageTransition）互斥：编排期间只做落点弹跳。
 */

const FLIGHT_MS = 900
/** 飞行落位时刻（占比）：下沉与弹跳与此对齐 */
const LAND_AT = 0.66
const EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)'

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function playerCoverEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.player-bar .cover')
}

/** 行点击飞行进行中（含收尾缓冲）：期间曲目变化 watcher 不重复演出 */
let flightUntil = 0

/** 播放栏封面弹跳：接住封面——放大、歪头、回正 */
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

/** 播放栏整体下沉回弹：落位的重量感 */
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

/** 卡带外壳框：套在封面四周的深色边框，让方形封面读作"卡带" */
function makeShell(): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'absolute',
    inset: '-10% -13%',
    borderRadius: '12px',
    background: 'var(--bg-panel)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'var(--shadow-1)',
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  return el
}

/** 定位在播放栏封面位的新封面卡带（封面 + 外壳框） */
function makeCassette(to: DOMRect, src: string | null, z: number): HTMLElement {
  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, {
    position: 'fixed',
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    borderRadius: '8px',
    zIndex: String(z),
    pointerEvents: 'none',
    willChange: 'transform, opacity',
  } as CSSStyleDeclaration)
  if (src) {
    const img = document.createElement('img')
    img.src = src
    Object.assign(img.style, {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
      borderRadius: '7px',
      boxShadow: 'var(--shadow-1)',
    } as CSSStyleDeclaration)
    wrapper.appendChild(img)
  } else {
    const body = document.createElement('div')
    Object.assign(body.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: '7px',
      background: 'var(--bg-hover)',
      border: '1px solid var(--glass-border)',
    } as CSSStyleDeclaration)
    wrapper.appendChild(body)
  }
  const shell = makeShell()
  shell.style.zIndex = '-1'
  wrapper.appendChild(shell)
  return wrapper
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

  // 无可飞封面 / 减动效 / 页面过渡编排中：只做落点弹跳（换带交给 watcher）
  if (!fromEl || !img || !img.currentSrc || !target || reduced() || useUiStore().dolly !== 'idle') {
    popPlayerCover()
    return
  }

  flightUntil = Date.now() + FLIGHT_MS + 150

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
  // 弧线拱高随距离变化；滑入段从拱顶顺下来近似切向入仓
  const arc = Math.min(96, Math.max(40, Math.hypot(tx, ty) * 0.2))
  // 姿态朝向飞行方向，优雅小角度
  const dir = tx >= 0 ? 1 : -1

  const startRadius = getComputedStyle(img).borderRadius

  /* ---------- 飞行载体：外壳框 + 封面 ---------- */
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
    boxShadow: 'var(--shadow-2)',
  } as CSSStyleDeclaration)
  const cloneImg = document.createElement('img')
  cloneImg.src = img.currentSrc
  Object.assign(cloneImg.style, {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    borderRadius: startRadius,
  } as CSSStyleDeclaration)
  const shell = makeShell()
  shell.style.zIndex = '-1'
  flying.append(shell, cloneImg)

  document.querySelectorAll('.cover-flight, .player-door').forEach((n) => n.remove())
  document.body.appendChild(flying)

  /* ---------- 主编排（offset 驱动四阶段） ---------- */
  const anim = flying.animate(
    [
      // 拿起：原位
      {
        transform: 'translate(0px, 0px) scale(1) rotate(0deg)',
        offset: 0,
        easing: 'ease-out',
      },
      // 浮起完成
      {
        transform: `translate(${(tx * 0.05).toFixed(1)}px, ${(ty * 0.05 - 14).toFixed(1)}px) scale(1.1) rotate(${(4 * dir).toFixed(1)}deg)`,
        offset: 0.16,
        easing: 'ease-in-out',
      },
      // 变形完成、滑行过拱顶（姿态朝向目标）
      {
        transform: `translate(${(tx * 0.55).toFixed(1)}px, ${(ty * 0.45 - arc).toFixed(1)}px) scale(1.16) rotate(${(7 * dir).toFixed(1)}deg)`,
        offset: 0.42,
        easing: 'cubic-bezier(0.3, 0, 0.35, 1)',
      },
      // 顺着弧线滑入到位
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${(s * 1.06).toFixed(3)}) rotate(0deg)`,
        offset: LAND_AT,
        easing: 'ease-out',
      },
      // 嵌入仓位
      { transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(0deg)`, offset: 0.8 },
      // 交给真实封面
      {
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(0deg)`,
        opacity: 0,
        offset: 1,
      },
    ],
    { duration: FLIGHT_MS, fill: 'both' },
  )

  /* ---------- 卡带部件的节奏 ---------- */
  // 外壳框在滑行段浮现，落位后随整体淡出
  shell.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.24 },
      { opacity: 1, offset: 0.78 },
      { opacity: 0, offset: 0.97 },
    ],
    { duration: FLIGHT_MS, fill: 'both', easing: 'ease-out' },
  )
  // 封面标签圆角收平（卡带标签是直角贴纸的感觉）
  cloneImg.animate(
    [
      { borderRadius: startRadius, offset: 0 },
      { borderRadius: '7px', offset: 0.26 },
      { borderRadius: '7px', offset: 1 },
    ],
    { duration: FLIGHT_MS, fill: 'both', easing: 'ease-out' },
  )

  /* ---------- 落位时刻的对齐表演 ---------- */
  const landDelay = Math.round(FLIGHT_MS * LAND_AT) - 30
  dipPlayerBar(landDelay)
  window.setTimeout(() => popPlayerCover(), Math.round(FLIGHT_MS * 0.86))

  const cleanup = () => flying.remove()
  anim.finished.then(cleanup, cleanup)
  window.setTimeout(cleanup, FLIGHT_MS + 400)
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

/* ================= 机上换带：任何方式切歌都有落位动画 =================
   下一曲/上一曲/队列点歌/右键播放等不经过行点击的切歌，封面原本是瞬间
   被覆盖的。这里监听曲目变化：新封面从上方落入播放栏封面位。
   行点击触发的飞行已包含同样叙事，用 flightUntil 错开避免双重演出。 */

const SWAP_MS = 620

/** 在 App 挂载后调用一次：监听播放曲目变化，驱动「机上换带」 */
export function installTrackSwapWatcher(): void {
  const player = usePlayerStore()
  const library = useLibraryStore()
  watch(
    () => player.currentPath,
    (path, oldPath) => {
      if (!path || !oldPath || path === oldPath) return // 首次播放 / 同曲重播不演出
      if (reduced()) {
        popPlayerCover()
        return
      }
      if (useUiStore().dolly !== 'idle' || Date.now() < flightUntil) return
      void runSwap(player.current, library)
    },
  )
}

async function runSwap(song: { coverId: string | null } | null, library: ReturnType<typeof useLibraryStore>): Promise<void> {
  const target = playerCoverEl()
  if (!target) return
  const to = target.getBoundingClientRect()
  if (to.width < 4 || to.height < 4) return

  // 新带封面 URL：缓存通常即时命中；给一点等待上限避免拖节奏
  let newSrc: string | null = null
  if (song?.coverId) {
    newSrc = await Promise.race([
      library.coverUrl(song.coverId).catch(() => null),
      new Promise<null>((r) => window.setTimeout(() => r(null), 260)),
    ])
  }

  // 新封面从上方落入封面位（0 → 0.7 落定）
  const newC = makeCassette(to, newSrc, 70)
  document.querySelectorAll('.cover-flight, .player-door').forEach((n) => n.remove())
  document.body.appendChild(newC)
  newC.animate(
    [
      { transform: 'translateY(-38px) scale(1.05)', opacity: 0, offset: 0, easing: EASE_OUT },
      { transform: 'translateY(-6px) scale(1.02)', opacity: 1, offset: 0.6, easing: EASE_OUT },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.72 },
    ],
    { duration: SWAP_MS, fill: 'both' },
  )

  dipPlayerBar(Math.round(SWAP_MS * 0.55))
  window.setTimeout(() => popPlayerCover(), Math.round(SWAP_MS * 0.7))
  window.setTimeout(() => newC.remove(), SWAP_MS + 150)
}
