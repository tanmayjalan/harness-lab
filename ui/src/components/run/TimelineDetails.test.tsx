import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns, type RunModel } from '../../model/derive'
import { statusLabel } from '../../model/permission'
import { stopWords } from '../../lib/stopWords'
import { usePrefs, useUi } from '../../store/ui'
import { latestPlan, Timeline } from './Timeline'
import { callsOfRun } from '../../model/derive'
import toolTurn from '../../test/fixtures/tool_turn.json'
import trimmed from '../../test/fixtures/trimmed.json'
import helper from '../../test/fixtures/helper.json'
import plan from '../../test/fixtures/plan.json'
import answer from '../../test/fixtures/answer.json'
import outside from '../../test/fixtures/approval_outside.json'
import hooked from '../../test/fixtures/hooked.json'
import { ToolRow } from './ToolRow'

type Ev = Record<string, unknown>
const show = (events: unknown, inspected: string | null = null) => {
  const model = deriveRuns(events as HarnessEvent[])
  render(<RTooltip.Provider><Timeline model={model} inspectedCallId={inspected} live="" running={false} /></RTooltip.Provider>)
  return model
}
const text = () => document.body.textContent ?? ''

beforeEach(() => {
  useUi.setState({ selectedCallId: null, selectedToolId: null, followLatest: true })
  usePrefs.setState({ explained: [], learningMode: false, inspectHintSeen: true })
})
afterEach(() => vi.restoreAllMocks())

describe('call lines', () => {
  // F102: stepping to a call brings it into view in the chat
  it('a call picked by hand scrolls into view', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    const m = deriveRuns(toolTurn as HarnessEvent[])
    useUi.setState({ followLatest: false, selectedCallId: m.callOrder[0] })
    show(toolTurn, m.callOrder[0])
    expect(spy).toHaveBeenCalled()
  })

  // F099: every trimmed call is marked, not only the first
  it('a trimmed call says so on its line', () => {
    show(trimmed)
    expect(text()).toMatch(/trimmed \d+ results?/)
    expect(document.querySelector('svg.lucide-scissors')).not.toBeNull() // Task 8 (F330g): a lucide icon, not a typed ✂
  })

  // F203: with a low call limit, the line counts towards it
  it('shows the call limit when it is low', () => {
    show((toolTurn as Ev[]).map((e) => (e.kind === 'request' ? { ...e, max_turns: 3 } : e)))
    expect(screen.getByRole('button', { name: /^Call 1 \(max 3\)/ })).toBeInTheDocument()
  })

  // F208: the count comes from what the model asked for, not from rows that arrived so far
  it('counts the tools the reply asked for even before their rows arrive', () => {
    const events = (toolTurn as Ev[]).filter((e) => !(e.kind === 'tool_call' || e.kind === 'tool_result' || e.seq as number > 3))
    show(events)
    expect(text()).toMatch(/asked for 2 tools/) // the reply asked for two; no rows have arrived yet
  })

  // F215: with several messages, the line names its message like the Inspector does
  it('names the message once there is more than one', () => {
    show([...(answer as Ev[]), ...(toolTurn as Ev[]).map((e) => ({ ...e, seq: (e.seq as number) + 100 }))])
    expect(screen.getAllByRole('button', { name: /^Message 2 · Call 1/ }).length).toBe(1)
  })

  // F100: a one-time hint that the call line opens the Inspector
  it('hints once that a call line opens the Inspector', () => {
    usePrefs.setState({ inspectHintSeen: false })
    show(answer)
    expect(text()).toMatch(/inspect →/)
    fireEvent.click(screen.getByRole('button', { name: /^Call 1/ }))
    expect(usePrefs.getState().inspectHintSeen).toBe(true)
  })
})

describe('words', () => {
  // F103, F161: one translation of stop reasons
  it('stopWords says what a stop reason means', () => {
    expect(stopWords('tool_use', 2)).toBe('asked for 2 tools')
    expect(stopWords('end_turn', 0)).toBe('finished')
    expect(stopWords('max_tokens', 0)).toBe('hit the longest-reply limit')
  })

  // F098: a tool skipped because the reply was cut off isn't "stopped"
  it('a tool not run because the reply was cut off says so', () => {
    expect(statusLabel('not_run', 'Not run: the reply was cut off (max_tokens) before this request was complete.').label)
      .toBe('not run: reply cut off')
    expect(statusLabel('not_run').label).toBe('not run: stopped')
  })
})

