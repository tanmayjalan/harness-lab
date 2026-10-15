import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { Info } from '../../api/types'
import { api } from '../../api/client'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { useEvals } from '../../store/evals'
import { useCompare } from '../../store/compare'
import { toast, usePrefs, useUi } from '../../store/ui'
import { onRunScreen } from '../../store/selectors'
import { inspectorWidthCss } from '../../lib/layout'
import { TopBar } from './TopBar'
import { Toaster } from './Toaster'
import { Announcer } from './Announcer'
import { deriveRuns } from '../../model/derive'
import type { HarnessEvent } from '../../api/types'
import { HelpSheet } from './HelpSheet'
import { Sidebar } from '../sidebar/Sidebar'
import { ExperimentGrid, EmptyState } from '../run/EmptyState'
import { ExplainIcon, Explain } from '../../learn/Explain'
import { CONCEPTS } from '../../learn/concepts'
import { EXPERIMENTS, findExperiment } from '../../learn/experiments'
import { QUIZ } from '../../learn/quiz'
import declined from '../../test/fixtures/approval_declined.json'

const wrap = (ui: React.ReactNode) => render(<RTooltip.Provider>{ui}</RTooltip.Provider>)
const text = () => document.body.textContent ?? ''
const item = (id: string, title: string, over: Record<string, unknown> = {}) =>
  ({ id, title, created: 1_790_000_000, updated: Date.now() / 1000, runs: 1, badge: ['claude-opus-5-5', 'trimming on'], kind: null, ...over })

beforeEach(() => {
  useUi.setState({ toasts: [], screen: 'run', helpOpen: false, helpTarget: null })
  useSession.setState({ running: false, provider: 'mock' })
  usePrefs.setState({ explained: [], learningMode: false, experimentsDone: [], quizAnswers: {} })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('layout', () => {
  // F009: the conversation column keeps room to read
  it('the inspector gives way before the conversation column gets too narrow', () => {
    expect(inspectorWidthCss(520, true)).toBe('min(520px, max(300px, calc(100vw - 256px - 420px)))')
    expect(inspectorWidthCss(480, false)).toBe('min(480px, max(300px, calc(100vw - 0px - 420px)))')
  })

  // F192: conversation keys only in a conversation
  it('conversation shortcuts only work on the conversation screen', () => {
    useUi.setState({ screen: 'compare' })
    expect(onRunScreen()).toBe(false)
    useUi.setState({ screen: 'run' })
    expect(onRunScreen()).toBe(true)
  })
})

describe('toasts', () => {
  // F090: messages last long enough to act on, and wait while you point at them
  it('an error stays 20 seconds, and as long as you hold it', () => {
    vi.useFakeTimers()
    toast({ kind: 'error', title: 'Boom' })
    const id = useUi.getState().toasts[0].id
    act(() => { vi.advanceTimersByTime(15000) })
    expect(useUi.getState().toasts).toHaveLength(1)
    useUi.getState().holdToast(id)
    act(() => { vi.advanceTimersByTime(60000) })
    expect(useUi.getState().toasts).toHaveLength(1)
    useUi.getState().releaseToast(id)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(useUi.getState().toasts).toHaveLength(0)
  })

  it('keeps line breaks in a message', () => {
    useUi.setState({ toasts: [{ id: 1, kind: 'info', title: 'Two lines', body: 'one\ntwo' }] })
    wrap(<Toaster />)
    expect(screen.getByText(/one/).className).toMatch(/whitespace-pre-line/)
  })
})

describe('sidebar', () => {
  beforeEach(() => {
    useServer.setState({ conversations: { current: 'a', items: [item('a', 'Open one'), item('b', 'Other one')] } as never })
  })

  // F091: delete is visible, says what a second click does, and can be undone
  it('delete asks in words, then offers Undo', async () => {
    const del = vi.spyOn(api, 'deleteConversation').mockResolvedValue({ current: 'a', items: [item('a', 'Open one')] } as never)
    const restore = vi.spyOn(api, 'restoreConversation').mockResolvedValue({ current: 'a', items: [] } as never)
    wrap(<Sidebar />)
    const trash = screen.getByRole('button', { name: 'Delete Other one' })
    expect(trash.className).not.toMatch(/opacity-0/)
    fireEvent.click(trash)
    expect(screen.getByText('Delete? Click again')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Confirm delete Other one/ })) })
    expect(del).toHaveBeenCalledWith('b')
    const t = useUi.getState().toasts.at(-1)!
    expect(t.title).toBe('Deleted "Other one"')
    await act(async () => { t.action!.run() })
    expect(restore).toHaveBeenCalledWith('b')
  })

  // F191: the open conversation can be deleted too
  it('the open conversation has a delete button', () => {
    wrap(<Sidebar />)
    expect(screen.getByRole('button', { name: 'Delete Open one' })).toBeInTheDocument()
  })

  // F093: greyed-out controls say why
  it('controls greyed out during a reply say when they come back', () => {
    useSession.setState({ running: true })
    wrap(<Sidebar />)
    expect(screen.getByRole('button', { name: /New conversation/ }).closest('[title]')!.getAttribute('title'))
      .toMatch(/Available when the current reply finishes/)
  })

  // Deferred M9: a disabled button gets no pointer events, so its reason sits on a wrapper
  it('the greyed-out bin says why', () => {
    useSession.setState({ running: true })
    wrap(<Sidebar />)
    const bin = screen.getByRole('button', { name: 'Delete Other one' })
    expect(bin).toBeDisabled()
    expect(bin.parentElement!.getAttribute('title')).toMatch(/Available when the current reply finishes/)
  })

  // F092: tags are labelled for what they are
  it('setup tags say what they are', () => {
    wrap(<Sidebar />)
    expect(screen.getAllByTitle(/Settings this conversation last used/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('trimming on').length).toBeGreaterThan(0)
  })
})

