import { describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { Settings, SettingsChange } from '../api/types'
import { useServer } from '../store/server'
import { usePrefs } from '../store/ui'
import type { Experiment } from './experiments'
import { describeChange, onlyChanges, previousOf, putBack, setUpExperiment } from './setup'

const settings = {
  system: 'S', system_default: 'S', changed: [], file: 'f', mcp_problems: [], hooks: { file: '', functions: [], problem: null },
  trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
  limits: { max_tokens: 16000, max_turns: 20 },
  tools: [{ name: 'get_weather', description: 'Weather.', default_description: 'Weather.', permission: 'ask',
    default_permission: 'allow', input_schema: {}, source: 'built in' }],
} as Settings

describe('previousOf', () => {
  it('remembers exactly what an experiment changes, so Undo restores it', () => {
    expect(previousOf({ limits: { max_tokens: 300, max_turns: 20 } }, settings)).toEqual({ limits: { max_tokens: 16000, max_turns: 20 } })
    expect(previousOf({ thinking: { enabled: true, budget: 4000 }, cache: { enabled: true } }, settings))
      .toEqual({ thinking: settings.thinking, cache: { enabled: false } })
    expect(previousOf({ descriptions: { get_weather: 'Kelvin only.' }, permissions: { get_weather: 'block' } }, settings))
      .toEqual({ descriptions: { get_weather: 'Weather.' }, permissions: { get_weather: 'ask' } })
  })
})

// F273: Undo can't change the start a conversation keeps, so it says so
describe('Put it back, in a conversation that keeps its start', () => {
  it('says the conversation keeps the experiment\'s prompt and descriptions', async () => {
    const { useSession } = await import('../store/session')
    const { useUi } = await import('../store/ui')
    const current = { ...settings, apply: 'conversation' } as Settings
    vi.spyOn(api, 'saveSettings').mockResolvedValue(current)
    useServer.setState({ settings: current })
    useSession.setState({ frozen: true })
    useUi.setState({ toasts: [] })
    usePrefs.setState({ experimentBefore: { settings: { descriptions: { get_weather: '' } }, changes: ['get_weather description changed'] } as never })
    await putBack()
    const t = useUi.getState().toasts.at(-1)!
    expect(t.title).toBe('Back as it was')
    expect(t.body).toMatch(/This conversation keeps the experiment's prompt and tool descriptions: start a new conversation to use yours/)
    useSession.setState({ frozen: false })
    vi.restoreAllMocks()
  })
})

describe('Put it back', () => {
  it('after two experiments in a row, restores what was there before the first', async () => {
    let current = { ...settings, limits: { max_tokens: 16000, max_turns: 20 } }
    const saved: SettingsChange[] = []
    vi.spyOn(api, 'saveSettings').mockImplementation(async (change: SettingsChange) => {
      saved.push(change)
      current = { ...current, ...(change as Partial<Settings>) }
      return current
    })
    useServer.setState({ settings: current })
    usePrefs.setState({ experimentBefore: null })
    const x = (limits: { max_tokens: number; max_turns: number }) => ({ id: 'x', title: 'X', apply: { limits } }) as unknown as Experiment
    await setUpExperiment(x({ max_tokens: 300, max_turns: 20 }))
    await setUpExperiment(x({ max_tokens: 16000, max_turns: 2 }))
    expect(current.limits).toEqual({ max_tokens: 16000, max_turns: 2 })
    await putBack()
    expect(current.limits).toEqual({ max_tokens: 16000, max_turns: 20 })
    expect(saved.at(-1)).toEqual({ limits: { max_tokens: 16000, max_turns: 20 } }) // one save puts back the original
    expect(usePrefs.getState().experimentBefore).toBeNull()
    vi.restoreAllMocks()
  })

  // F004: what to put back is kept with your preferences, so a reload doesn't lose the way back
  it('is kept in the saved preferences, with each change named', async () => {
    let current = { ...settings }
    vi.spyOn(api, 'saveSettings').mockImplementation(async (change: SettingsChange) => {
      current = { ...current, ...(change as Partial<Settings>) }
      return current
    })
    useServer.setState({ settings: current })
    usePrefs.setState({ experimentBefore: null })
    await setUpExperiment({ id: 'x', title: 'X', apply: { limits: { max_tokens: 300, max_turns: 20 } } } as unknown as Experiment)
    const saved = JSON.parse(localStorage.getItem('harness-lab-prefs')!).state.experimentBefore
    expect(saved.settings).toEqual({ limits: { max_tokens: 16000, max_turns: 20 } })
    expect(saved.changes).toEqual(['longest reply set to 300 tokens'])
    vi.restoreAllMocks()
  })

  it('an experiment that finds everything already set changes nothing and offers no undo', async () => {
    const spy = vi.spyOn(api, 'saveSettings')
    useServer.setState({ settings })
    usePrefs.setState({ experimentBefore: null })
    await setUpExperiment({ id: 'x', title: 'X', apply: { permissions: { get_weather: 'ask' } } } as unknown as Experiment)
    expect(spy).not.toHaveBeenCalled()
    expect(usePrefs.getState().experimentBefore).toBeNull()
    vi.restoreAllMocks()
  })
})

// F066: an experiment sets what it relies on, and only what actually differs is changed
describe('onlyChanges', () => {
  it('keeps a permission that differs and drops one that already matches', () => {
    expect(onlyChanges({ permissions: { get_weather: 'allow' } }, settings)).toEqual({ permissions: { get_weather: 'allow' } })
    expect(onlyChanges({ permissions: { get_weather: 'ask' } }, settings)).toBeNull()
  })
  it('drops limits, thinking and the rest when they are already set that way', () => {
    expect(onlyChanges({ limits: { max_tokens: 16000, max_turns: 20 } }, settings)).toBeNull()
    expect(onlyChanges({ limits: { max_tokens: 300, max_turns: 20 } }, settings)).toEqual({ limits: { max_tokens: 300, max_turns: 20 } })
    expect(onlyChanges({ cache: { enabled: false } }, settings)).toBeNull()
  })
})

// F061: the setup note names each change instead of "changed a setting"
describe('describeChange', () => {
  it('names each change in plain words', () => {
    expect(describeChange({ limits: { max_tokens: 300, max_turns: 20 } }, settings)).toEqual(['longest reply set to 300 tokens'])
    expect(describeChange({ limits: { max_tokens: 16000, max_turns: 2 } }, settings)).toEqual(['at most 2 calls per message'])
    expect(describeChange({ thinking: { enabled: true, budget: 4000, effort: 'high' } }, settings)).toEqual(['thinking on'])
    expect(describeChange({ trim: { enabled: true, keep_last: 1 } }, settings)).toEqual(['trimming on, keeping the last 1'])
    expect(describeChange({ cache: { enabled: true } }, settings)).toEqual(['caching on'])
    expect(describeChange({ descriptions: { get_weather: 'Kelvin.' } }, settings)).toEqual(["get_weather's description changed"])
    expect(describeChange({ permissions: { get_weather: 'allow' } }, settings)).toEqual(['get_weather set to Allow'])
  })
})
