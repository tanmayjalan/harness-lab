import { describe, expect, it } from 'vitest'
import type { HarnessEvent } from '../api/types'
import { callsOfRun, deriveRuns } from './derive'
import answer from '../test/fixtures/answer.json'
import toolTurn from '../test/fixtures/tool_turn.json'
import declined from '../test/fixtures/approval_declined.json'
import outside from '../test/fixtures/approval_outside.json'
import blocked from '../test/fixtures/blocked.json'
import helper from '../test/fixtures/helper.json'
import plan from '../test/fixtures/plan.json'
import trimmed from '../test/fixtures/trimmed.json'
import compacted from '../test/fixtures/compacted.json'
import stopped from '../test/fixtures/stopped.json'
import providerSwitch from '../test/fixtures/provider_switch.json'
import error from '../test/fixtures/error.json'

const derive = (events: unknown) => deriveRuns(events as HarnessEvent[])

describe('deriveRuns', () => {
  it('a plain answer is one run with one call and no tools', () => {
    const m = derive(answer)
    expect(m.runs).toHaveLength(1)
    const [run] = m.runs
    expect(run.text).toBe('What is the capital of France?')
    expect(run.outcome).toBe('answered')
    expect(run.answer?.text).toContain('France')
    expect(run.callIds).toHaveLength(1)
    expect(m.calls[run.callIds[0]].stopReason).toBe('end_turn')
    expect(m.tokens).toEqual({ read: 900, cached: 0, wrote: 20, written: 0 })
    expect(m.status).toBe('idle')
  })

  it('a tool turn: three calls, tools land under the call that asked for them, each once', () => {
    const m = derive(toolTurn)
    const calls = callsOfRun(m, m.runs[0])
    expect(calls.map((c) => c.toolIds)).toEqual([['t1', 't2'], ['t3'], []])
    expect(calls.map((c) => c.stopReason)).toEqual(['tool_use', 'tool_use', 'end_turn'])
    expect(calls[0].interim).toBe('Let me check the weather.')
    expect(Object.values(m.tools).map((t) => [t.name, t.status, t.permission])).toEqual([
      ['get_weather', 'ran', 'allow'],
      ['get_current_time', 'ran', 'allow'],
      ['convert_temperature', 'ran', 'allow'],
    ])
    expect(calls[1].tokens.cached).toBe(1500)
    expect(m.tools.t1.result?.chars).toBeGreaterThan(0)
  })

  it('a declined write keeps the approval on its tool row', () => {
    const m = derive(declined)
    const row = m.tools.w1
    expect(row.permission).toBe('ask')
    expect(row.approval?.decision).toBe(false)
    expect(row.status).toBe('declined')
    expect(m.pendingApproval).toBeNull()
  })

  // F279: "outside the workspace" comes from the server's own flag, not from matching the question's wording
  it('reads outside, where and what a fact replaces from the approval event', () => {
    const events = (outside as HarnessEvent[]).map((e) => (e.kind === 'approval'
      ? { ...e, prompt: 'Allow?', outside: true, where: 'C:\\Windows\\win.ini', setting: 'allow' as const,
          replaces: { label: 'Unit', value: 'C', shared: false } } : e))
    const cut = events.findIndex((e) => e.kind === 'decision')
    const a = deriveRuns(events.slice(0, cut)).pendingApproval!
    expect(a.outside).toBe(true)
    expect(a.where).toBe('C:\\Windows\\win.ini')
    expect(a.setting).toBe('allow')
    expect(a.replaces).toEqual({ label: 'Unit', value: 'C', shared: false })
  })

  // F298: older saves with the "nobody can be asked" wording still read as such
  it('works out "nobody to ask" from the result wording', () => {
    const events = (blocked as HarnessEvent[]).map((e) => (e.kind === 'tool_result'
      ? { ...e, outcome: undefined, result: { ...(e as { result: object }).result, content: "Not run: this tool needs the user's OK, and nobody can be asked here. Don't try it again." } }
      : e))
    const m = derive(events)
    expect(Object.values(m.tools).map((t) => t.status)).toContain('unattended')
  })

  it('an approval is pending until decided', () => {
    const events = outside as HarnessEvent[]
    const cut = events.findIndex((e) => e.kind === 'decision')
    const waiting = deriveRuns(events.slice(0, cut))
    expect(waiting.status).toBe('awaiting_you')
    expect(waiting.pendingApproval?.tool).toBe('read_file')
    expect(waiting.pendingApproval?.outside).toBe(true)
    expect(waiting.tools.r1.status).toBe('awaiting')
    const after = derive(outside)
    expect(after.tools.r1.outside).toBe(true)
    expect(after.tools.r1.status).toBe('ran')
    expect(after.tools.r1.approval?.decision).toBe(true)
  })

  it('tells a hook block from a settings block', () => {
    const m = derive(blocked)
    expect(m.tools.b1.status).toBe('hook_blocked')
    expect(m.tools.b2.status).toBe('blocked')
    expect(m.tools.b2.permission).toBe('block')
  })

  it('a helper becomes a card on its delegate row, with its calls and tokens counted', () => {
    const m = derive(helper)
    const h = m.tools.d1.helper!
    expect(h.calls.map((c) => c.n)).toEqual([1, 2])
    expect(h.tools.map((t) => [t.name, t.status])).toEqual([['read_file', 'ran']])
    expect(h.tokens.read).toBe(2100)
    expect(h.running).toBe(false)
    expect(h.reportChars).toBeGreaterThan(0)
    // the helper's tokens are part of the conversation's totals
    expect(m.tokens.read).toBeGreaterThanOrEqual(2100 + 1200 * 2)
  })

  it('keeps the latest plan', () => {
    const m = derive(plan)
    expect(m.plan?.map((s) => s.status)).toEqual(['done', 'done', 'done'])
    expect(m.tools.p1.plan?.[1].status).toBe('in_progress')
  })

  it('two messages make two runs; trimming shows on the later calls', () => {
    const m = derive(trimmed)
    expect(m.runs.map((r) => r.callIds.length)).toEqual([2, 3])
    const second = callsOfRun(m, m.runs[1])
    expect(second.map((c) => c.trimmed)).toEqual([
      { count: 0, chars: 0 }, { count: 1, chars: 3720 }, { count: 1, chars: 3720 },
    ])
    expect(second.every((c) => c.runIndex === 2)).toBe(true)
  })

  it('summarising is attached to the run it happened in', () => {
    const m = derive(compacted)
    expect(m.runs[0].compaction).toBeUndefined()
    expect(m.runs[1].compaction?.messages_before).toBe(5)
    expect(m.runs[1].compaction?.messages_after).toBe(1)
    expect(m.tokens.read).toBeGreaterThanOrEqual(900) // the summarising call is paid for too
  })

  it('stopping marks the asked-for tools "Not run", even without tool_call events', () => {
    const m = derive(stopped)
    expect(m.runs[0].outcome).toBe('stopped')
    expect(m.runs[0].stopping).toBe(true)
    expect(Object.values(m.tools).map((t) => [t.id, t.name, t.status])).toEqual([
      ['s1', 'get_weather', 'not_run'], ['s2', 'get_weather', 'not_run'],
    ])
  })

  it('records a provider switch before the next run', () => {
    const m = derive(providerSwitch)
    expect(m.switches).toEqual([expect.objectContaining({ beforeRun: 2, name: 'mock', history: 2 })])
    expect(m.runs.map((r) => r.model)).toEqual(['deepseek-flash', 'claude-opus-5-5'])
  })

  // F010: a call that never got a reply is marked failed, not left "waiting" for ever
  it('an error marks the call that never got a reply as failed', () => {
    const m = derive(error)
    const call = m.calls[m.callOrder[0]]
    expect(call.response).toBeUndefined()
    expect(call.failed).toContain("Could not reach the model's server") // F297: the plain words, as the server sends them
  })

  it('a call that did get its reply is never marked failed', () => {
    const m = derive(toolTurn)
    expect(m.callOrder.map((id) => m.calls[id].failed)).toEqual([undefined, undefined, undefined])
  })

  it('an error ends the run with its message', () => {
    const m = derive(error)
    expect(m.runs[0].outcome).toBe('error')
    expect(m.runs[0].error).toContain("Could not reach the model's server")
    expect(m.runs[0].errorDetail).toBe('RuntimeError: Connection refused') // the raw error, kept for the details
    expect(m.status).toBe('idle')
  })

  it('records whether a reply thought, and its text when the provider returns it', () => {
    const events = answer as HarnessEvent[]
    const withThinking = events.map((e) => (e.kind === 'response'
      ? { ...e, content: [{ type: 'thinking', thinking: 'Paris is the capital.', signature: 's' }, ...e.content] }
      : e))
    const hidden = events.map((e) => (e.kind === 'response'
      ? { ...e, content: [{ type: 'thinking', thinking: '', signature: 'mock' }, ...e.content] } : e))
    const call = (ev: unknown) => { const m = derive(ev); return m.calls[m.callOrder[0]] }
    expect(call(events).thought).toBeUndefined()
    expect(call(withThinking).thought).toBe('Paris is the capital.')
    expect(call(hidden).thought).toBe('')
    expect(call(withThinking).interim).toBe('') // thinking is not the reply's text
  })

  it('works one event at a time (the same result as all at once)', () => {
    const events = toolTurn as HarnessEvent[]
    for (let i = 0; i <= events.length; i++) expect(() => deriveRuns(events.slice(0, i))).not.toThrow()
    expect(deriveRuns(events.slice(0, 3)).status).toBe('running_tools')
  })
})

