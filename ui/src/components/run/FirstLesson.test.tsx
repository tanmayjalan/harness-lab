// The first lesson, from the 2026-10-15 persona review (section 4.4): opening the page, following
// the first experiment, and moving on to the next one
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns } from '../../model/derive'
import { useSession } from '../../store/session'
import { usePrefs, useUi } from '../../store/ui'
import { RunView } from './RunView'
import { api } from '../../api/client'
import { openConversation } from '../../store/selectors'
import toolTurn from '../../test/fixtures/tool_turn.json'
import answer from '../../test/fixtures/answer.json'
import { EXPERIMENTS, experimentDone, findExperiment, nextExperiment } from '../../learn/experiments'
import { GROUPS } from '../../learn/concepts'
import { QUIZ } from '../../learn/quiz'
import { askThenPick, EmptyState } from './EmptyState'
import { useServer } from '../../store/server'
import type { Settings, SettingsChange } from '../../api/types'
import { HelpSheet } from '../shell/HelpSheet'

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

const show = (events: unknown[]) => {
  useSession.setState({ derived: deriveRuns(events as HarnessEvent[]), loaded: true, running: false, conversation: 'c1' })
  return render(<RunView composerRef={{ current: null }} />)
}

describe('F406: a tool row opens the Inspector, and where to look stays after the run', () => {
  beforeEach(() => {
    usePrefs.setState({ inspectorOpen: false, inspectorTab: 'summary', inspectHintSeen: false })
    useUi.setState({ selectedCallId: null, selectedToolId: null })
  })

  it('clicking a tool row opens Inspector → Tools on that tool', () => {
    show(toolTurn)
    const row = screen.getAllByRole('button', { expanded: false }).find((b) => b.textContent?.includes('get_weather'))!
    fireEvent.click(row)
    const call = useSession.getState().derived.callOrder[0]
    expect(usePrefs.getState()).toMatchObject({ inspectorOpen: true, inspectorTab: 'tools', inspectHintSeen: true })
    expect(useUi.getState().selectedCallId).toBe(call)
    expect(useUi.getState().selectedToolId).toBe(useSession.getState().derived.calls[call].toolIds[0])
  })

  it("after the run, the reveal keeps the experiment's 'Look at' line, with a button to the right tab", () => {
    useUi.setState({ experimentId: 'loop' })
    show(toolTurn)
    const reveal = screen.getByTestId('experiment-reveal')
    expect(reveal.textContent).toMatch(/Look at:.*Click a tool row/)
    fireEvent.click(screen.getByRole('button', { name: 'Open Inspector → Tools' }))
    expect(usePrefs.getState()).toMatchObject({ inspectorOpen: true, inspectorTab: 'tools' })
    const m = useSession.getState().derived
    expect(m.calls[useUi.getState().selectedCallId!].toolIds[0]).toBe(useUi.getState().selectedToolId)
  })

  it('an experiment that points at another tab opens that one, on the last call', () => {
    useUi.setState({ experimentId: 'growth' })
    const events = (toolTurn as { kind: string }[]).map((e) => e.kind === 'user' ? { ...e, text: findExperiment('growth')!.message } : e)
    show(events)
    fireEvent.click(screen.getByRole('button', { name: 'Open Inspector → Summary' }))
    expect(usePrefs.getState().inspectorTab).toBe('summary')
    expect(useUi.getState().selectedCallId).toBe(useSession.getState().derived.callOrder.at(-1))
  })
})

