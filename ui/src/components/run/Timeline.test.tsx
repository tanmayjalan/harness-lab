import { describe, expect, it, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns } from '../../model/derive'
import { usePrefs, useUi } from '../../store/ui'
import { Timeline } from './Timeline'
import { CONCEPTS } from '../../learn/concepts'
import { RunView } from './RunView'
import { Announcer } from '../shell/Announcer'
import { ToolRow } from './ToolRow'
import { HelperCard } from './HelperCard'
import { useSession } from '../../store/session'
import { useServer } from '../../store/server'
import providerSwitch from '../../test/fixtures/provider_switch.json'
import toolTurn from '../../test/fixtures/tool_turn.json'
import stopped from '../../test/fixtures/stopped.json'
import blocked from '../../test/fixtures/blocked.json'
import declined from '../../test/fixtures/approval_declined.json'
import answer from '../../test/fixtures/answer.json'
import outside from '../../test/fixtures/approval_outside.json'
import compacted from '../../test/fixtures/compacted.json'
import failed from '../../test/fixtures/error.json'

const show = (events: unknown) => {
  const model = deriveRuns(events as HarnessEvent[])
  render(<RTooltip.Provider><Timeline model={model} inspectedCallId={null} live="" running={false} /></RTooltip.Provider>)
  return model
}

beforeEach(() => {
  useUi.setState({ selectedCallId: null, selectedToolId: null, followLatest: true })
  usePrefs.setState({ explained: [], learningMode: false })
})

