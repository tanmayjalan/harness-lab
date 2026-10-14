import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent, RunConfig, Settings } from '../../api/types'
import { api } from '../../api/client'
import { configDiff } from '../../model/configDiff'
import { deriveRuns } from '../../model/derive'
import { callTiming } from '../../model/inspector'
import { describeChange, onlyChanges, previousOf } from '../../learn/setup'
import { findExperiment } from '../../learn/experiments'
import { QUIZ } from '../../learn/quiz'
import { PRESETS } from '../../store/compare'
import { useServer } from '../../store/server'
import { usePrefs } from '../../store/ui'
import { ToolsSection } from '../settings/ToolsSection'
import { changedIn, sectionOf, settingsAsChange } from '../settings/common'
import { Timeline } from './Timeline'
import atOnce from '../../test/fixtures/at_once.json'
import toolTurn from '../../test/fixtures/tool_turn.json'

type Ev = Record<string, unknown>
const settings = {
  system: 'S', system_default: 'S', changed: [], file: 'f', mcp_problems: [], hooks: { file: '', functions: [], problem: null },
  trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
  limits: { max_tokens: 16000, max_turns: 20 }, tools_at_once: { enabled: false },
  tools: [{ name: 'get_weather', description: 'W.', default_description: 'W.', permission: 'allow', default_permission: 'allow', input_schema: {}, source: 'built in' }],
} as unknown as Settings
const show = (events: unknown) =>
  render(<RTooltip.Provider><Timeline model={deriveRuns(events as HarnessEvent[])} inspectedCallId={null} live="" running={false} /></RTooltip.Provider>)

beforeEach(() => {
  usePrefs.setState({ explained: [], learningMode: false })
  useServer.setState({ settings })
})
afterEach(() => vi.restoreAllMocks())

describe('tools run at once', () => {
  it('the call knows its tools ran together, and its line says so', () => {
    const m = deriveRuns(atOnce as HarnessEvent[])
    expect(m.calls[m.callOrder[0]].atOnce).toEqual({ count: 3, together: true, reason: null })
    show(atOnce)
    expect(document.body.textContent).toMatch(/3 tools at once/)
    expect(document.body.textContent).toMatch(/several tools at the same time/) // explained the first time
  })

  it('when they had to run one by one, the line says why', () => {
    const events = (atOnce as Ev[]).map((e) => (e.kind === 'tools_at_once' ? { ...e, together: false, reason: 'write_file is set to Ask first' } : e))
    show(events)
    expect(screen.getByText(/one by one/).getAttribute('title')).toMatch(/write_file is set to Ask first/)
  })

  it('tool time is the span from the first start to the last end, not the sum', () => {
    const t0 = 1000
    const events = (atOnce as Ev[]).map((e) => {
      if (e.kind === 'tool_call') return { ...e, time: t0 }
      if (e.kind === 'tool_result') return { ...e, time: t0 + 0.3 }
      return e
    })
    const m = deriveRuns(events as HarnessEvent[])
    expect(callTiming(m, m.calls[m.callOrder[0]]).tools).toBeCloseTo(0.3, 5) // not 0.9
  })
})

describe('the setting', () => {
  it('is in Settings → Tools', async () => {
    const save = vi.spyOn(api, 'saveSettings').mockResolvedValue({ ...settings, tools_at_once: { enabled: true } })
    render(<RTooltip.Provider><ToolsSection settings={settings} /></RTooltip.Provider>)
    fireEvent.click(screen.getByRole('checkbox', { name: /Run several tools at once/ }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ tools_at_once: { enabled: true } }))
  })

  it('counts under Tools, comes back after Reset all, and an experiment can set and undo it', () => {
    const on = { ...settings, tools_at_once: { enabled: true } } as Settings
    expect(changedIn(on).tools).toBe(1)
    expect(settingsAsChange(on).tools_at_once).toEqual({ enabled: true })
    expect(sectionOf('tools at once')).toBe('tools')
    const change = { tools_at_once: { enabled: true } }
    expect(previousOf(change, settings)).toEqual({ tools_at_once: { enabled: false } })
    expect(onlyChanges(change, on)).toBeNull()
    expect(describeChange(change, settings)).toEqual(['tools run at once'])
  })

  it('a comparison shows it, and there is a ready-made one', () => {
    const a = { provider: 'mock' } as RunConfig
    const b = { provider: 'mock', tools_at_once: { enabled: true } } as RunConfig
    expect(configDiff(a, b).find((d) => d.what === 'Tools at once')).toEqual({ what: 'Tools at once', a: 'off', b: 'on' })
    expect(PRESETS.find((p) => p.id === 'at_once')!.sides.map((s) => s.toolsAtOnce)).toEqual([false, true])
  })
})

describe('the lesson', () => {
  it('an experiment turns it on and asks how long three lookups take', () => {
    const x = findExperiment('at_once')!
    expect(x.tier).toBe('Size and cost')
    expect(x.apply).toEqual({ tools_at_once: { enabled: true } })
    const together = deriveRuns(atOnce as HarnessEvent[])
    expect(x.predict!.actual(together, together.runs[0])).toBe('About as long as one')
    const plain = deriveRuns(toolTurn as HarnessEvent[])
    expect(x.predict!.actual(plain, plain.runs[0])).toBe('About three times as long')
  })

  it('the quiz asks about it', () => {
    expect(QUIZ.some((q) => q.id === 'at_once')).toBe(true)
  })
})