describe('F407: from a finished experiment to the next one', () => {
  it('the reveal ends with the next experiment not done yet', () => {
    useUi.setState({ experimentId: 'loop' })
    show(toolTurn)
    // Watch the loop is not marked done yet when the reveal first draws: it is left out all the same
    expect(screen.getByTestId('experiment-next').textContent).toMatch(/^Next: Errors are answers too/)
  })

  it('skips the ones already done, and shows nothing once all are done', () => {
    usePrefs.setState({ experimentsDone: ['errors', 'busy'] })
    expect(nextExperiment(['errors', 'busy'], 'loop', 'mock')?.id).toBe('cutoff')
    usePrefs.setState({ experimentsDone: EXPERIMENTS.map((x) => x.id) })
    useUi.setState({ experimentId: 'loop' })
    show(toolTurn)
    expect(screen.getByTestId('experiment-reveal')).toBeInTheDocument()
    expect(screen.queryByTestId('experiment-next')).toBeNull()
  })

  it("skips one the provider in use can't show", () => {
    const done = EXPERIMENTS.filter((x) => x.id !== 'cache' && x.id !== 'mcp').map((x) => x.id)
    expect(nextExperiment(done, null, 'mock')?.id).toBe('mcp') // (caching needs the Anthropic API)
  })
})

describe('F408: experiments and the quiz follow the tiers', () => {
  it('the list is tier by tier', () => {
    const tiers = EXPERIMENTS.map((x) => GROUPS.indexOf(x.tier))
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b))
    expect(EXPERIMENTS[0].id).toBe('loop')
  })

  it("the welcome page's next three stay in the first tier while it has some left", () => {
    usePrefs.setState({ experimentsDone: ['loop'] })
    render(<EmptyState disabled={false} />)
    const cards = screen.getAllByRole('button').filter((b) => b.textContent?.includes('Idea:'))
    expect(cards.map((c) => EXPERIMENTS.find((x) => c.textContent!.includes(x.title))!.id)).toEqual(['errors', 'busy', 'cutoff'])
  })

  it('the quiz groups come in the same order', () => {
    useUi.setState({ helpOpen: true })
    render(<HelpSheet />)
    const heads = [...document.querySelectorAll('h4')].map((h) => h.textContent!.replace('after: ', '')).filter((t) => QUIZ.some((q) => q.after === t))
    const place = (t: string) => { const i = EXPERIMENTS.findIndex((x) => x.title === t); return i < 0 ? Infinity : i }
    expect(heads.length).toBeGreaterThan(5)
    expect(heads.map(place)).toEqual(heads.map(place).sort((a, b) => a - b))
    expect(heads.indexOf('A busy service')).toBeLessThan(heads.indexOf('Ask before acting'))
  })
})

describe('F410: Runaway task counts as done when it stops at the call limit', () => {
  // the message stopped by the limit, as the server sends it: an error in plain words, the raw one as detail
  const stoppedAt = (text: string, detail: string) => [
    ...(answer as Array<Record<string, unknown>>).filter((e) => e.kind !== 'answer' && e.kind !== 'done')
      .map((e) => e.kind === 'user' ? { ...e, text } : e),
    { seq: 90, kind: 'error', time: 2, msg: 1, message: 'Stopped after 2 model calls: the most allowed for one message.', detail },
    { seq: 91, kind: 'done', time: 2, msg: 1 },
  ]
  const runaway = findExperiment('runaway')!

  it('the stop at the limit marks it done', () => {
    useUi.setState({ experimentId: 'runaway' })
    show(stoppedAt(runaway.message, 'RuntimeError: Stopped: hit max_turns (2)'))
    expect(usePrefs.getState().experimentsDone).toContain('runaway')
  })

  it('any other failure still does not count, and the limit stop counts only for Runaway', () => {
    const failed = deriveRuns(stoppedAt(runaway.message, 'RuntimeError: something else') as HarnessEvent[]).runs[0]
    expect(experimentDone(runaway, failed, 'mock')).toBe(false)
    const cutoff = findExperiment('cutoff')!
    const limited = deriveRuns(stoppedAt(cutoff.message, 'RuntimeError: Stopped: hit max_turns (2)') as HarnessEvent[]).runs[0]
    expect(experimentDone(cutoff, limited, 'mock')).toBe(false)
  })
})

