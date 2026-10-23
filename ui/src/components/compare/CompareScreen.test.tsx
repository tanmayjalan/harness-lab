import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { CompareSide, Info, RunConfig, Settings } from '../../api/types'
import { api } from '../../api/client'
import { configDiff } from '../../model/configDiff'
import { PRESETS, useCompare } from '../../store/compare'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { CompareScreen } from './CompareScreen'
import { letThroughWords } from './letThrough'
import { MiniChart } from './MiniChart'

const info = {
  provider: 'mock', model: 'claude-opus-5-5', mode: 'Mock', folder: 'workspace', max_turns: 20,
  providers: [
    { name: 'mock', label: 'Mock: replies from claude -p', model: 'claude-opus-5-5', thinking: 'budget',
      models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'], price: null },
    { name: 'anthropic', label: 'Anthropic API', model: 'claude-opus-5-5', thinking: 'adaptive', models: ['claude-opus-5-5'], price: null },
  ],
} as unknown as Info
const settings = {
  system: 'S', system_default: 'S', tools: [
    { name: 'get_weather', permission: 'allow', description: 'w', default_description: 'w', default_permission: 'allow', input_schema: {}, source: 'built in' },
  ],
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false },
} as unknown as Settings
const initial = useCompare.getState()

const side = (over: Partial<CompareSide> = {}): CompareSide => ({
  label: 'Side A · claude-opus-5-5', provider: 'mock', model: 'claude-opus-5-5', tools: [], answer: 'It is **391**.',
  seconds: 10, tokens_read: 1000, tokens_written: 50, cost: 0.01, calls: [], conversation: 'c1',
  config: { provider: 'mock', model: 'claude-opus-5-5', tools: Array.from({ length: 16 }, (_, i) => ({ name: `t${i}` })) } as never,
  ...over,
})
const show = () => render(<RTooltip.Provider><CompareScreen /></RTooltip.Provider>)
const text = () => document.body.textContent ?? ''

beforeEach(() => {
  useCompare.setState({ ...initial, sides: initial.sides.map((s) => ({ ...s })), results: null, busy: null, history: [] })
  useServer.setState({ info, settings })
  useSession.setState({ provider: 'mock', model: 'claude-opus-5-5' })
  useUi.setState({ toasts: [], compareDraft: null })
  vi.spyOn(api, 'compareHistory').mockResolvedValue({ items: [] })
})
afterEach(() => vi.restoreAllMocks())

describe('configDiff', () => {
  // F029: thinking by effort is a real difference on Anthropic
  it('shows effort where the provider uses effort, and the budget elsewhere', () => {
    const a = { provider: 'anthropic', thinking: { enabled: true, budget: 4000, effort: 'low' } } as RunConfig
    const b = { provider: 'anthropic', thinking: { enabled: true, budget: 4000, effort: 'high' } } as RunConfig
    expect(configDiff(a, b).find((d) => d.what === 'Thinking')).toEqual({ what: 'Thinking', a: 'on (effort low)', b: 'on (effort high)' })
    const c = { provider: 'mock', thinking: { enabled: true, budget: 4000 } } as RunConfig
    const d = { provider: 'mock', thinking: { enabled: true, budget: 8000 } } as RunConfig
    expect(configDiff(c, d).find((x) => x.what === 'Thinking')?.b).toBe('on (8,000 tokens)')
  })
})

