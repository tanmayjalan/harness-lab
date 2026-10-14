import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns } from '../../model/derive'
import { useSession } from '../../store/session'
import { useServer } from '../../store/server'
import { useEvals } from '../../store/evals'
import { usePrefs, useUi } from '../../store/ui'
import { RunView } from './RunView'
import { ExperimentGrid, pickExperiment } from './EmptyState'
import { findExperiment } from '../../learn/experiments'
import toolTurn from '../../test/fixtures/tool_turn.json'
import answer from '../../test/fixtures/answer.json'

const show = (events: unknown[]) => {
  useSession.setState({ derived: deriveRuns(events as HarnessEvent[]), loaded: true, running: false, conversation: 'c1' })
  return render(<RTooltip.Provider><RunView composerRef={{ current: null }} /></RTooltip.Provider>)
}
const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

beforeEach(() => {
  useUi.setState({ experimentId: 'loop', guess: null })
  usePrefs.setState({ explained: [], learningMode: false, experimentsDone: [] })
})
afterEach(() => useSession.setState({ running: false }))

describe('experiment panels', () => {
  // F011: the guess must be where the eye is, right above the message box
  it('before sending, the guess sits just above the message box', () => {
    show([])
    const guess = screen.getByTestId('experiment-guess')
    expect(guess.textContent).toMatch(/Before you send, guess/)
    expect(before(guess, screen.getByRole('textbox', { name: 'Message' }))).toBe(true)
  })

  // F105: the result is shown under the answer, where the view ends up
  it('after the run, the reveal comes after the answer', () => {
    useUi.setState({ guess: '2' })
    show(toolTurn)
    const reveal = screen.getByTestId('experiment-reveal')
    expect(reveal.textContent).toMatch(/You guessed 2; it was 3/)
    expect(reveal.textContent).toMatch(/What it showed/)
    expect(before(screen.getAllByText(/87.8 °F/).at(-1)!, reveal)).toBe(true)
    expect(screen.queryByTestId('experiment-guess')).toBeNull()
  })

  // F067: an unrelated message later on no longer carries the experiment's result under it
  it('a later, unrelated message drops the reveal from the bottom and keeps a one-line result at the top', () => {
    useUi.setState({ guess: '3' })
    show([...toolTurn, ...answer])
    expect(screen.queryByTestId('experiment-reveal')).toBeNull()
    expect(screen.getByTestId('experiment-header').textContent).toMatch(/it was 3/i)
  })

  // F156: sending the experiment's message again scores the newest run, and says which
  it('sending the message again scores the newest run and labels it', () => {
    useUi.setState({ guess: '3' })
    show([...toolTurn, ...toolTurn])
    expect(screen.getByTestId('experiment-reveal').textContent).toMatch(/Message 2:/)
  })

  // Review focus 4: picking an experiment while a reply is running must not touch the draft
  it('picking an experiment while a reply is running changes nothing', () => {
    useUi.setState({ experimentId: null, draft: { text: '', n: 7 } })
    useSession.setState({ running: true })
    pickExperiment(findExperiment('errors')!)
    expect(useUi.getState().draft.n).toBe(7)
    expect(useUi.getState().experimentId).toBeNull()
  })
})

// F004, F056: the way back stays visible above the message box, in every conversation, until used
describe('the experiment changes chip', () => {
  it('names what is still changed and offers Undo, even with no experiment open', () => {
    useUi.setState({ experimentId: null })
    usePrefs.setState({ experimentBefore: { settings: { limits: { max_tokens: 16000, max_turns: 20 } }, changes: ['longest reply set to 300 tokens'] } })
    show(toolTurn)
    const chip = screen.getByTestId('experiment-changes')
    expect(chip.textContent).toMatch(/longest reply set to 300 tokens/)
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument()
    usePrefs.setState({ experimentBefore: null })
  })
})

