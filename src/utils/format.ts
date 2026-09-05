/** 时长/时间格式化工具 */

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTotalDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0 秒'
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分钟`
  if (m > 0) return `${m} 分钟`
  return `${total} 秒`
}

/** 文件大小：GB 一位小数，MB/KB 取整 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes)} B`
}

/** 采样率：44100 → "44.1 kHz"，96000 → "96 kHz" */
export function formatSampleRate(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return ''
  const khz = hz / 1000
  const v = Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)
  return `${v} kHz`
}