describe('the Compare store', () => {
  // F133: a preset doesn't throw away a question you typed
  it('a preset keeps a question you typed and offers its own', () => {
    useCompare.setState({ text: 'my question' })
    useCompare.getState().applyPreset(PRESETS[0], 'mock')
    expect(useCompare.getState().text).toBe('my question')
    const t = useUi.getState().toasts.at(-1)!
    t.action!.run()
    expect(useCompare.getState().text).toBe(PRESETS[0].text)
  })

  // F030: "Look for" belongs to the preset; change the question and it goes
  it('changing the question after a preset drops its "Look for"', () => {
    useCompare.getState().applyPreset(PRESETS[0], 'mock')
    expect(useCompare.getState().lookFor).not.toBe('')
    useCompare.getState().setText('something else')
    expect(useCompare.getState().lookFor).toBe('')
  })

  // F027: a preset's side name doesn't stay on a different model
  it('changing a preset side\'s model drops the preset\'s name for it', () => {
    useCompare.getState().applyPreset(PRESETS[0], 'mock') // Opus / Haiku
    useCompare.getState().setSide(1, { model: 'claude-sonnet-5-5' })
    expect(useCompare.getState().sides[1].label).toBe('')
  })

  // F127: on a provider that thinks by effort, a preset's budget becomes an effort
  it('a thinking preset uses an effort on Anthropic', () => {
    useCompare.getState().applyPreset(PRESETS[1], 'anthropic')
    expect(useCompare.getState().sides[1].thinking).toEqual({ effort: 'medium' })
  })

  // F130: a comparison needs two sides
  it('keeps at least two sides', () => {
    useCompare.getState().removeSide(0)
    expect(useCompare.getState().sides).toHaveLength(2)
  })

  // F131 and review focus 5
  it('names unnamed sides by letter and model, and survives a side removed while it runs', async () => {
    let resolve!: (v: unknown) => void
    const call = vi.spyOn(api, 'compare').mockReturnValue(new Promise((r) => { resolve = r }) as never)
    vi.spyOn(api, 'compareStatus').mockResolvedValue({ running: true })
    vi.spyOn(api, 'conversations').mockResolvedValue({ current: '', items: [] } as never)
    useCompare.setState({ text: 'q' })
    useCompare.getState().addSide()
    const running = useCompare.getState().run()
    const body = call.mock.calls[0][0] as { sides: { label: string }[]; look_for: string }
    expect(body.sides.map((s) => s.label)).toEqual(['Side A · claude-opus-5-5', 'Side B · claude-opus-5-5', 'Side C · claude-opus-5-5'])
    useCompare.getState().removeSide(2)
    await act(async () => { resolve({ id: 'x', results: [side(), side(), side()], profile_included: false }); await running })
    expect(useCompare.getState().results?.sides).toHaveLength(3)
  })

  // A progress check that comes back after the comparison has ended must not bring the progress back
  it('a late progress check after the end leaves no progress showing', async () => {
    vi.useFakeTimers()
    try {
      let finish!: (v: unknown) => void
      let late!: (v: unknown) => void
      vi.spyOn(api, 'compare').mockReturnValue(new Promise((r) => { finish = r }) as never)
      vi.spyOn(api, 'compareStatus').mockReturnValue(new Promise((r) => { late = r }) as never)
      vi.spyOn(api, 'conversations').mockResolvedValue({ current: '', items: [] } as never)
      useCompare.setState({ text: 'q' })
      const running = useCompare.getState().run()
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) }) // a progress check goes out
      await act(async () => { finish({ id: 'x', results: [side(), side()], profile_included: false }); await running })
      expect(useCompare.getState().progress).toBeNull()
      await act(async () => { late({ running: true, sides: [{ done: 1 }, { done: 1 }] }); await vi.advanceTimersByTimeAsync(0) })
      expect(useCompare.getState().progress).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the Compare screen', () => {
  // F021: results come first, where you are looking
  it('shows results above the setup', () => {
    useCompare.setState({ text: 'q', results: { kind: 'compare', text: 'q', sides: [side(), side({ label: 'Side B' })], profileIncluded: false } })
    show()
    const results = screen.getByRole('region', { name: 'Results' })
    const question = screen.getByRole('textbox', { name: 'Question' })
    expect(results.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // F024: while it runs: each side's progress, the time so far, and a Stop
  it('shows each side\'s progress and a Stop while running', () => {
    useCompare.setState({ busy: 'compare', busyText: 'Running both sides…', progress: [{ label: 'A', done: 1 }, { label: 'B', done: 2 }], repeatRunning: 3, startedAt: Date.now() })
    show()
    expect(text()).toMatch(/A: 1 of 3 runs done/)
    expect(text()).toMatch(/B: 2 of 3 runs done/)
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument()
    // F326a: the words stay still (the spinner shows it is working)
    for (const el of document.querySelectorAll('.animate-pulse-soft')) expect(el.textContent).toBe('')
  })

  // F129: how many runs before you press Run
  it('says how many conversations a run makes, before the Run button', () => {
    useCompare.setState({ repeat: 3 })
    show()
    expect(text()).toMatch(/2 sides × 3 runs = 6 conversations/)
    const select = screen.getByRole('combobox', { name: /Runs per side/ })
    const run = screen.getByRole('button', { name: /^Run/ })
    expect(select.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // F028: a preset the mock can't show is marked and can't be picked there
  it('marks API-only presets on the mock', () => {
    show()
    expect(screen.getByRole('button', { name: /Caching off vs on/ })).toHaveAttribute('aria-disabled', 'true') // F373
  })

  // F033: a folded side still says what it changes
  it('a folded side lists its changes in words', () => {
    useCompare.getState().setSide(0, { permissions: { get_weather: 'block' } })
    show()
    expect(text()).toMatch(/get_weather: Block/)
  })

  // F031, F135, F136, F134, F128, F032, F132
  it('result cards say why a tool was refused, count tools offered, and compare cost', () => {
    const a = side({ tools: [{ name: 'calculate', input: {}, }] })
    const b = side({ label: 'Side B', cost: 0.02, tools: [{ name: 'write_file', input: {}, blocked: true, outcome: 'blocked' }] })
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [a, b], profileIncluded: false } })
    show()
    expect(text()).toMatch(/write_file\(\).*not run: blocked or needed an approval nobody could give/)
    expect(text()).toMatch(/16 tools offered/)
    expect(text()).toMatch(/\+\$0\.01/)
  })

  // M5 live check: with one run per side, Stop cuts the run short, so "fewer runs" was wrong
  it('a stopped side says Stop was pressed, whatever the number of runs', () => {
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [side({ stopped: true, answer: '' }), side({ label: 'Side B' })], profileIncluded: false } })
    show()
    expect(text()).toMatch(/Stopped early: Stop was pressed before every run finished\./)
    expect(text()).not.toMatch(/fewer runs than asked for/)
  })
  it('several runs: medians in the tiles, tool agreement, every answer as text', () => {
    const stats = { runs: 3, seconds: { median: 11, min: 10, max: 12 }, tokens_read: { median: 1000, min: 900, max: 1100 },
      tokens_written: { median: 40, min: 30, max: 50 }, cost: null, same_answer: 2, answered: 3, same_tools: 3,
      tools: [['calculate'], ['calculate'], ['calculate']], errors: 0, answers: ['It is **391**.', 'It is 391.', 'Prime? No.'] }
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [side({ stats }), side({ label: 'B', stats })], profileIncluded: false } })
    show()
    expect(text()).toMatch(/Time \(middle of 3\)/)
    expect(text()).toMatch(/Same tools in 3 of 3/)
    expect(text()).toMatch(/Same answer in 2 of 3/)
    fireEvent.click(screen.getAllByText(/Read all 3 answers/)[0])
    expect(screen.getAllByText('391').length).toBeGreaterThan(0) // markdown, not "**391**"
  })

  // F023: past comparisons are listed and can be opened
  it('lists past comparisons and opens one', async () => {
    vi.spyOn(api, 'compareHistory').mockResolvedValue({ items: [{ id: 'p1', time: 1791062289, text: 'old question', repeat: 1, sides: ['A', 'B'] }] })
    vi.spyOn(api, 'compareGet').mockResolvedValue({ id: 'p1', time: 1791062289, text: 'old question', look_for: '', repeat: 1, sides: [side(), side({ label: 'B' })] })
    show()
    await screen.findByText(/old question/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Open “old question”/ })) })
    expect(useCompare.getState().results?.text).toBe('old question')
  })

  // F026: "Compare this question" starts from the model you were using, with one difference
  it('a question from the chat starts side A on your model and side B on another', () => {
    useSession.setState({ provider: 'mock', model: 'claude-sonnet-5-5' })
    useUi.setState({ compareDraft: { text: 'from the chat' } })
    show()
    const sides = useCompare.getState().sides
    expect(sides[0]).toMatchObject({ provider: 'mock', model: 'claude-sonnet-5-5' })
    expect(sides[1].model).not.toBe('claude-sonnet-5-5')
  })
})

