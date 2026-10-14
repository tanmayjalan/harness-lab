import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent, RunConfig, Settings } from '../../api/types'
import { api } from '../../api/client'
import { configDiff } from '../../model/configDiff'
import { deriveRuns } from '../../model/derive'
import { describeChange, onlyChanges, previousOf } from '../../learn/setup'
import { findExperiment } from '../../learn/experiments'
import { QUIZ } from '../../learn/quiz'
import { PRESETS } from '../../store/compare'
import { useServer } from '../../store/server'
import { usePrefs, useUi } from '../../store/ui'
import { useSession } from '../../store/session'
import { Inspector } from '../inspector/Inspector'
import { WorkflowSetting } from '../settings/ModelSection'
import { changedIn, sectionOf, settingsAsChange } from '../settings/common'
import { Timeline } from './Timeline'
import { WorkflowDiagram } from './WorkflowDiagram'
import workflow from '../../test/fixtures/workflow.json'
import answer from '../../test/fixtures/answer.json'

const settings = {
  system: 'S', system_default: 'S', changed: [], file: 'f', mcp_problems: [], hooks: { file: '', functions: [], problem: null },
  trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
  limits: { max_tokens: 16000, max_turns: 20 }, workflow: { enabled: false }, tools: [],
} as unknown as Settings
const events = workflow as HarnessEvent[]
const show = (evs: unknown) =>
  render(<RTooltip.Provider><Timeline model={deriveRuns(evs as HarnessEvent[])} inspectedCallId={null} live="" running={false} /></RTooltip.Provider>)

beforeEach(() => {
  usePrefs.setState({ explained: [], learningMode: false })
  useServer.setState({ settings })
})
afterEach(() => vi.restoreAllMocks())

describe('a message answered by the workflow', () => {
  it('has its steps, in order, each with its own calls', () => {
    const m = deriveRuns(events)
    const steps = m.runs[0].workflow!
    expect(steps.map((s) => [s.name, s.verdict ?? null])).toEqual([
      ['gather', null], ['write', null], ['check', 'problems'], ['fix', null], ['check', 'pass']])
    expect(steps.map((s) => s.callIds.length)).toEqual([2, 1, 1, 1, 1])
    expect(steps[0].tools).toContain('read_file')
    expect(steps[1].tools).toEqual([])
    expect(steps.every((s) => !s.running)).toBe(true)
    // every call knows its step; the writer was sent the notes, not the file
    expect(m.callOrder.map((id) => m.calls[id].step)).toEqual([1, 1, 2, 3, 4, 5])
    expect(steps[1].sent).toMatch(/coffee: 18.50/)
    expect(steps[1].sent).not.toMatch(/item,amount/)
    expect(m.runs[0].answer?.text).toMatch(/82\.50/)
  })

  it('the timeline shows the card, the steps, and what the code did with each check', () => {
    show(events)
    expect(screen.getByRole('region', { name: 'Workflow' })).toBeTruthy()
    expect(document.body.textContent).toMatch(/Step 1: Gather facts/)
    expect(document.body.textContent).toMatch(/Write · Call 3/) // its place in the message, not in the step
    expect(document.body.textContent).toMatch(/problems: the draft goes back to be fixed/)
    expect(document.body.textContent).toMatch(/PASS: the draft is the answer/)
    expect(document.body.textContent).toMatch(/fixed steps, each its own agent/) // explained the first time
    const diagram = screen.getAllByRole('img').find((n) => n.getAttribute('aria-label')?.startsWith('Workflow diagram'))!
    expect(diagram.getAttribute('aria-label')).toMatch(/Gather facts → Write → Check → Fix → Check → Answer/)
  })

  it('calls are numbered within the message, against its limit, wherever they are named', () => {
    const m = deriveRuns(events)
    const calls = m.callOrder.map((id) => m.calls[id])
    expect(calls.map((c) => c.turn)).toEqual([1, 2, 3, 4, 5, 6])
    expect(calls.map((c) => c.stepTurn)).toEqual([1, 2, 1, 1, 1, 1])
    expect(calls.every((c) => c.maxTurns === 20)).toBe(true) // the loop sent each step only the calls left
    expect(calls.map((c) => c.stepLabel)).toEqual(['Gather facts', 'Gather facts', 'Write', 'Check', 'Fix', 'Check'])
    // The Inspector on the writing step's call
    useSession.setState({ derived: m, loaded: true })
    useUi.setState({ followLatest: false, selectedCallId: m.callOrder[2] })
    usePrefs.setState({ inspectorTab: 'summary' })
    render(<RTooltip.Provider><Inspector /></RTooltip.Provider>)
    expect(document.body.textContent).toMatch(/Message 1 · call 3 · Write step/)
    expect(document.body.textContent).toMatch(/Call 3 of at most 20 for this message/)
    // a step's first call starts afresh: the loop diagram doesn't say it came after tools
    const loop = screen.getAllByRole('img').find((n) => n.getAttribute('aria-label')?.startsWith('Harness loop'))!
    expect(loop.getAttribute('aria-label')).toMatch(/went You → /)
  })

  it('a check with no fixes left says the last draft is the answer', () => {
    const evs = (workflow as Record<string, unknown>[]).map((e) =>
      (e.kind === 'step_done' && e.verdict === 'pass' ? { ...e, verdict: 'problems', last: true } : e))
    show(evs)
    expect(document.body.textContent).toMatch(/no fixes left \(2 done\): the last draft is the answer/)
  })

  it('a message without the workflow has no card', () => {
    show(answer)
    expect(screen.queryByRole('region', { name: 'Workflow' })).toBeNull()
    expect(deriveRuns(answer as HarnessEvent[]).runs[0].workflow).toBeUndefined()
  })
})

