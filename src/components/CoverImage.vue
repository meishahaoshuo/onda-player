<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useLibraryStore } from '@/stores/library'
import AppIcon from './AppIcon.vue'

/** 封面图：异步从 IndexedDB 取 blob；无封面显示占位 */
const props = defineProps<{ coverId: string | null; size?: number }>()

const library = useLibraryStore()
const url = ref<string | null>(null)

async function load() {
  url.value = await library.coverUrl(props.coverId)
}

onMounted(load)
watch(() => props.coverId, load)
</script>

<template>
  <img v-if="url" class="cover-img" :src="url" :width="size ?? 40" :height="size ?? 40" alt="" />
  <div v-else class="cover-fallback" :style="{ width: `${size ?? 40}px`, height: `${size ?? 40}px` }">
    <AppIcon name="music" :size="Math.round((size ?? 40) * 0.45)" />
  </div>
</template>

<style scoped>
.cover-img {
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg-hover);
}

.cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--text-tertiary);
  flex-shrink: 0;
}
</style>
