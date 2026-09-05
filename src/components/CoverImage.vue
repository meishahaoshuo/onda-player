<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useLibraryStore } from '@/stores/library'
import AppIcon from './AppIcon.vue'

/**
 * 封面图：默认用 IndexedDB 的 256px 缩略图（列表场景足够）；
 * `hires` 用于歌词页/专辑详情等大图场景，先出缩略图、再静默换成
 * 从音频内嵌图提取的高清图（解码完成后才替换，避免二次解码闪烁）。
 */
const props = defineProps<{ coverId: string | null; size?: number; hires?: boolean }>()

const library = useLibraryStore()
/** 首帧同步取缓存 URL：切页回来时封面不再"先占位后蹦出"。 */
const url = ref<string | null>(library.peekCoverUrl(props.coverId))

/** 等图片位图真正就绪再替换 src，替换瞬间即可见 */
function preload(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    const done = () => resolve()
    img.onload = done
    img.onerror = done
    img.src = src
    if (typeof img.decode === 'function') {
      img.decode().then(done, done)
    }
  })
}

async function load() {
  const id = props.coverId
  url.value = library.peekCoverUrl(id) ?? (await library.coverUrl(id))
  if (!props.hires || !id) return
  const hi = await library.coverUrlHi(id)
  if (!hi || props.coverId !== id) return
  await preload(hi)
  if (props.coverId !== id) return
  url.value = hi
}

onMounted(load)
watch(() => [props.coverId, props.hires] as const, load)
</script>

<template>
  <img v-if="url" class="cover-img" :src="url" :width="size ?? 40" :height="size ?? 40" alt="" decoding="async" />
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
