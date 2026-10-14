import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Snapshot } from './types'
import { PollClient } from './poll'
import { useSession } from '../store/session'
import answer from '../test/fixtures/answer.json'
import declined from '../test/fixtures/approval_declined.json'

const snap = (over: Partial<Snapshot>): Snapshot => ({
  gen: 0, running: false, events: [], conversation: 'c1', provider: 'mock', model: 'm', live: '', ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  useSession.setState(useSession.getInitialState())
})
afterEach(() => vi.useRealTimers())

describe('PollClient', () => {
  it('adds new events and asks again from the next one', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(snap({ events: (answer as Snapshot['events']).slice(0, 2) }))
      .mockResolvedValue(snap({ events: [] }))
    const p = new PollClient({}, fetch)
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(useSession.getState().events).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetch).toHaveBeenLastCalledWith(2)
    p.stop()
  })

  it('starts over when the conversation changes', async () => {
    const onNew = vi.fn()
    const fetch = vi.fn()
      .mockResolvedValueOnce(snap({ gen: 0, events: answer as Snapshot['events'] }))
      .mockResolvedValueOnce(snap({ gen: 1, events: [] }))
      .mockResolvedValue(snap({ gen: 1, events: [] }))
    const p = new PollClient({ onNewConversation: onNew }, fetch)
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(useSession.getState().derived.runs).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(onNew).toHaveBeenCalled()
    expect(useSession.getState().events).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([0, 5, 0])
    p.stop()
  })

  it('says the connection is lost after two failures, and recovers', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(snap({}))
    const p = new PollClient({}, fetch)
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(useSession.getState().connection).toBe('lost')
    await vi.advanceTimersByTimeAsync(1000)
    expect(useSession.getState().connection).toBe('ok')
    p.stop()
  })

  it('shows streamed text only while running', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snap({ running: true, live: 'Hel' })).mockResolvedValue(snap({ live: 'Hello' }))
    const p = new PollClient({}, fetch)
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(useSession.getState().live).toBe('Hel')
    await vi.advanceTimersByTimeAsync(200)
    expect(useSession.getState().live).toBe('')
    p.stop()
  })

  // F008: a restarted server starts a new conversation at gen 0 again; the page must notice
  it('starts over when the conversation id changes, even at the same gen', async () => {
    const onNew = vi.fn()
    const fetch = vi.fn()
      .mockResolvedValueOnce(snap({ gen: 0, conversation: 'c1', events: answer as Snapshot['events'] }))
      .mockResolvedValueOnce(snap({ gen: 0, conversation: 'c2', events: [] }))
      .mockResolvedValue(snap({ gen: 0, conversation: 'c2', events: [] }))
    const p = new PollClient({ onNewConversation: onNew }, fetch)
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(useSession.getState().derived.runs).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(onNew).toHaveBeenCalled()
    expect(useSession.getState().events).toHaveLength(0)
    expect(useSession.getState().since).toBe(0)
    p.stop()
  })

  // F007: the server's other state is (re)loaded whenever contact is made, not only once
  it('says when contact is made: at the start and after contact was lost, not on every poll', async () => {
    const onConnected = vi.fn()
    const fetch = vi.fn()
      .mockResolvedValueOnce(snap({}))
      .mockResolvedValueOnce(snap({}))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(snap({}))
    const p = new PollClient({ onConnected }, fetch)
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onConnected).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(onConnected).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500) // fails
    await vi.advanceTimersByTimeAsync(500) // fails: lost
    expect(useSession.getState().connection).toBe('lost')
    await vi.advanceTimersByTimeAsync(1000)
    expect(onConnected).toHaveBeenCalledTimes(2)
    p.stop()
  })

  // F088 and review focus 2: losing contact must not leave a live-looking run or an approval up
  it('losing contact clears the running state and the waiting approval, and re-reads everything after', async () => {
    const events = (declined as Snapshot['events']).slice(0, 5) // up to the approval
    const fetch = vi.fn()
      .mockResolvedValueOnce(snap({ running: true, events }))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(snap({ running: true, events }))
    const p = new PollClient({}, fetch)
    p.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(useSession.getState().derived.pendingApproval).not.toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(500)
    expect(useSession.getState().connection).toBe('lost')
    expect(useSession.getState().running).toBe(false)
    expect(useSession.getState().derived.pendingApproval).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetch).toHaveBeenLastCalledWith(0) // everything again, so a still-waiting approval comes back
    expect(useSession.getState().derived.pendingApproval).not.toBeNull()
    p.stop()
  })
})
