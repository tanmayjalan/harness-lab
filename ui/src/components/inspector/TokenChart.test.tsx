import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { SeriesPoint } from '../../model/inspector'
import { TokenChart } from './TokenChart'

const point = (n: number, over: Partial<SeriesPoint> = {}): SeriesPoint => ({
  callId: `c${n}`, runIndex: 1, turn: n, read: 1000 * n, cached: 0, wrote: 50, chars: 4000 * n, trimmedChars: 0,
  summarisedBefore: false, ...over,
})

describe('TokenChart', () => {
  it('each bar is a labelled button you can reach and press by keyboard', () => {
    const onSelect = vi.fn()
    render(<TokenChart points={[point(1), point(2, { trimmedChars: 900 })]} selected="c1" onSelect={onSelect} useTokens={false} />)
    const bars = screen.getAllByRole('button')
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Message 1, call 1: 4,000 characters',
      'Message 1, call 2: 8,000 characters, trimmed 900 characters',
    ])
    expect(bars.map((b) => b.getAttribute('tabindex'))).toEqual(['0', '-1']) // one tab stop: the selected bar
    fireEvent.keyDown(bars[1], { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith('c2')
    fireEvent.keyDown(bars[0], { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('c2')
  })
})
