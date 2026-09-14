import fs from 'node:fs'

const p = 'D:/项目/音乐播放器/src/components/PlayerBar.vue'
let s = fs.readFileSync(p, 'utf8')

// 1) .queue-duration 的 position:relative 只服务于已删除的 .row-actions
s = s.replace('.queue-duration {\r\n  position: relative;\r\n', '.queue-duration {\r\n')

// 2) 整块删除 .row-actions / .row-act 样式（含注释头）
const re =
  /\/\* 队列行悬停快捷操作[\s\S]*?\.row-act :deep\(svg\.filled\) \{\r?\n  fill: currentColor;\r?\n\}\r?\n/
if (!re.test(s)) throw new Error('待删块未匹配')
s = s.replace(re, '')

fs.writeFileSync(p, s)
for (const k of ['row-actions', 'row-act', 'position: relative;\r\n  font-size: 12px']) {
  console.log(`${k}: ${s.split(k).length - 1} 处`)
}
console.log('面板样式尾部:\n' + s.slice(s.indexOf('.queue-duration {'), s.indexOf('.queue-duration {') + 420))
