// Fixes from the final whole-branch review (C1, I1 to I11, and three minors re-graded by effect)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import userEvent from '@testing-library/user-event'
import type { HarnessEvent, Info, Settings } from './api/types'
import { api } from './api/client'
import { isTyping, useShortcuts } from './lib/shortcuts'
import { deriveRuns } from './model/derive'
import { escapeStops } from './store/selectors'
import { useSession } from './store/session'
import { useServer } from './store/server'
import { useEvals } from './store/evals'
import { toast, usePrefs, useUi } from './store/ui'
import { useCompare } from './store/compare'
import { ApprovalDock } from './components/composer/ApprovalDock'
import { RunView } from './components/run/RunView'
import { ContextSection } from './components/settings/ContextSection'
import { EvalsScreen, Results, ScoreChart } from './components/evals/EvalsScreen'
import { CompareScreen } from './components/compare/CompareScreen'
import { Composer } from './components/composer/Composer'
import { ModelSection } from './components/settings/ModelSection'
import { SettingsDrawer } from './components/settings/SettingsDrawer'
import { Inspector } from './components/inspector/Inspector'
import { EmptyState } from './components/run/EmptyState'
import { HelpSheet } from './components/shell/HelpSheet'
import { Explain } from './learn/Explain'
import { CONCEPTS, TEACHING_ORDER } from './learn/concepts'
import { cannotShow, EXPERIMENTS, findExperiment } from './learn/experiments'
import { PRESETS } from './store/compare'
import { STOP_WORDS } from './lib/stopWords'
import answer from './test/fixtures/answer.json'
import toolTurn from './test/fixtures/tool_turn.json'
import failed from './test/fixtures/error.json'
import { RadioRow } from './components/ui'
import { describeChange, putBack } from './learn/setup'
import declined from './test/fixtures/approval_declined.json'

const wrap = (ui: React.ReactNode) => render(<RTooltip.Provider>{ui}</RTooltip.Provider>)

beforeEach(() => {
  useUi.setState({ toasts: [], approvalDock: null, screen: 'run' })
  usePrefs.setState({ explained: [], learningMode: false, experimentBefore: null })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('keys', () => {
  function Page({ a, bracket }: { a: () => void; bracket: () => void }) {
    useShortcuts([{ key: 'a', run: a }, { key: '[', repeat: true, run: bracket }])
    return <input type="checkbox" aria-label="Always allow" />
  }
  // C1: a held A must not approve the next panel too
  it('a held-down key repeats only where that is wanted', () => {
    const a = vi.fn()
    const bracket = vi.fn()
    render(<Page a={a} bracket={bracket} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', repeat: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', repeat: true }))
    expect(a).not.toHaveBeenCalled()
    expect(bracket).toHaveBeenCalledTimes(1)
  })

  // I1: a ticked checkbox is not "typing"
  it('a checkbox does not count as typing, a text box does', () => {
    const box = document.createElement('input')
    box.type = 'checkbox'
    const text = document.createElement('input')
    expect(isTyping(box)).toBe(false)
    expect(isTyping(text)).toBe(true)
    expect(isTyping(document.createElement('textarea'))).toBe(true)
  })

  // I2: Esc never declines an approval, on any screen
  it('Esc does not stop while an approval waits, even with the panel off screen', () => {
    const model = deriveRuns((declined as Array<Record<string, unknown>>).slice(0, 5) as HarnessEvent[])
    useSession.setState({ running: true, derived: model })
    useUi.setState({ approvalDock: null, screen: 'compare' })
    expect(escapeStops()).toBe(false)
    useSession.setState({ running: false })
  })
})

describe('the approval panel', () => {
  // C1: once answered, the panel never sends again
  it('answers once, even when asked again after the first answer went through', async () => {
    const approve = vi.spyOn(api, 'approve').mockResolvedValue({ ok: true })
    const approval = { id: 'a1', toolId: 'w1', tool: 'write_file', prompt: '', input: {}, path: 'x', content: 'y', outside: false }
    wrap(<ApprovalDock approval={approval} row={{ permission: 'ask' } as never} />)
    await act(async () => { await useUi.getState().approvalDock!.answer(true) })
    await act(async () => { await useUi.getState().approvalDock!.answer(true) })
    expect(approve).toHaveBeenCalledTimes(1)
  })

  // I3 (page side): "Always allow" is sent with the answer
  it('sends "always" with the answer', async () => {
    vi.spyOn(api, 'saveSettings').mockResolvedValue({} as Settings)
    const approve = vi.spyOn(api, 'approve').mockResolvedValue({ ok: true })
    const approval = { id: 'a1', toolId: 'w1', tool: 'write_file', prompt: '', input: {}, path: 'x', content: 'y', outside: false }
    wrap(<ApprovalDock approval={approval} row={{ permission: 'ask' } as never} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Always allow/ }))
    await act(async () => { await useUi.getState().approvalDock!.answer(true) })
    expect(approve).toHaveBeenCalledWith('a1', true, true)
  })
})

