import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { EvalQuestion, EvalStatus } from '../api/types'
import { useEvals } from './evals'

const initial = useEvals.getState()

// A promise the test settles by hand, so a request can be kept "out" for as long as needed
function later<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  useEvals.setState({ ...initial })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Evals store', () => {
  // Two refreshes at once (contact made, and Run pressed) must leave one loop asking, not two
  it('two refreshes at once leave one loop of status checks', async () => {
    const asks = [later<EvalStatus>(), later<EvalStatus>()]
    let n = 0
    vi.spyOn(api, 'evalsStatus').mockImplementation(() => (n < asks.length ? asks[n++].promise : Promise.resolve({ running: true })))
    void useEvals.getState().refresh()
    void useEvals.getState().refresh()
    asks[0].resolve({ running: true })
    asks[1].resolve({ running: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.getTimerCount()).toBe(1)
  })

  // A slow, older failed request doesn't wipe out the list a newer one read
  it('an older failed question list does not overwrite a newer one', async () => {
    const older = later<{ cases: EvalQuestion[] }>()
    const cases = [{ id: 'q1' }] as unknown as EvalQuestion[]
    vi.spyOn(api, 'evalCases').mockReturnValueOnce(older.promise).mockResolvedValueOnce({ cases })
    const first = useEvals.getState().loadCases()
    await useEvals.getState().loadCases()
    expect(useEvals.getState().cases).toEqual(cases)
    older.reject(new Error('down'))
    await first
    expect(useEvals.getState().cases).toEqual(cases)
    expect(useEvals.getState().casesFailed).toBe(false)
  })
})
