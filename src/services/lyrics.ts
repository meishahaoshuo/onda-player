/**
 * .lrc 歌词解析：
 * - 支持 `[mm:ss.xx]` 与多时间戳行
 * - 忽略 `[ti:xxx]` 等元数据标签
 * - 增强型逐字时间标签 `<mm:ss.xx>` 直接剔除
 * - 相邻时间戳差 < 50ms 的行合并为一组（原文 + 翻译/罗马音）
 */

export interface LyricGroup {
  time: number
  texts: string[]
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/g

export function parseLrc(content: string): LyricGroup[] {
  const flat: { t: number; text: string }[] = []

  for (const raw of content.split(/\r?\n/)) {
    TIME_TAG.lastIndex = 0
    const stamps = [...raw.matchAll(TIME_TAG)]
    if (stamps.length === 0) continue
    const text = raw
      .replace(TIME_TAG, '')
      .replace(WORD_TAG, '')
      .trim()
    for (const m of stamps) {
      const t = Number(m[1]) * 60 + Number(m[2])
      if (Number.isFinite(t)) flat.push({ t, text })
    }
  }

  flat.sort((a, b) => a.t - b.t)

  const groups: LyricGroup[] = []
  for (const line of flat) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(last.time - line.t) < 0.05) {
      if (line.text) last.texts.push(line.text)
      continue
    }
    groups.push({ time: line.t, texts: line.text ? [line.text] : [] })
  }
  return groups
}

export function isLrcEmpty(groups: LyricGroup[]): boolean {
  return groups.length === 0 || groups.every((g) => g.texts.every((t) => !t))
}
