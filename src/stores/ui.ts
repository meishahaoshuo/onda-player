import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ViewId } from '@/types'

/** 界面导航状态（无路由依赖，视图由 App.vue 切换） */
export const useUiStore = defineStore('ui', () => {
  const activeView = ref<ViewId>('songs')

  function navigate(view: ViewId) {
    activeView.value = view
  }

  return { activeView, navigate }
})
