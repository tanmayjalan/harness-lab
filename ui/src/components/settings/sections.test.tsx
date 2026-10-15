import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { Settings } from '../../api/types'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { LimitsSection, ModelSection, WhenChangesApply } from './ModelSection'
import { PromptSection } from './PromptSection'
import { ToolsSection } from './ToolsSection'
import { usePrefs, useUi } from '../../store/ui'
import { useServer as server } from '../../store/server'
import { api } from '../../api/client'
import { ResetAll, SettingsDrawer } from './SettingsDrawer'
import { MemorySection } from './MemorySection'
import { DisplaySection } from './DisplaySection'
import { changedIn, settingsAsChange, sectionOf } from './common'
import { ContextSection } from './ContextSection'

export const baseSettings = {
  system: 'S', system_default: 'S', changed: [], file: 'data/lab_settings.json', mcp_problems: [],
  hooks: { file: '', functions: [], problem: null },
  trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
  limits: { max_tokens: 16000, max_turns: 20 },
  tools: [{ name: 'get_weather', description: 'Weather.', default_description: 'Weather.', permission: 'allow',
    default_permission: 'allow', input_schema: {}, source: 'built in' }],
} as unknown as Settings

const withSettings = (over: Partial<Settings>) => useServer.setState({ settings: { ...baseSettings, ...over } as Settings })
const wrap = (ui: React.ReactNode) => render(<RTooltip.Provider>{ui}</RTooltip.Provider>)

beforeEach(() => {
  useServer.setState({ settings: baseSettings })
  useUi.setState({ settingsDrafts: {} })
})

describe('Limits', () => {
  it('shows each limit with its range', () => {
    wrap(<LimitsSection />)
    expect(screen.getByText(/256 to 16,000; default 16,000/)).toBeInTheDocument()
    expect(screen.getByText(/2 to 20; default 20/)).toBeInTheDocument()
  })

  // F178: a thinking budget as big as the whole reply leaves nothing for the answer
  it('warns when the thinking budget is as large as the longest reply', () => {
    withSettings({ thinking: { enabled: true, budget: 4000, effort: 'medium' }, limits: { max_tokens: 300, max_turns: 20 } })
    wrap(<LimitsSection />)
    expect(screen.getByText(/thinking budget \(4,000 tokens\) is as large as the longest reply/)).toBeInTheDocument()
  })

  it('says nothing about thinking when it is off', () => {
    withSettings({ limits: { max_tokens: 300, max_turns: 20 } })
    wrap(<LimitsSection />)
    expect(screen.queryByText(/thinking budget/)).toBeNull()
  })
})

describe('Prompt', () => {
  // F084: closing the drawer or moving to another section must not lose what you typed
  it('a draft survives closing and reopening', () => {
    const first = wrap(<PromptSection settings={baseSettings} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'System prompt' }), { target: { value: 'Be brief.' } })
    first.unmount()
    wrap(<PromptSection settings={baseSettings} />)
    expect((screen.getByRole('textbox', { name: 'System prompt' }) as HTMLTextAreaElement).value).toBe('Be brief.')
  })

  // F083: an empty prompt is not saveable, and the page says why
  it('an empty prompt cannot be saved and says how to go back to the default', () => {
    withSettings({ system: 'Edited.' })
    wrap(<PromptSection settings={{ ...baseSettings, system: 'Edited.' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'System prompt' }), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByText(/An empty prompt isn't possible/)).toBeInTheDocument()
  })

  // F087: the switch that decides when this applies is in Model; say it here too
  it('says when edits apply when that is "from your next conversation"', () => {
    wrap(<PromptSection settings={{ ...baseSettings, apply: 'conversation' } as Settings} />)
    expect(screen.getByText(/Edits apply from your next conversation/)).toBeInTheDocument()
  })
})

