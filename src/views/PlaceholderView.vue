<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <div class="placeholder">
    <p>「{{ title }}」将在后续阶段实现</p>
  </div>
</template>

<style scoped>
.placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}
</style>