describe('Timeline', () => {
  it('shows each call once as a divider, and each tool once', () => {
    show(toolTurn)
    expect(screen.getAllByRole('button', { name: /^Call \d/ })).toHaveLength(3)
    expect(screen.getAllByText('get_weather')).toHaveLength(1)
    expect(screen.getByText(/87.8 °F/)).toBeInTheDocument()
  })

  it('clicking a call or a tool selects it for the Inspector', () => {
    const m = show(toolTurn)
    fireEvent.click(screen.getByRole('button', { name: /^Call 2/ }))
    expect(useUi.getState().selectedCallId).toBe(m.callOrder[1])
    expect(useUi.getState().followLatest).toBe(false)
    fireEvent.click(screen.getByText('convert_temperature'))
    expect(useUi.getState().selectedToolId).toBe('t3')
  })

  it('explains an idea only at its first appearance', () => {
    show(toolTurn)
    // two calls ask for tools, but the explanation appears once (waiting as an ⓘ behind the loop's, which is open)
    expect(screen.getAllByRole('button', { name: `New, not read yet: what does "${CONCEPTS.tool_use.term}" mean?` })).toHaveLength(1)
  })

  it('says which tools were not run when stopped, and why things were blocked', () => {
    show(stopped)
    expect(screen.getAllByText('not run: stopped')).toHaveLength(2)
    expect(screen.getByText(/Stopped. The conversation so far is kept/)).toBeInTheDocument()
  })

  // F097: the sentence at the top of an opened row must match what actually happened
  it('an opened row says the harness ran the tool only when it did', () => {
    show(toolTurn)
    fireEvent.click(screen.getByText('get_weather'))
    expect(screen.getByText(/the harness ran it here/)).toBeInTheDocument()
  })

  it('an opened declined row says you declined it, not that it ran', () => {
    show(declined)
    fireEvent.click(screen.getByText('write_file'))
    expect(screen.queryByText(/the harness ran it here/)).toBeNull()
    expect(screen.getByText(/The model asked for/).textContent).toMatch(/you declined it/)
  })

  it('an opened blocked row says the harness refused it', () => {
    show(blocked)
    for (const b of screen.getAllByRole('button', { expanded: false })) if (/blocked by/.test(b.textContent ?? '')) fireEvent.click(b)
    expect(screen.queryByText(/the harness ran it here/)).toBeNull()
    expect(screen.getAllByText(/the harness refused it/).length).toBeGreaterThanOrEqual(2)
  })

  it('tells a hook block from a settings block', () => {
    show(blocked)
    expect(screen.getByText('blocked by your hook')).toBeInTheDocument()
    expect(screen.getByText('blocked by your settings')).toBeInTheDocument()
  })

  // F037: pressing Stop during the only call leaves a note, not a silent "finished"
  it('a stop pressed during a call that then finished says so', () => {
    const events = [...(answer as Array<Record<string, unknown>>)]
    events.splice(2, 0, { seq: 99, kind: 'stopping', time: 1, msg: 1 })
    show(events)
    expect(screen.getByText(/You pressed Stop during call 1/)).toBeInTheDocument()
  })

  // F198: a failed summary is not "skipped"
  it('a failed summary says the full history was sent', () => {
    const events = (compacted as Array<Record<string, unknown>>).map((e) =>
      e.kind === 'compacted' ? { seq: e.seq, kind: 'compacted', time: e.time, msg: e.msg, failed: 'RuntimeError: boom' } : e)
    show(events)
    expect(screen.getByText(/Summarising failed, so the full history was sent this time/)).toBeInTheDocument()
  })

  // "messages" there are entries in the messages list, not your messages
  it('a summary counts the messages list in entries', () => {
    show(compacted)
    expect(document.body.textContent).toMatch(/\(5 → 1 entries in the messages list\)/)
  })

  // F199: a cut-off reply gets a note from the harness, not a marker inside the model's words
  it('a cut-off answer is noted outside the answer', () => {
    const events = (answer as Array<Record<string, unknown>>).map((e) =>
      e.kind === 'answer' ? { ...e, text: 'Once upon a time\n[stopped early: max_tokens]' } : e)
    show(events)
    expect(screen.queryByText(/\[stopped early/)).toBeNull()
    expect(screen.getByText(/Cut off: the reply reached the longest-reply limit/)).toBeInTheDocument()
  })

  // F240: the call limit arrives in plain words, with the raw error as detail; the note still recognises it
  it('a message stopped by the call limit gets its note, not "Something went wrong"', () => {
    const events = (answer as Array<Record<string, unknown>>).filter((e) => e.kind !== 'answer' && e.kind !== 'done')
    show([...events, { seq: 90, kind: 'error', time: 2, msg: 1, message: 'Stopped after 2 model calls: the most allowed for one message.',
      detail: 'RuntimeError: Stopped: hit max_turns (2)' }, { seq: 91, kind: 'done', time: 2, msg: 1 }])
    expect(screen.getByText(/this message reached the limit of 2 model calls/)).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong/)).toBeNull()
  })

  // F143: a row you allowed says so when collapsed, like a declined one does
  it('a collapsed row you allowed says so', () => {
    show(outside)
    expect(screen.getByText(/^you allowed · /)).toBeInTheDocument()
  })
})

