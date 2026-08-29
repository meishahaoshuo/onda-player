import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ViewId } from '@/types'

/**
 * 界面导航状态（无路由依赖，视图由 App.vue 切换）。
 * detail 用于聚合页的钻取：如专辑页 → 专辑详情。
 */
export const useUiStore = defineStore('ui', () => {
  const activeView = ref<ViewId>('songs')
  const detailKey = ref<string | null>(null)

  function navigate(view: ViewId) {
    activeView.value = view
    detailKey.value = null
  }

  /** 进入聚合页详情（同一视图内切换） */
  function openDetail(key: string) {
    detailKey.value = key
  }

  function closeDetail() {
    detailKey.value = null
  }

  return { activeView, detailKey, navigate, openDetail, closeDetail }
})
