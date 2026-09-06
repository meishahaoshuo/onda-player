<script setup lang="ts">
/**
 * 通用开关：与播放器统一的动效语言——
 * 滑块 spring 位移（--ease-spring）+ 开启态 accent 实底 + 按下轻缩放。
 */
defineProps<{ modelValue: boolean; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<template>
  <button
    type="button"
    class="app-switch"
    :class="{ on: modelValue }"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="knob" />
  </button>
</template>

<style scoped>
.app-switch {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 11px;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  transition: background var(--dur-med) var(--ease-out), border-color var(--dur-med) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.app-switch:hover {
  border-color: var(--text-tertiary);
}

.app-switch:active {
  transform: scale(0.96);
}

.app-switch:disabled {
  opacity: 0.45;
  pointer-events: none;
}

.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-secondary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: left var(--dur-med) var(--ease-spring), background var(--dur-med) var(--ease-out);
}

.app-switch.on {
  background: var(--accent);
  border-color: transparent;
}

.app-switch.on:hover {
  border-color: transparent;
  background: color-mix(in srgb, var(--accent) 88%, var(--text-primary));
}

.app-switch.on .knob {
  left: 20px;
  background: var(--accent-text);
}
</style>
