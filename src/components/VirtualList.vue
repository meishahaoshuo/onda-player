<script setup lang="ts" generic="T">
import { computed, onMounted, ref } from 'vue'

/**
 * 通用虚拟滚动列表：只渲染可视区 ± overscan 行，支撑万级条目。
 * 行高固定 itemHeight，行内容通过默认作用域插槽传入。
 */
const props = withDefaults(
  defineProps<{ items: T[]; itemHeight: number; overscan?: number }>(),
  { overscan: 6 },
)

const container = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(600)

function onScroll() {
  if (container.value) scrollTop.value = container.value.scrollTop
}

onMounted(() => {
  if (!container.value) return
  viewportH.value = container.value.clientHeight
  new ResizeObserver(() => {
    if (container.value) viewportH.value = container.value.clientHeight
  }).observe(container.value)
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
  <div ref="container" class="vlist" @scroll.passive="onScroll">
    <div class="vlist-spacer" :style="{ height: `${items.length * itemHeight}px` }">
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
