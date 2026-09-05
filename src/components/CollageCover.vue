<script setup lang="ts">
import { computed } from 'vue'
import CoverImage from './CoverImage.vue'

/**
 * 歌单封面：≥4 首有封面的歌拼 2×2 四宫格；1–3 首取第一张单曲封面；空取占位。
 */
const props = defineProps<{ coverIds: (string | null)[]; size: number }>()

const singles = computed(() => props.coverIds.filter((c): c is string => !!c))
const collage = computed(() => singles.value.length >= 4)
</script>

<template>
  <div class="collage" :style="{ width: `${size}px`, height: `${size}px` }">
    <CoverImage v-if="!collage" :cover-id="singles[0] ?? null" :size="size" class="single" />
    <template v-else>
      <CoverImage
        v-for="(c, i) in singles.slice(0, 4)"
        :key="i"
        :cover-id="c"
        :size="Math.round(size / 2)"
        class="tile"
      />
    </template>
  </div>
</template>

<style scoped>
.collage {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: var(--shadow-1);
  flex-shrink: 0;
}

.collage .single,
.collage .tile {
  width: 100%;
  height: 100%;
  border-radius: 0;
}

.collage .single {
  grid-column: 1 / -1;
  grid-row: 1 / -1;
}
</style>
