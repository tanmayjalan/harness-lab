import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent, Settings } from '../../api/types'
import { api } from '../../api/client'
import { deriveRuns } from '../../model/derive'
import { callTiming } from '../../model/inspector'
import { describeChange, onlyChanges, previousOf } from '../../learn/setup'
import { findExperiment } from '../../learn/experiments'
import { QUIZ } from '../../learn/quiz'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { usePrefs, useUi } from '../../store/ui'
import { Inspector } from '../inspector/Inspector'
import { LimitsSection } from '../settings/ModelSection'
import { changedIn, sectionOf, settingsAsChange } from '../settings/common'
import { Timeline } from './Timeline'
import { HelperCard } from './HelperCard'
import { PRESETS, useCompare } from '../../store/compare'
import retry from '../../test/fixtures/retry.json'
import helper from '../../test/fixtures/helper.json'
import toolTurn from '../../test/fixtures/tool_turn.json'

const model = () => deriveRuns(retry as HarnessEvent[])
const settings = {
  system: 'S', system_default: 'S', changed: [], file: 'f', mcp_problems: [], hooks: { file: '', functions: [], problem: null },
  trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
  limits: { max_tokens: 16000, max_turns: 20 }, faults: { busy: false }, tools: [],
} as unknown as Settings

beforeEach(() => {
  usePrefs.setState({ explained: [], learningMode: false, inspectorTab: 'summary', inspectorWidth: 520 })
  useUi.setState({ followLatest: true, selectedCallId: null, toasts: [] })
  useServer.setState({ settings })
})
afterEach(() => vi.restoreAllMocks())

describe('a retried call', () => {
  it('keeps each retry with its call', () => {
    const m = model()
    const call = m.calls[m.callOrder[0]]
    expect(call.retries).toEqual([{ attempt: 1, status: 529, reason: 'the service is overloaded', wait: 1, simulated: true }])
    expect(call.response).toBeDefined()
  })

  it('the call line says it was tried again, and the first one explains retries', () => {
    render(<RTooltip.Provider><Timeline model={model()} inspectedCallId={null} live="" running={false} /></RTooltip.Provider>)
    expect(document.body.textContent).toMatch(/tried again ×1/)
    expect(document.body.textContent).toMatch(/trying again when the provider is busy/)
  })

  it('the time spent waiting to try again is its own part, not the model\'s time', () => {
    const m = model()
    const call = m.calls[m.callOrder[0]]
    const t = callTiming(m, call)
    expect(t.retrying).toBe(1)
    expect(t.model!).toBeLessThan(call.response!.time - call.startedAt)
    expect(t.model! + t.retrying).toBeCloseTo(call.response!.time - call.startedAt, 5)
  })

  it('the Inspector says what the service said, how long the harness waited, and that it sent it again', () => {
    useSession.setState({ derived: model(), loaded: true })
    window.innerWidth = 1280
    render(<RTooltip.Provider><Inspector /></RTooltip.Provider>)
    window.innerWidth = 1024
    expect(document.body.textContent).toMatch(/The service said 529 \(the service is overloaded; simulated by the practice switch\): the harness waited 1\.0s and sent the same request again/)
    expect(screen.getByRole('img', { name: /waiting to try again 1\.0s/ })).toBeInTheDocument()
  })
})

describe('the practice switch', () => {
  it('is in Settings → Model, under the limits', async () => {
    const save = vi.spyOn(api, 'saveSettings').mockResolvedValue({ ...settings, faults: { busy: true } })
    render(<RTooltip.Provider><LimitsSection /></RTooltip.Provider>)
    fireEvent.click(screen.getByRole('checkbox', { name: /A busy service/ }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ faults: { busy: true } }))
  })

  it('counts under Model, comes back after Reset all, and an experiment can set and undo it', () => {
    const on = { ...settings, faults: { busy: true } } as Settings
    expect(changedIn(on).model).toBe(1)
    expect(settingsAsChange(on).faults).toEqual({ busy: true })
    expect(sectionOf('practice: busy service')).toBe('model')
    const change = { faults: { busy: true } }
    expect(previousOf(change, settings)).toEqual({ faults: { busy: false } })
    expect(onlyChanges(change, on)).toBeNull()
    expect(describeChange(change, settings)).toEqual(['practice: a busy provider'])
  })
})

// The practice switch reaches a helper's calls too, and the helper card shows them
describe('a helper\'s retries', () => {
  type Ev = Record<string, unknown>
  const withRetry = (helper as Ev[]).flatMap((e) => (e.kind === 'sub' && e.step === 'request' && e.call === 1
    ? [e, { ...e, seq: 4.5, time: (e.time as number) + 1, step: 'retry', turn: 1, attempt: 1, status: 529,
        reason: 'the service is overloaded', wait: 1, simulated: true }]
    : [e]))
  const helperOf = (events: Ev[]) => Object.values(deriveRuns(events as HarnessEvent[]).tools).find((t) => t.name === 'delegate')!.helper!

  it('are kept with the helper\'s call, and its line says it was tried again', () => {
    const h = helperOf(withRetry)
    expect(h.calls[0].retries).toEqual([{ attempt: 1, status: 529, reason: 'the service is overloaded', wait: 1, simulated: true }])
    expect(h.calls[1].retries).toBeUndefined()
    render(<HelperCard helper={h} />)
    const note = screen.getByText(/tried again ×1/)
    expect(note.getAttribute('title')).toMatch(/waited 1\.0s and sent the same request again \(the practice switch\)/)
  })

  it('a helper that was never retried says nothing about it', () => {
    render(<HelperCard helper={helperOf(helper as Ev[])} />)
    expect(document.body.textContent).not.toMatch(/tried again/)
  })
})

describe('in Compare', () => {
  it('a ready-made comparison puts a calm service beside a busy one, and the sides send the switch', async () => {
    const preset = PRESETS.find((p) => p.id === 'busy')!
    expect(preset.sides.map((s) => s.busy)).toEqual([false, true])
    const call = vi.spyOn(api, 'compare').mockReturnValue(new Promise(() => {}) as never)
    vi.spyOn(api, 'compareStatus').mockResolvedValue({ running: true })
    useCompare.setState({ text: '', results: null, busy: null })
    useCompare.getState().applyPreset(preset, 'mock')
    void useCompare.getState().run()
    const body = call.mock.calls[0][0] as { sides: { settings: { faults?: { busy: boolean } } }[] }
    expect(body.sides.map((s) => s.settings.faults)).toEqual([{ busy: false }, { busy: true }])
    expect(findExperiment('busy')!.tryNext).toMatch(/A calm service vs a busy one/)
  })
})

describe('the lesson', () => {
  it('an experiment in the first tier turns the switch on and asks how many tries call 1 takes', () => {
    const x = findExperiment('busy')!
    expect(x.tier).toBe('The loop')
    expect(x.apply).toEqual({ faults: { busy: true } })
    const m = model()
    expect(x.predict!.actual(m, m.runs[0])).toBe('2')
    const plain = deriveRuns(toolTurn as HarnessEvent[])
    expect(x.predict!.actual(plain, plain.runs[0])).toBe('1')
  })

  it('the quiz asks about it', () => {
    expect(QUIZ.some((q) => q.id === 'retry')).toBe(true)
  })
})
