<script setup lang="ts" generic="T">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'

/**
 * 通用虚拟滚动列表（外层滚动架构）：只渲染可视区 ± overscan 行，支撑万级条目。
 * 组件自身不滚动——自然高度撑开 spacer，滚动发生在最近的 `.scroll-host` 标记祖先上
 * （App.vue 的 .view-body / 详情覆盖层 / 文件夹页 .main 等，closest 就近命中）。
 * 可视区按「列表顶边相对宿主视口顶边的偏移」实时测量，不依赖自身 scrollTop。
 * persistKey：传入后宿主滚动位置会记入 ui store 并在挂载/数据就绪时恢复。
 */
const props = withDefaults(
  defineProps<{ items: T[]; itemHeight: number; overscan?: number; persistKey?: string }>(),
  { overscan: 6 },
)

const ui = useUiStore()
const container = ref<HTMLElement | null>(null)
const host = ref<HTMLElement | null>(null)
/** 列表相对宿主已滚过的距离（列表尚未进入视口时为负，按 0 处理） */
const scrollTop = ref(0)
const viewportH = ref(600)

let resizeObs: ResizeObserver | null = null

/** 实时测量：宿主与列表两次 getBoundingClientRect 的差值即列表已滚出宿主顶部的距离 */
function measure() {
  const h = host.value
  const el = container.value
  if (!h || !el) return
  scrollTop.value = Math.max(0, h.getBoundingClientRect().top - el.getBoundingClientRect().top)
  viewportH.value = h.clientHeight
}

function onHostScroll() {
  measure()
  if (props.persistKey && host.value) ui.rememberScroll(props.persistKey, host.value.scrollTop)
}

function restoreScroll() {
  if (!props.persistKey || !host.value) return
  const top = ui.recallScroll(props.persistKey)
  if (top > 0) host.value.scrollTop = top
}

onMounted(() => {
  const h = container.value?.closest<HTMLElement>('.scroll-host') ?? null
  host.value = h
  if (h) {
    h.addEventListener('scroll', onHostScroll, { passive: true })
    resizeObs = new ResizeObserver(() => measure())
    resizeObs.observe(h)
    if (container.value) resizeObs.observe(container.value)
    viewportH.value = h.clientHeight
  }
  measure()
  restoreScroll()
})

// 数据晚于挂载到达（曲库异步加载）时补一次测量与恢复，否则 spacer 还没高度、scrollTop 会被钳到 0
watch(
  () => props.items.length,
  (n, o) => {
    if (n > 0 && o === 0) nextTick(() => { measure(); restoreScroll() })
  },
)

onBeforeUnmount(() => {
  host.value?.removeEventListener('scroll', onHostScroll)
  resizeObs?.disconnect()
  resizeObs = null
  host.value = null
})

const start = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / props.itemHeight) - props.overscan),
)
const end = computed(() =>
  Math.min(props.items.length, Math.ceil((scrollTop.value + viewportH.value) / props.itemHeight) + props.overscan),
)
const visible = computed(() =>
  props.items.slice(start.value, end.value).map((item, i) => ({ item, index: start.value + i })),
)
</script>

<template>
  <div ref="container" class="vlist">
    <!-- spacer 撑出全部行高（滚动交给外层 .scroll-host 宿主）；
         window 绝对定位平移到可视区起点，只挂载可视 ± overscan 行 -->
    <div class="vlist-spacer" :style="{ height: `${items.length * itemHeight}px` }">
      <div class="vlist-window" :style="{ transform: `translateY(${start * itemHeight}px)` }">
        <slot v-for="v in visible" :key="v.index" :item="v.item" :index="v.index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.vlist {
  position: relative;
}

.vlist-spacer {
  position: relative;
}

.vlist-window {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
</style>