describe('guided path', () => {
  // F158
  it('"Try next" offers its message as a button that fills the message box', () => {
    useUi.setState({ draft: { text: '', n: 1 } })
    show(toolTurn)
    fireEvent.click(screen.getByRole('button', { name: /Weather in Paris and Tokyo\?/ }))
    expect(useUi.getState().draft.text).toBe('Weather in Paris and Tokyo?')
  })

  // F372: Try next must not silently throw away what you typed
  it('Try next asks before replacing typed text', () => {
    useUi.setState({ draft: { text: '', n: 1 }, toasts: [] })
    show(toolTurn)
    act(() => useUi.setState({ composerText: 'my own question' })) // (the box reports its text when it mounts)
    fireEvent.click(screen.getByRole('button', { name: /Weather in Paris and Tokyo\?/ }))
    expect(useUi.getState().draft.text).toBe('')
    const t = useUi.getState().toasts.at(-1)!
    expect(t.title).toMatch(/Replace what you typed/)
    act(() => t.action!.run())
    expect(useUi.getState().draft.text).toBe('Weather in Paris and Tokyo?')
    expect(useUi.getState().experimentId).toBe('loop') // (fill only: no experiment started)
    useUi.setState({ composerText: '', toasts: [] })
  })

  it("the Replace toast's button gets focus", async () => {
    const { Toaster } = await import('../shell/Toaster')
    useUi.setState({ experimentId: null, composerText: 'my own question', toasts: [] })
    render(<RTooltip.Provider><Toaster /></RTooltip.Provider>)
    const box = document.createElement('textarea')
    document.body.append(box)
    box.focus()
    pickExperiment(findExperiment('errors')!)
    const button = await screen.findByRole('button', { name: 'Replace' })
    await waitFor(() => expect(button).toHaveFocus())
    box.remove()
    useUi.setState({ composerText: '', toasts: [] })
  })

  // F159
  it('done ticks say what they mean, and each tier counts what is done', () => {
    usePrefs.setState({ experimentsDone: ['loop'] })
    render(<RTooltip.Provider><ExperimentGrid onPick={() => {}} disabled={false} /></RTooltip.Provider>)
    expect(screen.getByTitle('You ran this')).toBeInTheDocument()
    expect(screen.getByText(/1 of 5 done/)).toBeInTheDocument() // The loop: five experiments, with A busy service
  })

  it('progress can be reset', () => {
    usePrefs.setState({ experimentsDone: ['loop', 'errors'] })
    usePrefs.getState().resetExperimentsDone()
    expect(usePrefs.getState().experimentsDone).toEqual([])
  })
})

// F145: picking a card doesn't throw away what you typed
describe('picking with text in the box', () => {
  it('asks before replacing what you typed', () => {
    useUi.setState({ experimentId: null, draft: { text: '', n: 3 }, composerText: 'my own question', toasts: [] })
    pickExperiment(findExperiment('errors')!)
    expect(useUi.getState().draft.n).toBe(3)
    const t = useUi.getState().toasts.at(-1)!
    expect(t.title).toMatch(/Replace what you typed/)
    t.action!.run()
    expect(useUi.getState().draft.text).toBe('Read missing.txt')
    expect(useUi.getState().experimentId).toBe('errors')
    useUi.setState({ composerText: '' })
  })
})

// F022: a side of a comparison, opened as a conversation, says so and leads back
describe('a conversation opened from Compare', () => {
  it('says which side it was and goes back to Compare', () => {
    useUi.setState({ experimentId: null, screen: 'run' })
    useSession.setState({ origin: { comparison: 'cmp1', side: 'B' } })
    show(toolTurn)
    expect(screen.getByText(/Side B of a comparison/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Back to Compare/ }))
    expect(useUi.getState().screen).toBe('compare')
    useSession.setState({ origin: null })
  })

  // F267: the new run of a re-run says what it was, not "Side Current settings of a comparison"
  it('the new run of a re-run says so and goes back to it', () => {
    useUi.setState({ experimentId: null, screen: 'run' })
    useSession.setState({ origin: { comparison: 'rr1', side: 'Current settings', kind: 'rerun' } })
    show(toolTurn)
    expect(screen.getByText(/The re-run with your current settings, opened so you can inspect every call/)).toBeInTheDocument()
    expect(screen.queryByText(/Side Current settings/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Back to Compare/ }))
    expect(useUi.getState().screen).toBe('compare')
    useSession.setState({ origin: null })
  })
})