describe('Tools', () => {
  it('a description draft survives the row being filtered away and back', () => {
    wrap(<ToolsSection settings={baseSettings} />)
    const row = () => screen.getByRole('button', { name: /get_weather/ })
    fireEvent.click(row())
    fireEvent.change(screen.getByRole('textbox', { name: 'Description the model reads for get_weather' }), { target: { value: 'Kelvin only.' } })
    const filter = screen.getByRole('textbox', { name: 'Filter tools' })
    fireEvent.change(filter, { target: { value: 'zzz' } })
    fireEvent.change(filter, { target: { value: '' } })
    fireEvent.click(row())
    expect((screen.getByRole('textbox', { name: 'Description the model reads for get_weather' }) as HTMLTextAreaElement).value).toBe('Kelvin only.')
  })

  // F306: a long tool name truncates with a tooltip, like in the chat. Final review: it doesn't shrink with the
  // rest of the row (a short name was cut at 1024 px); its 40 % cap is what truncates a long one
  it('a tool name keeps its width, truncates at its cap and keeps its full name as a tooltip', () => {
    wrap(<ToolsSection settings={baseSettings} />)
    const name = screen.getByText('get_weather', { selector: 'code' })
    expect(name.className).toMatch(/\btruncate\b/)
    expect(name.className).toMatch(/\bshrink-0\b/)
    expect(name.className).toMatch(/max-w-\[40%\]/)
    expect(name).toHaveAttribute('title', 'get_weather')
  })
})

describe('Reset all', () => {
  afterEach(() => vi.restoreAllMocks())

  // F086: say what was reset (and what was kept), and offer a way back
  it('names what it reset and what it kept, and offers Undo', async () => {
    const before = { ...baseSettings, system: 'Edited.', limits: { max_tokens: 300, max_turns: 20 } } as Settings
    server.setState({ settings: before })
    vi.spyOn(api, 'resetSettings').mockResolvedValue(baseSettings)
    const saved = vi.spyOn(api, 'saveSettings').mockResolvedValue(before)
    useUi.setState({ toasts: [] })
    wrap(<ResetAll />)
    fireEvent.click(screen.getByRole('button', { name: /Reset all to defaults/ }))
    fireEvent.click(screen.getByRole('button', { name: /Click again/ }))
    await vi.waitFor(() => expect(useUi.getState().toasts.length).toBeGreaterThan(0))
    const t = useUi.getState().toasts.at(-1)!
    expect(t.title).toBe('Model, prompt, tools and context are back to the defaults')
    expect(t.body).toMatch(/Memory and Display are kept/)
    t.action!.run()
    await vi.waitFor(() => expect(saved).toHaveBeenCalled())
    expect(saved.mock.calls[0][0]).toMatchObject({ system: 'Edited.', limits: { max_tokens: 300, max_turns: 20 } })
  })
})

describe('settingsAsChange', () => {
  it('turns saved settings back into a change that restores them', () => {
    const s = { ...baseSettings, system: 'S', trim: { enabled: true, keep_last: 1 } } as Settings
    const c = settingsAsChange(s)
    expect(c.system).toBe('') // the default
    expect(c.trim).toEqual({ enabled: true, keep_last: 1 })
    expect(c.permissions).toEqual({ get_weather: 'allow' })
  })
})

// F183: the server's "what you changed" list, in the footer, each item a way to its section
describe('the drawer footer', () => {
  it('lists what differs from the defaults, each linking to its section', () => {
    server.setState({ settings: { ...baseSettings, changed: ['the system prompt', 'trimming on'] } as Settings })
    useUi.setState({ settingsOpen: true, settingsSection: 'model' })
    wrap(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: 'trimming on' }))
    expect(useUi.getState().settingsSection).toBe('context')
    useUi.setState({ settingsOpen: false })
  })

  it('maps each kind of change to its section', () => {
    expect(sectionOf('the system prompt')).toBe('prompt')
    expect(sectionOf('2 tool descriptions')).toBe('tools')
    expect(sectionOf('1 permission')).toBe('tools')
    expect(sectionOf('summarising on')).toBe('context')
    expect(sectionOf('limits changed')).toBe('model')
  })

  // F084: a section with unsaved text says so in the list of sections
  it('marks a section with unsaved text', () => {
    useUi.setState({ settingsOpen: true, settingsSection: 'model', settingsDrafts: { system: 'Draft.' } })
    wrap(<SettingsDrawer />)
    expect(screen.getByRole('button', { name: /Prompt.*unsaved/ })).toBeInTheDocument()
    useUi.setState({ settingsOpen: false })
  })
})

