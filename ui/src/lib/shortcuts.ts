// One keyboard listener for the whole page. Letter keys are ignored while you're typing in a
// box or a dialog is open (only Ctrl/Cmd shortcuts still work then), so "a" in a message never approves anything.
import { useEffect, useRef } from 'react'

export type Shortcut = {
  key: string // e.g. "Escape", "a", "[", ","
  ctrl?: boolean // Ctrl on Windows/Linux, Cmd on Mac
  alt?: boolean // Alt (e.g. Alt+← where [ needs AltGr on the keyboard)
  repeat?: boolean // also fires while the key is held down (stepping); off for A, D and Esc, so a held key acts once
  whileTyping?: boolean // also fires inside text boxes
  when?: () => boolean
  run: (e: KeyboardEvent) => void
}

// Text you type into, where a letter is a letter (a checkbox or radio button is not)
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'password', 'url', 'tel', ''])
export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.tagName === 'INPUT') return TEXT_INPUTS.has((el as HTMLInputElement).getAttribute('type') ?? '')
  return el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')

// On a Mac, Alt+letter types a character, so an alt shortcut must not fire inside a text box there
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform ?? '')

export function useShortcuts(shortcuts: Shortcut[]) {
  const ref = useRef(shortcuts)
  ref.current = shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return // a key that ends an input-method composition (Japanese, Chinese…) isn't a shortcut
      for (const s of ref.current) {
        const ctrl = e.ctrlKey || e.metaKey
        if (e.key.toLowerCase() !== s.key.toLowerCase() || !!s.ctrl !== ctrl || !!s.alt !== e.altKey) continue
        if (e.repeat && !s.repeat) continue
        if (dialogOpen() && !s.ctrl) continue // a dialog or menu owns the keys (Esc closes it by itself)
        if (!s.whileTyping && !s.ctrl && isTyping(e.target)) continue
        if (s.whileTyping && s.alt && isMac() && isTyping(e.target)) continue
        if (s.when && !s.when()) continue
        e.preventDefault()
        s.run(e)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