// Review focus: one reply asks for two writes. The harness runs them one after another, so each
// gets its own approval; the panel (and the A key) must answer the second write, not the first.
describe('two approvals in one call', () => {
  const base = (declined as Array<Record<string, unknown>>).slice(0, 4) // user, request, response, tool_call w1
  const t = 1791062290
  const events = [
    ...base,
    { seq: 4, kind: 'approval', time: t, id: 'a1', tool: 'write_file', prompt: 'Allow?', input: { path: 'a.txt' }, path: 'a.txt', content: 'a' },
    { seq: 5, kind: 'decision', time: t + 1, id: 'a1', allowed: true },
    { seq: 6, kind: 'tool_result', time: t + 2, outcome: 'ran', result: { type: 'tool_result', tool_use_id: 'w1', content: 'Wrote a.txt' } },
    { seq: 7, kind: 'tool_call', time: t + 3, id: 'w2', name: 'write_file', input: { path: 'b.txt', content: 'b' }, permission: 'ask' },
    { seq: 8, kind: 'approval', time: t + 4, id: 'a2', tool: 'write_file', prompt: 'Allow?', input: { path: 'b.txt' }, path: 'b.txt', content: 'b' },
  ]

  it('the pending approval belongs to the second write', () => {
    const m = derive(events)
    expect(m.pendingApproval?.id).toBe('a2')
    expect(m.pendingApproval?.toolId).toBe('w2')
  })

  it('the first write keeps its own, already-given answer', () => {
    const m = derive(events)
    expect(m.tools.w1.approval?.id).toBe('a1')
    expect(m.tools.w1.approval?.decision).toBe(true)
    expect(m.tools.w2.approval?.decision).toBeUndefined()
  })
})

describe('errors and cut-off replies', () => {
  // F095: the plain words show; the raw error is kept as detail
  it('an error keeps its detail apart from its message', () => {
    const events = (error as Array<Record<string, unknown>>).map((e) =>
      e.kind === 'error' ? { ...e, message: 'Could not reach the model.', detail: 'RuntimeError: Connection refused' } : e)
    const run = derive(events).runs[0]
    expect(run.error).toBe('Could not reach the model.')
    expect(run.errorDetail).toBe('RuntimeError: Connection refused')
  })

  // F199: the harness's "[stopped early: ...]" marker is not the model's words
  it('the stopped-early marker comes off the answer and is kept as a reason', () => {
    const events = (answer as Array<Record<string, unknown>>).map((e) =>
      e.kind === 'answer' ? { ...e, text: 'Once upon a time\n[stopped early: max_tokens]' } : e)
    const run = derive(events).runs[0]
    expect(run.answer?.text).toBe('Once upon a time')
    expect(run.cutOff).toBe('max_tokens')
  })
})
