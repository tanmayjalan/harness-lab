// The first lesson, from the 2026-10-15 persona review (section 4.4): opening the page, following
// the first experiment, and moving on to the next one
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns } from '../../model/derive'
import { useSession } from '../../store/session'
import { usePrefs, useUi } from '../../store/ui'
import { RunView } from './RunView'
import toolTurn from '../../test/fixtures/tool_turn.json'

beforeEach(() => {
  useUi.setState({ experimentId: null, guess: null })
  usePrefs.setState({ explained: [], learningMode: false, experimentsDone: [] })
})
afterEach(() => {
  useSession.setState({ running: false })
  vi.unstubAllGlobals()
})

// A page with sizes: jsdom lays nothing out, so the scroller's heights are made up here. The page is
// short while it shows the loading skeleton and taller once the heading is there
function withSizes() {
  const tops = new WeakMap<Element, number>()
  const observers: (() => void)[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) { observers.push(cb) }
    observe() {} unobserve() {} disconnect() {}
  })
  const proto = HTMLElement.prototype
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 700 })
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return this.querySelector('h1') ? 932 : 700 } })
  Object.defineProperty(proto, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) { return tops.get(this) ?? 0 },
    set(this: HTMLElement, v: number) { tops.set(this, v) },
  })
  return {
    grow: () => act(() => observers.forEach((cb) => cb())),
    restore: () => {
      for (const k of ['clientHeight', 'scrollHeight', 'scrollTop']) delete (proto as unknown as Record<string, unknown>)[k]
    },
  }
}

const scroller = (c: HTMLElement) => c.querySelector<HTMLElement>('.overflow-y-auto')!

describe('F405: the empty conversation starts at the top', () => {
  it('stays at the top while the page loads and grows, so the heading shows', () => {
    const page = withSizes()
    try {
      useSession.setState({ derived: deriveRuns([]), loaded: false, running: false, conversation: 'c1' })
      const { container } = render(<RunView composerRef={{ current: null }} />)
      act(() => useSession.setState({ loaded: true }))
      page.grow()
      expect(container.querySelector('h1')?.textContent).toMatch(/See how an AI agent harness works/)
      expect(scroller(container).scrollTop).toBe(0)
    } finally {
      page.restore()
    }
  })

  it('a conversation with messages still opens at the newest one', () => {
    const page = withSizes()
    try {
      useSession.setState({ derived: deriveRuns(toolTurn as HarnessEvent[]), loaded: true, running: false, conversation: 'c1' })
      const { container } = render(<RunView composerRef={{ current: null }} />)
      page.grow()
      expect(scroller(container).scrollTop).toBe(932)
    } finally {
      page.restore()
    }
  })
})