describe('focus after an approval (I4)', () => {
  it('losing contact says nothing about allowing and leaves focus alone', () => {
    useServer.setState({ info: null })
    const events = declined as Array<Record<string, unknown>>
    useSession.setState({ derived: deriveRuns(events.slice(0, 5) as HarnessEvent[]), loaded: true, running: true })
    wrap(<><button type="button">elsewhere</button><RunView composerRef={{ current: null }} /></>)
    screen.getByRole('button', { name: 'elsewhere' }).focus()
    act(() => { useSession.getState().setConnection('lost') })
    expect(screen.queryByText(/Allowed/)).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'elsewhere' }))
    useSession.setState({ connection: 'ok' })
  })
})

describe('settings (I5)', () => {
  it('a blank "% of window" box saves nothing', () => {
    const save = vi.spyOn(api, 'saveSettings')
    useServer.setState({ info: { providers: [{ name: 'mock', context_windows: { m: 200000 } }] } as never })
    useSession.setState({ provider: 'mock', model: 'm' })
    const settings = { trim: { enabled: false, keep_last: 2 }, compact: { enabled: true, over_chars: 40000 } } as Settings
    wrap(<ContextSection settings={settings} />)
    const pct = screen.queryByRole('spinbutton', { name: /percentage of the model's window/ })
    if (!pct) return // no window known for this model: nothing to test here
    fireEvent.change(pct, { target: { value: '' } })
    fireEvent.blur(pct)
    expect(save).not.toHaveBeenCalled()
  })
})

describe('Compare (I6)', () => {
  it('"Inspect this side" does not switch model when opening the side failed', async () => {
    vi.spyOn(api, 'compareHistory').mockResolvedValue({ items: [] })
    vi.spyOn(api, 'openConversation').mockRejectedValue(new Error('gone'))
    const sw = vi.spyOn(api, 'switchProvider')
    useServer.setState({ info: { providers: [] } as never, settings: null })
    useSession.setState({ provider: 'mock', model: 'claude-opus-5-5' })
    useCompare.setState({ results: { kind: 'compare', text: 'q', profileIncluded: false, sides: [
      { label: 'A', provider: 'mock', model: 'claude-haiku-4-5-20251001', tools: [], seconds: 1, tokens_read: 0, tokens_written: 0, cost: null, conversation: 'c1' },
      { label: 'B', provider: 'mock', model: 'claude-opus-5-5', tools: [], seconds: 1, tokens_read: 0, tokens_written: 0, cost: null, conversation: 'c2' },
    ] } })
    wrap(<CompareScreen />)
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Inspect this side/ })[0]) })
    expect(sw).not.toHaveBeenCalled()
    useCompare.setState({ results: null })
  })
})

describe('experiment Undo (I7)', () => {
  it('keeps the way back when the switch back fails', async () => {
    vi.spyOn(api, 'switchProvider').mockRejectedValue(new Error('wait for the reply'))
    usePrefs.setState({ experimentBefore: { provider: { provider: 'mock', model: 'claude-opus-5-5' }, changes: ['switched to haiku'] } })
    await act(async () => { await putBack() })
    expect(usePrefs.getState().experimentBefore).not.toBeNull()
  })
})

describe('evals (I9, I10)', () => {
  it('keeps asking after a failed status check', async () => {
    vi.useFakeTimers()
    const status = vi.spyOn(api, 'evalsStatus').mockRejectedValueOnce(new Error('down')).mockResolvedValue({ running: false })
    vi.spyOn(api, 'evalsHistory').mockResolvedValue({ runs: [] })
    await act(async () => { await useEvals.getState().refresh() })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(status).toHaveBeenCalledTimes(2)
  })

  it('a stopped (incomplete) run is not joined to the line', () => {
    const run = (id: string, incomplete = false) => ({ id, time: 1_790_000_000, provider: 'mock', label: 'M', model: 'm', repeat: 1,
      use_my_settings: true, judge: 'mock', setup: [], passed: 3, total: 6, questions: 6, only: '', incomplete })
    const { container } = render(<ScoreChart runs={[run('a'), run('b', true), run('c')]} selected="c" onPick={() => {}} />)
    expect(container.querySelector('polyline')!.getAttribute('points')!.trim().split(' ')).toHaveLength(2)
  })
})

