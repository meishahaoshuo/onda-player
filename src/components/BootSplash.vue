<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 与 public/logo/onda-logo-app.svg 同源的波形容器：一条 S 形波浪，上下两条各偏移 168 */
const WAVE_D = 'M210 512 Q 386 384 512 512 T 814 512'

/**
 * 三层声波：三条等粗波浪（线宽、间距、振幅与品牌源文件完全一致）。
 * delay 是各自的起笔时间——主体（中波）先落笔，上下两条依次跟上，
 * 像一道声波扩散开、再分层成形。
 */
const LAYERS = [
  { dy: -168, w: 88, delay: 110 },
  { dy: 168, w: 88, delay: 220 },
  { dy: 0, w: 88, delay: 0 },
]

const BRAND_NAME = 'Onda Player'

/**
 * 整段过场的时间轴（毫秒，相对组件挂载）。
 * 集中在这里是为了让「生长 → 抖动 → 名字浮现 → 一起归位」四拍之间的衔接可控——
 * 各段之间刻意留了少量重叠，避免出现「一拍结束、另一拍才起步」的顿感。
 */
const T = {
  growDur: 620, // 单条波浪从笔尖扫过右端的时长
  shakeAt: 860, // 三层成形后整体抖动（下波 840 才收笔，隔 20ms 接上）
  shakeDur: 400,
  nameAt: 1180, // 名字浮现：贴着抖动收尾起步，既不打架也不留空档
  nameDur: 340,
  bgOutAt: 1200, // 遮罩先于飞行淡出，让下方真实界面接管视线
  bgOutDur: 300,
  flyAt: 1480, // logo + 名字一起飞向左上角（此时遮罩已退场，画面是清晰不糊的）
  flyDur: 480,
  handoffAt: 1910, // 与侧边栏真实品牌交叉淡化
  doneAt: 2170,
}

/** 尊重系统「减少动态效果」：直接跳过整段过场，不做无谓的等待 */
const prefersReduced =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const visible = ref(!prefersReduced)

/**
 * `is-booting` 必须在 **setup 阶段**就挂上（同步执行），不能留到 onMounted：
 * 主应用是「先 mount 过场、再 mount 主应用」，而 onMounted 是微任务——主应用
 * （含侧边栏品牌）会抢在它之前挂载并渲染，品牌就会先露一帧再被隐藏（闪一下）。
 * 挂上后由 main.css 的 `html.is-booting .sidebar .brand` 从元素出生起就压成 opacity:0，
 * 过场结束移除本类时再由品牌自身的 200ms 过渡淡入，与过场 logo 淡出交叉完成交接。
 */
if (visible.value) {
  document.documentElement.classList.add('is-booting')
} else {
  // 无过场（系统开了「减少动态效果」）：立刻放行主应用挂载
  window.dispatchEvent(new CustomEvent('onda:splash-grown'))
}

const splashEl = ref<HTMLElement | null>(null)
const backdropEl = ref<HTMLElement | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)
const nameEl = ref<HTMLElement | null>(null)

const timers: number[] = []
const anims: Animation[] = []

const later = (ms: number) =>
  new Promise<void>((resolve) => {
    timers.push(window.setTimeout(resolve, ms))
  })

/** 安全取消：动画可能已自然结束 */
function kill(a: Animation) {
  try {
    a.cancel()
  } catch {
    /* 已结束，忽略 */
  }
}

/**
 * 把元素从当前位置「飞」到目标元素的位置与尺寸（FLIP）。
 * 用等比 scale 而非逐帧改 width/font-size，是为了只碰合成层、不触发布局。
 * 目标不可用（宽高为 0，例如侧边栏被折叠）时返回 null，由调用方降级。
 */
