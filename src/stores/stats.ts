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
  /** path → 最近一次播放时间戳（「最近在听」用） */
  const lastPlayed = ref<Record<string, number>>({})
  const loaded = ref(false)

  const totalPlays = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0))

  async function load() {
    const rows = await db.getAllStats()
    const countsMap: Record<string, number> = {}
    const lastMap: Record<string, number> = {}
    for (const { path, stat } of rows) {
      countsMap[path] = stat.playCount
      lastMap[path] = stat.lastPlayedAt
    }
    counts.value = countsMap
    lastPlayed.value = lastMap
    loaded.value = true
  }

  function recordPlay(path: string) {
    const now = Date.now()
    counts.value = { ...counts.value, [path]: (counts.value[path] ?? 0) + 1 }
    lastPlayed.value = { ...lastPlayed.value, [path]: now }
    void db.putStat(path, { playCount: counts.value[path] ?? 1, lastPlayedAt: now })
  }

  /** 最近在听：按最近播放时间降序的 path 列表 */
  const recentPaths = computed(() =>
    Object.entries(lastPlayed.value)
      .sort((a, b) => b[1] - a[1])
      .map(([path]) => path),
  )

  async function clear() {
    counts.value = {}
    lastPlayed.value = {}
    await db.clearStats()
  }

  return { counts, lastPlayed, loaded, totalPlays, recentPaths, load, recordPlay, clear }
})