describe('choices that save at once (I11)', () => {
  it('are pressed-state buttons, not radios that arrow keys would not pick', () => {
    render(<RadioRow label="Rule" value="ask" onChange={() => {}} options={[['allow', 'Allow'], ['ask', 'Ask first']]} />)
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ask first' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Rule' })).toBeInTheDocument()
  })
})

describe('re-graded minors', () => {
  // M3: two Undo toasts with the same words are two different deletes
  it('never merges toasts that carry a button', () => {
    toast({ kind: 'ok', title: 'Deleted "Hi"', action: { label: 'Undo', run: () => {} } })
    toast({ kind: 'ok', title: 'Deleted "Hi"', action: { label: 'Undo', run: () => {} } })
    expect(useUi.getState().toasts).toHaveLength(2)
  })
})

// ---- Third pass, Task 6: one name per thing, estimates marked, help and glossary complete (F338 to F374)
describe('third pass wording', () => {
  const text = () => document.body.textContent ?? ''
  const server = (over: Record<string, unknown> = {}) => ({
    provider: 'mock', model: 'claude-opus-5-5', mode: 'mock', folder: 'ws', max_turns: 20, tools: [],
    providers: [
      { name: 'anthropic', label: 'Anthropic API', model: 'claude-opus-5-5', models: ['claude-opus-5-5'], missing_key: null,
        price: { input: 4, cached: 0.2, output: 20, note: 'x' }, thinking: 'adaptive' },
      { name: 'deepseek', label: 'DeepSeek', model: 'deepseek-flash', models: ['deepseek-flash'], missing_key: 'DEEPSEEK_API_KEY', price: { input: 0.3, cached: 0.03, output: 1.2 } },
      { name: 'mock', label: 'Mock: replies from claude -p', model: 'claude-opus-5-5', models: ['claude-opus-5-5'], missing_key: null, price: null,
        model_prices: { 'claude-opus-5-5': { input: 4, cached: 0.2, output: 20 } } },
    ], ...over }) as unknown as Info
  const settings = (over: Record<string, unknown> = {}) => ({
    system: 'S', system_default: 'S', changed: [], mcp_problems: [], hooks: { file: '', functions: [], problem: null },
    trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
    thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
    limits: { max_tokens: 16000, max_turns: 12 }, faults: { busy: false },
    tools: [{ name: 'get_weather', description: 'W', default_description: 'W', permission: 'allow', default_permission: 'allow', input_schema: {}, source: 'built in' }],
    ...over }) as unknown as Settings

  beforeEach(() => {
    useServer.setState({ info: server(), settings: settings() })
    useSession.setState({ provider: 'mock', model: 'claude-opus-5-5', running: false })
  })

  it('every concept is in the teaching order exactly once, and the new ones are written out', () => {
    const keys = Object.keys(CONCEPTS).sort()
    expect([...TEACHING_ORDER].sort()).toEqual(keys)
    expect(new Set(TEACHING_ORDER).size).toBe(TEACHING_ORDER.length)
    for (const k of ['judge', 'model_call', 'provider', 'mock', 'inspector', 'frozen'] as const) {
      const c = CONCEPTS[k]
      expect([c.term, c.plain, c.short, c.group].every(Boolean) && c.long.length > 0, k).toBe(true)
    }
    expect(CONCEPTS.judge).toMatchObject({ group: 'Measuring', term: 'judge (LLM-as-judge)', plain: 'a second model call that grades an answer' })
    expect(JSON.stringify(CONCEPTS)).not.toMatch(/\.\.\./)
    expect(JSON.stringify(CONCEPTS)).not.toMatch(/its length limit/)
  })

  it('F350 F362: the provider menu prices the mock as an estimate and the paid APIs in their own prices', async () => {
    render(<RTooltip.Provider><Composer /></RTooltip.Provider>)
    await userEvent.click(screen.getByRole('button', { name: /Mock \(claude -p\)/ }))
    expect(text()).toMatch(/≈ \$4\/\$20 per M tokens, estimated/)
    expect(text()).toMatch(/\$4 in \/ \$20 out per million tokens/)
    expect(text()).not.toMatch(/no token counts/)
  })

  it('F350 F354 F358 F345 F348 F364: Settings → Model', () => {
    wrap(<ModelSection />)
    expect(text()).toMatch(/No cost to you\. Tokens and cost are estimates \(about 4 characters a token, at the chosen model's price\)\./)
    expect(text()).not.toMatch(/doesn't report token counts/)
    expect(text()).toMatch(/Which model answers, how it thinks and caches, and the limits on each message\./)
    expect(text()).toMatch(/up to 12 calls per message/) // the saved limit, not the server's start-up value
    expect(text()).toMatch(/Most model calls for one message \(max_turns\)/)
    expect(text()).toMatch(/The harness's own cap; each model call counts as one\./)
    expect(text()).not.toMatch(/the API calls each call a turn/)
    expect(text()).toMatch(/Needs DEEPSEEK_API_KEY\. In PowerShell: setx DEEPSEEK_API_KEY/)
    expect(screen.getByRole('group', { name: 'Practice' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /^Limits/ }).textContent).not.toMatch(/busy service/)
  })

  it('F354: the effort menu says "Default", and the note names it', () => {
    useSession.setState({ provider: 'anthropic' })
    wrap(<ModelSection />)
    expect(text()).toMatch(/"Default" sends no thinking setting, so Opus uses its own default effort\./)
    expect(text()).not.toMatch(/"Off" sends nothing/)
  })

  it('F358 F367: Settings → Context keeps the tool results of the last N model calls, with one reason for the Anthropic API', () => {
    useSession.setState({ provider: 'anthropic' })
    wrap(<ContextSection settings={settings()} />)
    expect(screen.getByText('Keep the tool results of the last')).toBeInTheDocument()
    expect(text()).toMatch(/model calls whole/)
    expect(text()).not.toMatch(/rounds of tool results/)
    expect(text()).toMatch(/Trimming is off with the Anthropic API: it refuses a request whose earlier messages changed, and offers its own server-side option instead \(context editing\)\./)
  })

  it('F351: the nav item is "Tools" and its section keeps the full heading', () => {
    useUi.setState({ settingsOpen: true, settingsSection: 'tools' })
    wrap(<SettingsDrawer />)
    expect(screen.getByRole('button', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tools & permissions' })).toBeInTheDocument()
    useUi.setState({ settingsOpen: false })
  })

  it('F360: a saved setting says what is now true, in a sentence', async () => {
    vi.spyOn(api, 'saveSettings').mockResolvedValue(settings({ cache: { enabled: true } }))
    wrap(<ModelSection />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Mark each request/ }))
    await vi.waitFor(() => expect(useUi.getState().toasts.map((t) => t.title)).toContain('Caching is on'))
    vi.spyOn(api, 'saveSettings').mockRejectedValue(new Error('no'))
    fireEvent.click(screen.getByRole('checkbox', { name: /Mark each request/ }))
    await vi.waitFor(() => expect(useUi.getState().toasts.map((t) => t.title)).toContain("Couldn't save that change"))
    expect(useUi.getState().toasts.some((t) => t.body === 'no')).toBe(true)
  })

  it('F361: a failed call says "The model call failed."; the limit notes are buttons to the limits', () => {
    useServer.setState({ info: null })
    useSession.setState({ derived: deriveRuns(failed as HarnessEvent[]), loaded: true, running: false })
    const first = wrap(<RunView composerRef={{ current: null }} />)
    expect(text()).toMatch(/The model call failed\./)
    expect(text()).not.toMatch(/Something went wrong/)
    first.unmount()
    const events = (answer as Array<Record<string, unknown>>).map((e) => (e.kind === 'answer' ? { ...e, text: `${e.text}
[stopped early: max_tokens]` } : e))
    useSession.setState({ derived: deriveRuns(events as HarnessEvent[]), loaded: true, running: false })
    wrap(<RunView composerRef={{ current: null }} />)
    const button = screen.getByRole('button', { name: 'Settings → Model → Limits' })
    fireEvent.click(button)
    expect(useUi.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'model' })
    useUi.setState({ settingsOpen: false })
    useSession.setState({ derived: deriveRuns([]) })
  })

  it('F353 F355: one name for the reply limit, and "Message 2 · call 1" everywhere', () => {
    expect(STOP_WORDS.max_tokens).toBe('hit the longest-reply limit')
    expect(CONCEPTS.other_stop.long.join(' ')).toMatch(/the longest-reply limit \(max_tokens\)/)
  })

  it('F338 F354 F355 F363: the Inspector says what each panel is for, and marks estimates with ≈', () => {
    const model = deriveRuns(toolTurn as HarnessEvent[])
    useSession.setState({ derived: model, loaded: true })
    useUi.setState({ followLatest: false, selectedCallId: model.callOrder[1] })
    usePrefs.setState({ inspectorTab: 'summary', explained: [], learningMode: false })
    wrap(<Inspector />)
    expect(text()).toMatch(/The call in numbers: time, cost, size, and what it is made of\./)
    expect(text()).toMatch(/default \(not asked for\)/)
    expect(text()).not.toMatch(/\(estimated\)/)
    act(() => usePrefs.setState({ inspectorTab: 'sent' }))
    expect(text()).toMatch(/Exactly what the harness sent: the system prompt, the tools offered and the messages list; green is new since the previous call\./)
    act(() => usePrefs.setState({ inspectorTab: 'received' }))
    expect(text()).toMatch(/What the model sent back, block by block\./)
  })

  it('F352: the provider shows under one name, from /info', () => {
    useServer.setState({ info: server() })
    useCompare.setState({ results: { kind: 'compare', text: 'q', profileIncluded: false, sides: [
      { label: 'A', provider: 'mock', model: 'claude-opus-5-5', tools: [], seconds: 1, tokens_read: 0, tokens_written: 0, cost: null, conversation: 'c1' },
      { label: 'B', provider: 'anthropic', model: 'claude-opus-5-5', tools: [], seconds: 1, tokens_read: 0, tokens_written: 0, cost: null, conversation: 'c2' },
    ] } })
    vi.spyOn(api, 'compareHistory').mockResolvedValue({ items: [] })
    wrap(<CompareScreen />)
    expect(text()).toMatch(/Mock \(claude -p\) · claude-opus-5-5/)
    expect(text()).toMatch(/Anthropic API · claude-opus-5-5/)
    expect(text()).not.toMatch(/mock · claude-opus-5-5/)
    useCompare.setState({ results: null })
  })

  it('F359 F349c F349d F362: Compare explains its ideas, says "(not on the mock)", names the paid API and its prices', () => {
    useServer.setState({ info: server() })
    vi.spyOn(api, 'compareHistory').mockResolvedValue({ items: [] })
    useCompare.getState().setSide(0, { provider: 'anthropic' })
    useCompare.getState().setSide(1, { permissions: { get_weather: 'ask' } })
    wrap(<CompareScreen />)
    expect(screen.getByRole('button', { name: /What does "Compare side" mean\?/ })).toBeInTheDocument()
    expect(text()).toMatch(/Caching off vs on\(not on the mock\)/)
    expect(text()).not.toMatch(/API only/)
    expect(text()).toMatch(/Set to Ask first on side B: get_weather\. Nobody can be asked during a comparison, so it is blocked there\./)
    expect(text()).toMatch(/Uses the paid API: 1 conversation at \$4 in \/ \$20 out per million tokens\./)
    expect(text()).not.toMatch(/priced providers cost money/)
  })

  it('F359 F349i F349j F362 F364: Evals explains the judge, separates "not run" from "blocked", says "round" for a batch', async () => {
    useServer.setState({ info: server() })
    useSession.setState({ provider: 'anthropic' })
    useEvals.setState({ provider: 'anthropic', model: '', repeat: 3, cases: [{ question: 'q', tools: [] }] as never, history: [], viewing: null, status: { running: false, error: 'boom' } })
    vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: false })
    vi.spyOn(api, 'evalsHistory').mockResolvedValue({ runs: [] })
    vi.spyOn(api, 'evalCases').mockResolvedValue({ cases: [{ question: 'q', tools: [] }] })
    wrap(<EvalsScreen />)
    expect(text()).toMatch(/Tools set to Ask first don't run \(nobody can be asked\); tools set to Block are refused\./)
    expect(text()).toMatch(/Judge the open-ended questions with the mock \(claude-opus-5-5\)/)
    expect(text()).toMatch(/Off: they pass on tool use alone\./)
    expect(screen.getByRole('button', { name: /What does "judge \(LLM-as-judge\)" mean\?/ })).toBeInTheDocument()
    expect(text()).toMatch(/Uses the paid API: 3 conversations at \$4 in \/ \$20 out per million tokens\./)
    expect(text()).not.toMatch(/Costs real tokens/)
    expect(text()).toMatch(/The last eval round failed: boom/)
    expect(text()).toMatch(/DeepSeek · deepseek-flash \(needs DEEPSEEK_API_KEY\)/)
  })

  it('F349i F349l F363: the Evals table marks Ask-first tools "(not run)", Block rules "(blocked)", and averages as ≈ when estimated', () => {
    const case_ = { question: 'q', passed: 1, runs: 1, verdict: 'PASS', problems: [], tools: [['write_file (not run)', 'read_file (blocked)']], seconds: [2],
      tokens: [1500], cost: [null], answers: ['a'], run_problems: [[]], judge_notes: [null], conversations: [null] }
    useEvals.setState({ viewing: { id: 'r', time: 1_790_000_000, provider: 'mock', label: 'Mock', model: 'm', repeat: 1, use_my_settings: true,
      judge: null, setup: [], passed: 1, total: 1, cases: [case_], estimated: true } as never })
    wrap(<Results />)
    expect(text()).toMatch(/Average time per run/)
    expect(text()).toMatch(/Average tokens per run/)
    expect(text()).toMatch(/≈ 1\.5k/)
    expect(screen.getByTitle(/\(not run\): it needed an approval nobody could give/)).toBeInTheDocument()
    expect(screen.getByTitle(/\(blocked\): your settings block it/)).toBeInTheDocument()
  })

  it('F349j: the score chart says "round"', () => {
    const r = { id: 'a', time: 1_790_000_000, provider: 'mock', label: 'M', model: 'm', repeat: 1, use_my_settings: true, judge: 'mock', setup: [], passed: 3, total: 6, questions: 6, only: '' }
    render(<ScoreChart runs={[r]} selected="a" onPick={() => {}} />)
    expect(text()).toMatch(/click a point to see that round/)
    expect(screen.getByRole('group', { name: 'Pass rate of each past eval round' })).toBeInTheDocument()
  })

  it('F356 F357 F366 F367 F368 F374: experiment cards and the empty page', () => {
    expect(describeChange({ skills: { enabled: true, mode: 'on_demand' } }, settings())).toEqual(['skills on (on demand)'])
    expect(findExperiment('switch')!.lookAt).toBe('You are now on another model (Undo restores it). After it answers, switch back in the menu above the box and ask "What did I just ask?"')
    expect(findExperiment('trim')!.needs).toBe('the mock or DeepSeek (the Anthropic API skips trimming)')
    expect(findExperiment('cache')!.needs).toBe("the Anthropic API (the mock can't cache; DeepSeek caches on its own, so the switch shows no difference there)")
    expect(PRESETS.find((p) => p.id === 'cache')!.needs).toBe(findExperiment('cache')!.needs)
    expect(findExperiment('thinking')!.tryNext).toMatch(/"Thinking off vs on"/)
    // trimming cannot be shown on the Anthropic API; caching cannot be shown on the mock
    expect(cannotShow(findExperiment('trim')!, 'anthropic')).toBe(true)
    expect(cannotShow(findExperiment('trim')!, 'mock')).toBe(false)
    expect(cannotShow(findExperiment('cache')!, 'mock')).toBe(true)
    wrap(<EmptyState disabled={false} />)
    expect(text()).toMatch(/You're on the mock \(Claude Code's claude -p\): free, but each model call takes 20 to 60 s\./)
    expect(text()).toMatch(/Idea: a cap on calls per message \(call limit \(max_turns\)\)/)
    expect(screen.getByRole('button', { name: /Long reading, short memory/ }).textContent).toMatch(/needs the mock or DeepSeek/)
    expect(screen.getByRole('button', { name: /Long reading, short memory/ })).toBeEnabled()
  })

  it('F374: the empty page does not say it is on the mock when it is not', () => {
    useSession.setState({ provider: 'anthropic' })
    wrap(<EmptyState disabled={false} />)
    expect(text()).not.toMatch(/You're on the mock/)
    expect(screen.getByRole('button', { name: /Long reading, short memory/ })).toHaveAttribute('aria-disabled', 'true') // F373
  })

  it('F357 F370: the explanation names the plain words first, and its popover leads to the glossary', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    usePrefs.setState({ explained: [], learningMode: true })
    wrap(<Explain concept="history" />)
    expect(text()).toMatch(new RegExp(`${CONCEPTS.history.plain} \\(${CONCEPTS.history.term}\\)`))
    usePrefs.setState({ learningMode: false })
  })

  it('F370 F371: the glossary shows the long text under "More", in teaching order, with the new entries', () => {
    useUi.setState({ helpOpen: true })
    wrap(<HelpSheet />)
    const history = document.getElementById('term-history')!
    expect(history.textContent).toContain(CONCEPTS.history.short)
    expect(history.querySelector('details summary')!.textContent).toBe('More')
    for (const p of CONCEPTS.history.long) expect(history.querySelector('details')!.textContent).toContain(p)
    const ids = [...document.querySelectorAll('#glossary [id^="term-"]')].map((n) => n.id.slice(5))
    expect(ids.sort()).toEqual(Object.keys(CONCEPTS).sort())
    const order = (group: string) => [...document.querySelectorAll(`[id="group-${group}"] [id^="term-"]`)].map((n) => n.id.slice(5))
    expect(order('Basics')).toEqual(['harness', 'agent', 'model_call', 'tool', 'provider', 'mock'])
    const sizes = order('Size and cost')
    expect(sizes.indexOf('tokens')).toBeLessThan(sizes.indexOf('tools_at_once'))
    // the quiz goes in the order the experiments teach; the Evals question is last
    const tiers = [...document.querySelectorAll('#quiz h4')].map((n) => n.textContent!.replace('after: ', ''))
    const place = (t: string) => { const i = EXPERIMENTS.findIndex((x) => x.title === t); return i < 0 ? Infinity : i }
    expect(tiers).toEqual([...tiers].sort((a, b) => place(a) - place(b)))
    expect(tiers[tiers.length - 1]).toBe('the Evals screen')
    expect(text()).toMatch(/Ready, Waiting for the model, Running tools, Waiting for you, Stopping, Summarising history, and Comparing or Evaluating while those screens run\./)
    expect(text()).toMatch(/The longest-reply limit is imitated/)
    expect(text()).not.toMatch(/reply-length limit/)
    useUi.setState({ helpOpen: false })
  })

  it('F363: numbers are written with count(), dates stay dates', () => {
    useServer.setState({ info: server({ providers: [{ name: 'mock', label: 'Mock', model: 'm', context_windows: { m: 1_000_000 } }] }) })
    useSession.setState({ provider: 'mock', model: 'm' })
    wrap(<ContextSection settings={settings({ compact: { enabled: true, over_chars: 40000 } })} />)
    expect(text()).toMatch(/window \(1M tokens, at ~4 characters a token\)/)
    expect(text()).toMatch(/2,000 to 1,000,000; default 40,000/)
  })

  it('a provider that arrives later does not change the hook count; the cards follow the server meanwhile', () => {
    useSession.setState({ provider: null })
    useServer.setState({ info: server({ provider: 'anthropic' }) })
    wrap(<EmptyState disabled={false} />)
    expect(text()).not.toMatch(/You're on the mock/)
    expect(screen.getByRole('button', { name: /Long reading, short memory/ })).toHaveAttribute('aria-disabled', 'true') // F373
    act(() => useSession.setState({ provider: 'mock' }))
    expect(text()).toMatch(/You're on the mock/)
    expect(screen.getByRole('button', { name: /Long reading, short memory/ })).not.toHaveAttribute('aria-disabled')
  })

  it('F349i: the "(blocked)" tip admits older rounds counted Ask-first tools as blocked', () => {
    const case_ = { question: 'q', passed: 1, runs: 1, verdict: 'PASS', problems: [], tools: [['read_file (blocked)']], seconds: [1],
      tokens: [1], cost: [null], answers: ['a'] }
    useEvals.setState({ viewing: { id: 'r', provider: 'mock', label: 'M', model: 'm', repeat: 1, use_my_settings: true, judge: null, setup: [], passed: 1, total: 1, cases: [case_] } as never })
    wrap(<Results />)
    expect(screen.getByTitle(/rounds saved before 7 October 2026 also counted tools that needed an approval as blocked/)).toBeInTheDocument()
  })
})