describe('F411: the experiment you were following survives a reload', () => {
  const stored = () => JSON.parse(sessionStorage.getItem('harness-lab-experiment') ?? '{}').state
  // a reload: the tab's saved copy is read back into a page that starts with nothing
  const reload = async (saved: object) => {
    useUi.setState({ experimentId: null, guess: null, experimentConversation: null, composerText: '' }) // (this saves too: first)
    sessionStorage.setItem('harness-lab-experiment', JSON.stringify({ state: saved, version: 0 }))
    await useUi.persist.rehydrate()
  }
  afterEach(() => sessionStorage.clear())

  it('the experiment and your guess are kept in this tab, and come back', async () => {
    useUi.getState().setExperiment('approval')
    useUi.getState().setGuess('2')
    expect(stored()).toEqual({ experimentId: 'approval', guess: '2', experimentConversation: null })
    await reload({ experimentId: 'approval', guess: '2', experimentConversation: 'c1' })
    expect(useUi.getState()).toMatchObject({ experimentId: 'approval', guess: '2', experimentConversation: 'c1' })
  })

  it('once its message is sent, the experiment belongs to that conversation', () => {
    useUi.setState({ experimentId: 'loop', experimentConversation: null })
    show(toolTurn)
    expect(useUi.getState().experimentConversation).toBe('c1')
  })

  it("reopening the experiment's own conversation (the reload opens the one in the address) keeps it; another drops it", async () => {
    vi.spyOn(api, 'openConversation').mockResolvedValue({ current: 'c1', items: [] })
    useUi.setState({ experimentId: 'loop', guess: '3', experimentConversation: 'c1' })
    await openConversation('c1')
    expect(useUi.getState()).toMatchObject({ experimentId: 'loop', guess: '3' })
    await openConversation('c2')
    expect(useUi.getState().experimentId).toBeNull()
  })

  it('an experiment not sent yet puts its message back in the empty message box', async () => {
    await reload({ experimentId: 'approval', guess: null, experimentConversation: null })
    show([])
    expect(useUi.getState().draft.text).toBe(findExperiment('approval')!.message)
  })
})

describe('F412: a new experiment starts from your settings, not on top of the last one', () => {
  const base = {
    system: 'S', system_default: 'S', changed: [], file: 'f', mcp_problems: [], hooks: { file: '', functions: [], problem: null },
    trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
    thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
    limits: { max_tokens: 16000, max_turns: 20 },
    tools: [{ name: 'write_file', description: 'Write.', default_description: 'Write.', permission: 'allow',
      default_permission: 'ask', input_schema: {}, source: 'built in' }],
  } as unknown as Settings

  it("Runaway's 2-call limit is put back before Ask before acting sets up", async () => {
    let current = base
    const saved: SettingsChange[] = []
    vi.spyOn(api, 'saveSettings').mockImplementation(async (change: SettingsChange) => {
      saved.push(change)
      const { permissions, ...rest } = change
      current = { ...current, ...(rest as Partial<Settings>),
        tools: current.tools.map((t) => ({ ...t, permission: permissions?.[t.name] ?? t.permission })) }
      return current
    })
    useServer.setState({ settings: base })
    useUi.setState({ toasts: [], composerText: '' })
    usePrefs.setState({ experimentBefore: null })
    await askThenPick(findExperiment('runaway')!)
    expect(useServer.getState().settings!.limits.max_turns).toBe(2)

    await askThenPick(findExperiment('approval')!)
    expect(saved).toEqual([
      { limits: { max_tokens: 16000, max_turns: 2 } }, // Runaway
      { limits: { max_tokens: 16000, max_turns: 20 } }, // put back
      { permissions: { write_file: 'ask' } }, // Ask before acting
    ])
    expect(useServer.getState().settings!.limits.max_turns).toBe(20)
    expect(usePrefs.getState().experimentBefore?.changes).toEqual(['write_file set to Ask first'])
    const note = useUi.getState().toasts.at(-1)!
    expect(note.title).toMatch(/Ask before acting/)
    expect(note.body).toMatch(/First put back what the last experiment changed \(at most 2 calls per message\)/)
    vi.restoreAllMocks()
  })
})
