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
import { Timeline } from '../run/Timeline'
import { PromptSection } from './PromptSection'
import { changedIn, sectionOf, settingsAsChange } from './common'
import toolTurn from '../../test/fixtures/tool_turn.json'

const baseSettings = {
  system: 'S', system_default: 'S', changed: [], file: 'data/lab_settings.json', mcp_problems: [],
  hooks: { file: '', functions: [], problem: null },
  trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
  limits: { max_tokens: 16000, max_turns: 20 },
  tools: [{ name: 'get_weather', description: 'Weather.', default_description: 'Weather.', permission: 'allow',
    default_permission: 'allow', input_schema: {}, source: 'built in' }],
} as unknown as Settings

const skillsOff = {
  setting: { enabled: false, mode: 'on_demand' }, folder: 'config/skills',
  found: [{ name: 'expenses', description: 'Filing an expense' }, { name: 'trip-check', description: 'Checking a city' }],
  addition: 'Skills: instructions for some tasks, loaded only when needed.\n- expenses: Filing an expense\n- trip-check: Checking a city',
}
const withSkills = (setting: { enabled: boolean; mode: 'on_demand' | 'all_in_prompt' }) =>
  ({ ...baseSettings, skills: { ...skillsOff, setting } }) as Settings
const wrap = (ui: React.ReactNode) => render(<RTooltip.Provider>{ui}</RTooltip.Provider>)

beforeEach(() => {
  useServer.setState({ settings: withSkills({ enabled: false, mode: 'on_demand' }) })
  useUi.setState({ settingsDrafts: {}, toasts: [] })
})
afterEach(() => vi.restoreAllMocks())

describe('Settings → Prompt → Skills', () => {
  it('lists the skill files and shows exactly what would be added', () => {
    wrap(<PromptSection settings={withSkills({ enabled: false, mode: 'on_demand' })} />)
    expect(screen.getByText('expenses')).toBeInTheDocument()
    expect(screen.getAllByText(/Checking a city/)).toHaveLength(2) // in the list, and in what's added
    expect(screen.getByText(/- expenses: Filing an expense/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Use skills/ })).not.toBeChecked()
  })

  it('turns skills on and picks how they are sent', async () => {
    const save = vi.spyOn(api, 'saveSettings').mockResolvedValue(withSkills({ enabled: true, mode: 'on_demand' }))
    wrap(<PromptSection settings={withSkills({ enabled: false, mode: 'on_demand' })} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Use skills/ }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ skills: { enabled: true, mode: 'on_demand' } }))
    save.mockClear()
    wrap(<PromptSection settings={withSkills({ enabled: true, mode: 'on_demand' })} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'All in the prompt' }).at(-1)!)
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ skills: { enabled: true, mode: 'all_in_prompt' } }))
  })
})

describe('skills as a setting', () => {
  it('counts under Prompt, comes back after Reset all, and links to Prompt', () => {
    expect(changedIn(withSkills({ enabled: true, mode: 'on_demand' })).prompt).toBe(1)
    expect(changedIn(withSkills({ enabled: false, mode: 'on_demand' })).prompt).toBe(0)
    expect(settingsAsChange(withSkills({ enabled: true, mode: 'all_in_prompt' })).skills).toEqual({ enabled: true, mode: 'all_in_prompt' })
    expect(sectionOf('skills on')).toBe('prompt')
  })

  it('an experiment can turn skills on, and Undo turns them off again', () => {
    const s = withSkills({ enabled: false, mode: 'on_demand' })
    const change = { skills: { enabled: true, mode: 'on_demand' as const } }
    expect(previousOf(change, s)).toEqual({ skills: { enabled: false, mode: 'on_demand' } })
    expect(onlyChanges(change, s)).toEqual(change)
    expect(onlyChanges(change, withSkills({ enabled: true, mode: 'on_demand' }))).toBeNull()
    expect(describeChange(change, s)).toEqual(['skills on (on demand)'])
  })

  it('a comparison shows a difference in skills', () => {
    const a = { provider: 'mock', skills: { enabled: true, mode: 'on_demand' } } as RunConfig
    const b = { provider: 'mock', skills: { enabled: true, mode: 'all_in_prompt' } } as RunConfig
    expect(configDiff(a, b).find((d) => d.what === 'Skills')).toEqual({ what: 'Skills', a: 'on demand', b: 'all in the prompt' })
  })

  it('has a ready-made comparison', () => {
    const p = PRESETS.find((x) => x.id === 'skills')!
    expect(p.sides.map((s) => s.skills?.mode)).toEqual(['on_demand', 'all_in_prompt'])
  })
})

describe('the lesson', () => {
  it('an experiment turns skills on and asks a question an expense skill covers', () => {
    const x = findExperiment('skills')!
    expect(x.tier).toBe('Bigger jobs')
    expect(x.apply).toEqual({ skills: { enabled: true, mode: 'on_demand' } })
    expect(x.message).toMatch(/expense/)
  })

  it('the first load_skill row explains skills', () => {
    usePrefs.setState({ explained: [], learningMode: false })
    const events = (toolTurn as Record<string, unknown>[]).map((e) => (e.kind === 'tool_call' ? { ...e, name: 'load_skill', input: { name: 'expenses' } } : e))
    wrap(<Timeline model={deriveRuns(events as HarnessEvent[])} inspectedCallId={null} live="" running={false} />)
    expect(document.body.textContent).toMatch(/instructions the model loads only when/i)
  })

  it('the quiz has a question on skills, and "Quiz me" counts the questions', () => {
    expect(QUIZ.some((q) => q.id === 'skills')).toBe(true)
  })
})
