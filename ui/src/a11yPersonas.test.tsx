// Keyboard and screen-reader fixes from the persona review of 15 Oct (F425 to F433)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { HarnessEvent } from './api/types'
import { api } from './api/client'
import { deriveRuns } from './model/derive'
import { useSession } from './store/session'
import { useServer } from './store/server'
import { usePrefs, useUi } from './store/ui'
import { RunView } from './components/run/RunView'
import { Timeline } from './components/run/Timeline'
import { ExperimentNow } from './components/run/ExperimentPanels'
import { Announcer } from './components/shell/Announcer'
import { Explain } from './learn/Explain'
import { App } from './App'
import { CONCEPTS } from './learn/concepts'
import toolTurn from './test/fixtures/tool_turn.json'
import stopped from './test/fixtures/stopped.json'
import failed from './test/fixtures/error.json'
import answer from './test/fixtures/answer.json'

const events = (x: unknown) => x as HarnessEvent[]
const announced = () => document.querySelector('[data-announcer]')?.textContent?.replace(/​/g, '') ?? ''
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })) })

beforeEach(() => {
  useUi.setState({ toasts: [], approvalDock: null, screen: 'run', selectedCallId: null, selectedToolId: null, followLatest: true,
    mobilePane: 'chat', experimentId: null, guess: null, focusInspector: false, spoken: { text: '', n: 0 } })
  usePrefs.setState({ explained: [], learningMode: false, inspectorOpen: false, inspectHintSeen: true })
  useServer.setState({ info: null })
})
afterEach(() => { vi.restoreAllMocks() })

async function page() {
  // the page polls the server: never answer, so nothing replaces the conversation set here
  vi.spyOn(api, 'events').mockReturnValue(new Promise(() => {}))
  useSession.setState({ conversation: 'c1', derived: deriveRuns(events(toolTurn)), loaded: true, running: false, origin: null, frozen: false })
  render(<App />)
}

describe('F425: [ and ] with the Inspector closed', () => {
  it('[ opens the Inspector on the previous call and reads it out, leaving focus where it was', async () => {
    await page()
    expect(document.getElementById('inspector')).toBeNull()
    const before = document.activeElement
    key('[')
    expect(usePrefs.getState().inspectorOpen).toBe(true)
    expect(document.getElementById('inspector')).not.toBeNull()
    expect(announced()).toBe('Inspector: Message 1, call 2 (2 of 3 calls): asked for 1 tool')
    expect(document.activeElement).toBe(before)
  })

  it('says so at either end, rather than nothing', async () => {
    await page()
    key('['); key('['); key('[')
    expect(announced()).toMatch(/^Already at the first call\. Inspector: Message 1, call 1/)
    key(']'); key(']'); key(']')
    expect(announced()).toMatch(/^Already at the newest call\. Inspector: Message 1, call 3/)
  })
})

describe('F426: opening and closing the Inspector', () => {
  it('a call line says what it controls; picking one moves focus to the Inspector, and hiding it puts focus back', async () => {
    await page()
    const call1 = screen.getByRole('button', { name: /^Call 1/ })
    expect(call1).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(call1)
    const inspector = document.getElementById('inspector')!
    expect(call1).toHaveAttribute('aria-controls', 'inspector')
    expect(call1).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(inspector.contains(document.activeElement)).toBe(true))
    expect(document.activeElement).toHaveAccessibleName('Call to inspect')
    fireEvent.click(within(inspector).getByRole('button', { name: 'Hide the inspector' }))
    expect(document.getElementById('inspector')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Call 1/ }))
  })
})

describe('F427: explanations waiting their turn', () => {
  it('a waiting one is named as new; "Got it" hands focus to the next one, then to the ⓘ left behind', async () => {
    render(<><Explain concept="loop" /><Explain concept="tool_use" /></>)
    const first = screen.getByRole('region', { name: `Explanation: ${CONCEPTS.loop.plain}` })
    expect(screen.getByRole('button', { name: `New, not read yet: what does "${CONCEPTS.tool_use.term}" mean?` })).toBeInTheDocument()
    fireEvent.click(within(first).getByRole('button', { name: 'Got it, shorten this next time' }))
    const second = await screen.findByRole('region', { name: `Explanation: ${CONCEPTS.tool_use.plain}` })
    await waitFor(() => expect(document.activeElement).toBe(second))
    fireEvent.click(within(second).getByRole('button', { name: 'Got it, shorten this next time' }))
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(`What does "${CONCEPTS.tool_use.term}" mean?`))
  })
})