function flyTo(el: Element, target: Element | null, delay: number) {
  if (!target) return null
  const from = el.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  if (!from.width || !to.width) return null

  const scale = to.width / from.width
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)

  return el.animate(
    [
      // 起步不要太钝：归位是「啪」地一下飞走，不是慢悠悠挪过去
      { transform: 'none', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(4)})` },
    ],
    { duration: T.flyDur, delay, fill: 'forwards' },
  )
}

onMounted(async () => {
  if (!visible.value) return
  const svg = svgEl.value
  const splash = splashEl.value
  const nameNode = nameEl.value
  const backdrop = backdropEl.value
  if (!svg || !splash || !nameNode || !backdrop) return

  try {

    // —— 1. 三条波浪依次生长成形 ——
    // pathLength="1" 把整条路径归一化，stroke-dashoffset 由 1 走到 0 就是「笔尖从左端扫到右端」。
    // 只动 stroke-dashoffset，不碰 transform 与布局，比切碎片飞入轻量得多；
    // 而且每一层始终是完整的一条波浪，生长过程中形态始终可读。
    const waves = Array.from(svg.querySelectorAll<SVGPathElement>('.wave'))
    if (waves.length !== LAYERS.length) return

    waves.forEach((el, i) => {
      const a = el.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: T.growDur,
        delay: LAYERS[i].delay,
        easing: 'cubic-bezier(0.45, 0, 0.25, 1)',
        fill: 'both',
      })
      // fill:'both' 只为盖住 delay 期间的首帧；成形后交还 CSS 静态态并取消动画（项目铁律）
      a.onfinish = () => {
        el.style.strokeDashoffset = '0'
        kill(a)
      }
      anims.push(a)
    })

    // 三条波浪全部成形（最后一条 delay 220 + 生长 620 = 840ms）后，才放行主应用挂载。
    // 提前挂载的话，那个约 100ms 的挂载长任务会正好落在波浪生长期间，把这段
    // 最受注视的动画卡断；挪到生长收笔之后，生长全程无阻塞，剩下一拍是拼合抖动，
    // 抖动期间掉帧的观感损耗远小于平滑生长期间。
    await later(T.growDur + 220)
    window.dispatchEvent(new CustomEvent('onda:splash-grown'))

    // —— 2. 拼合完成后整体抖动几下 ——
    anims.push(
      svg.animate(
        [
          { transform: 'scale(1) rotate(0deg)' },
          { transform: 'scale(1.06) rotate(-1.6deg)', offset: 0.18 },
          { transform: 'scale(0.972) rotate(1.2deg)', offset: 0.42 },
          { transform: 'scale(1.026) rotate(-0.75deg)', offset: 0.64 },
          { transform: 'scale(0.992) rotate(0.38deg)', offset: 0.82 },
          { transform: 'scale(1) rotate(0deg)' },
        ],
        { duration: T.shakeDur, delay: T.shakeAt, easing: 'ease-in-out', fill: 'none' },
      ),
    )

    // —— 3. 名字逐渐浮现：淡入 + 轻微上浮 + 字距收拢，「聚字成形」的手感 ——
    anims.push(
      nameNode.animate(
        [
          {
            opacity: 0,
            transform: 'translateY(12px)',
            letterSpacing: '11px',
            offset: 0,
            easing: 'cubic-bezier(0.25, 0.8, 0.3, 1)',
          },
          { opacity: 1, transform: 'translateY(0px)', letterSpacing: '0.5px', offset: 1 },
        ],
        { duration: T.nameDur, delay: T.nameAt, fill: 'both' },
      ),
    )

    await later(T.bgOutAt)
    // —— 4. 遮罩（独立背景层）先淡出，露出真实界面 ——
    // 只淡背景层，绝不淡容器：logo 与名字是容器的子元素，
    // 一旦容器整体透明，它们会被一起带走，飞行过程就完全看不见了
    anims.push(
      backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: T.bgOutDur,
        easing: 'ease-out',
        fill: 'forwards',
      }),
    )
    // 遮罩淡出途中就不该再拦截指针事件
    splash.style.pointerEvents = 'none'

    await later(T.flyAt - T.bgOutAt)

    // —— 5. logo 与名字一起飞向左上角原有位置 ——
    // 名字的 letterSpacing 动画此刻已结束，所以量到的宽度就是最终值，FLIP 才准
    const targetLogo = document.querySelector('.sidebar .brand-logo')
    const targetName = document.querySelector('.sidebar .brand-name')

    const flyLogo = flyTo(svg, targetLogo, 0)
    const flyName = flyTo(nameNode, targetName, 0)

    if (!flyLogo || !flyName) {
      // 目标不可用（例如侧边栏被折叠）→ 不做归位，直接收尾
      await later(T.doneAt - T.flyAt)
      visible.value = false
      return
    }

    anims.push(flyLogo, flyName)

    await later(T.handoffAt - T.flyAt)

    // —— 6. 交接：侧边栏真实品牌淡入，同时 splash 的 logo 与名字淡出 ——
    // 两者此刻位置完全重合（FLIP 实测偏移 0），所以这一步是无缝的
    document.documentElement.classList.remove('is-booting')
    anims.push(
      svg.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 200,
        easing: 'ease-out',
        fill: 'forwards',
      }),
      nameNode.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 200,
        easing: 'ease-out',
        fill: 'forwards',
      }),
    )

    await later(T.doneAt - T.handoffAt)
    visible.value = false
  } catch {
    // 任何意外都不该把用户挡在白屏上，直接放行
    visible.value = false
  } finally {
    document.documentElement.classList.remove('is-booting')
  }
})

onBeforeUnmount(() => {
  timers.forEach((t) => window.clearTimeout(t))
  anims.forEach(kill)
  document.documentElement.classList.remove('is-booting')
})
</script>

<template>
  <div v-if="visible" ref="splashEl" class="boot-splash" aria-hidden="true">
    <div ref="backdropEl" class="boot-backdrop" />
    <svg ref="svgEl" class="boot-logo" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="boot-wave-grad" gradientUnits="userSpaceOnUse" x1="0" y1="330" x2="0" y2="694">
          <stop offset="0" style="stop-color: var(--boot-wave-1)" />
          <stop offset="0.5" style="stop-color: var(--boot-wave-2)" />
          <stop offset="1" style="stop-color: var(--boot-wave-3)" />
        </linearGradient>
      </defs>
      <path
        v-for="(layer, li) in LAYERS"
        :key="`w${li}`"
        class="wave"
        :d="WAVE_D"
        :stroke-width="layer.w"
        :transform="`translate(0 ${layer.dy})`"
        pathLength="1"
        stroke-dasharray="1"
      />
    </svg>
    <div ref="nameEl" class="boot-name">{{ BRAND_NAME }}</div>
  </div>
</template>

<style scoped>
.boot-splash {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  overflow: hidden;
  /* 容器本身不画背景：遮罩交给 .boot-backdrop 独立一层，
     这样淡出背景时不会连带把 logo 与名字一起淡掉 */
  /* 品牌渐变（浅色主题）：与 onda-logo-app.svg 完全一致 */
  --boot-wave-1: #3e5a98;
  --boot-wave-2: #22356a;
  --boot-wave-3: #172554;
}

.boot-backdrop {
  position: absolute;
  inset: 0;
  background: var(--bg-base);
  will-change: opacity;
}

/* 深色主题：深蓝在近黑底上会糊成一团，整体提亮一档 */
:global([data-theme='dark']) .boot-splash {
  --boot-wave-1: #8298db;
  --boot-wave-2: #4a64a6;
  --boot-wave-3: #2e4280;
}

/* 与侧边栏 .brand-logo 同为 1024 方形 viewBox，归位 FLIP 才能等比缩放不变形。
   波形只占 viewBox 的 59%，所以元素本身要开得更大。
   position:relative 是必须的——遮罩层是 absolute，否则它会盖在 logo 上 */
.boot-logo {
  position: relative;
  width: min(46vmin, 420px);
  height: auto;
  overflow: visible;
  will-change: transform;
}

.boot-name {
  position: relative;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1.15;
  color: var(--text-primary);
  opacity: 0;
  will-change: transform, opacity;
}

/* 整条波浪：pathLength="1" 归一化后，stroke-dashoffset 由 1 走到 0 就是「从左端生长」。
   初始值 1 = 完全隐藏，避免首帧闪出完整波形。
   只动这一个属性，不碰 transform 与布局，三层同时跑也很轻 */
.wave {
  fill: none;
  stroke: url(#boot-wave-grad);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dashoffset: 1;
  will-change: stroke-dashoffset;
}
</style>
