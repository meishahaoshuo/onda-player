<script setup lang="ts">
/**
 * 液态玻璃面板（令牌：docs/03-设计规范.md / main.css）
 * 半透明底 + backdrop-filter 模糊 + 细描边 + 顶部内高光；内部禁止再铺不透明底色。
 */
withDefaults(defineProps<{ radius?: string }>(), { radius: '16px' })
</script>

<template>
  <div class="frosted glass" :style="{ borderRadius: radius }">
    <slot />
  </div>
</template>

<style scoped>
.frosted {
  /* .glass 提供玻璃材质，这里只管尺寸 */
}
</style>