const stats3 = (over: Partial<NonNullable<CompareSide['stats']>> = {}) => ({
  runs: 3, seconds: { median: 11, min: 10, max: 12 }, tokens_read: { median: 1000, min: 900, max: 1100 },
  tokens_written: { median: 40, min: 30, max: 50 }, cost: null, same_answer: 2, answered: 3, same_tools: 3,
  tools: [['calculate'], ['calculate'], ['calculate']], errors: 0, stopped: 0, answers: ['4', '4', 'four'], failures: [], ...over,
})

describe('second review: Compare', () => {
  // F245: since M5, Stop ends a run at its next step
  it('Stop says a run stops at its next step', async () => {
    useCompare.setState({ busy: 'compare', progress: [{ label: 'A', done: 0 }, { label: 'B', done: 0 }], repeatRunning: 1, startedAt: Date.now() })
    show()
    expect(screen.getByRole('button', { name: /Stop/ }).getAttribute('title')).toMatch(/stops at its next step/)
    vi.spyOn(api, 'compareStop').mockResolvedValue({} as never)
    await act(async () => { await useCompare.getState().stop() })
    expect(useCompare.getState().busyText).toMatch(/each run stops at its next step/)
    expect(useCompare.getState().busyText).not.toMatch(/finishes the run it is on/)
  })

  // F246, F247: failed and stopped runs are counted apart, and the errors aren't listed as answers
  it('counts failed and stopped runs apart from the answered ones', () => {
    const stats = stats3({ runs: 5, answered: 2, same_answer: 2, same_tools: 2, errors: 2, stopped: 1,
      tools: [['calculate'], ['calculate']], answers: ['4', '4'], failures: ['Could not reach the service.', 'Could not reach the service.'] })
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [side({ stats }), side({ label: 'B', stats })], profileIncluded: false } })
    show()
    expect(text()).toMatch(/Same tools in 2 of 2/)
    expect(text()).toMatch(/Same answer in 2 of 2/)
    expect(text()).toMatch(/2 runs failed · 1 stopped/)
    expect(text()).toMatch(/Time \(middle of 2\)/)
    expect(text()).toMatch(/Over 5 runs \(middle, range of the 2 that answered\)/)
    expect(text()).toMatch(/Failed: Could not reach the service\. \(2 runs\)/)
  })

  // F248: the tiles and chart that come from the first run say so; "1 run", not "1 runs"
  it('says which figures come from the first run only', () => {
    const stats = stats3({ runs: 1, answered: 1, same_answer: 1, same_tools: 1, tools: [['calculate']], answers: ['4'] })
    const calls = [{ turn: 1, input_tokens: 500, cache_read: 0 }] as never
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [side({ stats, calls }), side({ label: 'B', stats, calls })], profileIncluded: false } })
    show()
    expect(text()).toMatch(/Model calls \(first run\)/)
    expect(text()).toMatch(/tokens in, per call \(first run\)/)
    expect(text()).toMatch(/Over 1 run \(middle, range\)/)
  })

  // F249: the note gives the time for every run, and the clock reads m:ss
  it('gives the time for every run and the clock in minutes and seconds', async () => {
    let resolve!: (v: unknown) => void
    vi.spyOn(api, 'compare').mockReturnValue(new Promise((r) => { resolve = r }) as never)
    vi.spyOn(api, 'compareStatus').mockResolvedValue({ running: true })
    vi.spyOn(api, 'conversations').mockResolvedValue({ current: '', items: [] } as never)
    useCompare.setState({ text: 'q', repeat: 5 })
    const running = useCompare.getState().run()
    expect(useCompare.getState().busyText).toMatch(/On the mock that takes about 2 to 5 minutes/)
    useCompare.setState({ startedAt: Date.now() - 143_000 })
    show()
    expect(text()).toMatch(/2:23/)
    await act(async () => { resolve({ id: 'x', results: [side(), side()], profile_included: false }); await running })
  })

  // F250: adding or removing a side is a different comparison: the preset's "Look for" goes
  it('adding or removing a side drops the preset\'s "Look for"', () => {
    useCompare.getState().applyPreset(PRESETS[0], 'mock')
    useCompare.getState().addSide()
    expect(useCompare.getState().lookFor).toBe('')
    expect(useCompare.getState().preset).toBeNull()
    // three sides from a preset (as if it had three), then one removed
    useCompare.getState().applyPreset(PRESETS[0], 'mock')
    const sides = useCompare.getState().sides
    useCompare.setState({ sides: [...sides, { ...sides[0], id: 'third' }] })
    useCompare.getState().removeSide(2)
    expect(useCompare.getState().lookFor).toBe('')
  })

  // F251: an open side stays with its side after another is removed, and focus has somewhere to go
  it('keeps an open panel with its side and puts focus somewhere after add and remove', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: /Add a side/ }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name of side C' }))
    const panels = () => screen.getAllByRole('button', { name: /Changes for this side only/ })
    expect(panels()[1].getAttribute('aria-expanded')).toBe('true') // side B opens by itself
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of side C' }), { target: { value: 'Third' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove side A' }))
    // B is now first and still open; "Third" is second and still closed
    expect(panels()[0].getAttribute('aria-expanded')).toBe('true')
    expect(panels()[1].getAttribute('aria-expanded')).toBe('false')
    expect((screen.getByRole('textbox', { name: 'Name of side B' }) as HTMLInputElement).value).toBe('Third')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Add a side/ }))
  })

  // F252, F255: results and the table carry the side's letter; an unnamed side doesn't show its model twice
  it('shows each side\'s letter on its card and in the table, and the model once', () => {
    const a = side({ config: { provider: 'mock', model: 'claude-opus-5-5', permissions: {} } as never })
    const b = side({ label: 'Side B · claude-haiku-4-5-20251001', model: 'claude-haiku-4-5-20251001',
      config: { provider: 'mock', model: 'claude-haiku-4-5-20251001', permissions: {} } as never })
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [a, b], profileIncluded: false } })
    show()
    const cards = screen.getAllByRole('article')
    expect(cards[0].querySelector('header')?.textContent).toMatch(/^A/)
    expect(cards[1].querySelector('header')?.textContent).toMatch(/^B/)
    const heads = [...document.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads[1]).toBe('ASide A · claude-opus-5-5')
    expect(heads[2]).toBe('BSide B · claude-haiku-4-5-20251001')
  })

  // F253: "(same)" isn't coloured like a change
  it('"(same)" in the table is not coloured like a change', () => {
    const cfg = (over: object) => ({ provider: 'mock', model: 'claude-opus-5-5', permissions: {}, ...over }) as never
    const sides = [side({ config: cfg({}) }), side({ label: 'B', config: cfg({ model: 'claude-haiku-4-5-20251001' }) }),
      side({ label: 'C', config: cfg({ cache: { enabled: true } }) })]
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides, profileIncluded: false } })
    show()
    const same = screen.getAllByText('(same)')
    expect(same.length).toBeGreaterThan(0)
    same.forEach((cell) => expect(cell.className).not.toMatch(/text-warn/))
  })

  // F349f: the settings table scrolls inside its card and long values wrap, like Evals'
  it('the settings table has an overflow wrapper, top-aligned cells and word breaking', () => {
    const cfg = (over: object) => ({ provider: 'mock', model: 'claude-opus-5-5', permissions: {}, ...over }) as never
    const sides = [side({ config: cfg({}) }), side({ label: 'B', config: cfg({ model: 'claude-haiku-4-5-20251001' }) })]
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides, profileIncluded: false } })
    show()
    const table = screen.getByRole('table')
    expect(table.parentElement!.className).toMatch(/\boverflow-x-auto\b/)
    for (const cell of table.querySelectorAll('td')) expect(cell.className).toMatch(/\balign-top\b.*\bbreak-words\b|\bbreak-words\b.*\balign-top\b/)
    for (const th of table.querySelectorAll('th')) expect(th.className).toMatch(/\bpr-3\b/)
  })

  // F349 (was F254's optgroups): every option names its provider, so a model id seen twice is not ambiguous
  it('every option names its provider', () => {
    show()
    const select = screen.getAllByRole('combobox').find((s) => [...s.querySelectorAll('option')].some((o) => /claude-haiku/.test(o.textContent ?? '')))!
    expect(select.querySelector('optgroup')).toBeNull()
    const options = [...select.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toContain('Mock (claude -p) · claude-haiku-4-5-20251001')
    expect(options).toContain('Anthropic API · claude-opus-5-5')
    expect(options.every((o) => / · /.test(o ?? ''))).toBe(true)
  })

  // F256: a long list of side names gives way to the question
  it('past comparisons truncate the side names, with the full list in a tooltip', async () => {
    const sides = ['Side A · claude-opus-5-5', 'Side B · claude-sonnet-5-5', 'Side C · claude-haiku-4-5-20251001']
    vi.spyOn(api, 'compareHistory').mockResolvedValue({ items: [{ id: 'p1', time: 1791062289, text: 'old question', repeat: 1, sides }] })
    show()
    const names = await screen.findByText(/Side A · claude-opus-5-5 vs/)
    expect(names.className).toMatch(/truncate/)
    expect(names.className).not.toMatch(/shrink-0/)
    expect(names.getAttribute('title')).toBe(sides.join(' vs '))
  })

  // F257: "Compare this question" starts from two clean sides, not on top of an older comparison
  it('a question from the chat replaces an older setup', () => {
    useCompare.getState().addSide()
    useCompare.getState().setSide(1, { permissions: { get_weather: 'block' }, system: 'old prompt' })
    useCompare.getState().applyPreset(PRESETS[0], 'mock')
    useCompare.getState().addSide()
    useUi.setState({ compareDraft: { text: 'from the chat' } })
    show()
    const st = useCompare.getState()
    expect(st.sides).toHaveLength(2)
    expect(st.sides[1]).toMatchObject({ system: '', permissions: {} })
    expect(st.preset).toBeNull()
    expect(st.lookFor).toBe('')
  })

  // F258: the Ask-first note names the sides where a tool asks
  it('the Ask-first note names the sides where the tool asks', () => {
    useCompare.getState().setSide(1, { permissions: { get_weather: 'ask' } })
    show()
    expect(text()).toMatch(/Set to Ask first on side B: get_weather\. Nobody can be asked during a comparison/)
    expect(text()).not.toMatch(/on every side/)
  })

  // Final review: clauses after the first carry on the sentence, so they start lower case
  it('the Ask-first note joins clauses for different sides in one sentence', () => {
    useServer.setState({ settings: { ...settings, tools: [...settings.tools,
      { ...settings.tools[0], name: 'write_file' }] } as Settings })
    useCompare.getState().setSide(0, { permissions: { get_weather: 'ask' } })
    useCompare.getState().setSide(1, { permissions: { write_file: 'ask' } })
    show()
    expect(text()).toMatch(/Set to Ask first on side A: get_weather; set to Ask first on side B: write_file\. Nobody can be asked/)
  })

  // F259: "Run both", "Run all 3"
  it('says "Run both" for two sides and "Run all 3" for three', () => {
    useCompare.setState({ text: 'q' })
    show()
    expect(screen.getByRole('button', { name: 'Run both' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add a side/ }))
    expect(screen.getByRole('button', { name: 'Run all 3' })).toBeInTheDocument()
  })
})

