import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { EvalCase, EvalResult, EvalRun, Info, Settings } from '../../api/types'
import { api } from '../../api/client'
import { useEvals } from '../../store/evals'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { EvalsScreen, Results, ScoreChart } from './EvalsScreen'

const info = { provider: 'mock', model: 'claude-opus-5-5', providers: [{ name: 'mock', label: 'Mock', model: 'claude-opus-5-5', models: ['claude-opus-5-5'], price: null }] } as unknown as Info
const row = (over: Partial<EvalCase> = {}): EvalCase => ({
  question: 'What is 2+2?', passed: 3, runs: 3, verdict: 'PASS', problems: [], tools: [['calculate'], ['calculate'], []],
  seconds: [1, 2, 3], tokens: [100, 200, 300], cost: [null, null, null], answers: ['It is **4**.', '4', 'four'],
  checked: ['uses calculate', "answer mentions '4'"], judge_notes: [null, null, null], conversations: ['c1', 'c2', 'c3'], ...over,
})
const result = (over: Partial<EvalResult> = {}): EvalResult => ({
  id: 'r1', time: 1_790_000_000, provider: 'mock', label: 'Mock', model: 'claude-opus-5-5', repeat: 3, use_my_settings: true,
  judge: 'mock', setup: [], passed: 3, total: 3, cases: [row()], estimated: true, only: '', ...over,
})
const run = (id: string, over: Partial<EvalRun> = {}): EvalRun => ({
  id, time: 1_790_000_000, provider: 'mock', label: 'Mock', model: 'm', repeat: 1, use_my_settings: true, judge: 'mock',
  setup: [], passed: 3, total: 6, questions: 6, only: '', ...over,
})
const text = () => document.body.textContent ?? ''
const wrap = (ui: React.ReactNode) => render(<RTooltip.Provider>{ui}</RTooltip.Provider>)

beforeEach(() => {
  useServer.setState({ info, settings: { changed: ['the system prompt'] } as unknown as Settings })
  useSession.setState({ provider: 'mock' })
  useEvals.setState({ status: { running: false }, history: [], viewing: null, cases: [], only: '', repeat: 1, judge: true, useMySettings: true })
  vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: false })
  vi.spyOn(api, 'evalsHistory').mockResolvedValue({ runs: [] })
  vi.spyOn(api, 'evalCases').mockResolvedValue({ cases: [
    { question: 'What is 17% of 2,450?', tools: ['calculate'], answer_has: ['416.5'] },
    { question: 'Roll two six-sided dice and tell me the total.', tools: ['roll_dice'] },
  ] })
})
afterEach(() => vi.restoreAllMocks())

describe('a result row', () => {
  // F003: the answers that were judged can be read
  it('shows every run\'s answer on request', () => {
    useEvals.setState({ viewing: result() })
    wrap(<Results />)
    fireEvent.click(screen.getByText(/Show the 3 answers/))
    expect(screen.getByText('4', { selector: 'strong' })).toBeInTheDocument()
    expect(text()).toMatch(/four/)
  })

  // F050: a PASS row says what was checked too
  it('a passing row says what was checked', () => {
    useEvals.setState({ viewing: result() })
    wrap(<Results />)
    fireEvent.click(screen.getByText(/What was checked/))
    expect(text()).toMatch(/uses calculate/)
    expect(text()).toMatch(/answer mentions '4'/)
  })

  // F149: each run can be opened as a conversation
  it('each run links to its conversation', () => {
    useEvals.setState({ viewing: result() })
    wrap(<Results />)
    fireEvent.click(screen.getByText(/Show the 3 answers/))
    expect(screen.getAllByRole('button', { name: /Inspect run/ })).toHaveLength(3)
  })

  // F146, F150, F045: the header says runs, questions, the filter and whether the judge was on
  it('the header counts runs, names the filter and the judge', () => {
    useEvals.setState({ viewing: result({ passed: 12, total: 48, repeat: 3, only: 'dice', cases: Array.from({ length: 16 }, () => row()) }) })
    wrap(<Results />)
    expect(text()).toMatch(/12 of 48 runs passed \(16 questions × 3 runs, 25%\)/)
    expect(text()).toMatch(/questions containing "dice"/)
    expect(text()).toMatch(/judge on/)
  })

  // F148: with several runs, each tool path says how many runs took it
  it('counts how many runs took each tool path', () => {
    useEvals.setState({ viewing: result() })
    wrap(<Results />)
    expect(text()).toMatch(/calculate · in 2 runs/) // F239: "×" only counts repeated calls
    expect(text()).toMatch(/no tools · in 1 run/)
  })

  // F048: a stopped run says it is incomplete
  it('a stopped run says it is incomplete', () => {
    useEvals.setState({ viewing: result({ incomplete: true }) })
    wrap(<Results />)
    expect(text()).toMatch(/incomplete: stopped before every question ran/)
  })
})

