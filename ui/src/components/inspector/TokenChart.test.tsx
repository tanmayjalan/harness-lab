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

  // VIZ-1: the top can be the model's context window, with a labelled ceiling line
  it('switches its scale to the context window, and draws the ceiling', () => {
    const { container } = render(<TokenChart points={[point(1), point(2)]} selected="c1" onSelect={() => {}} useTokens contextWindow={200_000} />)
    const text = () => container.textContent ?? ''
    const thisChat = screen.getByRole('button', { name: 'this conversation' })
    const windowBtn = screen.getByRole('button', { name: "the model's context window" })
    expect(thisChat.getAttribute('aria-pressed')).toBe('true') // the default
    expect(text()).toMatch(/top of chart = 2k tokens/)
    expect(container.querySelector('[data-ceiling]')).toBeNull()
    fireEvent.click(windowBtn)
    expect(windowBtn.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-ceiling]')?.textContent).toBe('context window: 200k tokens')
    expect(text()).toMatch(/top of chart = the model's context window, 200k tokens/)
    // a 2k call is a sliver against 200k
    const bar = container.querySelector('g[data-call="c2"] rect[rx]')!
    expect(Number(bar.getAttribute('height'))).toBeLessThan(3)
  })

  it('has no scale switch when the window is not known', () => {
    render(<TokenChart points={[point(1)]} selected="c1" onSelect={() => {}} useTokens contextWindow={null} />)
    expect(screen.queryByRole('button', { name: "the model's context window" })).toBeNull()
  })

  // VIZ-4: the dashed untrimmed size adds a characters/4 guess to a measured count
  it('marks the top as about when a trimmed call sets it, and says the tokens trimmed are a guess', () => {
    const { container } = render(<TokenChart points={[point(1), point(2, { trimmedChars: 900 })]} selected="c1" onSelect={() => {}} useTokens contextWindow={null} />)
    expect(container.textContent).toMatch(/top of chart = ≈ 2\.2k tokens/)
    expect(container.querySelector('g[data-call="c2"] title')?.textContent).toMatch(/about 225 tokens trimmed/)
    expect(container.querySelector('g[data-call="c1"] title')?.textContent).not.toMatch(/trimmed/)
  })

  it('a measured top stays exact', () => {
    const { container } = render(<TokenChart points={[point(1, { trimmedChars: 400 }), point(3)]} selected="c1" onSelect={() => {}} useTokens contextWindow={null} />)
    expect(container.textContent).toMatch(/top of chart = 3k tokens/)
  })

  // VIZ-5: a long conversation scrolls sideways instead of shrinking the drawing
  it('scrolls sideways past about 50 calls, and keeps the bars their size', () => {
    const many = Array.from({ length: 80 }, (_, i) => point(i + 1))
    const long = render(<TokenChart points={many} selected="c1" onSelect={() => {}} useTokens contextWindow={null} />)
    const svg = long.container.querySelector('svg')!
    expect(svg.parentElement!.className).toMatch(/overflow-x-auto/)
    expect(svg.getAttribute('class')).not.toMatch(/w-full/) // its own width, not squeezed to the panel's
    expect(long.container.textContent).toMatch(/scroll sideways/)
    long.unmount()
    const short = render(<TokenChart points={many.slice(0, 10)} selected="c1" onSelect={() => {}} useTokens contextWindow={null} />)
    expect(short.container.querySelector('.overflow-x-auto')).toBeNull()
    short.unmount()
    // fractional bar widths that add up to a hair over the drawing's width still fit: no scrolling
    for (const n of [13, 37, 49]) {
      const fits = render(<TokenChart points={many.slice(0, n)} selected="c1" onSelect={() => {}} useTokens contextWindow={null} />)
      expect(fits.container.querySelector('.overflow-x-auto')).toBeNull()
      fits.unmount()
    }
  })
})