// A re-run's results: the saved run and the same message with current settings
const cfgTools = (rules: Record<string, string>) =>
  ({ provider: 'mock', model: 'claude-opus-5-5', permissions: {}, tools: Object.entries(rules).map(([name, permission]) => ({ name, permission })) }) as never
const rerunOf = (base: Partial<CompareSide>, now: Partial<CompareSide>) => ({
  kind: 'rerun' as const, text: 'write it', conversation: 'conv1', seq: 3, id: 'rr1',
  sides: [side({ label: 'Saved run', model: 'claude-haiku-4-5-20251001', provider: 'mock', conversation: 'conv1', ...base }),
    side({ label: 'Current settings', conversation: 'c-now', ...now })],
})

describe('second review: Re-run', () => {
  // F260: opening the saved run doesn't switch your model, or name a side that isn't on screen
  it('opening the saved run keeps your model', async () => {
    const open = vi.spyOn(api, 'openConversation').mockResolvedValue({} as never)
    const sw = vi.spyOn(api, 'switchProvider')
    useCompare.setState({ results: rerunOf({}, {}) })
    show()
    const buttons = screen.getAllByRole('button', { name: /Open the conversation/ })
    expect(buttons).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Inspect this side/ })).toBeNull()
    await act(async () => { fireEvent.click(buttons[0]) })
    expect(open).toHaveBeenCalled()
    expect(sw).not.toHaveBeenCalled()
    expect(useUi.getState().toasts.map((t) => t.title).join(' ')).not.toMatch(/Switched/)
  })

  // F261, F262: a re-run keeps what was on screen, shows a clock and a Stop, and is kept in Past comparisons
  it('keeps the old results, offers Stop and a clock, and lands in Past comparisons', async () => {
    const old = { kind: 'compare' as const, text: 'q', sides: [side(), side({ label: 'B' })], profileIncluded: false }
    useCompare.setState({ results: old })
    let resolve!: (v: unknown) => void
    const call = vi.spyOn(api, 'rerun').mockReturnValue(new Promise((r) => { resolve = r }) as never)
    vi.spyOn(api, 'conversations').mockResolvedValue({ current: '', items: [] } as never)
    const history = vi.spyOn(api, 'compareHistory')
    show()
    let running!: Promise<void>
    act(() => { running = useCompare.getState().rerun('conv1', 3, 'write it') })
    expect(call.mock.calls[0]).toEqual(['conv1', 3, false])
    expect(useCompare.getState().results).toBe(old)
    expect(screen.getByText('Previous results')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument()
    expect(text()).toMatch(/\b\d+s\b/) // Task 8: the one elapsed format, seconds under a minute
    const loads = history.mock.calls.length
    await act(async () => { resolve({ text: 'write it', baseline: side({ label: 'Saved run' }), rerun: side({ label: 'Current settings' }), id: 'rr1' }); await running })
    expect(useCompare.getState().results).toMatchObject({ kind: 'rerun', id: 'rr1' })
    expect(history.mock.calls.length).toBeGreaterThan(loads)
  })

  // F261: a saved re-run opens as a re-run
  it('opens a saved re-run as a re-run', async () => {
    vi.spyOn(api, 'compareGet').mockResolvedValue({ id: 'rr1', time: 1, text: 'write it', look_for: '', repeat: 1, kind: 'rerun',
      conversation: 'conv1', seq: 3, sides: [side({ label: 'Saved run' }), side({ label: 'Current settings' })] } as never)
    await act(async () => { await useCompare.getState().openPast('rr1') })
    expect(useCompare.getState().results).toMatchObject({ kind: 'rerun', conversation: 'conv1', seq: 3, id: 'rr1' })
  })

  // F263, F264: tools set to Ask first get the retry, with a warning; tools set to Block say so instead
  it('offers the retry for Ask-first tools with a warning, and says when a tool is set to Block', () => {
    const blocked = (name: string) => ({ name, input: {}, blocked: true, outcome: 'blocked' })
    useCompare.setState({ results: rerunOf({ approved: [] },
      { tools: [blocked('write_file'), blocked('remember_fact'), blocked('get_weather')],
        config: cfgTools({ write_file: 'ask', remember_fact: 'ask', get_weather: 'block' }) }) })
    show()
    expect(text()).toMatch(/write_file and remember_fact are set to Ask first/)
    expect(text()).toMatch(/so they were blocked/)
    expect(text()).toMatch(/get_weather is set to Block now/)
    const retry = screen.getByRole('button', { name: /Re-run letting Ask-first tools run/ })
    expect(retry.parentElement?.textContent).toMatch(/writes really happen/i)
  })

  // F298: a tool refused because nobody could be asked says so, and a re-run offers the retry for it
  it('says "nobody to ask" on the card and offers the retry', () => {
    const unattended = { name: 'write_file', input: {}, blocked: true, outcome: 'unattended' }
    useCompare.setState({ results: rerunOf({}, { tools: [unattended], config: cfgTools({ write_file: 'ask' }) }) })
    show()
    expect(text()).toMatch(/write_file\(\)not run: needs your OK, and nobody can be asked here/)
    expect(screen.getByRole('button', { name: /Re-run letting Ask-first tools run/ })).toBeInTheDocument()
  })

  // F389: the re-run names every Ask-first tool it lets through, and asks again before running unseen code
  it('names the tools a re-run lets through, and asks once more when run_python is one', () => {
    const call = vi.fn()
    const unattended = { name: 'write_file', input: {}, blocked: true, outcome: 'unattended' }
    useCompare.setState({ results: rerunOf({}, { tools: [unattended], config: cfgTools({ write_file: 'ask', run_python: 'ask', calculate: 'allow' }) }) })
    useCompare.setState({ rerun: call as never })
    show()
    const retry = screen.getByRole('button', { name: 'Re-run letting Ask-first tools run: write_file and run_python' })
    expect(text()).toMatch(/Code the model writes will run as you, without you seeing it first, in one run/)
    fireEvent.click(retry)
    expect(call).not.toHaveBeenCalled()
    expect(text()).toMatch(/Let the model's code run without you seeing it first\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, re-run and let it run' }))
    expect(call).toHaveBeenCalledWith('conv1', 3, 'write it', true)
  })
})