describe('top bar', () => {
  // F089, F118: Experiments has its own icon and name
  it('names the Experiments button', () => {
    wrap(<TopBar narrow={false} />)
    expect(screen.getByRole('button', { name: 'Experiments' })).toBeInTheDocument()
  })

  // F190: an eval run shows in the status
  it('says when evals are running', () => {
    useEvals.setState({ status: { running: true, done: 1, total: 6 } })
    wrap(<TopBar narrow={false} />)
    expect(text()).toMatch(/Evaluating 1\/6/)
    useEvals.setState({ status: { running: false } })
  })

  // F195: the inspector button stays, greyed with a reason, off the conversation screen
  it('keeps the inspector button on other screens, greyed out with a reason', () => {
    useUi.setState({ screen: 'compare' })
    wrap(<TopBar narrow={false} />)
    const b = screen.getByRole('button', { name: 'Inspector' })
    // F433: aria-disabled, so Tab still reaches it and its reason; a click does nothing
    expect(b).not.toBeDisabled()
    expect(b).toHaveAttribute('aria-disabled', 'true')
    expect(b).toHaveAccessibleDescription('The inspector shows model calls in a conversation')
    const before = usePrefs.getState().inspectorOpen
    fireEvent.click(b)
    expect(usePrefs.getState().inspectorOpen).toBe(before)
  })

  // F193, F112: the status is in words at every width
  it('shows the status in words', () => {
    wrap(<TopBar narrow />)
    expect(screen.getByText('Ready').className).not.toMatch(/sr-only/)
  })

  // F053: the ? button says the quiz is in there
  it('the help button mentions the glossary and quiz', () => {
    wrap(<TopBar narrow={false} />)
    expect(screen.getByRole('button', { name: 'Help, glossary and quiz' })).toBeInTheDocument()
  })
})

