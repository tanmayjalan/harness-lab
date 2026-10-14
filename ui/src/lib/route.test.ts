import { describe, expect, it } from 'vitest'
import { isRoute, parseHash, toHash } from './route'

describe('route', () => {
  it('maps hashes both ways', () => {
    expect(parseHash('#compare')).toEqual({ screen: 'compare' })
    expect(parseHash('#chat/abc')).toEqual({ screen: 'run', conversation: 'abc' })
    expect(parseHash('')).toEqual({ screen: 'run' })
    expect(toHash('run', 'abc')).toBe('#chat/abc')
    expect(toHash('evals', null)).toBe('#evals')
  })

  // R9: an in-page fragment is not a place to go to
  it('knows which hashes are routes', () => {
    for (const h of ['', '#', '#chat', '#chat/abc', '#compare', '#evals']) expect(isRoute(h), h).toBe(true)
    for (const h of ['#quiz', '#group-Basics', '#message-box', '#chat/a/b', '#compares']) expect(isRoute(h), h).toBe(false)
  })
})
