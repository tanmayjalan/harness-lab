import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useShortcuts } from './shortcuts'

function Page({ run }: { run: () => void }) {
  useShortcuts([{ key: 'Escape', whileTyping: true, run }])
  return <textarea aria-label="Message" />
}

// F036: Esc that ends an IME composition (Japanese, Chinese, Korean input) is not a shortcut
describe('useShortcuts', () => {
  it('ignores keys pressed while composing text', () => {
    const run = vi.fn()
    render(<Page run={run} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }))
    expect(run).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  // The listener is added once; a key runs the handler from the page's newest drawing, not the first one
  it('a key runs the newest handler after the page redraws', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Page run={first} />)
    rerender(<Page run={second} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  // F312: on a Mac, Alt+letter types a character, so an alt shortcut must not fire inside a text box
  it('an alt shortcut does not fire while typing on a Mac', () => {
    const run = vi.fn()
    const spy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    function AltPage() {
      useShortcuts([{ key: 'ArrowLeft', alt: true, whileTyping: true, run }])
      return <textarea aria-label="Message" />
    }
    const { getByLabelText } = render(<AltPage />)
    fireEvent.keyDown(getByLabelText('Message'), { key: 'ArrowLeft', altKey: true })
    expect(run).not.toHaveBeenCalled()
    spy.mockReturnValue('Win32')
    fireEvent.keyDown(getByLabelText('Message'), { key: 'ArrowLeft', altKey: true })
    expect(run).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('no shortcut fires while a dialog is open', () => {
    const run = vi.fn()
    const dlg = document.createElement('div')
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('data-state', 'open')
    document.body.appendChild(dlg)
    function Keys() { useShortcuts([{ key: 'Escape', whileTyping: true, run }, { key: 'k', ctrl: true, run }]); return null }
    render(<Keys />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(run).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    expect(run).toHaveBeenCalledTimes(1) // Ctrl shortcuts still work
    dlg.remove()
  })
})