describe('help', () => {
  // F051: a short tour first, with a way into the experiments
  it('starts with the page at a glance and a way into the experiments', () => {
    useUi.setState({ helpOpen: true })
    wrap(<HelpSheet />)
    expect(screen.getByText('The page at a glance')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start the learning path' }))
    expect(useUi.getState().experimentsOpen).toBe(true)
  })

  // F054: every key that does something is listed
  it('lists the chart arrows and the Alt alternative to [ ]', () => {
    useUi.setState({ helpOpen: true })
    wrap(<HelpSheet />)
    expect(text()).toMatch(/move between calls in the size chart/)
    expect(text()).toMatch(/Alt.*previous or next call/)
  })

  // F052: Help can open at a glossary term; the glossary can be filtered
  it('opens at a term, and filters the glossary', async () => {
    useUi.getState().setHelp(true, 'term-history')
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    wrap(<HelpSheet />)
    expect(document.getElementById('term-history')).not.toBeNull()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) }) // it scrolls once the dialog is drawn
    expect(spy).toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter the glossary' }), { target: { value: 'cache' } })
    expect(document.getElementById('term-history')).toBeNull()
    expect(document.getElementById('term-caching')).not.toBeNull()
  })

  // F153: Compare's ideas are in the glossary
  it('the glossary covers Compare', () => {
    useUi.setState({ helpOpen: true })
    wrap(<HelpSheet />)
    expect(text()).toMatch(/Compare side/)
    expect(text()).toMatch(/middle \(median\) and range/)
  })

  // F055, F154: the quiz is grouped by what you've seen, counts clearly, and a question can be tried again
  it('groups the quiz, counts answered questions, and offers try again', () => {
    useUi.setState({ helpOpen: true })
    usePrefs.setState({ quizAnswers: { [QUIZ[0].id]: QUIZ[0].answer, [QUIZ[1].id]: 0, [QUIZ[2].id]: QUIZ[2].answer } })
    wrap(<HelpSheet />)
    expect(text()).toMatch(/2 right of 3 answered/)
    expect(text()).toMatch(/after: /)
    fireEvent.click(screen.getAllByRole('button', { name: /Try again/ })[0])
    expect(Object.keys(usePrefs.getState().quizAnswers)).toHaveLength(2)
  })
})

describe('explanations', () => {
  // F063: once seen, a quiet explanation leaves an ⓘ behind, as Help promises
  it('a quiet explanation already seen leaves an ⓘ', () => {
    usePrefs.setState({ explained: ['loop'] })
    wrap(<Explain concept="loop" quiet />)
    expect(screen.getByRole('button', { name: /loop/ })).toBeInTheDocument()
  })

  // F152: from an ⓘ to the glossary
  it('the ⓘ popover leads to the glossary', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    wrap(<ExplainIcon concept="history" />)
    fireEvent.click(screen.getByRole('button', { name: /history/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'See it in the glossary' }))
    expect(useUi.getState()).toMatchObject({ helpOpen: true, helpTarget: 'term-history' })
  })

  // F155: the close button says what closing does
  // Task 8: the close is an IconButton; its sentence is the button's description (always, not only in the tooltip)
  it('the close button says the explanation shortens next time', () => {
    wrap(<Explain concept="tool_use" />)
    expect(screen.getByRole('button', { name: 'Got it, shorten this next time' })).toHaveAccessibleDescription(/Next time this is an ⓘ/)
  })
})

