import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

/** 主应用的挂载入口，由 main.ts 动态引入（详见 main.ts 的说明） */
export function mountApp() {
  const app = createApp(App)
  app.use(createPinia())
  app.mount('#app')
}
