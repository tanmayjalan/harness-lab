import { describe, expect, it } from 'vitest'
import type { HarnessEvent } from '../api/types'
import { deriveRuns } from './derive'
import { answersCarried, breakdown, callTiming, callView, receivedLine, roundTrips, sentChars, tokenSeries } from './inspector'
import toolTurn from '../test/fixtures/tool_turn.json'
import trimmed from '../test/fixtures/trimmed.json'
import compacted from '../test/fixtures/compacted.json'
import stopped from '../test/fixtures/stopped.json'
import outside from '../test/fixtures/approval_outside.json'
import answer from '../test/fixtures/answer.json'

const derive = (events: unknown) => deriveRuns(events as HarnessEvent[])

describe('callView', () => {
  it('marks what each call added and counts how often each message was sent', () => {
    const m = derive(toolTurn)
    const [c1, c2, c3] = m.callOrder.map((id) => callView(m, id)!)
    expect(c1.messages.map((x) => x.isNew)).toEqual([true])
    // call 2 adds the model's tool request and the results
    expect(c2.messages.map((x) => x.isNew)).toEqual([false, true, true])
    expect(c2.messages.map((x) => x.sentTimes)).toEqual([2, 1, 1])
    expect(c3.messages.map((x) => x.sentTimes)).toEqual([3, 2, 2, 1, 1])
    expect(c3.previous?.id).toBe(c2.call.id)
  })

  it('flags trimmed tool results in the copy sent', () => {
    const m = derive(trimmed)
    const last = callView(m, m.callOrder[m.callOrder.length - 1])!
    expect(last.messages.some((x) => x.trimmed)).toBe(true)
    expect(callView(m, m.callOrder[0])!.messages.some((x) => x.trimmed)).toBe(false)
  })

  it('starts counting again after the history is summarised', () => {
    const m = derive(compacted)
    const first = m.runs[1].callIds[0]
    const v = callView(m, first)!
    expect(v.afterSummary).toBe(true)
    expect(v.previous).toBeNull()
    expect(v.messages.every((x) => x.sentTimes === 1)).toBe(true)
    expect(v.messages[v.messages.length - 1].isNew).toBe(true)
    expect(v.messages[0].summary).toBe(true)
  })
})

describe('tokenSeries', () => {
  it('one point per call with sizes and markers', () => {
    const s = tokenSeries(derive(trimmed))
    expect(s.map((p) => p.runIndex)).toEqual([1, 1, 2, 2, 2])
    expect(s.map((p) => p.trimmedChars)).toEqual([0, 0, 0, 3720, 3720])
    expect(s.every((p) => p.chars > 0)).toBe(true)
    const c = tokenSeries(derive(compacted))
    expect(c.map((p) => p.summarisedBefore)).toEqual([false, false, true])
    expect(c[2].chars).toBeLessThan(c[1].chars) // the summary made the next call smaller
  })
})

describe('roundTrips', () => {
  it('links each tool request to the result sent back in the next call', () => {
    const m = derive(toolTurn)
    const [c1, c2, c3] = m.callOrder
    const trips = roundTrips(m, c1)
    expect(trips.map((t) => [t.ask.name, t.row?.status, t.answer?.callId, t.answer?.messageIndex])).toEqual([
      ['get_weather', 'ran', c2, 2],
      ['get_current_time', 'ran', c2, 2],
    ])
    expect(trips[0].answer?.block.tool_use_id).toBe(trips[0].ask.id)
    expect(roundTrips(m, c3)).toEqual([]) // the last call answered, it asked for nothing
    expect(answersCarried(m, c2).map((a) => a.block.tool_use_id)).toEqual(['t1', 't2'])
    expect(answersCarried(m, c1)).toEqual([])
  })

  it('a stopped run has requests with no next call', () => {
    const m = derive(stopped)
    const trips = roundTrips(m, m.callOrder[0])
    expect(trips.map((t) => [t.ask.name, t.row?.status, t.answer])).toEqual([
      ['get_weather', 'not_run', undefined], ['get_weather', 'not_run', undefined],
    ])
  })
})

describe('breakdown', () => {
  it('splits a call into what goes every time and what is new', () => {
    const m = derive(toolTurn)
    const second = callView(m, m.callOrder[1])!
    const parts = Object.fromEntries(breakdown(second).map((p) => [p.key, p.chars]))
    expect(parts.system).toBe(second.call.request.system.length)
    expect(parts.tools).toBeGreaterThan(0) // the tool descriptions go on every call
    expect(parts.earlier).toBeGreaterThan(0) // your first message
    expect(parts.results).toBeGreaterThan(0) // call 2 carries the first call's tool results
    expect(sentChars(second.call)).toBeGreaterThan(parts.system + parts.tools)
  })
})

describe('callTiming', () => {
  it('splits a call into model time, tool time and waiting for you', () => {
    const m = derive(outside) // a read outside the workspace: it waited for approval
    const first = m.calls[m.callOrder[0]]
    const t = callTiming(m, first)
    expect(t.model).toBeGreaterThanOrEqual(0)
    expect(t.waited).toBeGreaterThan(0)
    expect(t.tools).toBeGreaterThanOrEqual(0)
    const plain = derive(answer)
    expect(callTiming(plain, plain.calls[plain.callOrder[0]]).waited).toBe(0)
  })
})

// F072: the Received summary must not call a cut-off reply "a final answer"
describe('receivedLine', () => {
  it('a finished reply with no tool requests is a final answer', () => {
    expect(receivedLine('end_turn', 0)).toBe('A final answer, no tool requests.')
  })
  it('a reply cut off by the length limit is not a finished answer', () => {
    expect(receivedLine('max_tokens', 0)).toMatch(/^Text only, but the model stopped early \(max_tokens\)/)
    expect(receivedLine('max_tokens', 0)).toMatch(/not a finished answer/)
  })
  it('tool requests are listed elsewhere, so there is no line for them', () => {
    expect(receivedLine('tool_use', 2)).toBeNull()
  })
})