// F188: an empty fact is never sent, so it can't be ticked as shared
describe('Memory', () => {
  it('an empty fact cannot be shared and says it is not sent', () => {
    server.setState({ profile: { facts: [{ label: 'Unit', value: '', share: true }], shared: 0, addition: '', file: 'p.json' } as never })
    wrap(<MemorySection />)
    expect(screen.getByRole('checkbox', { name: /Share Unit/ })).toBeDisabled()
    expect(screen.getByText(/empty, not sent/)).toBeInTheDocument()
  })

  // F347: in a narrow drawer the fact row wraps instead of squeezing the value to a few characters
  it('a fact row wraps below the small breakpoint', () => {
    server.setState({ profile: { facts: [{ label: 'Unit', value: '', share: true }], shared: 0, addition: '', file: 'p.json' } as never })
    wrap(<MemorySection />)
    const label = screen.getByRole('textbox', { name: 'Label of fact 1' })
    expect(label.closest('li')!.className).toMatch(/\bflex-wrap\b/)
    expect(label.closest('li')!.className).toMatch(/\bsm:flex-nowrap\b/)
    expect(label.className).toMatch(/\bw-full\b/)
    expect(label.className).toMatch(/\bsm:w-56\b/)
  })

  const profile = { facts: [{ label: 'Name', value: '', share: true }], shared: 0, addition: '', file: 'p.json' } as never
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('shows a skeleton until the profile arrives', () => {
    server.setState({ profile: null })
    const { container } = wrap(<MemorySection />)
    expect(screen.getByRole('heading', { name: /Memory/ })).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse-soft')).not.toBeNull()
  })

  // F327: closing the drawer must not lose the last 700 ms of typing
  it('closing the section saves a pending edit at once', () => {
    server.setState({ profile })
    const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(profile)
    const { unmount } = wrap(<MemorySection />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Value of fact 1' }), { target: { value: 'Alex' } })
    unmount()
    expect(save).toHaveBeenCalledTimes(1)
  })

  // F328: no silent retry loop
  it('a failed save stops after one try and offers Try again', async () => {
    vi.useFakeTimers()
    server.setState({ profile })
    const save = vi.spyOn(api, 'saveProfile').mockRejectedValue(new Error('disk full'))
    wrap(<MemorySection />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Value of fact 1' }), { target: { value: 'Alex' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(save).toHaveBeenCalledTimes(1)
    save.mockResolvedValue(profile)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(save).toHaveBeenCalledTimes(2)
  })

  // F339
  it('Add a fact focuses the new label field', () => {
    vi.useFakeTimers()
    server.setState({ profile })
    wrap(<MemorySection />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a fact' })) // Task 8 (F330g): the + is a lucide icon
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByRole('textbox', { name: 'Label of fact 2' })).toHaveFocus()
  })

  // Final review: Undo pressed after the section was closed and opened again. The old section is gone, so its Undo
  // saves from the store; the open one must show that fact, and its next edit must not save over it
  it('Undo from a closed section shows the fact in the reopened one, and the next edit keeps it', async () => {
    const two = { facts: [{ label: 'Name', value: 'Alex', share: true }, { label: 'City', value: 'Lisbon', share: true }],
      shared: 2, addition: '', file: 'p.json' }
    server.setState({ profile: two as never })
    useUi.setState({ toasts: [] })
    const save = vi.spyOn(api, 'saveProfile').mockImplementation(async (facts) => ({ ...two, facts }) as never)
    const first = wrap(<MemorySection />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Name' }))
    const undo = useUi.getState().toasts.at(-1)!.action!.run
    first.unmount() // saves the removal at once
    await act(async () => {})
    expect(server.getState().profile!.facts.map((f) => f.label)).toEqual(['City'])
    wrap(<MemorySection />)
    expect(screen.getByRole('textbox', { name: 'Label of fact 1' })).toHaveValue('City')
    await act(async () => { undo() })
    await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Label of fact 1' })).toHaveValue('Name'))
    expect(screen.getByRole('textbox', { name: 'Label of fact 2' })).toHaveValue('City')
    fireEvent.change(screen.getByRole('textbox', { name: 'Value of fact 2' }), { target: { value: 'Mumbai' } })
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith([{ label: 'Name', value: 'Alex', share: true },
      { label: 'City', value: 'Mumbai', share: true }]), { timeout: 2000 })
  })

  // Final review: the section takes in a changed profile, but not the answer to its own save, which leaves out
  // empty facts: a fact you have just added (still blank) stays on screen
  it('a blank fact you just added stays after its save comes back', async () => {
    vi.useFakeTimers()
    server.setState({ profile })
    vi.spyOn(api, 'saveProfile').mockImplementation(async (facts) => ({ ...(profile as object), facts }) as never)
    wrap(<MemorySection />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a fact' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByRole('textbox', { name: 'Label of fact 2' })).toBeInTheDocument()
  })
})

// F271, F272, F276: "From your next conversation" keeps the prompt, the tool descriptions and the facts about you
describe('when changes apply, said where you make them', () => {
  afterEach(() => vi.restoreAllMocks())
  const kept = { ...baseSettings, apply: 'conversation' } as Settings

  it('the Prompt note and the drawer header say the facts are kept too', () => {
    wrap(<PromptSection settings={kept} />)
    expect(screen.getByText(/keeps the prompt, the tool descriptions and the facts about you it began with/)).toBeInTheDocument()
    withSettings({ apply: 'conversation' })
    useUi.setState({ settingsOpen: true, settingsSection: 'prompt' })
    wrap(<SettingsDrawer />)
    expect(screen.getByText(/The prompt, tool descriptions and facts about you apply from your next conversation; the rest from your next message/)).toBeInTheDocument()
    useUi.setState({ settingsOpen: false })
  })

  it('the Tools note says descriptions wait but Allow / Ask first / Block apply from the next message', () => {
    wrap(<ToolsSection settings={kept} />)
    expect(screen.getByText(/Description edits apply from your next conversation/)).toBeInTheDocument()
    expect(screen.getByText(/Allow \/ Ask first \/ Block apply from your next message/)).toBeInTheDocument()
  })

  it('Memory says fact changes wait for the next conversation in that mode', () => {
    server.setState({ profile: { facts: [], shared: 0, addition: '', file: 'p.json' } as never })
    withSettings({ apply: 'conversation' })
    wrap(<MemorySection />)
    expect(screen.getByText(/Fact changes apply from your next conversation/)).toBeInTheDocument()
  })

  // F278: what Memory says about remember_fact follows its rule
  it('Memory says whether remember_fact asks first, saves without asking, or is blocked', () => {
    server.setState({ profile: { facts: [], shared: 0, addition: '', file: 'p.json' } as never })
    const tool = (permission: string) => ({ ...baseSettings.tools[0], name: 'remember_fact', permission })
    for (const [rule, words] of [['ask', /it asks you first/], ['allow', /it saves them without asking you/], ['block', /it's set to Block/]] as const) {
      withSettings({ tools: [tool(rule)] as never })
      const view = wrap(<MemorySection />)
      expect(view.container.textContent).toMatch(words)
      view.unmount()
    }
  })

  it('Memory says nothing about it from the next message', () => {
    server.setState({ profile: { facts: [], shared: 0, addition: '', file: 'p.json' } as never })
    wrap(<MemorySection />)
    expect(screen.queryByText(/Fact changes apply from your next conversation/)).toBeNull()
  })

  it('the toast for the switch reads as a sentence', async () => {
    vi.spyOn(api, 'saveSettings').mockResolvedValue(kept)
    useUi.setState({ toasts: [] })
    wrap(<WhenChangesApply />)
    fireEvent.click(screen.getByRole('button', { name: /From your next conversation/ }))
    await vi.waitFor(() => expect(useUi.getState().toasts.length).toBeGreaterThan(0))
    expect(useUi.getState().toasts.at(-1)!.title).toBe('When changes apply: from your next conversation')
  })
})

describe('rules and dots', () => {
  // F081: what Allow / Ask first / Block mean is on screen, not only in a hover title
  it('each tool row says what its current rule does', () => {
    wrap(<ToolsSection settings={baseSettings} />)
    const help = screen.getByText('Runs without asking you.')
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveAttribute('aria-describedby', help.id)
  })

  // F082: a changed rule names the default and can be put back without opening the row
  it('a changed rule shows its default and a way back on the collapsed row', () => {
    const tool = { ...baseSettings.tools[0], permission: 'block', default_permission: 'ask' }
    wrap(<ToolsSection settings={{ ...baseSettings, tools: [tool] } as Settings} />)
    expect(screen.getByTitle(/default: Ask first/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to the default rule for get_weather' })).toBeInTheDocument()
  })

  // F080: limits and the apply switch count as changes too
  it('counts changed limits and the apply switch under Model', () => {
    expect(changedIn({ ...baseSettings, limits: { max_tokens: 300, max_turns: 20 } } as Settings).model).toBe(1)
    expect(changedIn({ ...baseSettings, apply: 'conversation' } as Settings).model).toBe(1)
  })

  // F175: one mark for "changed from the default" everywhere
  it('a switched-on feature gets the same dot as any other change', () => {
    wrap(<ContextSection settings={{ ...baseSettings, trim: { enabled: true, keep_last: 2 } } as Settings} />)
    const legend = screen.getByText(/^Trimming/).closest('legend')!
    expect(legend.querySelector('[aria-label^="changed"]')).not.toBeNull()
    expect(legend.textContent).not.toMatch(/on/)
  })

  // F181: Memory's count is not a "changed" badge in a different colour
  it('Memory shows how many facts are shared in words', () => {
    server.setState({ profile: { facts: [], shared: 2, addition: '', file: 'p.json' } as never })
    useUi.setState({ settingsOpen: true, settingsSection: 'model' })
    wrap(<SettingsDrawer />)
    expect(screen.getByRole('button', { name: /Memory · 2 shared/ })).toBeInTheDocument()
    useUi.setState({ settingsOpen: false })
  })
})

describe('wording inside Settings', () => {
  // F186: no "Edit it in Settings → Prompt" while you are in Settings → Prompt
  it('the Prompt section does not send you to itself', () => {
    wrap(<PromptSection settings={baseSettings} />)
    expect(document.body.textContent).not.toMatch(/Edit it in Settings/)
  })

  // F185: the Context section describes what a setting does, not something that already happened
  it('Context describes trimming and summarising as settings', () => {
    wrap(<ContextSection settings={baseSettings} />)
    expect(screen.getByText(/^Replaces older tool results with a short note/)).toBeInTheDocument()
    expect(screen.getByText(/^When the history gets too long, replaces the older part with a summary/)).toBeInTheDocument()
  })
})

// F184: Ctrl+, from Help or Experiments closes them first, instead of stacking Settings on top
describe('toggleSettings', () => {
  it('closes Help and Experiments before opening Settings', () => {
    useUi.setState({ helpOpen: true, experimentsOpen: true, settingsOpen: false })
    useUi.getState().toggleSettings()
    expect(useUi.getState()).toMatchObject({ helpOpen: false, experimentsOpen: false, settingsOpen: true })
    useUi.getState().toggleSettings()
    expect(useUi.getState().settingsOpen).toBe(false)
  })
})

// F182: the description limit is shown before the server refuses it
it('a tool description shows its length against the limit', () => {
  wrap(<ToolsSection settings={baseSettings} />)
  fireEvent.click(screen.getByRole('button', { name: /get_weather/ }))
  expect(screen.getByText('8 of 4,000 characters')).toBeInTheDocument()
})

// F329, F330n: nothing is thrown away without a way back; click-twice waits for you
describe('Undo for destructive actions (F329)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
  const lastToast = () => useUi.getState().toasts.at(-1)!

  it('Back to the default prompt can be undone', async () => {
    const edited = { ...baseSettings, system: 'Edited.' } as Settings
    withSettings({ system: 'Edited.' })
    const saved = vi.spyOn(api, 'saveSettings').mockResolvedValue(baseSettings)
    useUi.setState({ toasts: [] })
    wrap(<PromptSection settings={edited} />)
    fireEvent.click(screen.getByRole('button', { name: /Back to the default/ }))
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(useUi.getState().toasts.length).toBe(1))
    expect(lastToast().action?.label).toBe('Undo')
    await act(async () => { lastToast().action!.run() })
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(2))
    expect(saved.mock.calls[1][0]).toEqual({ system: 'Edited.' })
  })

  it('Back to the default description can be undone', async () => {
    const tool = { ...baseSettings.tools[0], description: 'Kelvin only.' }
    const edited = { ...baseSettings, tools: [tool] } as Settings
    withSettings({ tools: [tool] })
    const saved = vi.spyOn(api, 'saveSettings').mockResolvedValue(baseSettings)
    useUi.setState({ toasts: [] })
    wrap(<ToolsSection settings={edited} />)
    fireEvent.click(screen.getByRole('button', { name: /get_weather/ }))
    fireEvent.click(screen.getByRole('button', { name: /Back to the default/ }))
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(useUi.getState().toasts.length).toBe(1))
    await act(async () => { lastToast().action!.run() })
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(2))
    expect(saved.mock.calls[1][0]).toEqual({ descriptions: { get_weather: 'Kelvin only.' } })
  })

  it('a removed fact comes back at its place, and is saved', async () => {
    vi.useFakeTimers()
    const facts = [{ label: 'Name', value: 'Alex', share: true }, { label: 'Unit', value: 'metric', share: true }, { label: 'City', value: 'Lisbon', share: true }]
    const profile = { facts, shared: 3, addition: '', file: 'p.json' } as never
    server.setState({ profile })
    const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(profile)
    useUi.setState({ toasts: [] })
    wrap(<MemorySection />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Unit' }))
    expect(screen.queryByDisplayValue('metric')).toBeNull()
    act(() => { lastToast().action!.run() })
    expect(screen.getAllByRole('textbox', { name: /Label of fact/ }).map((e) => (e as HTMLInputElement).value)).toEqual(['Name', 'Unit', 'City'])
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(save).toHaveBeenLastCalledWith(facts)
  })

  it('Undo of a removed fact still saves after the section is closed', async () => {
    const facts = [{ label: 'Name', value: 'Alex', share: true }, { label: 'Unit', value: 'metric', share: true }, { label: 'City', value: 'Lisbon', share: true }]
    const profile = { facts, shared: 3, addition: '', file: 'p.json' } as never
    server.setState({ profile })
    const save = vi.spyOn(api, 'saveProfile').mockImplementation(async (list) => ({ ...(profile as object), facts: list }) as never)
    useUi.setState({ toasts: [] })
    const { unmount } = wrap(<MemorySection />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Unit' }))
    unmount() // saves the removal at once
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await act(async () => { lastToast().action!.run() })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).toEqual(facts)
    expect(server.getState().profile?.facts).toEqual(facts)
  })

  // F449: one button for a first-time learner's view, with one Undo
  it('Start over as a new learner clears explanations, ticks and quiz answers, and Undo brings them back', async () => {
    usePrefs.setState({ explained: ['loop'], experimentsDone: ['loop', 'errors'], quizAnswers: { q1: 2 }, inspectHintSeen: true, experimentBefore: null })
    useUi.setState({ toasts: [] })
    wrap(<DisplaySection />)
    expect(screen.queryByRole('button', { name: 'Reset experiment progress' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start over as a new learner' }))
    await vi.waitFor(() => expect(usePrefs.getState().experimentsDone).toEqual([]))
    expect(usePrefs.getState()).toMatchObject({ explained: [], inspectHintSeen: false })
    expect(usePrefs.getState().quizAnswers).toEqual({})
    expect(lastToast().title).toBe('Started over as a new learner')
    act(() => { lastToast().action!.run() })
    await vi.waitFor(() => expect(usePrefs.getState().experimentsDone).toEqual(['loop', 'errors']))
    expect(usePrefs.getState()).toMatchObject({ explained: ['loop'], quizAnswers: { q1: 2 }, inspectHintSeen: true })
  })

  it("Start over puts an experiment's change back first, and clears its Undo", async () => {
    const before = { settings: { limits: { max_tokens: 16000, max_turns: 20 } }, changes: ['longest reply set to 300 tokens'] }
    usePrefs.setState({ experimentsDone: ['cutoff'], experimentBefore: before })
    const saved = vi.spyOn(api, 'saveSettings').mockResolvedValue(baseSettings)
    useUi.setState({ toasts: [] })
    wrap(<DisplaySection />)
    fireEvent.click(screen.getByRole('button', { name: 'Start over as a new learner' }))
    await vi.waitFor(() => expect(usePrefs.getState().experimentsDone).toEqual([]))
    expect(saved).toHaveBeenCalledWith(before.settings)
    expect(usePrefs.getState().experimentBefore).toBeNull()
    expect(lastToast().body).toMatch(/longest reply set to 300 tokens.*put back/)
  })
})

describe('Reset all waits for you (F330n)', () => {
  afterEach(() => vi.useRealTimers())
  it('stays armed after 3 s, announces itself, and disarms on blur or Esc', () => {
    vi.useFakeTimers()
    wrap(<ResetAll />)
    const btn = () => screen.getByRole('button', { name: /Reset all to defaults|Click again/ })
    fireEvent.click(btn())
    act(() => { vi.advanceTimersByTime(10000) })
    expect(btn().textContent).toMatch(/Click again/)
    expect(screen.getByRole('status').textContent).toBe('Press again to reset everything')
    fireEvent.blur(btn())
    expect(btn().textContent).toMatch(/Reset all to defaults/)
  })
})

describe('Esc on an armed Reset all (F330n)', () => {
  it('disarms the button and leaves the drawer open', () => {
    useUi.setState({ settingsOpen: true, settingsSection: 'display' })
    wrap(<SettingsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /Reset all to defaults/ }))
    expect(screen.getByRole('button', { name: /Click again/ })).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /Reset all to defaults/ })).toBeInTheDocument()
    expect(useUi.getState().settingsOpen).toBe(true)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(useUi.getState().settingsOpen).toBe(false)
  })
})

// ---- Third pass, Task 9: pick-one rows, and field hints and errors tied to their fields (F340 F341 F342 F346) ----
describe('Settings → Model as pick-one rows (F340 F346)', () => {
  const info = {
    provider: 'mock', model: 'claude-opus-5-5', mode: 'mock', folder: 'ws', max_turns: 20, tools: [],
    providers: [
      { name: 'anthropic', label: 'Anthropic API', model: 'claude-opus-5-5', models: ['claude-opus-5-5'], missing_key: null, price: { input: 4, cached: 0.2, output: 20, note: 'x' } },
      { name: 'deepseek', label: 'DeepSeek', model: 'deepseek-flash', models: ['deepseek-flash'], missing_key: 'DEEPSEEK_API_KEY', price: null },
      { name: 'mock', label: 'Mock', model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-haiku-4-5'], missing_key: null, price: null },
    ],
  }
  beforeEach(() => {
    useServer.setState({ info: info as never })
    useSession.setState({ provider: 'mock', model: 'claude-opus-5-5', running: false })
  })
  afterEach(() => vi.restoreAllMocks())

  it('provider, then the chosen provider\'s models, as two pressed-state rows (no radios, nothing nested)', async () => {
    const sw = vi.spyOn(api, 'switchProvider').mockResolvedValue({} as never)
    vi.spyOn(api, 'info').mockResolvedValue(info as never)
    wrap(<ModelSection />)
    expect(screen.queryByRole('radio')).toBeNull()
    const providers = screen.getByRole('group', { name: 'Provider' })
    const models = screen.getByRole('group', { name: 'Model' })
    expect(providers.contains(models)).toBe(false)
    expect(within(providers).getByRole('button', { name: 'Mock' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(providers).getByRole('button', { name: 'DeepSeek' })).toBeDisabled()
    expect(document.body.textContent).toMatch(/DeepSeek: Needs DEEPSEEK_API_KEY/) // the reason is on screen
    fireEvent.click(within(models).getByRole('button', { name: 'claude-haiku-4-5' }))
    await vi.waitFor(() => expect(sw).toHaveBeenCalledWith('mock', 'claude-haiku-4-5'))
    fireEvent.click(within(providers).getByRole('button', { name: 'Anthropic API' }))
    await vi.waitFor(() => expect(sw).toHaveBeenCalledWith('anthropic', undefined))
  })

  it('while a reply runs, the rows wait', () => {
    useSession.setState({ running: true })
    wrap(<ModelSection />)
    for (const b of within(screen.getByRole('group', { name: 'Provider' })).getAllByRole('button')) expect(b).toBeDisabled()
  })

  it('"When changes apply" is a pressed-state row that keeps both explanations on screen', () => {
    wrap(<WhenChangesApply />)
    const row = screen.getByRole('group', { name: 'When changes apply' })
    expect(within(row).getByRole('button', { name: 'From your next message' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.body.textContent).toMatch(/best for experimenting/)
    expect(document.body.textContent).toMatch(/caching keeps working/)
  })
})

describe('field hints and errors (F342)', () => {
  it('a blank prompt marks the box invalid and points at the warning', () => {
    wrap(<PromptSection settings={baseSettings} />)
    const box = screen.getByRole('textbox', { name: 'System prompt' })
    expect(box).not.toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(box, { target: { value: '  ' } })
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription(/An empty prompt isn't possible/)
  })

  it('a tool description names its tool, and its count and warnings are tied to it', () => {
    wrap(<ToolsSection settings={baseSettings} />)
    fireEvent.click(screen.getByRole('button', { name: /get_weather/ }))
    const box = screen.getByRole('textbox', { name: 'Description the model reads for get_weather' })
    expect(box).toHaveAccessibleDescription(/8 of 4,000 characters/)
    fireEvent.change(box, { target: { value: 'x'.repeat(4001) } })
    expect(box).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(box, { target: { value: '' } })
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription(/A tool always has a description/)
  })
})