describe('the setup', () => {
  // F044: the questions themselves, and where to change them
  it('lists the questions and says where they come from', async () => {
    wrap(<EvalsScreen />)
    fireEvent.click(await screen.findByText(/The questions \(2\)/))
    expect(text()).toMatch(/What is 17% of 2,450\?/)
    expect(text()).toMatch(/edit config\/evals\.json/)
  })

  // F047: what a run costs in time, before you press it
  it('estimates the size of a run next to the button', async () => {
    useEvals.setState({ repeat: 3 })
    wrap(<EvalsScreen />)
    expect(await screen.findByText(/2 questions × 3 runs = 6 conversations/)).toBeInTheDocument()
  })

  // F045, F147: the judge's job, and its weakness on the mock
  it('explains the judge and its limit on the mock', async () => {
    wrap(<EvalsScreen />)
    await screen.findByText(/The questions/)
    expect(text()).toMatch(/Off: they pass on tool use alone/)
    expect(text()).toMatch(/with the mock \(claude-opus-5-5\)/) // F242: the judge's model is named
    expect(text()).toMatch(/The judge is the same model as the one being tested/)
  })

  // F242: the warning is about the model, not the provider
  it('warns about the judge only when it is the model under test', async () => {
    useServer.setState({ info: { ...info, providers: [{ ...info.providers[0], models: ['claude-opus-5-5', 'claude-haiku-4-5'] }] } as Info })
    useEvals.setState({ provider: 'mock', model: 'claude-haiku-4-5' })
    wrap(<EvalsScreen />)
    await screen.findByText(/The questions/)
    expect(text()).not.toMatch(/The judge is the same model/)
  })

  // F244: the question list says when the judge is off
  it('the question list says a judged question is judged only with the judge on', async () => {
    vi.spyOn(api, 'evalCases').mockResolvedValue({ cases: [{ question: 'Say hi', tools: [], judge: 'Says hello.' }] })
    useEvals.setState({ judge: false })
    wrap(<EvalsScreen />)
    await screen.findByText('Say hi')
    expect(text()).toMatch(/judged when the judge is on: Says hello\./)
  })

  // F046: what "my settings" means right now
  it('says what your settings change today', async () => {
    wrap(<EvalsScreen />)
    expect(await screen.findByText(/Different from the defaults now: the system prompt/)).toBeInTheDocument()
    expect(text()).toMatch(/the model is picked above/i)
  })

  // F048: a failure stays on screen; a running suite can be stopped
  it('keeps an error on screen and offers Stop while running', async () => {
    vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: false, error: 'RuntimeError: boom' }) // kept by the server until the next run
    const first = wrap(<EvalsScreen />)
    expect(await screen.findByText(/The last eval round failed: RuntimeError: boom/)).toBeInTheDocument()
    first.unmount()
    vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: true, done: 1, total: 6, started: Date.now() / 1000 - 30 })
    useEvals.setState({ status: { running: true, done: 1, total: 6, started: Date.now() / 1000 - 30 } })
    wrap(<EvalsScreen />)
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(text()).toMatch(/3\ds, about/) // Task 8: the one elapsed format (RunningBanner), seconds under a minute
    expect(text()).toMatch(/1 of 6 conversations done/) // F235: the count is of finished ones
    await act(async () => {})
  })
})

describe('the chart', () => {
  // F049: only comparable runs are joined; the others are drawn apart; the tooltip says what each was
  it('joins only runs like the latest, and says the date, model, filter and judge', () => {
    const runs = [run('a'), run('b', { only: 'dice' }), run('c'), run('d', { model: 'other' }), run('e')]
    const { container } = render(<ScoreChart runs={runs} selected="e" onPick={() => {}} />)
    const line = container.querySelector('polyline')!
    expect(line.getAttribute('points')!.trim().split(' ')).toHaveLength(3)
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent)
    expect(titles[1]).toMatch(/questions containing "dice"/)
    expect(titles[0]).toMatch(/judge on/)
    expect(titles[0]).toMatch(/\d{4}/) // a date, not only a time
  })
})

