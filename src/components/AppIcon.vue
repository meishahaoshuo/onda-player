<script setup lang="ts">
import { computed } from 'vue'
import { iconPaths, type IconName } from './icons'

/** 内联 SVG 图标组件 */
const props = withDefaults(
  defineProps<{ name: IconName; size?: number }>(),
  { size: 18 },
)

const inner = computed(() => iconPaths[props.name])
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="inner"
  />
</template>
