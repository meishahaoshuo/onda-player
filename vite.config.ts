import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // 固定端口，避免与其他项目冲突（见 AGENTS.md §5）
    port: 5180,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 不清空 dist/：构建产物带 hash、index.html 只引用最新一套，
    // 旧文件留着无害（每个仅几百 KB）。关掉后构建零删除，
    // 不会往回收站塞旧产物；若嫌 dist 变大，隔段时间手动 Shift+Delete 清旧 hash 文件即可。
    emptyOutDir: false,
  },
})
