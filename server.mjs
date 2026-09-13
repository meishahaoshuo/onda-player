// 本地静态服务器：仅用于双击启动播放器（服务 dist 目录），无任何外部请求
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = 5181

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.map': 'application/json',
}

async function sendFile(res, filePath) {
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const data = await readFile(filePath)
  res.writeHead(200, { 'Content-Type': type })
  res.end(data)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'
    let filePath = normalize(join(ROOT, pathname))
    // 防目录穿越：解析后的路径必须仍在 dist 内
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    try {
      const s = await stat(filePath)
      if (s.isDirectory()) filePath = join(filePath, 'index.html')
    } catch {
      // 单页应用路由回退到 index.html
      filePath = join(ROOT, 'index.html')
    }
    await sendFile(res, filePath)
  } catch {
    res.writeHead(404)
    res.end('Not Found')
  }
})

server.on('error', (err) => {
  // 端口被占用说明服务器已在运行（如重复双击启动），直接打开页面即可
  if (err.code === 'EADDRINUSE') {
    console.log(`端口 ${PORT} 已有播放器服务在运行，直接使用`)
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`音乐播放器已就绪: http://localhost:${PORT}`)
})
