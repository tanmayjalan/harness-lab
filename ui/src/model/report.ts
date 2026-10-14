// A whole conversation in numbers, and the same as a spreadsheet (CSV) to keep or share.
import type { RunModel } from './derive'
import { callTiming } from './inspector'

export type ConversationReport = {
  messages: number
  calls: number
  helperCalls: number
  toolRuns: Record<string, number> // by outcome: ran, failed, blocked, declined...
  modelSeconds: number
  toolSeconds: number
  waitedSeconds: number
  tokensIn: number
  tokensOut: number
  estimated: boolean
  cost: number | null
  nextCallAtLeast: number // the next call resends everything: at least the last call's input + its reply
}

export function conversationReport(m: RunModel): ConversationReport {
  const toolRuns: Record<string, number> = {}
  for (const t of Object.values(m.tools)) toolRuns[t.status] = (toolRuns[t.status] ?? 0) + 1
  let modelSeconds = 0
  let toolSeconds = 0
  let waitedSeconds = 0
  for (const id of m.callOrder) {
    const t = callTiming(m, m.calls[id])
    modelSeconds += t.model ?? 0
    toolSeconds += t.tools
    waitedSeconds += t.waited
  }
  const last = m.calls[m.callOrder[m.callOrder.length - 1]]
  return {
    messages: m.runs.length,
    calls: m.callOrder.length,
    helperCalls: Object.values(m.tools).reduce((n, t) => n + (t.helper?.calls.length ?? 0), 0),
    toolRuns,
    modelSeconds, toolSeconds, waitedSeconds,
    tokensIn: m.tokens.read,
    tokensOut: m.tokens.wrote,
    estimated: m.tokensEstimated,
    cost: m.costKnown ? m.cost : null,
    nextCallAtLeast: last ? last.tokens.read + last.tokens.wrote : 0,
  }
}

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// One row per model call
export function callsCsv(m: RunModel): string {
  const head = ['message', 'call', 'stop_reason', 'seconds', 'tokens_in', 'from_cache', 'written_to_cache', 'tokens_out',
    'estimated', 'cost_usd', 'tools', 'tool_outcomes']
  const rows = m.callOrder.map((id) => {
    const c = m.calls[id]
    const tools = c.toolIds.map((t) => m.tools[t]).filter(Boolean)
    return [c.runIndex, c.turn, c.stopReason ?? '', c.seconds?.toFixed(2) ?? '', c.tokens.read, c.tokens.cached, c.tokens.written,
      c.tokens.wrote, c.estimated ? 'yes' : 'no', c.cost ?? '', tools.map((t) => t.name).join(' '), tools.map((t) => t.status).join(' ')]
  })
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n'
}
