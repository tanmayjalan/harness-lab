import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { Explain } from './Explain'
import { usePrefs } from '../store/ui'
import { useSession } from '../store/session'

// A stand-in for the browser's IntersectionObserver: everything is on screen at once
class SeenAtOnce {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]) }
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IntersectionObserver', SeenAtOnce)
  usePrefs.setState({ explained: [], learningMode: false })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  useSession.setState({ running: false })
})

// F064: an explanation that scrolls past during a live run has not been read
describe('Explain marks an idea read', () => {
  it('after about three seconds on screen when nothing is running', () => {
    render(<Explain concept="loop" />)
    act(() => { vi.advanceTimersByTime(1600) })
    expect(usePrefs.getState().explained).not.toContain('loop')
    act(() => { vi.advanceTimersByTime(1600) })
    expect(usePrefs.getState().explained).toContain('loop')
  })

  it('not while a reply is running and the view is scrolling by itself', () => {
    useSession.setState({ running: true })
    render(<Explain concept="loop" />)
    act(() => { vi.advanceTimersByTime(10000) })
    expect(usePrefs.getState().explained).not.toContain('loop')
  })
})
