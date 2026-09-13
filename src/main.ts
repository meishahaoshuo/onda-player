import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')

if (import.meta.env.DEV) {
  import('./services/testBridge').then((m) => m.installTestBridge())
} else {
  // 桌面化：SW 注册与安装提示捕获仅生产环境启用
  import('./services/pwa').then((m) => m.setupPwa())
}
