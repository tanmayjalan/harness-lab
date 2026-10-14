import { describe, expect, it } from 'vitest'
import type { HarnessEvent } from '../api/types'
import { deriveRuns } from './derive'
import { callsCsv, conversationReport } from './report'
import toolTurn from '../test/fixtures/tool_turn.json'
import blocked from '../test/fixtures/blocked.json'

describe('conversation report', () => {
  it('adds up the whole conversation', () => {
    const r = conversationReport(deriveRuns(toolTurn as HarnessEvent[]))
    expect(r.calls).toBe(3)
    expect(r.messages).toBe(1)
    expect(r.toolRuns).toEqual({ ran: 3 })
    expect(r.tokensIn).toBe(1500 + (1800 + 1500) + (2000 + 1800)) // fresh input plus what came from the cache
    expect(r.nextCallAtLeast).toBe(3800 + 40) // the last call's input and reply both go again
    expect(conversationReport(deriveRuns(blocked as HarnessEvent[])).toolRuns).toEqual({ hook_blocked: 1, blocked: 1 })
  })

  it('exports one CSV row per call', () => {
    const csv = callsCsv(deriveRuns(toolTurn as HarnessEvent[])).trim().split('\n')
    expect(csv[0]).toBe('message,call,stop_reason,seconds,tokens_in,from_cache,written_to_cache,tokens_out,estimated,cost_usd,tools,tool_outcomes')
    expect(csv).toHaveLength(4)
    expect(csv[1]).toMatch(/^1,1,tool_use,[\d.]+,1500,0,0,90,no,.*,get_weather get_current_time,ran ran$/)
  })
})
