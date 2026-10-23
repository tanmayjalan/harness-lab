import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ResizeHandle } from './App'
import { usePrefs } from './store/ui'

beforeEach(() => usePrefs.setState({ sidebarCollapsed: true })) // room to drag in the test's 1024 px window
afterEach(() => {
  document.body.style.cursor = ''
  usePrefs.setState({ inspectorWidth: 440, sidebarCollapsed: false })
})

const moveTo = (clientX: number) => window.dispatchEvent(new MouseEvent('pointermove', { clientX }))

describe("the Inspector's edge", () => {
  it('a drag follows the pointer and ends when the button is let go', () => {
    render(<ResizeHandle />)
    fireEvent.pointerDown(screen.getByRole('separator'))
    expect(document.body.style.cursor).toBe('col-resize')
    moveTo(window.innerWidth - 400)
    expect(usePrefs.getState().inspectorWidth).toBe(400)
    window.dispatchEvent(new Event('pointerup'))
    expect(document.body.style.cursor).toBe('')
    moveTo(window.innerWidth - 360)
    expect(usePrefs.getState().inspectorWidth).toBe(400)
  })

  // A touch drag the browser takes over (to scroll, say) ends with pointercancel, not pointerup
  it('a cancelled drag ends too: no stuck resize cursor, and moving no longer resizes', () => {
    render(<ResizeHandle />)
    fireEvent.pointerDown(screen.getByRole('separator'))
    moveTo(window.innerWidth - 400)
    window.dispatchEvent(new Event('pointercancel'))
    expect(document.body.style.cursor).toBe('')
    moveTo(window.innerWidth - 360)
    expect(usePrefs.getState().inspectorWidth).toBe(400)
  })
})