describe('the diagram', () => {
  it('on its own, describes both loops', () => {
    render(<WorkflowDiagram />)
    const svg = screen.getByRole('img')
    expect(svg.getAttribute('aria-label')).toMatch(/outer chain .* inner loop/)
    expect(svg.textContent).toMatch(/Outer chain/)
    expect(svg.textContent).toMatch(/Inner loop/)
  })
})

describe('the setting', () => {
  it('is in Settings → Model', async () => {
    const save = vi.spyOn(api, 'saveSettings').mockResolvedValue({ ...settings, workflow: { enabled: true } })
    render(<WorkflowSetting />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Answer with a workflow/ }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ workflow: { enabled: true } }))
  })

  it('counts under Model, comes back after Reset all, and an experiment can set and undo it', () => {
    const on = { ...settings, workflow: { enabled: true } } as Settings
    expect(changedIn(on).model).toBe(1)
    expect(settingsAsChange(on).workflow).toEqual({ enabled: true })
    expect(sectionOf('workflow on')).toBe('model')
    const change = { workflow: { enabled: true } }
    expect(previousOf(change, settings)).toEqual({ workflow: { enabled: false } })
    expect(onlyChanges(change, on)).toBeNull()
    expect(describeChange(change, settings)).toEqual(['workflow on'])
  })

  it('a comparison shows it, and there is a ready-made one', () => {
    const a = { provider: 'mock' } as RunConfig
    const b = { provider: 'mock', workflow: { enabled: true } } as RunConfig
    expect(configDiff(a, b).find((d) => d.what.startsWith('Workflow'))).toMatchObject({ a: 'off', b: 'on' })
    expect(PRESETS.find((p) => p.id === 'workflow')!.sides.map((s) => s.workflow)).toEqual([false, true])
  })
})

describe('the lesson', () => {
  it('an experiment turns it on and asks how many calls it takes', () => {
    const x = findExperiment('workflow')!
    expect(x.tier).toBe('Bigger jobs')
    expect(x.apply).toEqual({ workflow: { enabled: true } })
    const chain = deriveRuns(events)
    expect(x.predict!.actual(chain, chain.runs[0])).toBe('5 or more')
    const one = deriveRuns(answer as HarnessEvent[])
    expect(x.predict!.actual(one, one.runs[0])).toBe('1 or 2')
  })

  it('the quiz asks about it', () => {
    expect(QUIZ.some((q) => q.id === 'workflow')).toBe(true)
  })
})
