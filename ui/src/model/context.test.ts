import { describe, expect, it } from 'vitest'
import type { Info } from '../api/types'
import { charsToPercent, percentToChars, windowFor } from './context'

describe('context window', () => {
  it('finds a model\'s window and converts the summarising threshold both ways', () => {
    const info = { providers: [{ name: 'mock', context_windows: { m: 200000 } }] } as unknown as Info
    expect(windowFor(info, 'mock', 'm')).toBe(200000)
    expect(windowFor(info, 'mock', 'other')).toBeNull()
    expect(charsToPercent(40000, 200000)).toBe(5) // 40,000 characters ≈ 10,000 tokens = 5% of 200k
    expect(percentToChars(5, 200000)).toBe(40000)
  })
})