describe('experiment cards', () => {
  const info = { provider: 'mock', providers: [{ name: 'mock', models: ['claude-opus-5-5', 'claude-haiku-4-5-20251001'] }] } as unknown as Info
  beforeEach(() => useServer.setState({ info }))

  // F057: a card says what it will do to your setup, and API-only ones are greyed on the mock
  it('cards say what they change and which need a real API', () => {
    wrap(<ExperimentGrid onPick={() => {}} disabled={false} />)
    const cut = screen.getByRole('button', { name: /Cut off mid-sentence/ })
    expect(cut.textContent).toMatch(/changes a setting \(undoable\)/)
    expect(screen.getByRole('button', { name: /Watch the loop/ }).textContent).toMatch(/guess first/)
    const cache = screen.getByRole('button', { name: /Second call is cheaper/ })
    expect(cache).toHaveAttribute('aria-disabled', 'true') // F373: still reachable, and says why
    expect(cache.textContent).toMatch(/needs the Anthropic API \(the mock can't cache; DeepSeek caches on its own/)
  })

  // F373: a card that can't be picked now stays in the Tab order and says why; a click does nothing
  it('cards that cannot be picked say why to screen readers too', () => {
    const onPick = vi.fn()
    wrap(<ExperimentGrid onPick={onPick} disabled={false} />)
    const cache = screen.getByRole('button', { name: /Second call is cheaper/ })
    expect(cache).not.toBeDisabled()
    expect(cache).toHaveAccessibleDescription(/Needs the Anthropic API/)
    fireEvent.click(cache)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('while a reply runs, every card waits and says so', () => {
    const onPick = vi.fn()
    wrap(<ExperimentGrid onPick={onPick} disabled />)
    const loop = screen.getByRole('button', { name: /Watch the loop/ })
    expect(loop).toHaveAttribute('aria-disabled', 'true')
    expect(loop).toHaveAccessibleDescription('Available when the current reply finishes')
    fireEvent.click(loop)
    expect(onPick).not.toHaveBeenCalled()
  })

  // F374b: two columns from 640 px up, never three
  it('the cards sit in two columns', () => {
    wrap(<ExperimentGrid onPick={() => {}} disabled={false} />)
    const grid = screen.getByRole('button', { name: /Watch the loop/ }).parentElement!
    expect(grid.className).toMatch(/\bsm:grid-cols-2\b/)
    expect(grid.className).not.toMatch(/grid-cols-3/)
  })

  // F053: once a few are done, the quiz is offered
  it('offers the quiz after three experiments', () => {
    usePrefs.setState({ experimentsDone: ['loop', 'errors', 'approval'] })
    wrap(<EmptyState disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Quiz me/ }))
    expect(useUi.getState()).toMatchObject({ helpOpen: true, helpTarget: 'quiz' })
  })

  // F060, F065, F151: wording that matches what the page can show
  it('the wording fits the mock and points at related ideas', () => {
    expect(findExperiment('thinking')!.lookAt).toMatch(/On the mock you only see that it thought/)
    expect(findExperiment('trim')!.tryNext).toMatch(/Search vs read everything/)
    expect(CONCEPTS.eval.long.join(' ')).toMatch(/PASS.*MIXED.*FAIL/)
    expect(EXPERIMENTS.length).toBeGreaterThan(10)
  })
})

describe('dialogs, announcements and approvals (F303, F308, F310c, F369)', () => {
  const pending = () => {
    const events = (declined as unknown as HarnessEvent[]).slice(0, 5)
    return deriveRuns(events).pendingApproval
  }
  beforeEach(() => useUi.setState({ settingsOpen: false, experimentsOpen: false, mobilePane: 'chat' }))
  afterEach(() => useSession.setState({ derived: deriveRuns([]) }))

  it("a new toast's words appear in the announcer", () => {
    wrap(<Announcer />)
    act(() => toast({ kind: 'ok', title: 'Saved', body: 'Applies from your next message.' }))
    expect(screen.getByRole('status').textContent?.replace('​', '')).toBe('Saved. Applies from your next message.')
  })

  it('the same toast twice in a row changes the announcer both times', () => {
    wrap(<Announcer />)
    const region = screen.getByRole('status')
    act(() => toast({ kind: 'ok', title: 'Copied' }))
    const first = region.textContent
    act(() => useUi.getState().dismiss(useUi.getState().toasts[0].id))
    act(() => toast({ kind: 'ok', title: 'Copied' }))
    expect(first).toMatch(/^Copied/)
    expect(region.textContent).toMatch(/^Copied/)
    expect(region.textContent).not.toBe(first)
  })

  it('an approval arriving while Help is open is announced inside the dialog', () => {
    useUi.setState({ helpOpen: true })
    wrap(<HelpSheet />)
    const approval = pending()
    expect(approval).not.toBeNull()
    act(() => useSession.setState({ derived: { ...useSession.getState().derived, pendingApproval: approval } }))
    const inside = screen.getAllByRole('status').filter((s) => s.closest('[role=dialog]'))
    expect(inside.some((s) => /waiting for you/.test(s.textContent ?? ''))).toBe(true)
  })

  describe('the address bar', () => {
    beforeEach(() => { history.replaceState(null, '', '#chat'); useSession.setState({ conversation: '', connection: 'connecting' }) })
    afterEach(() => { history.replaceState(null, '', location.pathname) })

    it('switching screens writes the hash and popstate switches back', async () => {
      const { App } = await import('../../App')
      render(<App />)
      expect(location.hash).toBe('#chat')
      act(() => useUi.getState().setScreen('compare'))
      expect(location.hash).toBe('#compare')
      history.replaceState(null, '', '#chat')
      act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
      expect(useUi.getState().screen).toBe('run')
    })

    it('a new conversation with no message keeps the hash at #chat, and a run puts its id there', async () => {
      const { App } = await import('../../App')
      render(<App />)
      act(() => useSession.setState({ conversation: 'fresh1' }))
      expect(location.hash).toBe('#chat')
      act(() => useSession.setState({ derived: deriveRuns(declined as HarnessEvent[]) }))
      expect(location.hash).toBe('#chat/fresh1')
    })

    it('Back from a conversation to #chat starts a new one', async () => {
      const { App } = await import('../../App')
      const fresh = vi.spyOn(api, 'newConversation').mockResolvedValue({ ok: true } as never)
      render(<App />)
      act(() => useSession.setState({ conversation: 'abc', derived: deriveRuns(declined as HarnessEvent[]) }))
      expect(location.hash).toBe('#chat/abc')
      history.replaceState(null, '', '#chat')
      act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
      expect(fresh).toHaveBeenCalledTimes(1)
    })

    it.each(['#evals', '#compare'])('reloading on %s before the server answers does not crash', async (hash) => {
      const { App } = await import('../../App')
      useServer.setState({ settings: null })
      history.replaceState(null, '', hash)
      render(<App />)
      expect(useUi.getState().screen).toBe(hash.slice(1))
    })

    it('an unknown id in the hash falls back to a new conversation', async () => {
      const { App } = await import('../../App')
      const { ApiError } = await import('../../api/client')
      history.replaceState(null, '', '#chat/nope')
      vi.spyOn(api, 'events').mockResolvedValue({ gen: 1, since: 0, events: [], running: false, conversation: 'cur' } as never)
      vi.spyOn(api, 'openConversation').mockRejectedValue(new ApiError(404, 'no such conversation'))
      render(<App />)
      await screen.findByText('That conversation is gone')
      expect(useUi.getState().screen).toBe('run')
      await vi.waitFor(() => expect(location.hash).toBe('#chat'))
    })

    it("a reconnect does not reopen the hash's conversation a second time", async () => {
      const { App } = await import('../../App')
      history.replaceState(null, '', '#chat/abc')
      vi.spyOn(api, 'events').mockResolvedValue({ gen: 1, since: 0, events: [], running: false, conversation: 'cur' } as never)
      const open = vi.spyOn(api, 'openConversation').mockResolvedValue({ current: 'abc', items: [] } as never)
      render(<App />)
      await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1))
      act(() => useSession.getState().setConnection('lost'))
      await new Promise((r) => setTimeout(r, 1300)) // the poll reconnects: onConnected runs again
      expect(open).toHaveBeenCalledTimes(1)
    })
  })

  it('an approval arriving on the Compare screen shows a toast whose action returns to the chat', async () => {
    const { App } = await import('../../App')
    vi.spyOn(api, 'info').mockResolvedValue(undefined as never)
    history.replaceState(null, '', '#compare')
    render(<App />)
    act(() => useSession.setState({ derived: { ...useSession.getState().derived, pendingApproval: pending() } }))
    const go = await screen.findByRole('button', { name: 'Go to the conversation' })
    fireEvent.click(go)
    expect(useUi.getState().screen).toBe('run')
    history.replaceState(null, '', location.pathname)
  })

  it('answering a quiz question keeps focus on the pressed option and the result is in a status region', () => {
    useUi.setState({ helpOpen: true })
    wrap(<HelpSheet />)
    const q = QUIZ[0]
    const opt = screen.getAllByRole('button', { name: q.options[0] })[0]
    opt.focus()
    fireEvent.click(opt)
    expect(document.activeElement).toBe(opt)
    expect(opt.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getAllByRole('status').some((s) => /Right\.|Not quite/.test(s.textContent ?? ''))).toBe(true)
    fireEvent.click(opt) // a second press changes nothing
    expect(Object.keys(usePrefs.getState().quizAnswers)).toHaveLength(1)
  })
})