describe('rows and cards', () => {
  it('the helper card uses plain words for its calls and quotes its report', () => {
    show(helper)
    expect(text()).not.toMatch(/helper call 1 · tool_use/)
    expect(text()).toMatch(/helper call 1 · asked for/)
    expect(screen.getByTestId('helper-report')).toBeInTheDocument()
  })

  // F206: text the model wrote beside its tool request is labelled as the model's
  it('labels the model\'s own words next to a tool request', () => {
    show(toolTurn)
    expect(screen.getByTitle(/text the model wrote in the same reply as its tool request/i)).toBeInTheDocument()
  })

  // F207: a failed tool previews its error
  it('a failed tool shows the start of its error when collapsed', () => {
    const events = (toolTurn as Ev[]).map((e, i, all) => {
      const firstResult = all.findIndex((x) => x.kind === 'tool_result')
      if (i !== firstResult) return e
      const r = e.result as Ev
      return { ...e, outcome: 'error', result: { ...r, is_error: true, content: 'Error: no city called Atlantis was found by the geocoding service' } }
    })
    show(events)
    expect(text()).toMatch(/Error: no city called Atlantis/)
  })

  // F212: no second "You allowed it" under the checks; the time you took instead
  it('an allowed row says how long you took, not "You allowed it" twice', () => {
    show(outside)
    fireEvent.click(screen.getAllByRole('button', { expanded: false }).find((b) => /you allowed/.test(b.textContent ?? ''))!)
    expect(text()).not.toMatch(/✓ You allowed it\./)
    expect(text()).toMatch(/You decided in \d+s/)
  })

  // F214: the footer separates time spent waiting for you
  it('the answer footer says how much of the time was waiting for you', () => {
    show((outside as Ev[]).map((e) => (e.kind === 'decision' ? { ...e, time: (e.time as number) + 41 } : e)))
    expect(text()).toMatch(/\(\d+s waiting for you\)/)
  })

  // F213: a long result is shortened like everywhere else
  it('a long tool result is shown in part, with a way to see it all', () => {
    const long = 'x'.repeat(2000)
    const events = (toolTurn as Ev[]).map((e) => (e.kind === 'tool_result' ? { ...e, result: { ...(e.result as Ev), content: long } } : e))
    show(events)
    fireEvent.click(screen.getAllByRole('button', { expanded: false }).find((b) => /get_weather/.test(b.textContent ?? ''))!)
    expect(screen.getByRole('button', { name: /Show all 2,000 characters/ })).toBeInTheDocument()
  })
})

// F205: a plan only counts if the update_plan call actually ran
describe('latestPlan', () => {
  it('ignores a plan whose tool call did not run', () => {
    const m: RunModel = deriveRuns(plan as HarnessEvent[])
    const calls = callsOfRun(m, m.runs[0])
    const rows = calls.flatMap((c) => c.toolIds.map((id) => m.tools[id])).filter((r) => r?.plan)
    const lastRow = rows[rows.length - 1]
    const before = latestPlan(m, calls)
    lastRow.status = 'hook_blocked'
    const after = latestPlan(m, calls)
    expect(after).not.toBe(before)
    expect(after).toBe(rows[rows.length - 2]?.plan ?? null)
  })
})

// F104: opening a tool row makes the chat taller; it must not then jump to the bottom
it('opening a tool row tells the chat to stay where it is', () => {
  useUi.setState({ keepScroll: false })
  show(toolTurn)
  fireEvent.click(screen.getAllByRole('button', { expanded: false }).find((b) => /get_weather/.test(b.textContent ?? ''))!)
  expect(useUi.getState().keepScroll).toBe(true)
})

// F304, F306: a long tool name or a row of badges never widens the chat
describe('tool row widths (F304, F306)', () => {
  it('a long tool name truncates instead of widening the row', () => {
    const m = deriveRuns(hooked as HarnessEvent[])
    const name = 'mcp__' + 'a'.repeat(55)
    const row = { ...m.tools.k1, name }
    render(<RTooltip.Provider><ToolRow row={row} selected={false} onSelect={() => {}} /></RTooltip.Provider>)
    const code = screen.getByText(name)
    expect(code.tagName).toBe('CODE')
    expect(code.className).toMatch(/\btruncate\b/)
    expect(code).toHaveAttribute('title', name)
    // Final review: the name doesn't shrink with the arguments (a short one was cut at 1024 px); its 40 % cap truncates
    expect(code.className).toMatch(/\bshrink-0\b/)
    expect(code.className).toMatch(/max-w-\[40%\]/)
    const cluster = screen.getByText('rewritten by your hook').closest('.ml-auto')!
    expect(cluster.className).toMatch(/\bflex-wrap\b/)
    expect(cluster.className).not.toMatch(/\bshrink-0\b/)
  })
})