describe('F428: what is read out while and after a message runs', () => {
  const view = (start: unknown[]) => {
    useSession.setState({ conversation: 'c1', derived: deriveRuns(events(start)), loaded: true, running: true, origin: null, frozen: false })
    render(<RunView composerRef={{ current: null }} />)
  }
  const region = () => document.querySelector('.sr-only[aria-live]:not([data-announcer])')!.textContent!.replace(/​/g, '')

  it('a stopped message is announced', () => {
    const all = stopped as unknown[]
    view(all.slice(0, 2))
    act(() => useSession.setState({ derived: deriveRuns(events(all)), running: false }))
    expect(region()).toBe('Stopped. The conversation so far is kept.')
  })

  it('a message stopped by the call limit is announced', () => {
    const all = (failed as Record<string, unknown>[]).map((e) => e.kind === 'error' ? { ...e, message: 'Stopped: hit max_turns (2)', detail: 'RuntimeError: Stopped: hit max_turns (2)' } : e)
    view(all.slice(0, 2))
    act(() => useSession.setState({ derived: deriveRuns(events(all)), running: false }))
    expect(region()).toMatch(/^Stopped: this message reached the limit of 2 model calls/)
  })

  it('each call that comes back is said while it runs, and the reveal is read with the reply', () => {
    useUi.setState({ experimentId: 'loop', guess: '2' })
    const all = toolTurn as unknown[]
    view(all.slice(0, 2))
    act(() => useSession.setState({ derived: deriveRuns(events(all.slice(0, 3))) }))
    expect(region()).toBe('Call 1: asked for 2 tools.')
    act(() => useSession.setState({ derived: deriveRuns(events(all)), running: false }))
    expect(region()).toBe('Reply received (3 calls). Experiment Watch the loop. You guessed 2; it was 3. What it showed is under the reply.')
  })

  it('a failure is not said twice: its own alert reads it out', () => {
    const all = failed as unknown[]
    view(all.slice(0, 2))
    act(() => useSession.setState({ derived: deriveRuns(events(all)), running: false }))
    expect(region()).toBe('')
  })
})

describe('F429: the narrow Inspect view and back', () => {
  it('the chat stays put under the Inspect view; coming back puts focus on the call you picked', async () => {
    // a narrow window (one column, as at 200% zoom)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }))
    try {
      await page()
      const scroller = document.querySelector('main .overflow-y-auto')!
      fireEvent.click(screen.getByRole('button', { name: /^Call 1/ }))
      expect(useUi.getState().mobilePane).toBe('inspect')
      await waitFor(() => expect(document.getElementById('inspector')!.contains(document.activeElement)).toBe(true))
      // the same chat, not a new one: its scroll position and contents are kept, out of sight and out of reach
      expect(document.querySelector('main .overflow-y-auto')).toBe(scroller)
      expect(scroller.closest('[inert]')).not.toBeNull()
      fireEvent.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Chat' }))
      expect(document.querySelector('main .overflow-y-auto')).toBe(scroller)
      expect(scroller.closest('[inert]')).toBeNull()
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Call 1/ })))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('F430: guess first', () => {
  it('the choices are named by the question, and the pick is confirmed out loud', () => {
    useUi.setState({ experimentId: 'loop' })
    render(<><textarea aria-label="Message" /><ExperimentNow model={deriveRuns([])} /><Announcer /></>)
    const group = screen.getByRole('group', { name: /^Your guess: How many times will the harness call the model/ })
    fireEvent.click(within(group).getByRole('button', { name: '3' }))
    expect(announced()).toBe('Your guess: 3. Now send the message.')
    expect(document.activeElement).toHaveAccessibleName('Message')
  })
})

describe('F431, F433: older replies and headings', () => {
  // two messages: the older reply's numbers fade until pointed at
  const two = () => {
    const a = answer as Record<string, unknown>[]
    const again = a.map((e) => ({ ...e, seq: (e.seq as number) + 100, msg: 2 }))
    return deriveRuns(events([...a, ...again]))
  }

  it('the numbers under an older reply can be reached by Tab, and show when they are', () => {
    render(<Timeline model={two()} inspectedCallId={null} live="" running={false} />)
    const groups = screen.getAllByRole('group', { name: 'Numbers for this reply' })
    expect(groups).toHaveLength(1) // the newest reply's numbers are always shown
    expect(groups[0]).toHaveAttribute('tabindex', '0')
    expect(groups[0].className).toMatch(/focus:opacity-100/)
  })

  it('each message and each reply has a heading', () => {
    render(<Timeline model={two()} inspectedCallId={null} live="" running={false} />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Message 1', 'Message 2'])
    expect(screen.getAllByRole('heading', { level: 3, name: "The model's reply" })).toHaveLength(2)
  })
})

describe('F432: the top bar on a phone', () => {
  // (the fit itself is checked in a browser at 390 px: jsdom has no layout)
  it('drops the logo and tightens the screen buttons below the small breakpoint', () => {
    render(<App />)
    const header = document.querySelector('header')!
    expect(header.className).toMatch(/\bgap-1\b.*sm:gap-2/)
    expect(within(header).getByText('Harness lab').closest('div')!.className).toMatch(/\bhidden\b.*sm:flex/)
    expect(within(header).getByRole('button', { name: 'Chat' }).className).toMatch(/max-sm:px-2/)
  })
})
