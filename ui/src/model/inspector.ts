// What the Inspector shows about one call: which messages are new since the previous call,
// how many calls have sent each one, and the size of every call for the chart.
import type { Message } from '../api/types'
import type { Call, RunModel } from './derive'

export type MessageView = {
  message: Message
  index: number
  isNew: boolean // not in the previous call's copy
  sentTimes: number // calls that have sent this message so far, this one included
  trimmed: boolean // a tool result in it was shortened in this copy
  summary: boolean // the summary that replaced older history
}

export type CallView = { call: Call; previous: Call | null; messages: MessageView[]; afterSummary: boolean }

const TRIM_NOTE = '[Trimmed by the harness'
const SUMMARY_START = '[Summary of the earlier conversation'

function isTrimmed(m: Message) {
  return Array.isArray(m.content) && m.content.some((b) =>
    b.type === 'tool_result' && typeof (b as { content?: unknown }).content === 'string' &&
    ((b as { content: string }).content).startsWith(TRIM_NOTE))
}

// Calls since history was last summarised, oldest first, up to and including `callId`
function sinceSummary(m: RunModel, callId: string): Call[] {
  const out: Call[] = []
  for (const id of m.callOrder) {
    const c = m.calls[id]
    const run = m.runs[c.runIndex - 1]
    const summarisedHere = run?.compaction && !run.compaction.skipped && !run.compaction.failed && run.callIds[0] === id
    if (summarisedHere) out.length = 0
    out.push(c)
    if (id === callId) break
  }
  return out
}

export function callView(m: RunModel, callId: string): CallView | null {
  const call = m.calls[callId]
  if (!call) return null
  const chain = sinceSummary(m, callId)
  const previous = chain.length > 1 ? chain[chain.length - 2] : null
  const run = m.runs[call.runIndex - 1]
  const afterSummary = !!run?.compaction?.summary && run.callIds[0] === callId
  const sent = call.request.messages
  // The history only grows between calls (until it is summarised), so messages past the
  // previous call's length are the new ones
  const newFrom = previous ? previous.request.messages.length : afterSummary ? sent.length - 1 : 0
  const messages = sent.map((message, index) => {
    const firstCall = chain.findIndex((c) => c.request.messages.length > index)
    return {
      message,
      index,
      isNew: index >= newFrom,
      sentTimes: firstCall === -1 ? 1 : chain.length - firstCall,
      trimmed: isTrimmed(message),
      summary: afterSummary && index === 0 && typeof message.content === 'string' && message.content.startsWith(SUMMARY_START),
    }
  })
  return { call, previous, messages, afterSummary }
}

export type SeriesPoint = {
  callId: string
  runIndex: number
  turn: number
  read: number
  cached: number
  wrote: number
  chars: number // characters sent: always known, even when a provider doesn't count tokens
  trimmedChars: number
  summarisedBefore: boolean
}

const toolChars = (call: Call) =>
  (call.request.tools ?? []).reduce((n, t) => n + t.name.length + t.description.length, 0)

// Everything a call sends: system prompt, tool names and descriptions, and the messages
export function sentChars(call: Call) {
  return JSON.stringify(call.request.messages).length + (call.request.system?.length ?? 0) + toolChars(call)
}

// Where one call's time went: the model's reply (and, on the mock, starting claude -p), then the
// tools it asked for, and any wait for your approval. Seconds; undefined when not known.
// `retrying`: waiting to send the call again after the service was busy (not the model's time)
export type Timing = { firstWord?: number; model?: number; overhead?: number; tools: number; waited: number; retrying: number }

export function callTiming(m: RunModel, call: Call): Timing {
  const res = call.response
  let tools = 0
  let waited = 0
  for (const id of call.toolIds) {
    const row = m.tools[id]
    if (!row) continue
    const wait = row.approval?.askedAt && row.approval.decidedAt ? row.approval.decidedAt - row.approval.askedAt : 0
    waited += wait
    if (row.startedAt && row.endedAt) tools += Math.max(0, row.endedAt - row.startedAt - wait)
  }
  if (call.atOnce?.together) {
    // Run at the same time: the time they took is from the first start to the last end, not the sum
    const rows = call.toolIds.map((id) => m.tools[id]).filter((r) => r?.startedAt && r.endedAt)
    if (rows.length) tools = Math.max(...rows.map((r) => r.endedAt!)) - Math.min(...rows.map((r) => r.startedAt!))
  }
  const overhead = res?.usage?.mock_overhead_ms ? res.usage.mock_overhead_ms / 1000 : undefined
  const retrying = (call.retries ?? []).reduce((n, r) => n + r.wait, 0)
  return {
    firstWord: res?.first_text ? res.first_text - call.startedAt : undefined,
    model: res ? Math.max(0, res.time - call.startedAt - retrying) : undefined,
    overhead,
    tools,
    waited,
    retrying,
  }
}