describe('F389: letting Ask-first tools run in a comparison', () => {
  const withCode = () => {
    useServer.setState({ settings: { ...settings, run_code: { enabled: true }, tools: [...settings.tools,
      { ...settings.tools[0], name: 'run_python', permission: 'ask' }] } as Settings })
    useCompare.getState().setSide(1, { runCode: true })
    useCompare.setState({ repeat: 3 })
  }

  it('names the tools, and says code runs unseen up to sides × runs times', () => {
    withCode()
    show()
    const box = screen.getByRole('checkbox', { name: /Let Ask-first tools run for this comparison: run_python/ })
    expect(box).toHaveAccessibleName(/Code the model writes will run as you, without you seeing it first, in up to 6 runs/)
    expect(box).not.toHaveAccessibleName(/paths outside the workspace are still refused/)
  })

  it('names MCP tools and remember_fact for what they are', () => {
    expect(letThroughWords(['remember_fact', 'notes__add', 'write_file'], 0)).toEqual([
      'remember_fact: facts the model saves about you are shared in every future conversation.',
      'notes__add: another program decides what it does.',
      'write_file: writes really happen; paths outside the workspace are still refused.',
    ])
  })

  it('is unticked again after the comparison runs', async () => {
    vi.spyOn(api, 'compare').mockResolvedValue({ id: 'x', results: [side(), side()], profile_included: false } as never)
    vi.spyOn(api, 'compareStatus').mockResolvedValue({ running: false } as never)
    vi.spyOn(api, 'conversations').mockResolvedValue({ current: '', items: [] } as never)
    useCompare.setState({ text: 'q', allowAsk: true })
    await act(async () => { await useCompare.getState().run() })
    expect(useCompare.getState().allowAsk).toBe(false)
  })
})

