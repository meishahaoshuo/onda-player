<script setup lang="ts">
/**
 * 二级弹层面板。材质：`--panel-solid-*` 纯色底 + 细描边 + 顶部内高光。
 *
 * 2026-09-14 用户要求「二级界面不要半透明的磨砂，改纯色」——本组件原来是
 * 液态玻璃（.glass），现统一改为纯色面板（.panel-solid）。内部仍然禁止再铺底色。
 * 组件名/文件名保留为 FrostedPanel（历史名，改动会波及引用与文档）。
 */
withDefaults(defineProps<{ radius?: string }>(), { radius: '16px' })
</script>

<template>
  <div class="frosted panel-solid" :style="{ borderRadius: radius }">
    <slot />
  </div>
</template>

<style scoped>
.frosted {
  /* .panel-solid 提供材质，这里只管尺寸 */
}
</style>
