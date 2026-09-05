import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as db from '@/services/db'

/**
 * 我喜欢的音乐：path → 收藏时间戳（内存镜像 + IndexedDB 持久化）。
 * 收藏列表按 addedAt 倒序（新收藏在前）。
 */

export const useFavoritesStore = defineStore('favorites', () => {
  const addedAt = ref<Record<string, number>>({})
  const loaded = ref(false)

  /** 收藏的 path 列表，新收藏在前 */
  const paths = computed(() =>
    Object.keys(addedAt.value).sort((a, b) => addedAt.value[b] - addedAt.value[a]),
  )

  async function load() {
    const rows = await db.getAllFavorites()
    const map: Record<string, number> = {}
    for (const { path, addedAt: at } of rows) map[path] = at
    addedAt.value = map
    loaded.value = true
  }

  function has(path: string): boolean {
    return path in addedAt.value
  }

  /** 返回切换后的收藏状态（true = 已收藏） */
  function toggle(path: string): boolean {
    if (path in addedAt.value) {
      const next = { ...addedAt.value }
      delete next[path]
      addedAt.value = next
      void db.deleteFavorite(path)
      return false
    }
    addedAt.value = { ...addedAt.value, [path]: Date.now() }
    void db.putFavorite(path, { addedAt: Date.now() })
    return true
  }

  async function clear() {
    addedAt.value = {}
    await db.clearFavorites()
  }

  return { addedAt, paths, loaded, load, has, toggle, clear }
})
