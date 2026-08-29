<script setup lang="ts">
/**
 * 磨砂半透明面板（规范：docs/03-设计规范.md §2）
 * 半透明底色 + backdrop-filter 模糊 + 细描边；内部禁止再铺不透明底色。
 */
withDefaults(defineProps<{ radius?: string }>(), { radius: '12px' })
</script>

<template>
  <div class="frosted" :style="{ borderRadius: radius }">
    <slot />
  </div>
</template>

<style scoped>
.frosted {
  background: var(--bg-panel);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-panel);
}
</style>