describe('second review: Re-run, continued', () => {
  // F265: what "current settings" covers, said once; facts about you aren't a second, unexplained prompt change
  it('says what current settings covers, and puts a facts change in one row', () => {
    const base = { config: { provider: 'mock', model: 'claude-opus-5-5', permissions: {}, system: 'S', facts_shared: 0 } as never }
    const now = { config: { provider: 'mock', model: 'claude-opus-5-5', permissions: {}, system: 'S\n\nFacts: Celsius', facts_shared: 1 } as never }
    useCompare.setState({ results: rerunOf(base, now) })
    show()
    expect(screen.getByRole('heading', { name: 'Saved run vs current settings' })).toBeInTheDocument()
    expect(text()).toMatch(/Current settings: your model, prompt, tools and permissions, thinking, caching, limits and the facts about you/)
    expect(text()).not.toMatch(/different text/)
    expect(text()).toMatch(/Facts about you01 \(added to the system prompt\)/)
  })

  // F266: Re-run during a comparison says why nothing happens
  it('says so when a comparison is already running', async () => {
    const call = vi.spyOn(api, 'rerun')
    useCompare.setState({ busy: 'compare' })
    await act(async () => { await useCompare.getState().rerun('conv1', 3, 'q') })
    expect(call).not.toHaveBeenCalled()
    const t = useUi.getState().toasts.at(-1)!
    expect(t.title).toMatch(/comparison is running/)
    expect(t.action?.label).toBe('Go to Compare')
  })

  // F268: a saved run from before settings were recorded doesn't claim "the same"
  it('says the saved run did not record its settings', () => {
    useCompare.setState({ results: rerunOf({ config: null as never }, {}) })
    show()
    expect(text()).toMatch(/The saved run didn't record its settings/)
    expect(text()).not.toMatch(/The settings are the same/)
  })

  // F269: using the question starts a fresh comparison, says what isn't sent, and takes you to it
  it('"Use this question in a comparison" moves you to the question and says the earlier messages are not sent', () => {
    useCompare.setState({ results: rerunOf({}, {}) })
    show()
    fireEvent.click(screen.getByRole('button', { name: /Use this question in a comparison/ }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Question' }))
    expect((document.activeElement as HTMLTextAreaElement).value).toBe('write it')
    expect(text()).toMatch(/the messages before it in the conversation aren't sent/)
  })
})

// Deferred M4: results arriving don't pull focus out of a box you're typing in
describe('focus when results arrive', () => {
  const two = { kind: 'compare' as const, text: 'q', sides: [side(), side({ label: 'Side B' })], profileIncluded: false }
  it('stays in the question box while you type', () => {
    show()
    const box = screen.getByRole('textbox', { name: 'Question' })
    box.focus()
    act(() => { useCompare.setState({ results: two }) })
    expect(document.activeElement).toBe(box)
  })
  it('goes to the results heading when you were not typing', () => {
    show()
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => { useCompare.setState({ results: two }) })
    expect(document.activeElement?.textContent).toBe('Results')
  })
})

describe('Undo in Compare (F329)', () => {
  it('a removed side comes back at its place with its setup', () => {
    useCompare.getState().addSide()
    useCompare.getState().setSide(1, { label: 'Middle', system: 'Be brief.' })
    const ids = useCompare.getState().sides.map((s) => s.id)
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Remove side B' }))
    expect(useCompare.getState().sides).toHaveLength(2)
    act(() => { useUi.getState().toasts.at(-1)!.action!.run() })
    expect(useCompare.getState().sides.map((s) => s.id)).toEqual(ids)
    expect(useCompare.getState().sides[1]).toMatchObject({ label: 'Middle', system: 'Be brief.' })
  })

  it('a preset can be undone, and brings back the old sides, question and "Look for"', () => {
    useCompare.setState({ text: '' })
    const before = useCompare.getState().sides
    useCompare.getState().applyPreset(PRESETS[0], 'mock')
    const t = useUi.getState().toasts.find((x) => x.title === `"${PRESETS[0].title}" set up both sides`)!
    expect(t.action?.label).toBe('Undo')
    t.action!.run()
    expect(useCompare.getState()).toMatchObject({ sides: before, text: '', preset: null, lookFor: '' })
  })
})

// F349a: with one run, a difference is noise, not better or worse
describe('deltas', () => {
  it('with one run a 0.7 s difference is not called better', () => {
    const a = side({ seconds: 10 })
    const b = side({ label: 'B', seconds: 9.3 })
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [a, b], profileIncluded: false } })
    show()
    expect(text()).toMatch(/−0\.7 ?s/)
    expect(text()).not.toMatch(/\(better\)/)
    expect(screen.getAllByTitle(/Too few runs to call better or worse/).length).toBeGreaterThan(0)
    // F441: no arrow on a single-run difference, and the reason is on the page, not only in a tooltip
    expect(screen.getAllByTitle(/than side A/).every((el) => !el.querySelector('svg'))).toBe(true)
    expect(text()).toMatch(/One run per side: a model answers differently from run to run/)
  })

  it('with three runs a big difference whose ranges overlap is not called better', () => {
    const stats = (median: number, min: number, max: number) => ({ runs: 3, seconds: { median, min, max },
      tokens_read: { median: 1000, min: 1000, max: 1000 }, tokens_written: { median: 40, min: 40, max: 40 }, cost: null,
      same_answer: 3, answered: 3, same_tools: 3, tools: [[], [], []], errors: 0, answers: ['a', 'a', 'a'] })
    useCompare.setState({ results: { kind: 'compare', text: 'q', profileIncluded: false,
      sides: [side({ stats: stats(10, 4, 12) }), side({ label: 'B', stats: stats(5, 3, 9) })] } })
    show()
    expect(text()).not.toMatch(/\(better\)/)
    expect(screen.getAllByTitle(/runs overlap, so it isn't called better or worse/).length).toBeGreaterThan(0)
  })

  // F442: a comparison can be kept as a file
  it('results can be downloaded as JSON', () => {
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [side({}), side({ label: 'B' })], profileIncluded: false } })
    show()
    expect(screen.getByRole('button', { name: /Download as JSON/ })).toBeInTheDocument()
  })

  it('with three runs and a big difference it is called better or worse', () => {
    const stats = (s: number) => ({ runs: 3, seconds: { median: s, min: s, max: s }, tokens_read: { median: 1000, min: 1000, max: 1000 },
      tokens_written: { median: 40, min: 40, max: 40 }, cost: null, same_answer: 3, answered: 3, same_tools: 3,
      tools: [[], [], []], errors: 0, answers: ['a', 'a', 'a'] })
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [side({ stats: stats(10) }), side({ label: 'B', stats: stats(5) })], profileIncluded: false } })
    show()
    expect(text()).toMatch(/\(better\)/)
  })

  it('with three runs a difference under 10 % is still not called better', () => {
    const stats = (s: number) => ({ runs: 3, seconds: { median: s, min: s, max: s }, tokens_read: { median: 1000, min: 1000, max: 1000 },
      tokens_written: { median: 40, min: 40, max: 40 }, cost: null, same_answer: 3, answered: 3, same_tools: 3,
      tools: [[], [], []], errors: 0, answers: ['a', 'a', 'a'] })
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [side({ stats: stats(10) }), side({ label: 'B', stats: stats(9.5) })], profileIncluded: false } })
    show()
    expect(text()).not.toMatch(/\(better\)/)
  })
})

