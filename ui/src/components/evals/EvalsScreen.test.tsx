import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { EvalResult, EvalRun } from '../../api/types'
import { useEvals } from '../../store/evals'
import { Results, ScoreChart, toolList } from './EvalsScreen'

const run = (id: string, passed: number, over: Partial<EvalRun> = {}): EvalRun => ({
  id, time: 1_790_000_000, provider: 'mock', label: 'Claude (mock)', model: 'claude-haiku-4-5', repeat: 3,
  use_my_settings: true, judge: null, setup: [], passed, total: 6, questions: 2, ...over,
})

describe('Evals screen', () => {
  it('each past run is a point you can pick by click or keyboard', () => {
    const onPick = vi.fn()
    render(<ScoreChart runs={[run('a', 3), run('b', 6, { setup: ['prompt edited'] })]} selected="b" onPick={onPick} />)
    const points = screen.getAllByRole('button')
    expect(points).toHaveLength(2)
    expect(points[0].getAttribute('aria-label')).toContain('claude-haiku-4-5 · 3 of 6 runs passed')
    expect(points[1].getAttribute('aria-label')).toContain('prompt edited')
    fireEvent.click(points[0])
    expect(onPick).toHaveBeenLastCalledWith('a')
    fireEvent.keyDown(points[1], { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('b')
  })

  it('repeated tool calls are counted, not listed', () => {
    expect(toolList(['roll_dice (failed)', 'roll_dice (failed)', 'roll_dice', 'calculate', 'calculate'])).toBe(
      'roll_dice (failed) ×2 → roll_dice → calculate ×2') // F241: written the way Compare writes them
    expect(toolList([])).toBe('no tools')
  })

  it('the table shows each question with its verdict, reasons and tools', () => {
    const result: EvalResult = {
      ...run('a', 4), cases: [
        { question: 'What is 2+2?', passed: 1, runs: 3, verdict: 'MIXED', problems: ["answer doesn't mention '4'"],
          tools: [[], [], ['calculate']], seconds: [1, 2, 3], tokens: [100, 200, 300], cost: [null, null, null], answers: ['4', '5', '4'] },
        { question: 'Roll two dice', passed: 3, runs: 3, verdict: 'PASS', problems: [],
          tools: [['roll_dice'], ['roll_dice'], ['roll_dice']], seconds: [1, 1, 1], tokens: [50, 50, 50], cost: [null, null, null], answers: ['7', '9', '3'] },
      ],
    }
    useEvals.setState({ viewing: result })
    render(<Results />)
    expect(document.body.textContent).toMatch(/4 of 6 runs passed \(2 questions × 3 runs, 67%\)/)
    expect(screen.getByText('MIXED 1/3')).toBeTruthy()
    expect(screen.getByText('PASS 3/3')).toBeTruthy()
    expect(screen.getByText("answer doesn't mention '4'")).toBeTruthy()
    expect(document.body.textContent).toMatch(/no tools · in 2 runs/) // each tool path once, with how many runs took it
    expect(document.body.textContent).toMatch(/calculate · in 1 run(?!s)/)
  })
})
