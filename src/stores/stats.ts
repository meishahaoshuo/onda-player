import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as db from '@/services/db'

/**
 * 播放统计：path → 播放次数（内存镜像 + IndexedDB 持久化）。
 * 计数规则见 player store：听满 30 秒或进度 50%（先到）计一次。
 */

export const useStatsStore = defineStore('stats', () => {
  /** path → 播放次数（整体替换赋值保证响应式） */
  const counts = ref<Record<string, number>>({})
  const loaded = ref(false)

  const totalPlays = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0))

  async function load() {
    const rows = await db.getAllStats()
    const map: Record<string, number> = {}
    for (const { path, stat } of rows) map[path] = stat.playCount
    counts.value = map
    loaded.value = true
  }

  function recordPlay(path: string) {
    counts.value = { ...counts.value, [path]: (counts.value[path] ?? 0) + 1 }
    void db.putStat(path, { playCount: counts.value[path] ?? 1, lastPlayedAt: Date.now() })
  }

  async function clear() {
    counts.value = {}
    await db.clearStats()
  }

  return { counts, loaded, totalPlays, load, recordPlay, clear }
})