describe('compare polish', () => {
  // F349e
  it('past comparisons say how long ago, like the sidebar', async () => {
    vi.spyOn(api, 'compareHistory').mockResolvedValue({ items: [{ id: 'p1', time: Date.now() / 1000, text: 'fresh question', repeat: 1, sides: ['A', 'B'] }] })
    show()
    await screen.findByText(/fresh question/)
    expect(text()).toMatch(/just now/)
  })

  // F349g
  it('says what the preset set that the side panel cannot show', () => {
    const at = PRESETS.find((p) => p.id === 'at_once')!
    useCompare.getState().applyPreset(at, 'mock')
    show()
    fireEvent.click(screen.getAllByRole('button', { name: /Changes for this side only/ })[0])
    expect(text()).toMatch(/Set by the preset: tools one by one\. Pick another preset to clear it\./)
  })

  // F349m
  it('the picked preset is marked for assistive technology too', () => {
    useCompare.getState().applyPreset(PRESETS[0], 'mock')
    show()
    expect(screen.getByRole('button', { name: new RegExp(PRESETS[0].title) })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: new RegExp(PRESETS[1].title) })).toHaveAttribute('aria-pressed', 'false')
  })

  // F349o
  it('previous results are not faded: a banner and a dashed border say what they are', () => {
    useCompare.setState({ results: { kind: 'compare', text: 'q', sides: [side(), side({ label: 'B' })], profileIncluded: false }, busy: 'compare' as never })
    show()
    const region = screen.getByRole('region', { name: 'Results' })
    expect(region.className).not.toMatch(/opacity-60/)
    expect(region.className).toMatch(/border-dashed/)
    expect(text()).toMatch(/Previous results, while the new comparison runs/)
  })
})

// Third pass, Task 9 (F335): the small chart says its values
describe('MiniChart (F335)', () => {
  it('names the tokens each call read', () => {
    const calls = [{ turn: 1, input_tokens: 1000, cache_read: 200 }, { turn: 2, input_tokens: 3000, cache_read: 0 }] as unknown as NonNullable<CompareSide['calls']>
    render(<MiniChart calls={calls} firstRun={false} />)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Tokens read by each call: call 1 1.2k, call 2 3k')
  })
})

// Third pass, Task 9 (F373): a preset the mock can't show stays reachable and says why
describe('presets that cannot run here (F373)', () => {
  it('are aria-disabled with the reason as their description, and a click does nothing', () => {
    useSession.setState({ provider: 'mock' })
    show()
    const needy = PRESETS.find((p) => p.needs)!
    const b = screen.getByRole('button', { name: new RegExp(needy.title) })
    expect(b).not.toBeDisabled()
    expect(b).toHaveAttribute('aria-disabled', 'true')
    expect(b).toHaveAccessibleDescription(/the mock can't show this/)
    fireEvent.click(b)
    expect(useCompare.getState().preset?.id).not.toBe(needy.id)
  })
})
