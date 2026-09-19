import fs from 'node:fs'

/**
 * 校验便携包 zip 里的中文条目名会不会在 Windows 资源管理器里变乱码。
 *
 * 关键在 zip 通用位标记（general purpose bit flag）的 **bit 11**：
 * 置位 = 文件名按 UTF-8 存；不置位 = 解压方按本地代码页（简中 = GBK）解读。
 * Compress-Archive 走 .NET ZipArchive，历史上有"写了 UTF-8 字节但不置位"的坑，
 * 那样解压出来中文名就是乱码 —— 所以这里直接把中央目录读出来验。
 */

const file = process.argv[2]
const buf = fs.readFileSync(file)

// EOCD：从尾部往前找 0x06054b50
let eocd = -1
for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
}
if (eocd < 0) throw new Error('找不到 EOCD，不是有效 zip')
const count = buf.readUInt16LE(eocd + 10)
const cdOff = buf.readUInt32LE(eocd + 16)
console.log('条目数 ' + count + '   中央目录偏移 ' + cdOff)
console.log('')

let p = cdOff
let utf8Ok = 0
for (let i = 0; i < count; i++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) { console.log('中央目录签名异常 @' + p); break }
  const flag = buf.readUInt16LE(p + 8)
  const compSize = buf.readUInt32LE(p + 20)
  const uncompSize = buf.readUInt32LE(p + 24)
  const nameLen = buf.readUInt16LE(p + 28)
  const extraLen = buf.readUInt16LE(p + 30)
  const commentLen = buf.readUInt16LE(p + 32)
  const nameBytes = buf.subarray(p + 46, p + 46 + nameLen)
  const bit11 = (flag & 0x0800) !== 0
  const utf8 = new TextDecoder('utf-8').decode(nameBytes)
  let gbk = '(解码失败)'
  try { gbk = new TextDecoder('gbk').decode(nameBytes) } catch {}
  const isAscii = /^[\x20-\x7e]*$/.test(utf8)
  console.log(
    (isAscii ? '  纯 ASCII' : (bit11 ? '  UTF-8 位已置 ✓' : '  ⚠️ UTF-8 位未置')) +
    '  | UTF-8 读作: ' + utf8.padEnd(42) +
    ' | GBK 读作: ' + gbk.padEnd(34) +
    ' | 压缩 ' + compSize + ' → 原始 ' + uncompSize,
  )
  if (bit11 || isAscii) utf8Ok++
  p += 46 + nameLen + extraLen + commentLen
}
console.log('')
console.log('UTF-8 安全条目 ' + utf8Ok + '/' + count + (utf8Ok === count ? '  ✅ 解压不会乱码' : '  ❌ 中文名可能在资源管理器里乱码'))