// F304, F320, F326: nothing in the chat pushes it wider than the column
describe('widths (F304, F320, F326)', () => {
  it('the call pill can wrap', () => {
    show(toolTurn)
    const row = screen.getAllByRole('button', { name: /^Call 1/ })[0].querySelector('b')!.parentElement!
    expect(row.className).toMatch(/\bflex-wrap\b/)
    const pill = row.parentElement!.parentElement!
    expect(pill.className).toMatch(/\bmin-w-0\b/)
    expect(pill.className).toMatch(/\bborder\b/)
    expect(pill.className).not.toMatch(/\bshrink-0\b/)
  })

  // F320 in the pill: once it wraps, no line may start with "·"
  it("the call pill's separators are drawn by CSS, not typed", () => {
    show(toolTurn)
    const b = screen.getAllByRole('button', { name: /^Call 2/ })[0].querySelector('b')!
    const row = b.parentElement!
    const items = [...row.children]
    expect(items.length).toBeGreaterThan(2)
    for (const el of items) {
      expect(el.textContent).not.toMatch(/^\s*·/)
      expect(el.className).toContain("before:content-['·']")
    }
    // the first item's dot is pushed past a clipped edge that sits inside the pill's padding
    expect(row.className).toMatch(/-ml-3/)
    expect(row.parentElement!.className).toMatch(/\boverflow-hidden\b/)
    expect(row.parentElement!.parentElement!.className).toMatch(/\bpx-2\b/)
  })

  it("the footer's separators are drawn by CSS, not typed", () => {
    show(answer)
    const callCount = screen.getAllByText(/^·? ?\d+ calls?$/).find((s) => s.closest('.text-muted'))!
    const footer = callCount.parentElement!
    const spans = [...footer.querySelectorAll(':scope > span')]
    expect(spans.length).toBeGreaterThan(1)
    for (const s of spans) {
      expect(s.textContent).not.toMatch(/^\s*·/)
      expect(s.className).toContain("before:content-['·']")
    }
    // the dot in front of the first item on each line is pushed past the clipped edge
    expect(footer.className).toMatch(/-ml-3/)
    expect(footer.parentElement!.className).toMatch(/\boverflow-hidden\b/)
  })

  it('a long word in your message or an error breaks instead of widening the column', () => {
    show(failed)
    expect(document.querySelector('.rounded-br-md')!.className).toMatch(/\bbreak-words\b/)
    const box = screen.getByText('The model call failed.').closest('.border')!
    const inner = box.querySelector(':scope > div')!
    expect(inner.className).toMatch(/\bmin-w-0\b/)
    expect(inner.className).toMatch(/\bbreak-words\b/)
  })
})

