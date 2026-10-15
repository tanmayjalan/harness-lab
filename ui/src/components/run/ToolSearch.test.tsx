import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent, RequestEvent, RunConfig, Settings } from '../../api/types'
import { api } from '../../api/client'
import { configDiff } from '../../model/configDiff'
import { deriveRuns } from '../../model/derive'
import { describeChange, onlyChanges, previousOf } from '../../learn/setup'
import { CONCEPTS, TEACHING_ORDER } from '../../learn/concepts'
import { EXPERIMENTS, findExperiment } from '../../learn/experiments'
import { QUIZ } from '../../learn/quiz'
import { PRESETS } from '../../store/compare'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { usePrefs, useUi } from '../../store/ui'
import { Inspector } from '../inspector/Inspector'
import { ToolsSection } from '../settings/ToolsSection'
import { changedIn, sectionOf, settingsAsChange } from '../settings/common'
import { Timeline } from './Timeline'
import findTool from '../../test/fixtures/find_tool.json'
import allTools from '../../test/fixtures/extra_tools_all.json'
import answer from '../../test/fixtures/answer.json'

const tool = (name: string) =>
  ({ name, description: `${name}.`, default_description: `${name}.`, permission: 'allow', default_permission: 'allow', input_schema: {}, source: 'built in' })
const settings = {
  system: 'S', system_default: 'S', changed: [], file: 'f', mcp_problems: [], hooks: { file: '', functions: [], problem: null },
  trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
  limits: { max_tokens: 16000, max_turns: 20 }, extra_tools: { enabled: false, mode: 'find' },
  tools: [tool('read_file'), tool('calculate')],
} as unknown as Settings
const requests = (events: unknown) => (events as HarnessEvent[]).filter((e): e is RequestEvent => e.kind === 'request')
const names = (r: RequestEvent) => (r.tools ?? []).map((t) => t.name)
const text = () => document.body.textContent ?? ''

beforeEach(() => {
  usePrefs.setState({ explained: [], learningMode: false })
  useServer.setState({ settings })
})
afterEach(() => vi.restoreAllMocks())

describe('a tool found first, then used', () => {
  it('the first call sends find_tool and no office tools; the next one adds what it found, and its start changed', () => {
    const [first, second, third] = requests(findTool)
    expect(names(first)).toContain('find_tool')
    expect(names(first)).not.toContain('book_room')
    expect(names(second).slice(0, names(first).length)).toEqual(names(first))
    expect(names(second)).toContain('book_room')
    expect([first.start_changed, second.start_changed, third.start_changed]).toEqual([false, true, false])
  })

  it("find_tool's row says what it loaded, and the timeline explains it", () => {
    render(<RTooltip.Provider><Timeline model={deriveRuns(findTool as HarnessEvent[])} inspectedCallId={null} live="" running={false} /></RTooltip.Provider>)
    expect(text()).toMatch(/loaded: book_room, /)
    // one full explanation at a time: an earlier one (the loop) is open, so this one waits as a named ⓘ here
    expect(screen.getByRole('button', { name: `What does "${CONCEPTS.tool_search.term}" mean?` })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /book_room/ }).length).toBeGreaterThan(0)
  })

  it('Sent marks the tools that are new since the previous call in green', () => {
    const model = deriveRuns(findTool as HarnessEvent[])
    useSession.setState({ derived: model, loaded: true })
    useUi.setState({ followLatest: false, selectedCallId: model.callOrder[1] })
    usePrefs.setState({ inspectorTab: 'sent' })
    render(<RTooltip.Provider><Inspector /></RTooltip.Provider>)
    expect(text()).toMatch(/new since call 1: book_room, /)
    const offered = [...document.querySelectorAll('details')].find((d) => d.querySelector('summary')!.textContent!.includes('new since'))!
    const green = [...offered.querySelectorAll('li.added code')].map((c) => c.textContent)
    expect(green).toContain('book_room')
    expect(green).not.toContain('find_tool')
  })

  it('with all sent, every call carries the 40 office tools and nothing is new', () => {
    const [first, second] = requests(allTools)
    expect(names(first)).toContain('book_room')
    expect(names(first)).not.toContain('find_tool')
    expect(names(first).length).toBeGreaterThan(50)
    expect(names(second)).toEqual(names(first))
  })
})

