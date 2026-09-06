import { ref } from 'vue'
import { usePlayerStore } from '@/stores/player'

/**
 * 全局快捷键：播放/音量控制，键位可在设置中重新录制。
 * - 绑定存 localStorage（动作 → 组合字符串，如 "Ctrl+ArrowRight"）；
 * - 输入框/可编辑元素聚焦时自动失效；
 * - 同一元素同一属性只挂一个动画的原则在此同样适用：本服务不碰 DOM 动画。
 */

export type HotkeyAction = 'togglePlay' | 'prev' | 'next' | 'volUp' | 'volDown' | 'toggleMute'

export const HOTKEY_ACTIONS: { id: HotkeyAction; label: string }[] = [
  { id: 'togglePlay', label: '播放 / 暂停' },
  { id: 'prev', label: '上一曲' },
  { id: 'next', label: '下一曲' },
  { id: 'volUp', label: '音量 +' },
  { id: 'volDown', label: '音量 −' },
  { id: 'toggleMute', label: '静音' },
]

const STORAGE_KEY = 'hotkeys.bindings'

export const HOTKEY_DEFAULTS: Record<HotkeyAction, string> = {
  togglePlay: 'Space',
  prev: 'Ctrl+ArrowLeft',
  next: 'Ctrl+ArrowRight',
  volUp: 'Ctrl+ArrowUp',
  volDown: 'Ctrl+ArrowDown',
  toggleMute: 'Ctrl+M',
}

function loadBindings(): Record<HotkeyAction, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<
      Record<HotkeyAction, string>
    >
    return { ...HOTKEY_DEFAULTS, ...raw }
  } catch {
    return { ...HOTKEY_DEFAULTS }
  }
}

const bindings = ref<Record<HotkeyAction, string>>(loadBindings())

export function useHotkeyBindings() {
  return bindings
}

export function setBinding(action: HotkeyAction, combo: string) {
  bindings.value = { ...bindings.value, [action]: combo }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings.value))
}

export function resetBinding(action: HotkeyAction) {
  bindings.value = { ...bindings.value, [action]: HOTKEY_DEFAULTS[action] }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings.value))
}

/** 从键盘事件归一化出组合字符串（修饰键按固定顺序 + 主键） */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = normalizeKey(e)
  if (!key) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  // 只有修饰键按下不算组合
  if (['Ctrl', 'Alt', 'Shift', 'Meta'].includes(key)) return null
  parts.push(key)
  return parts.join('+')
}

function normalizeKey(e: KeyboardEvent): string | null {
  const k = e.key
  if (k === ' ') return 'Space'
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) return k === 'Control' ? 'Ctrl' : k
  if (k.startsWith('Arrow')) return k
  if (/^[a-z]$/i.test(k)) return k.toUpperCase()
  if (/^[0-9]$/.test(k)) return k
  if (k.length === 1) return k.toUpperCase()
  return k // F1-F12、Home、End、PageUp 等
}

function parseCombo(combo: string): { mods: Set<string>; key: string } {
  const parts = combo.split('+')
  const key = parts.pop() ?? ''
  return { mods: new Set(parts), key }
}

function matches(binding: string, e: KeyboardEvent): boolean {
  const { mods, key } = parseCombo(binding)
  const needCtrl = mods.has('Ctrl')
  const needAlt = mods.has('Alt')
  const needShift = mods.has('Shift')
  const needMeta = mods.has('Meta')
  if (needCtrl !== e.ctrlKey || needAlt !== e.altKey || needShift !== e.shiftKey || needMeta !== e.metaKey)
    return false
  return normalizeKey(e) === key
}

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/** 在 App 挂载后调用一次：安装全局 keydown 监听 */
export function installHotkeys(): void {
  const player = usePlayerStore()
  window.addEventListener(
    'keydown',
    (e) => {
      if (isEditableTarget(e)) return
      for (const { id } of HOTKEY_ACTIONS) {
        if (!matches(bindings.value[id], e)) continue
        e.preventDefault()
        switch (id) {
          case 'togglePlay':
            player.current ? player.togglePlay() : player.resumePlay()
            break
          case 'prev':
            player.prev()
            break
          case 'next':
            player.next()
            break
          case 'volUp':
            player.setVolume(Math.min(100, player.volume + 5))
            break
          case 'volDown':
            player.setVolume(Math.max(0, player.volume - 5))
            break
          case 'toggleMute':
            player.toggleMute()
            break
        }
        return
      }
    },
    { capture: true },
  )
}