// ---- Third pass, Task 9: who said what, calmer live regions, the current call (F321 to F325, F326b) ----
describe('timeline accessibility (F321 F322 F323 F324 F325 F326b)', () => {
  const tl = (events: unknown, running = false, extra: Partial<React.ComponentProps<typeof Timeline>> = {}) =>
    <RTooltip.Provider><Timeline model={deriveRuns(events as HarnessEvent[])} inspectedCallId={null} live="" running={running} {...extra} /></RTooltip.Provider>

  it('F321: your message and the answer each say who wrote them', () => {
    show(answer)
    const you = screen.getByText('You:')
    expect(you).toHaveClass('sr-only')
    expect(you.parentElement!.className).toMatch(/rounded-br-md/)
    // nothing visible before the text: the bubble keeps white space, so a stray space would indent it
    const visible = [...you.parentElement!.childNodes].filter((n) => n !== you)
    expect(visible[0].textContent).toMatch(/^\S/)
    // F433: and it is a heading, so a screen reader can jump from reply to reply
    const model = screen.getByRole('heading', { name: "The model's reply" })
    expect(model).toHaveClass('sr-only')
    expect(model.closest('.rounded-bl-md')).not.toBeNull()
  })

  it('F322: an old failure is not an alert; one that fails while you watch is', () => {
    const first = render(tl(failed))
    expect(screen.queryByRole('alert')).toBeNull()
    first.unmount()
    const events = failed as unknown[]
    const view = render(tl(events.slice(0, 2), true))
    view.rerender(tl(events, false))
    expect(screen.getByRole('alert')).toHaveTextContent(/The model call failed/)
  })

  it('F323: a switch note reads out only its sentence, not the explanation under it', () => {
    show(providerSwitch)
    const status = screen.getAllByRole('status').find((s) => /Switched to/.test(s.textContent ?? ''))!
    expect(status).toBeDefined()
    expect(status.querySelector('button')).toBeNull() // the explanation (and its close) sits outside
    expect(status.textContent).not.toMatch(/Got it/)
  })

  it('F323: a running tool row has a quiet spinner (its words already say running)', () => {
    const m = deriveRuns(toolTurn as HarnessEvent[])
    const row = { ...Object.values(m.tools)[0], status: 'running' as const, result: undefined }
    render(<RTooltip.Provider><ToolRow row={row} selected={false} onSelect={() => {}} /></RTooltip.Provider>)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('F323: a running helper card adds no second "working"', () => {
    const helper = { task: 'Look it up', running: true, calls: [], tools: [], tokens: { read: 0, wrote: 0 }, cost: 0 } as unknown as Parameters<typeof HelperCard>[0]['helper']
    render(<HelperCard helper={helper} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('F324: a reply that arrives while you watch is announced with its number of calls', () => {
    useServer.setState({ info: null })
    useUi.setState({ approvalDock: null })
    const events = answer as unknown[]
    useSession.setState({ conversation: 'c1', derived: deriveRuns(events.slice(0, 2) as HarnessEvent[]), loaded: true, running: true, origin: null, frozen: false })
    useUi.setState({ spoken: { text: '', n: 0 } })
    render(<RTooltip.Provider><RunView composerRef={{ current: null }} /><Announcer /></RTooltip.Provider>)
    act(() => useSession.setState({ derived: deriveRuns(events as HarnessEvent[]), running: false }))
    expect(screen.getByText(/^Reply received \(1 call\)/)).toBeInTheDocument()
  })

  it('F324: opening a conversation that already has answers says nothing', () => {
    useServer.setState({ info: null })
    useSession.setState({ conversation: 'c2', derived: deriveRuns(answer as HarnessEvent[]), loaded: true, running: false, origin: null, frozen: false })
    render(<RTooltip.Provider><RunView composerRef={{ current: null }} /></RTooltip.Provider>)
    expect(screen.queryByText(/Reply received/)).toBeNull()
  })

  it('F325: the call being inspected and the selected tool row are marked current, not pressed', () => {
    const m = deriveRuns(toolTurn as HarnessEvent[])
    const tool = Object.values(m.tools)[0]
    useUi.setState({ selectedToolId: tool.id })
    render(<RTooltip.Provider><Timeline model={m} inspectedCallId={m.callOrder[1]} live="" running={false} /></RTooltip.Provider>)
    const call2 = screen.getByRole('button', { name: /^Call 2/ })
    expect(call2).toHaveAttribute('aria-current', 'true')
    expect(call2).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: /^Call 1/ })).not.toHaveAttribute('aria-current')
    const rows = screen.getAllByRole('button', { expanded: false }).filter((b) => b.getAttribute('aria-describedby')?.startsWith('row-help-'))
    expect(rows.filter((b) => b.getAttribute('aria-current') === 'true')).toHaveLength(1)
  })

  it('only one explanation is in full at a time; closing it opens the next one waiting', () => {
    show(toolTurn)
    expect(screen.getAllByRole('button', { name: 'Got it, shorten this next time' })).toHaveLength(1)
    expect(screen.getByText(CONCEPTS.loop.long[0])).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Got it, shorten this next time' }))
    expect(usePrefs.getState().explained).toContain('loop')
    expect(screen.getAllByRole('button', { name: 'Got it, shorten this next time' })).toHaveLength(1)
    expect(screen.queryByText(CONCEPTS.loop.long[0])).toBeNull()
  })

  // F406: a tool row opens it too, on its Tools tab (the first experiment says "click a tool row, then Inspector → Tools")
  it('the Inspector starts closed and opens when you pick a call or a tool row', () => {
    usePrefs.setState({ inspectorOpen: false })
    show(toolTurn)
    fireEvent.click(screen.getByRole('button', { name: /^Call 1/ }))
    expect(usePrefs.getState().inspectorOpen).toBe(true)
    usePrefs.setState({ inspectorOpen: false, inspectorTab: 'summary' })
    fireEvent.click(screen.getByText('get_weather'))
    expect(usePrefs.getState()).toMatchObject({ inspectorOpen: true, inspectorTab: 'tools' })
  })

  it('in learning mode every explanation stays in full', () => {
    usePrefs.setState({ learningMode: true })
    show(toolTurn)
    expect(screen.getAllByText(CONCEPTS.loop.long[0])).toHaveLength(1)
    expect(screen.getByText(CONCEPTS.tool_use.long[0])).toBeInTheDocument()
  })
})
