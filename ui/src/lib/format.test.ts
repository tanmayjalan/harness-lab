import { describe, expect, it } from 'vitest'
import { cost, dollars, tokensOut } from './format'

// F382: money keeps its detail at $0.01, and every estimate says so
describe('money and estimates', () => {
  it('two significant figures under a dollar, so $0.0099 and $0.0101 look alike', () => {
    expect(dollars(0.0099)).toBe('$0.0099')
    expect(dollars(0.0101)).toBe('$0.010')
    expect(dollars(0.123)).toBe('$0.12')
    expect(dollars(0.5)).toBe('$0.50')
    expect(dollars(12.345)).toBe('$12.35')
    expect(dollars(0)).toBe('$0')
  })
  it('a cost is always about (worked out from list prices); on the mock, at least', () => {
    expect(cost(0.012, false)).toBe('≈ $0.012')
    expect(cost(0.012, true)).toBe('≈ $0.012 or more')
  })
  it('tokens out on the mock leave thinking out, so they are at least the figure', () => {
    expect(tokensOut(120, true)).toBe('≈ 120 or more')
    expect(tokensOut(120, false)).toBe('120')
  })
})