describe('quiz start again (F329)', () => {
  it('can be undone', () => {
    usePrefs.setState({ quizAnswers: { 'runs-tools': 1, memory: 2 } })
    useUi.setState({ helpOpen: true })
    wrap(<HelpSheet />)
    fireEvent.click(screen.getByRole('button', { name: 'start again' }))
    expect(usePrefs.getState().quizAnswers).toEqual({})
    act(() => { useUi.getState().toasts.at(-1)!.action!.run() })
    expect(usePrefs.getState().quizAnswers).toEqual({ 'runs-tools': 1, memory: 2 })
  })
})

// ---- Third pass, Task 9: the shell (F309 F310 F310a F310b F310d) ----
describe('shell accessibility (F309 F310 F310a F310b F310d)', () => {
  const idle = () => deriveRuns([])
  beforeEach(() => {
    history.replaceState(null, '', '#chat')
    useSession.setState({ conversation: '', connection: 'connecting', running: false, loaded: true, derived: idle() })
    usePrefs.setState({ sidebarCollapsed: false, inspectorOpen: true })
    useEvals.setState({ status: { running: false } })
  })
  afterEach(() => { history.replaceState(null, '', location.pathname); vi.unstubAllGlobals() })

  it('F309: the first Tab lands on the skip link, which puts focus in the message box without touching the address', async () => {
    const { App } = await import('../../App')
    render(<App />)
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Skip to the message box' })
    expect(skip).toHaveFocus()
    await userEvent.click(skip)
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Message' }).id).toBe('message-box')
    expect(location.hash).toBe('#chat')
  })

  it('F309: a conversation has a hidden h1, and the sidebar groups are h2', async () => {
    const { App } = await import('../../App')
    useServer.setState({ conversations: { current: 'a', items: [item('a', 'Open one')] } as never })
    useSession.setState({ conversation: 'a', derived: deriveRuns(declined as HarnessEvent[]) })
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Conversation' })).toHaveClass('sr-only')
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument()
  })

  it('F310: running tools does not change the live text, and a chat reply finishing does not either', () => {
    useSession.setState({ running: true, derived: { ...idle(), status: 'running_tools' } })
    wrap(<TopBar narrow={false} />)
    expect(screen.getByText('Running tools')).toBeInTheDocument() // still shown
    const live = document.querySelector('header [aria-live]')!
    expect(live).toHaveClass('sr-only')
    expect(live.textContent).not.toMatch(/Running tools/)
    act(() => useSession.setState({ derived: { ...idle(), status: 'waiting_model' } }))
    expect(live.textContent).not.toMatch(/Waiting for the model/)
    act(() => useSession.setState({ running: false, derived: idle() }))
    expect(live.textContent).toBe('') // RunView says "Reply received"; a failure has its own alert (R9)
  })

  // A finished comparison or re-run: its new results arrive just before busy clears (as the store does it)
  const finished = (over: object = {}) => ({ busy: null, results: { kind: 'compare', text: 'q', profileIncluded: false,
    sides: [{ label: 'A' }, { label: 'B', ...over }] } }) as never

  it('R9: two comparisons finishing in a row are both read out as Ready', () => {
    useCompare.setState({ results: null, busy: null } as never)
    onTestFinished(() => useCompare.setState({ results: null, busy: null } as never)) // the made-up results would reach later tests
    wrap(<TopBar narrow={false} />)
    const live = document.querySelector('header [aria-live]')!
    act(() => useCompare.setState({ busy: 'compare' } as never))
    act(() => useCompare.setState(finished()))
    const first = live.textContent
    expect(first!.replace(/\u200b/g, '')).toBe('Ready')
    act(() => useCompare.setState({ busy: 'rerun' } as never))
    act(() => useCompare.setState(finished()))
    expect(live.textContent!.replace(/\u200b/g, '')).toBe('Ready')
    expect(live.textContent).not.toBe(first)
  })

  // Final review: a failed or stopped comparison, re-run or eval round is not "Ready" (its toast says what happened)
  it('a comparison or re-run that failed or was stopped is not read out as Ready', () => {
    useCompare.setState({ results: null, busy: null } as never)
    onTestFinished(() => useCompare.setState({ results: null, busy: null } as never)) // the made-up results would reach later tests
    wrap(<TopBar narrow={false} />)
    const live = document.querySelector('header [aria-live]')!
    act(() => useCompare.setState({ busy: 'compare' } as never))
    act(() => useCompare.setState({ busy: null } as never)) // failed: the results stay as they were
    expect(live.textContent).toBe('')
    act(() => useCompare.setState({ busy: 'rerun' } as never))
    act(() => useCompare.setState({ busy: null } as never))
    expect(live.textContent).toBe('')
    act(() => useCompare.setState({ busy: 'compare' } as never))
    act(() => useCompare.setState(finished({ stopped: true }))) // Stop was pressed
    expect(live.textContent).toBe('')
    act(() => useCompare.setState({ busy: 'compare' } as never))
    act(() => useCompare.setState(finished())) // and a normal finish still is
    expect(live.textContent!.replace(/\u200b/g, '')).toBe('Ready')
  })

  it('an eval round that failed or was stopped is not read out as Ready', () => {
    wrap(<TopBar narrow={false} />)
    const live = document.querySelector('header [aria-live]')!
    const said = () => live.textContent!.replace(/\u200b/g, '')
    act(() => useEvals.setState({ status: { running: true, done: 0, total: 4 } }))
    act(() => useEvals.setState({ status: { running: false, error: 'The provider could not be reached.' } }))
    expect(said()).not.toMatch(/Ready/)
    act(() => useEvals.setState({ status: { running: true, done: 0, total: 4 } }))
    act(() => useEvals.setState({ status: { running: false, result: { incomplete: true } as never } }))
    expect(said()).not.toMatch(/Ready/)
    act(() => useEvals.setState({ status: { running: true, done: 0, total: 4 } }))
    act(() => useEvals.setState({ status: { running: false, result: { passed: 4, total: 4 } as never } }))
    expect(said()).toBe('Ready')
  })

  it('F310: an eval round is announced at every quarter, not at every question', () => {
    useEvals.setState({ status: { running: true, done: 0, total: 8 } })
    wrap(<TopBar narrow={false} />)
    const live = document.querySelector('header [aria-live]')!
    const said = () => live.textContent!.replace(/\u200b/g, '')
    expect(said()).toBe('Evaluating 0/8')
    act(() => useEvals.setState({ status: { running: true, done: 1, total: 8 } }))
    expect(said()).toBe('Evaluating 0/8')
    act(() => useEvals.setState({ status: { running: true, done: 2, total: 8 } }))
    expect(said()).toBe('Evaluating 2/8')
    act(() => useEvals.setState({ status: { running: false } }))
    expect(said()).toBe('Ready')
  })

  it('F310a: the Conversations toggle says whether the list is open; the Inspector toggle is pressed or not', () => {
    wrap(<TopBar narrow={false} />)
    const conv = screen.getByRole('button', { name: 'Conversations' })
    expect(conv).toHaveAttribute('aria-expanded', 'true')
    expect(conv).toHaveAttribute('aria-controls', 'sidebar')
    fireEvent.click(conv)
    expect(conv).toHaveAttribute('aria-expanded', 'false')
    // before the first model call there is nothing to inspect: the toggle waits
    expect(screen.getByRole('button', { name: 'Inspector' })).toHaveAttribute('aria-disabled', 'true')
    act(() => usePrefs.setState({ inspectorOpen: true }))
    act(() => useSession.setState({ derived: deriveRuns(declined as HarnessEvent[]) }))
    const insp = screen.getByRole('button', { name: 'Inspector' })
    expect(insp).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(insp)
    expect(screen.getByRole('button', { name: 'Inspector' })).toHaveAttribute('aria-pressed', 'false')
    act(() => useSession.setState({ derived: deriveRuns([]) }))
  })

  it('F310b: the narrow conversations sheet has a Close button', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }))
    const { App } = await import('../../App')
    useUi.setState({ sidebarSheet: true })
    render(<App />)
    const sheet = screen.getByRole('dialog', { name: 'Conversations' })
    expect(sheet.id).toBe('sidebar')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(useUi.getState().sidebarSheet).toBe(false)
  })

  it('F310d: Help has a contents row whose links scroll within the sheet and leave the address alone', () => {
    const scrolled: string[] = []
    const was = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) }
    onTestFinished(() => { Element.prototype.scrollIntoView = was })
    useUi.setState({ helpOpen: true })
    wrap(<HelpSheet />)
    const nav = screen.getByRole('navigation', { name: 'In this help' })
    const names = within(nav).getAllByRole('link').map((a) => a.textContent)
    expect(names).toEqual(['At a glance', 'Shortcuts', 'Quiz', 'The mock', 'Glossary'])
    for (const a of within(nav).getAllByRole('link')) {
      const target = document.getElementById(a.getAttribute('href')!.slice(1))!
      expect(target).not.toBeNull()
      expect(target).toHaveClass('scroll-mt-4')
    }
    fireEvent.click(within(nav).getByRole('link', { name: 'Quiz' }))
    expect(scrolled.at(-1)).toBe('quiz')
    expect(document.getElementById('quiz')).toHaveFocus() // Tab and screen readers carry on from there
    // the glossary's group chips too (a hash change would have left the conversation)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Glossary groups' })).getAllByRole('link')[0])
    expect(scrolled.at(-1)).toMatch(/^group-/)
    expect(document.activeElement!.id).toMatch(/^group-/)
    expect(location.hash).toBe('#chat')
  })

  it('R9: a popstate to an in-page fragment (#quiz) changes nothing', async () => {
    const { App } = await import('../../App')
    const fresh = vi.spyOn(api, 'newConversation').mockResolvedValue({ ok: true } as never)
    render(<App />)
    act(() => useSession.setState({ conversation: 'abc', derived: deriveRuns(declined as HarnessEvent[]) }))
    expect(location.hash).toBe('#chat/abc')
    history.replaceState(null, '', '#quiz')
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(fresh).not.toHaveBeenCalled()
    expect(useUi.getState().screen).toBe('run')
    act(() => useUi.getState().setScreen('compare'))
    history.replaceState(null, '', '#group-Basics')
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(useUi.getState().screen).toBe('compare')
  })
})
