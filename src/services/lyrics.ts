/**
 * .lrc 歌词解析：
 * - 支持 `[mm:ss.xx]` 与多时间戳行
 * - 忽略 `[ti:xxx]` 等元数据标签
 * - 增强型逐字时间标签 `<mm:ss.xx>` 解析为逐字开始时刻（charTimes，与行文本逐字符对齐，
 *   末尾追加行结束时刻）；无逐字标签的普通行不生成 charTimes，由视图层插值兜底
 * - 相邻时间戳差 < 50ms 的行合并为一组（原文 + 翻译/罗马音）
 */

export interface LyricGroup {
  time: number
  texts: string[]
  /** 与 texts[0] 逐码点对齐的开始时刻，长度 = 码点数 + 1（末位为行尾时刻）；仅增强型 LRC 行有 */
  charTimes?: number[]
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g
const WORD_TAG = /<(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)>/g

/** 词内字符在 [wordStart, wordEnd) 区间线性均分；words 的 len 之和必须等于 text 的码点数 */
function buildCharTimes(words: { t: number; len: number }[], lineEnd: number): number[] {
  const times: number[] = []
  for (let w = 0; w < words.length; w++) {
    const start = words[w].t
    const end = w + 1 < words.length ? Math.max(start, words[w + 1].t) : Math.max(start, lineEnd)
    const len = Math.max(1, words[w].len)
    for (let k = 0; k < len; k++) {
      times.push(start + ((end - start) * k) / len)
    }
  }
  times.push(lineEnd)
  return times
}

/** 解析一条增强型 LRC 行文本；无逐字标签时返回 undefined */
function parseWordTimings(body: string): { charTimes: number[] } | undefined {
  WORD_TAG.lastIndex = 0
  if (!WORD_TAG.test(body)) return undefined

  // 按词标签切段：每段携带「开启它的标签」的时刻
  const words: { t: number; len: number }[] = []
  let lastTagT = 0
  let cursor = 0
  let m: RegExpExecArray | null
  WORD_TAG.lastIndex = 0
  while ((m = WORD_TAG.exec(body))) {
    const t = Number(m[1]) * 60 + Number(m[2])
    const seg = body.slice(cursor, m.index)
    const len = [...seg].length
    if (len > 0) words.push({ t: lastTagT, len })
    if (Number.isFinite(t)) lastTagT = t
    cursor = m.index + m[0].length
  }
  const tail = body.slice(cursor)
  const tailLen = [...tail].length
  if (tailLen > 0) words.push({ t: lastTagT, len: tailLen })
  if (words.length === 0) return undefined

  // 行尾时刻：按词均长估算，最短 0.6s
  const span = words[words.length - 1].t - words[0].t
  const avg = span / Math.max(1, words.length - 1)
  const lineEnd = words[words.length - 1].t + Math.max(0.6, avg)

  // 去 rune 安全地 trim 首尾空白，并同步修正首/末词长度
  const total = words.reduce((s, w) => s + w.len, 0)
  const plain = body.replace(WORD_TAG, '')
  const chars = [...plain]
  if (chars.length !== total) return undefined // 长度对不上（理论不可达）时放弃逐字
  let lead = 0
  while (lead < chars.length && /\s/.test(chars[lead])) lead++
  let trail = 0
  while (trail < chars.length - lead && /\s/.test(chars[chars.length - 1 - trail])) trail++
  if (lead + trail >= chars.length) return undefined

  if (lead > 0) {
    let remain = lead
    while (remain > 0 && words.length > 0) {
      const cut = Math.min(words[0].len, remain)
      words[0].len -= cut
      remain -= cut
      if (words[0].len === 0) words.shift()
    }
  }
  if (trail > 0 && words.length > 0) {
    let remain = trail
    while (remain > 0 && words.length > 0) {
      const cut = Math.min(words[words.length - 1].len, remain)
      words[words.length - 1].len -= cut
      remain -= cut
      if (words[words.length - 1].len === 0) words.pop()
    }
  }
  return { charTimes: buildCharTimes(words, lineEnd) }
}

export function parseLrc(content: string): LyricGroup[] {
  const flat: { t: number; text: string; charTimes?: number[] }[] = []

  for (const raw of content.split(/\r?\n/)) {
    TIME_TAG.lastIndex = 0
    const stamps = [...raw.matchAll(TIME_TAG)]
    if (stamps.length === 0) continue
    const body = raw.replace(TIME_TAG, '')
    const text = body.replace(WORD_TAG, '').trim()
    const timing = text ? parseWordTimings(body) : undefined
    for (const stamp of stamps) {
      const t = Number(stamp[1]) * 60 + Number(stamp[2])
      if (Number.isFinite(t)) flat.push({ t, text, charTimes: timing?.charTimes })
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
    groups.push({
      time: line.t,
      texts: line.text ? [line.text] : [],
      charTimes: line.text ? line.charTimes : undefined,
    })
  }
  return groups
}

export function isLrcEmpty(groups: LyricGroup[]): boolean {
  return groups.length === 0 || groups.every((g) => g.texts.every((t) => !t))
}