describe('wording', () => {
  it('one run reads "1 of 1 run passed"', () => {
    useEvals.setState({ viewing: result({ passed: 1, total: 1, repeat: 1, cases: [row({ runs: 1, passed: 1 })] }) })
    wrap(<Results />)
    expect(text()).toMatch(/1 of 1 run passed/)
  })

  it('the time estimate is in plain words', async () => {
    useEvals.setState({ repeat: 1 })
    wrap(<EvalsScreen />)
    expect(await screen.findByText(/= 2 conversations, under a minute/)).toBeInTheDocument()
  })
})

// Deferred M7: runs past the newest 10 keep their scores but not their conversations
it('a run whose conversations were let go shows its answers without Inspect buttons', () => {
  useEvals.setState({ viewing: result({ cases: [row({ conversations: [] })] }) })
  wrap(<Results />)
  fireEvent.click(screen.getByText(/Show the 3 answers/))
  expect(screen.queryByRole('button', { name: /Inspect run/ })).toBeNull()
  expect(text()).toMatch(/four/)
})

// Deferred M6: the newest answer wins, and a failed fetch isn't "no match"
describe('the question list', () => {
  it('a slow older answer does not overwrite a newer one', async () => {
    let slow!: (v: unknown) => void
    vi.spyOn(api, 'evalCases')
      .mockReturnValueOnce(new Promise((r) => { slow = r }) as never)
      .mockResolvedValueOnce({ cases: [{ question: 'Roll two dice', tools: ['roll_dice'] }] })
    const first = useEvals.getState().loadCases()
    await useEvals.getState().loadCases()
    slow({ cases: [{ question: 'a' }, { question: 'b' }, { question: 'c' }] })
    await first
    expect(useEvals.getState().cases).toHaveLength(1)
  })

  it('a failed fetch says so, and leaves Run usable', async () => {
    vi.spyOn(api, 'evalCases').mockRejectedValue(new Error('down'))
    wrap(<EvalsScreen />)
    expect(await screen.findByText(/Couldn't read the questions/)).toBeInTheDocument()
    expect(text()).not.toMatch(/No question matches/)
    expect(screen.getByRole('button', { name: /Run evals/ })).not.toBeDisabled()
  })
})

// F233, F234, F240: what each run got
describe('each run', () => {
  const mixed = () => row({
    passed: 1, runs: 2, ran: 3, unjudged: 1, verdict: 'MIXED', problems: ["answer doesn't mention '4'", 'judge: says 5'],
    answers: ['It is 4.', 'It is 5.', null], tools: [['calculate'], ['calculate'], ['calculate']],
    run_problems: [[], ["answer doesn't mention '4'", 'judge: says 5'], []],
    judge_verdicts: ['PASS', 'FAIL', 'UNJUDGED'], judge_notes: ['says 4', 'says 5', "the judge couldn't grade this: down"],
    errors: [null, null, 'Stopped after 20 model calls: the most allowed for one message.'],
  })

  it('says which run failed, and why, under its answer', () => {
    useEvals.setState({ viewing: result({ passed: 1, total: 2, unjudged: 1, cases: [mixed()] }) })
    wrap(<Results />)
    expect(text()).toMatch(/answer doesn't mention '4' \(run 2\)/)
    expect(text()).toMatch(/Run 1 · PASS · tools: calculate/)
    expect(text()).toMatch(/Run 2 · FAIL · tools: calculate/)
    expect(text()).toMatch(/judge: FAIL · says 5/)
    expect(text()).toMatch(/Run 3 · couldn't judge/)
  })

  it('leaves runs the judge could not grade out of the pass rate, and says so', () => {
    useEvals.setState({ viewing: result({ passed: 1, total: 2, unjudged: 1, cases: [mixed()] }) })
    wrap(<Results />)
    expect(text()).toMatch(/1 run couldn't be judged \(the judge itself failed\), so it's left\s+out of the pass rate/)
    expect(text()).toMatch(/1 run couldn't be judged: left out of the 1\/2/)
  })

  it('shows an error as an error, not as the answer', () => {
    useEvals.setState({ viewing: result({ cases: [mixed()] }) })
    wrap(<Results />)
    expect(text()).toMatch(/Ended with an error: Stopped after 20 model calls/)
  })

  // Results saved before runs were kept apart still show, with the judge notes where they were
  it('an older saved result without per-run detail still reads as before', () => {
    useEvals.setState({ viewing: result({ cases: [row({ judge_notes: ['fine', null, null] })] }) })
    wrap(<Results />)
    expect(text()).toMatch(/Run 1 · tools: calculate/)
    expect(text()).not.toMatch(/Run 1 · PASS/)
    expect(text()).toMatch(/judge, run 1: fine/)
  })

  // F238: a run stopped part-way doesn't claim a questions × runs sum, and says which questions ran short
  it('a stopped run says so instead of multiplying questions by runs', () => {
    useEvals.setState({ viewing: result({ incomplete: true, passed: 1, total: 1, cases: [row({ passed: 1, runs: 1, ran: 1 })] }) })
    wrap(<Results />)
    expect(text()).toMatch(/1 of 1 run passed \(stopped early, 100%\)/)
    expect(text()).toMatch(/Only 1 of 3 runs ran before Stop/)
  })
})

// F236, F237: the chart tells providers apart and says how many runs per question
describe('the chart, by provider', () => {
  it('does not join a run of the same model on another provider', () => {
    const runs = [run('a', { provider: 'anthropic', label: 'Anthropic API' }), run('b'), run('c')]
    const { container } = render(<ScoreChart runs={runs} selected="c" onPick={() => {}} />)
    expect(container.querySelector('polyline')!.getAttribute('points')!.trim().split(' ')).toHaveLength(2)
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent)
    expect(titles[0]).toMatch(/Anthropic API · m/)
    expect(titles[1]).toMatch(/1 run per question/)
  })

  // F237: a point's visible label says the runs per question when there were several (in words: × is for calls)
  it('labels a point with its runs per question when there were several', () => {
    const { container } = render(<ScoreChart runs={[run('a'), run('b', { repeat: 3, passed: 16, total: 21 })]} selected="b" onPick={() => {}} />)
    const labels = [...container.querySelectorAll('text')].map((t) => t.textContent)
    expect(labels).toContain('3/6')
    expect(labels).toContain('16/21 · 3 runs each')
    expect(labels.join(' ')).not.toMatch(/×/)
  })

  // F237: longer labels skip points rather than overlap, and the end ones stay inside the chart
  it('wide labels never overlap and stay inside the chart', () => {
    const runs = Array.from({ length: 13 }, (_, i) => run(String(i), { repeat: 3, passed: 30 + i, total: 48 }))
    const { container } = render(<ScoreChart runs={runs} selected="12" onPick={() => {}} />)
    const spans = [...container.querySelectorAll('g[data-run] text')].map((t) => {
      const x = Number(t.getAttribute('x'))
      const w = t.textContent!.length * 5 // the chart's own estimate; measured live at about 4.8 per character
      const anchor = t.getAttribute('text-anchor')
      const left = anchor === 'end' ? x - w : anchor === 'start' ? x : x - w / 2
      return [left, left + w]
    })
    expect(spans.length).toBeGreaterThan(2)
    expect(container.querySelector('g[data-run="12"] text')?.textContent).toBe('42/48 · 3 runs each') // the newest keeps its label
    spans.forEach(([l, r]) => { expect(l).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(640) })
    spans.slice(1).forEach(([l], i) => expect(l).toBeGreaterThanOrEqual(spans[i][1] + 9))
  })

  // F234: a point says how many runs the judge couldn't grade
  it('says how many runs could not be judged', () => {
    const { container } = render(<ScoreChart runs={[run('a', { unjudged: 2 }), run('b')]} selected="b" onPick={() => {}} />)
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent)
    expect(titles[0]).toMatch(/2 runs couldn't be judged \(left out\)/)
    expect(titles[1]).not.toMatch(/judged \(left out\)/)
  })
})

describe('evals behaviour', () => {
  // F349k
  it('a FAIL row says what to do next', () => {
    useEvals.setState({ viewing: result({ passed: 0, cases: [row({ passed: 0, verdict: 'FAIL', problems: ["didn't use: calculate"]})] }) })
    render(<Results />)
    expect(text()).toMatch(/Open a run with Inspect to see which call went wrong\. If a tool was not run, check its rule in Settings → Tools; if the answer was wrong, try the prompt or the model\./)
  })

  // F349m
  it('Run evals moves focus to Stop', async () => {
    vi.spyOn(api, 'startEvals').mockResolvedValue({ started: true } as never)
    wrap(<EvalsScreen />)
    await screen.findByText(/The questions \(2\)/)
    vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: true, done: 0, total: 2, started: Date.now() / 1000 })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Run evals/ })) })
    expect(screen.getByRole('button', { name: /Stop/ })).toHaveFocus()
    await act(async () => { useEvals.setState({ status: { running: false } }) })
  })

  it('when the round finishes focus lands on the results heading', async () => {
    useEvals.setState({ status: { running: true, done: 1, total: 2 }, viewing: null })
    vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: false, result: result() })
    vi.spyOn(api, 'evalsHistory').mockResolvedValue({ runs: [run('r1')] })
    wrap(<EvalsScreen />)
    const heading = await screen.findByRole('heading', { name: /3 of 3 runs passed/ })
    await act(async () => {})
    expect(heading).toHaveFocus()
    expect(useEvals.getState().focusResults).toBe(false)
  })

  it('opening Evals with an old finished round does not steal focus', async () => {
    useEvals.setState({ status: { running: false }, viewing: null })
    vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: false, result: result() })
    wrap(<EvalsScreen />)
    const heading = await screen.findByRole('heading', { name: /3 of 3 runs passed/ })
    await act(async () => {})
    expect(heading).not.toHaveFocus()
  })

  // F349n
  it('shows a placeholder, not 0, while the questions load', async () => {
    useEvals.setState({ cases: null })
    vi.spyOn(api, 'evalCases').mockReturnValue(new Promise(() => {}) as never)
    wrap(<EvalsScreen />)
    expect(text()).toMatch(/The questions \(…\)/)
    expect(text()).not.toMatch(/The questions \(0\)/)
  })

  it('number columns are right-aligned and tabular, and the progress track is visible', async () => {
    useEvals.setState({ viewing: result(), status: { running: true, done: 1, total: 2, started: Date.now() / 1000 } })
    wrap(<EvalsScreen />)
    const head = screen.getByRole('columnheader', { name: /Average time per run/ })
    expect(head.className).toMatch(/text-right/)
    expect(head.className).toMatch(/tabular-nums/)
    expect(screen.getByRole('progressbar').className).toMatch(/border-line-strong/)
    await act(async () => {})
  })

  it('the score chart is as wide as its card', () => {
    let notify!: (w: number) => void
    class RO { constructor(cb: (e: unknown[]) => void) { notify = (w) => cb([{ contentRect: { width: w } }]) } observe() {} disconnect() {} unobserve() {} }
    vi.stubGlobal('ResizeObserver', RO)
    const { container } = render(<ScoreChart runs={[run('a'), run('b')]} onPick={() => {}} />)
    act(() => notify(900))
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 900 160')
    expect(container.querySelector('svg')!.getAttribute('preserveAspectRatio')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('a round you picked stays shown when the status answer names a later one', async () => {
    useEvals.setState({ status: { running: false }, viewing: result({ id: 'picked' }) })
    vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: false, result: result({ id: 'latest' }) })
    wrap(<EvalsScreen />)
    await screen.findByText(/The questions \(2\)/)
    await act(async () => {})
    expect(useEvals.getState().viewing?.id).toBe('picked')
  })
})

// Third pass, Task 9 (F322): an old failure is shown, not read out again on every visit
describe('the failed-round message (F322)', () => {
  it('is an alert only when the round failed while you were on the screen', async () => {
    vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: false, error: 'boom' })
    const first = wrap(<EvalsScreen />)
    await screen.findByText(/The last eval round failed: boom/)
    expect(screen.queryByRole('alert')).toBeNull()
    first.unmount()
    vi.spyOn(api, 'evalsStatus').mockResolvedValue({ running: true, done: 0, total: 2 })
    useEvals.setState({ status: { running: true, done: 0, total: 2 } })
    wrap(<EvalsScreen />)
    await act(async () => {})
    act(() => useEvals.setState({ status: { running: false, error: 'boom' } }))
    expect(screen.getByRole('alert')).toHaveTextContent(/The last eval round failed: boom/)
  })
})