// F273, F274: "From your next conversation" changes what the caching lesson's "Try next" can do, and the
// "kept from the start" note shows only while that mode is on
describe('a conversation that keeps its start', () => {
  afterEach(() => { useSession.setState({ frozen: false }); useServer.setState({ settings: null }) })

  it('says what it keeps, and stops saying so once the mode is switched back', () => {
    useUi.setState({ experimentId: null, screen: 'run' })
    useSession.setState({ frozen: true })
    useServer.setState({ settings: { apply: 'conversation' } as never })
    const view = show(toolTurn)
    expect(screen.getByText(/keeps the prompt, the tool descriptions and the facts about you it began with/)).toBeInTheDocument()
    view.unmount()
    useServer.setState({ settings: { apply: 'message' } as never })
    show(toolTurn)
    expect(screen.queryByText(/keeps the prompt, the tool descriptions and the facts about you/)).toBeNull()
  })

  it('the caching lesson tells you to start a new conversation after editing the prompt', () => {
    useUi.setState({ experimentId: 'cache', guess: null })
    useServer.setState({ settings: { apply: 'conversation' } as never })
    const message = findExperiment('cache')!.message // the reveal is for the run of the experiment's own message
    show((toolTurn as { kind: string; text?: string }[]).map((e) => (e.kind === 'user' ? { ...e, text: message } : e)))
    expect(screen.getByTestId('experiment-reveal').textContent).toMatch(/start a new conversation/)
  })
})

// Deferred M2: nothing happens before you agree, and nothing happens during a reply
describe('Replace asks first, and checks again', () => {
  it('Replace pressed while a reply runs changes nothing', () => {
    useUi.setState({ experimentId: null, draft: { text: '', n: 3 }, composerText: 'my own question', toasts: [] })
    pickExperiment(findExperiment('errors')!)
    const replace = useUi.getState().toasts.at(-1)!.action!
    useSession.setState({ running: true })
    replace.run()
    expect(useUi.getState().draft.n).toBe(3)
    expect(useUi.getState().toasts.at(-1)!.title).toMatch(/Wait for the reply to finish/)
    useSession.setState({ running: false })
    useUi.setState({ composerText: '' })
  })

  it('from the Experiments dialog, no new conversation starts until you agree', async () => {
    const { api } = await import('../../api/client')
    const { askThenPick } = await import('./EmptyState')
    const fresh = vi.spyOn(api, 'newConversation').mockResolvedValue({ ok: true })
    useUi.setState({ experimentId: null, draft: { text: '', n: 3 }, composerText: 'my own question', toasts: [] })
    const before = vi.fn(async () => { await api.newConversation() })
    await askThenPick(findExperiment('errors')!, before)
    expect(fresh).not.toHaveBeenCalled()
    await act(async () => { await useUi.getState().toasts.at(-1)!.action!.run() })
    expect(fresh).toHaveBeenCalledTimes(1)
    expect(useUi.getState().experimentId).toBe('errors')
    useUi.setState({ composerText: '' })
    fresh.mockRestore()
  })
})

// F349h: an eval run, opened with Inspect, says so and leads back to its round
describe('a conversation opened from Evals', () => {
  it('an eval conversation shows Back to Evals and opens its round', async () => {
    const view = vi.spyOn(useEvals.getState(), 'view').mockResolvedValue()
    useUi.setState({ experimentId: null, screen: 'run' })
    useSession.setState({ origin: { kind: 'eval', round: '20261007-101010-001', question: 'What is 2+2?', attempt: 2 } })
    show(toolTurn)
    expect(screen.getByText(/Run 2 of the eval question “What is 2\+2\?”, opened so you can inspect every call/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Back to Evals/ }))
    expect(useUi.getState().screen).toBe('evals')
    expect(view).toHaveBeenCalledWith('20261007-101010-001')
    // Live check (Task 10): the button is gone once Evals shows, so focus must go to the round's result
    await waitFor(() => expect(useEvals.getState().focusResults).toBe(true))
    useEvals.setState({ focusResults: false })
    useSession.setState({ origin: null })
    view.mockRestore()
  })
})

// Third pass, Task 9 (F373): the greyed-out Undo says when it comes back
describe('the experiment changes chip while a reply runs (F373)', () => {
  it('says in words why Undo is greyed out', () => {
    usePrefs.setState({ experimentBefore: { settings: { limits: { max_tokens: 16000, max_turns: 20 } }, changes: ['longest reply set to 300 tokens'] } })
    show(toolTurn)
    act(() => useSession.setState({ running: true }))
    expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled()
    expect(screen.getByTestId('experiment-changes').textContent).toMatch(/Available when the reply finishes/)
    usePrefs.setState({ experimentBefore: null })
  })
})
