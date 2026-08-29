<script setup lang="ts">
import { computed } from 'vue'
import type { Quality } from '@/types'

const props = defineProps<{
  container: string
  sampleRateHz: number | null
  bitsPerSample: number | null
  bitrateKbps: number | null
}>()

const LOSSLESS = new Set(['flac', 'wav', 'alac', 'aiff'])

const quality = computed<Quality>(() => {
  const container = props.container.toLowerCase()
  if (
    (props.sampleRateHz !== null && props.sampleRateHz > 48000) ||
    (props.bitsPerSample !== null && props.bitsPerSample > 16)
  ) {
    return 'hires'
  }
  if (LOSSLESS.has(container)) return 'lossless'
  return 'lossy'
})

const label = computed(() => {
  switch (quality.value) {
    case 'hires':
      return 'Hi-Res'
    case 'lossless':
      return '无损'
    case 'lossy':
      return props.bitrateKbps ? `${props.bitrateKbps}K` : '有损'
  }
})

const cls = computed(() => `q-${quality.value}`)
</script>

<template>
  <span class="badge" :class="cls">{{ label }}</span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  line-height: 1;
  flex-shrink: 0;
}

.q-hires {
  background: var(--badge-hires);
}

.q-lossless {
  background: var(--badge-lossless);
}

.q-lossy {
  background: var(--badge-lossy);
}
</style>