describe('the setting', () => {
  it('is one switch with three positions in Settings → Tools', async () => {
    const save = vi.spyOn(api, 'saveSettings').mockResolvedValue({ ...settings, extra_tools: { enabled: true, mode: 'find' } })
    render(<RTooltip.Provider><ToolsSection settings={settings} /></RTooltip.Provider>)
    expect(text()).toMatch(/40 extra office tools/)
    expect(text()).toMatch(/Helpers and the workflow never get them/)
    expect(screen.getByRole('button', { name: 'off' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'found on demand (find_tool)' }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ extra_tools: { enabled: true, mode: 'find' } }))
    fireEvent.click(screen.getByRole('button', { name: 'all sent every call' }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ extra_tools: { enabled: true, mode: 'all' } }))
  })

  it('counts under Tools, comes back after Reset all, and an experiment can set and undo it', () => {
    const on = { ...settings, extra_tools: { enabled: true, mode: 'all' } } as Settings
    expect(changedIn(on).tools).toBe(1)
    expect(changedIn(settings).tools).toBe(0)
    expect(settingsAsChange(on).extra_tools).toEqual({ enabled: true, mode: 'all' })
    expect(sectionOf('extra tools: found on demand')).toBe('tools')
    const change = { extra_tools: { enabled: true, mode: 'find' as const } }
    expect(previousOf(change, settings)).toEqual({ extra_tools: { enabled: false, mode: 'find' } })
    expect(onlyChanges(change, on)).toEqual(change) // all → find is a change
    expect(onlyChanges(change, { ...settings, extra_tools: change.extra_tools } as Settings)).toBeNull()
    expect(describeChange(change, settings)).toEqual(['extra tools: found on demand'])
  })

  it('a comparison shows it, and there is a ready-made one', () => {
    const a = { provider: 'mock', extra_tools: { enabled: true, mode: 'all' } } as RunConfig
    const b = { provider: 'mock', extra_tools: { enabled: true, mode: 'find' } } as RunConfig
    expect(configDiff(a, b).find((d) => d.what === '40 extra office tools')).toEqual({ what: '40 extra office tools', a: 'all sent', b: 'found on demand' })
    const preset = PRESETS.find((p) => p.id === 'tool_search')!
    expect(preset.title).toBe('All tools sent vs found on demand')
    expect(preset.sides.map((s) => s.extraTools)).toEqual(['all', 'find'])
  })
})

describe('the lesson', () => {
  it('two experiments in Size and cost, right after "Three cities at once"', () => {
    const at = EXPERIMENTS.findIndex((x) => x.title === 'Three cities at once')
    expect(EXPERIMENTS.slice(at + 1, at + 3).map((x) => [x.tier, x.title])).toEqual([['Size and cost', 'Fifty tools'], ['Size and cost', 'Find a tool first']])
    expect(findExperiment('fifty_tools')!.apply).toEqual({ extra_tools: { enabled: true, mode: 'all' } })
    expect(findExperiment('find_tool')!.apply).toEqual({ extra_tools: { enabled: true, mode: 'find' } })
    expect(findExperiment('find_tool')!.message).toBe(findExperiment('fifty_tools')!.message)
  })

  it('"Find a tool first" asks how many model calls, and counts them', () => {
    const x = findExperiment('find_tool')!
    const found = deriveRuns(findTool as HarnessEvent[])
    expect(x.predict!.actual(found, found.runs[0])).toBe('3 or more')
    const one = deriveRuns(answer as HarnessEvent[])
    expect(x.predict!.options).toEqual(['1', '2', '3 or more'])
    expect(x.predict!.actual(one, one.runs[0])).toBe('1')
  })

  it('the glossary teaches it after tools at once, and the quiz asks why not send every tool', () => {
    expect(TEACHING_ORDER.indexOf('tool_search')).toBe(TEACHING_ORDER.indexOf('tools_at_once') + 1)
    expect(CONCEPTS.tool_search.plain).toBe("sending tool details only when they're needed")
    const q = QUIZ.find((x) => x.id === 'tool_search')!
    expect(q.after).toBe(findExperiment('find_tool')!.title)
    expect(q.q).toBe('Why not send every tool on every call?')
    expect(q.options[q.answer]).toMatch(/costs tokens on every call and makes the choice harder/)
  })
})
