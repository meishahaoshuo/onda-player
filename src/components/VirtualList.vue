<script setup lang="ts" generic="T">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'

/**
 * 通用虚拟滚动列表：只渲染可视区 ± overscan 行，支撑万级条目。
 * 行高固定 itemHeight，行内容通过默认作用域插槽传入。
 * persistKey：传入后滚动位置会记入 ui store 并在挂载/数据就绪时恢复。
 */
const props = withDefaults(
  defineProps<{ items: T[]; itemHeight: number; overscan?: number; persistKey?: string; tail?: number }>(),
  { overscan: 6, tail: 0 },
)

const ui = useUiStore()
const container = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(600)

function onScroll() {
  if (!container.value) return
  scrollTop.value = container.value.scrollTop
  if (props.persistKey) ui.rememberScroll(props.persistKey, scrollTop.value)
}

function restoreScroll() {
  if (!props.persistKey || !container.value) return
  const top = ui.recallScroll(props.persistKey)
  if (top > 0) container.value.scrollTop = top
}

onMounted(() => {
  if (!container.value) return
  viewportH.value = container.value.clientHeight
  new ResizeObserver(() => {
    if (container.value) viewportH.value = container.value.clientHeight
  }).observe(container.value)
  restoreScroll()
})

// 数据晚于挂载到达（曲库异步加载）时补一次恢复，否则 spacer 还没高度、scrollTop 会被钳到 0
watch(
  () => props.items.length,
  (n, o) => {
    if (n > 0 && o === 0) nextTick(restoreScroll)
  },
)

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
  <div ref="container" class="vlist" @scroll.passive="onScroll">
    <!-- tail：滚动内容末尾的安全空间（如浮动胶囊高度），让最后一行能滚到悬浮层上方，
         同时不压缩列表自身的可视高度（height:100% 容器若用容器 padding 会把行截短） -->
    <div class="vlist-spacer" :style="{ height: `${items.length * itemHeight + props.tail}px` }">
      <div class="vlist-window" :style="{ transform: `translateY(${start * itemHeight}px)` }">
        <slot v-for="v in visible" :key="v.index" :item="v.item" :index="v.index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.vlist {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
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