export type Part = { key: 'system' | 'tools' | 'earlier' | 'results' | 'new'; label: string; chars: number }

// What one call is made of, in characters: the parts that go every time, and what's new
export function breakdown(view: CallView): Part[] {
  const { call } = view
  let earlier = 0
  let results = 0
  let fresh = 0
  for (const m of view.messages) {
    const size = JSON.stringify(m.message.content).length
    if (!m.isNew) earlier += size
    else if (Array.isArray(m.message.content) && m.message.content.some((b) => b.type === 'tool_result')) results += size
    else fresh += size
  }
  return [
    { key: 'system', label: 'system prompt', chars: call.request.system?.length ?? 0 },
    { key: 'tools', label: 'tool descriptions', chars: toolChars(call) },
    { key: 'earlier', label: 'earlier entries', chars: earlier },
    { key: 'results', label: 'new tool results', chars: results },
    { key: 'new', label: 'new entries', chars: fresh },
  ]
}

export function tokenSeries(m: RunModel): SeriesPoint[] {
  return m.callOrder.map((id) => {
    const c = m.calls[id]
    const run = m.runs[c.runIndex - 1]
    const t = c.trimmed && 'count' in c.trimmed ? c.trimmed : null
    return {
      callId: id,
      runIndex: c.runIndex,
      turn: c.turn,
      read: c.tokens.read,
      cached: c.tokens.cached,
      wrote: c.tokens.wrote,
      chars: sentChars(c),
      trimmedChars: t?.count ? t.chars : 0,
      summarisedBefore: !!run?.compaction?.summary && run.callIds[0] === id,
    }
  })
}

// ---- a tool's round trip: asked for in one call's reply, answered in the next call's request ----

export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }

export type RoundTrip = {
  ask: ToolUseBlock // in this call's reply (model → harness)
  row?: import('./derive').ToolRow // what the harness did with it, here on this computer
  answer?: { block: ToolResultBlock; callId: string; turn: number; messageIndex: number } // in the next call's request
}

function resultIn(call: Call, id: string) {
  const msgs = call.request.messages
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = msgs[i].content
    if (!Array.isArray(c)) continue
    const block = c.find((b) => b.type === 'tool_result' && (b as ToolResultBlock).tool_use_id === id)
    if (block) return { block: block as ToolResultBlock, messageIndex: i }
  }
  return null
}

export function roundTrips(m: RunModel, callId: string): RoundTrip[] {
  const call = m.calls[callId]
  if (!call?.response) return []
  const i = m.callOrder.indexOf(callId)
  const next = m.calls[m.callOrder[i + 1]]
  const sameRun = next && next.runIndex === call.runIndex ? next : undefined
  return call.response.content.filter((b) => b.type === 'tool_use').map((b) => {
    const ask = b as ToolUseBlock
    const found = sameRun ? resultIn(sameRun, ask.id) : null
    return {
      ask,
      row: m.tools[ask.id],
      answer: found && sameRun ? { ...found, callId: sameRun.id, turn: sameRun.turn } : undefined,
    }
  })
}

// The tool results this call's request carries for the call before it
export function answersCarried(m: RunModel, callId: string): { block: ToolResultBlock; askedIn: Call }[] {
  const call = m.calls[callId]
  const prev = call && m.calls[m.callOrder[m.callOrder.indexOf(callId) - 1]]
  if (!call || !prev || prev.runIndex !== call.runIndex) return []
  return roundTrips(m, prev.id).filter((r) => r.answer?.callId === callId).map((r) => ({ block: r.answer!.block, askedIn: prev }))
}

// One line for the Summary's "Received" list when the reply asked for no tools: a finished answer,
// or text that stopped early (so it is not a finished answer). Null when the reply asked for tools.
export function receivedLine(stopReason: string | undefined, toolRequests: number): string | null {
  if (toolRequests > 0 || stopReason === 'tool_use') return null
  if (!stopReason || stopReason === 'end_turn') return 'A final answer, no tool requests.'
  return `Text only, but the model stopped early (${stopReason}): this is not a finished answer.`
}

// How much of the context window a call uses. While its reply hasn't come back, the best figure is
// the previous call's (this one sends at least that much), marked "at least".
export function windowUsed(call: Call, previous: Call | null): { used: number; atLeast: boolean } {
  if (call.tokens.read > 0) return { used: call.tokens.read, atLeast: false }
  if (!call.response && previous) {
    return { used: previous.tokens.read || Math.round(sentChars(previous) / 4), atLeast: true }
  }
  return { used: Math.round(sentChars(call) / 4), atLeast: false }
}
