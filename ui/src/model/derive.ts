// Turns the server's event list into the shape the page draws: runs (one per message you sent),
// model calls inside each run, tool rows inside each call, plus the plan, the pending approval
// and running totals. Pure: same events in, same model out. No screen code here.
import type {
  ApprovalEvent, Block, CompactedEvent, HarnessEvent, HookEvent, HookName, HookVerdict, Outcome, RequestEvent,
  ResponseEvent, Rule, ScriptText, SubEvent, ToolCallEvent, ToolResultEvent, TrimInfo, Usage, Verdict, WorkflowStepName,
} from '../api/types'

// read: all input (fresh + from cache + written to cache); cached: read from the cache; written: written to it
export type Tokens = { read: number; cached: number; wrote: number; written: number }

export type ToolStatus = 'running' | 'awaiting' | Outcome

export type PlanStep = { text: string; status: 'pending' | 'in_progress' | 'done' }

export type Approval = { id: string; toolId: string | null; tool: string; prompt: string; input: Record<string, unknown>;
  path: string; content: string; outside: boolean; decision?: boolean; askedAt?: number; decidedAt?: number
  where?: string; setting?: Rule; replaces?: { label: string; value: string; shared: boolean }; script?: ScriptText }

export type HelperCall = { n: number; startedAt: number; seconds?: number; stopReason?: string; tokens: Tokens;
  cost: number | null; messages: number; retries?: Retry[] }
// One call of one of your hooks around a tool call (a "hook" event), in the order they ran
export type HookRecord = { hook: HookName; verdict: HookVerdict; reason?: string | null; error?: string | null;
  original?: string | null; ms: number }
export type HelperTool = { id: string; name: string; input: Record<string, unknown>; status: ToolStatus; chars?: number;
  call: number; hooks?: HookRecord[] } // call: which of the helper's calls asked for it
export type Helper = { toolId: string; task: string; calls: HelperCall[]; tools: HelperTool[]; tokens: Tokens;
  cost: number; running: boolean; reportChars?: number; failed?: boolean; estimated?: boolean }

export type ToolRow = {
  id: string
  callId: string
  runIndex: number
  name: string
  input: Record<string, unknown>
  permission: Rule | null
  outside: boolean
  source: string
  status: ToolStatus
  result?: { content: string; isError: boolean; chars: number }
  startedAt?: number // when the harness got the request (server time)
  endedAt?: number // when the result was ready
  approval?: Approval
  helper?: Helper
  plan?: PlanStep[]
  hooks?: HookRecord[] // what your hooks did for this call; missing when none ran (or in older saves)
}

export type Call = {
  id: string
  runIndex: number
  turn: number
  maxTurns: number
  request: RequestEvent
  response?: ResponseEvent
  startedAt: number
  seconds?: number
  stopReason?: string
  failed?: string // the call ended without a reply (provider error, or the message ended first)
  tokens: Tokens
  estimated: boolean // the provider guessed the token counts (the mock)
  cost: number | null
  interim: string
  thought?: string // the reply's thinking ('' when the provider hides the text); undefined: no thinking
  toolIds: string[]
  trimmed: TrimInfo
  retries?: Retry[] // the service was busy or briefly down: each wait and new try, in order
  atOnce?: { count: number; together: boolean; reason: string | null } // several tools, with "tools at once" on
  step?: number // the workflow step it belongs to (1, 2, ...), with the workflow on
  stepLabel?: string // that step's name, e.g. "Write"
  stepTurn?: number // its place within the step (each step's loop starts again at 1); `turn` is its place in the message
}

// One step of a workflow: a loop of its own, with the text the code passed it and what it returned
export type WorkflowStep = {
  n: number
  name: WorkflowStepName
  label: string
  sent: string // the one message the code built for this step
  system: string // its own instructions
  tools: string[] // the tools it was offered (none for writing and checking)
  callIds: string[]
  startedAt: number
  endedAt?: number
  running: boolean
  text?: string // what it returned
  verdict?: Verdict // a check: PASS, problems, or a reply the code couldn't read
  problems?: string
  last?: boolean // a check that found problems with no fixes left
  attempt?: number // a fix: which one (1, 2)
}

export type Retry = { attempt: number; status: number | null; reason: string; wait: number; simulated: boolean }

export type RunOutcome = 'running' | 'answered' | 'stopped' | 'error'

export type Run = {
  index: number // 1, 2, ... in the order you sent them
  userSeq: number
  text: string
  startedAt: number
  endedAt?: number
  callIds: string[]
  compaction?: CompactedEvent
  compacting?: boolean
  answer?: { text: string; provider: string; model: string }
  cutOff?: string // the stop reason when the harness marked the answer "[stopped early: ...]"
  error?: string
  errorDetail?: string // the raw error, when error is in plain words
  stopping: boolean
  outcome: RunOutcome
  tokens: Tokens
  cost: number
  providerLabel?: string
  model?: string
  workflow?: WorkflowStep[] // the message went through the workflow: its steps, in order
}

export type ProviderSwitch = { beforeRun: number; name: string; label: string; model: string; history: number; seq: number }

export type Status = 'idle' | 'waiting_model' | 'running_tools' | 'awaiting_you' | 'stopping' | 'summarising'

export type RunModel = {
  runs: Run[]
  calls: Record<string, Call>
  callOrder: string[]
  tools: Record<string, ToolRow>
  plan: PlanStep[] | null
  pendingApproval: Approval | null
  switches: ProviderSwitch[]
  tokens: Tokens
  cost: number
  costKnown: boolean
  tokensReported: boolean
  tokensEstimated: boolean // some counts are the mock's estimates
  status: Status
  lastEvent: HarnessEvent | null
}

export const zeroTokens = (): Tokens => ({ read: 0, cached: 0, wrote: 0, written: 0 })

export function tokensOf(usage: Usage | null | undefined): Tokens {
  const u = usage ?? {}
  return {
    read: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    cached: u.cache_read_input_tokens ?? 0,
    wrote: u.output_tokens ?? 0,
    written: u.cache_creation_input_tokens ?? 0,
  }
}

function add(a: Tokens, b: Tokens) {
  a.read += b.read
  a.cached += b.cached
  a.wrote += b.wrote
  a.written += b.written
}

export function textOf(content: string | Block[] | undefined): string {
  if (typeof content === 'string') return content
  return (content ?? []).filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
}

function resultText(content: string | Block[]): string {
  return typeof content === 'string' ? content : textOf(content) || JSON.stringify(content)
}

// For saved conversations from before the server sent `outcome`: work it out from the wording
function outcomeFromText(content: string, isError: boolean): Outcome {
  if (content.startsWith("Blocked by the user's hook")) return 'hook_blocked'
  if (content.startsWith("The user's settings block")) return 'blocked'
  if (content.startsWith("Not run: this tool needs the user's OK")) return 'unattended'
  if (content.startsWith('The user declined')) return 'declined'
  if (content.startsWith('Not run:')) return 'not_run'
  return isError ? 'error' : 'ran'
}

function validPlan(steps: unknown): PlanStep[] | null {
  if (!Array.isArray(steps) || !steps.length) return null
  return steps.map((s) => ({
    text: String((s as PlanStep).text ?? ''),
    status: (['pending', 'in_progress', 'done'] as const).includes((s as PlanStep).status) ? (s as PlanStep).status : 'pending',
  }))
}

export function deriveRuns(events: HarnessEvent[]): RunModel {
  const m: RunModel = {
    runs: [], calls: {}, callOrder: [], tools: {}, plan: null, pendingApproval: null, switches: [],
    tokens: zeroTokens(), cost: 0, costKnown: false, tokensReported: false, tokensEstimated: false, status: 'idle',
    lastEvent: null,
  }
  let run: Run | null = null
  let call: Call | null = null
  const helpers: Record<string, Helper> = {}
  let openHelper: Helper | null = null

  const count = (tokens: Tokens, cost: number | null | undefined) => {
    add(m.tokens, tokens)
    if (tokens.read || tokens.wrote) m.tokensReported = true
    if (cost != null) {
      m.cost += cost
      m.costKnown = true
    }
    if (run) {
      add(run.tokens, tokens)
      run.cost += cost ?? 0
    }
  }

  for (const e of events) {
    m.lastEvent = e
    switch (e.kind) {
      case 'user': {
        run = {
          index: m.runs.length + 1, userSeq: e.seq, text: e.text, startedAt: e.time, callIds: [], stopping: false,
          outcome: 'running', tokens: zeroTokens(), cost: 0,
        }
        m.runs.push(run)
        call = null
        m.status = 'waiting_model'
        break
      }
      case 'compacting':
        if (run) run.compacting = true
        m.status = 'summarising'
        break
      case 'compacted':
        if (run) {
          run.compacting = false
          run.compaction = e
        }
        count(tokensOf(e.usage), e.cost)
        break
      case 'request': {
        if (!run) break
        call = {
          id: `c${e.seq}`, runIndex: run.index, turn: e.turn, maxTurns: e.max_turns, request: e, startedAt: e.time,
          tokens: zeroTokens(), estimated: false, cost: null, interim: '', toolIds: [], trimmed: e.trimmed,
        }
        m.calls[call.id] = call
        m.callOrder.push(call.id)
        run.callIds.push(call.id)
        if (e.step != null) {
          // The loop numbers calls within each step and sends a step the calls it has left. Here a call is
          // numbered within the message, against the message's limit, as everywhere else on the page
          const st = run.workflow?.find((x) => x.n === e.step)
          const before = run.callIds.length - 1 - (st?.callIds.length ?? 0) // this message's calls before the step
          Object.assign(call, { step: e.step, stepLabel: st?.label, stepTurn: e.turn, turn: run.callIds.length,
            maxTurns: e.max_turns + before })
          st?.callIds.push(call.id)
        }
        run.providerLabel = e.provider
        run.model = e.model
        m.status = 'waiting_model'
        break
      }
      case 'step': {
        if (!run) break
        ;(run.workflow ??= []).push({ n: e.n, name: e.name, label: e.label, sent: e.sent, system: e.system, tools: e.tools ?? [],
          callIds: [], startedAt: e.time, running: true, attempt: e.attempt })
        break
      }
      case 'step_done': {
        const st = run?.workflow?.find((x) => x.n === e.n)
        if (!st) break
        Object.assign(st, { running: false, endedAt: e.time, text: e.text, verdict: e.verdict, problems: e.problems, last: e.last })
        break
      }
      case 'tools_at_once': {
        if (call) call.atOnce = { count: e.count, together: e.together, reason: e.reason }
        break
      }
      case 'retry': {
        if (!call) break
        call.retries = [...(call.retries ?? []), { attempt: e.attempt, status: e.status, reason: e.reason, wait: e.wait, simulated: e.simulated }]
        break
      }
      case 'response': {
        if (!call) break
        call.response = e
        call.seconds = Math.max(0, e.time - call.startedAt)
        call.stopReason = e.stop_reason
        call.tokens = tokensOf(e.usage)
        call.estimated = !!e.usage?.estimated
        if (call.estimated) m.tokensEstimated = true
        call.cost = e.cost
        call.interim = e.stop_reason === 'tool_use' ? textOf(e.content).trim() : ''
        const thinking = (e.content ?? []).filter((b) => b.type === 'thinking' || b.type === 'redacted_thinking')
        call.thought = thinking.length
          ? thinking.map((b) => String((b as { thinking?: string }).thinking ?? '')).join('\n\n').trim()
          : undefined
        count(call.tokens, e.cost)
        m.status = e.stop_reason === 'tool_use' ? 'running_tools' : m.status
        break
      }
      case 'tool_call': {
        if (!call || !run) break
        const row: ToolRow = {
          id: e.id, callId: call.id, runIndex: run.index, name: e.name, input: e.input ?? {},
          permission: e.permission ?? null, outside: !!e.outside, source: e.source ?? 'built in', status: 'running',
          startedAt: e.time,
        }
        if (e.name === 'delegate') {
          row.helper = { toolId: e.id, task: String(e.input?.task ?? ''), calls: [], tools: [], tokens: zeroTokens(),
            cost: 0, running: true }
          helpers[e.id] = row.helper
          openHelper = row.helper
        }
        if (e.name === 'update_plan') row.plan = validPlan(e.input?.steps) ?? undefined
        m.tools[e.id] = row
        call.toolIds.push(e.id)
        m.status = 'running_tools'
        break
      }
      case 'sub': {
        const h = (e.helper && helpers[e.helper]) || openHelper
        if (!h) break
        applyHelperStep(h, e, count)
        break
      }
      case 'approval': {
        const row = findOpenRow(m, call, e)
        const approval: Approval = {
          id: e.id, toolId: row?.id ?? null, tool: e.tool, prompt: e.prompt, input: e.input ?? {}, path: e.path,
          content: e.content, askedAt: e.time, where: e.where, setting: e.setting, replaces: e.replaces, script: e.script,
          // the server's own flag; older saves only had it in the question's wording
          outside: e.outside ?? row?.outside ?? e.prompt.includes('OUTSIDE the workspace'),
        }
        if (row) {
          row.approval = approval
          row.status = 'awaiting'
        }
        m.pendingApproval = approval
        m.status = 'awaiting_you'
        break
      }
      case 'decision': {
        if (m.pendingApproval?.id === e.id) {
          m.pendingApproval.decision = e.allowed
          m.pendingApproval = null
        }
        for (const row of Object.values(m.tools)) {
          if (row.approval?.id === e.id) {
            row.approval.decision = e.allowed
            row.approval.decidedAt = e.time
            row.status = 'running'
          }
        }
        m.status = 'running_tools'
        break
      }
      case 'hook': {
        const row = m.tools[e.id]
        if (row) (row.hooks ??= []).push(hookRecord(e))
        break
      }
      case 'tool_result':
        if (!m.tools[e.result.tool_use_id] && call && run) rowFromReply(m, call, run, e.result.tool_use_id)
        applyResult(m, e, helpers)
        break
      case 'answer':
        if (run) {
          // The loop adds "[stopped early: <reason>]" to a reply that didn't finish: that's the
          // harness talking, not the model, so it comes off the answer and becomes a note
          const marker = /\n?\[stopped early: ([a-z_]+)\]\s*$/.exec(e.text)
          run.answer = { text: marker ? e.text.slice(0, marker.index) : e.text, provider: e.provider, model: e.model }
          if (marker) run.cutOff = marker[1]
          run.outcome = 'answered'
        }
        break
      case 'stopping':
        if (run) run.stopping = true
        m.status = 'stopping'
        break
      case 'stopped':
        if (run) run.outcome = 'stopped'
        if (call && !call.response && !call.failed) call.failed = 'Stopped before a reply came back.'
        break
      case 'error':
        if (run) {
          run.outcome = 'error'
          run.error = e.message
          if (e.detail) run.errorDetail = e.detail
        }
        if (call && !call.response && !call.failed) call.failed = e.message
        break
      case 'provider':
        m.switches.push({ beforeRun: m.runs.length + 1, name: e.name, label: e.label, model: e.model,
          history: e.history, seq: e.seq })
        break
      case 'done':
        if (call && !call.response && !call.failed) call.failed = 'No reply came back.'
        if (run) {
          run.endedAt = e.time
          if (run.outcome === 'running') run.outcome = 'answered'
        }
        for (const h of Object.values(helpers)) h.running = false
        for (const st of run?.workflow ?? []) st.running = false // a stopped or failed step ends with the message
        openHelper = null
        m.pendingApproval = null
        m.status = 'idle'
        break
    }
  }
  return m
}

function findOpenRow(m: RunModel, call: Call | null, e: ApprovalEvent): ToolRow | undefined {
  // The approval is for the latest tool call with that name that hasn't finished
  const ids = call ? [...call.toolIds].reverse() : []
  return ids.map((id) => m.tools[id]).find((r) => r && r.name === e.tool && r.status === 'running')
}

// Stopping mid-reply answers the requested tools "Not run" without a tool_call event:
// rebuild the row from what the model asked for, so the skipped tool still shows
function rowFromReply(m: RunModel, call: Call, run: Run, id: string) {
  const block = (call.response?.content ?? []).find((b) => b.type === 'tool_use' && (b as { id: string }).id === id) as
    | { id: string; name: string; input: Record<string, unknown> } | undefined
  if (!block) return
  m.tools[id] = { id, callId: call.id, runIndex: run.index, name: block.name, input: block.input ?? {}, permission: null,
    outside: false, source: 'built in', status: 'running' }
  call.toolIds.push(id)
}

function applyResult(m: RunModel, e: ToolResultEvent, helpers: Record<string, Helper>) {
  const row = m.tools[e.result.tool_use_id]
  if (!row) return // e.g. "Not run" results for a reply the page never saw
  const content = resultText(e.result.content)
  const isError = !!e.result.is_error
  row.result = { content, isError, chars: content.length }
  row.endedAt = e.time
  row.status = e.outcome ?? outcomeFromText(content, isError)
  if (row.name === 'update_plan' && row.plan && row.status === 'ran') m.plan = row.plan
  const h = helpers[row.id]
  if (h) {
    h.running = false
    h.failed = row.status !== 'ran'
    h.reportChars = content.length
  }
}

type Counter = (tokens: Tokens, cost: number | null | undefined) => void

function applyHelperStep(h: Helper, e: SubEvent, count: Counter) {
  const last = h.calls[h.calls.length - 1]
  switch (e.step) {
    case 'request':
      h.calls.push({ n: (e.call as number) || h.calls.length + 1, startedAt: e.time, tokens: zeroTokens(), cost: null,
        messages: Array.isArray(e.messages) ? (e.messages as unknown[]).length : 0 })
      break
    case 'response': {
      if (!last) break
      last.seconds = Math.max(0, e.time - last.startedAt)
      last.stopReason = e.stop_reason as string
      last.tokens = tokensOf(e.usage as Usage)
      last.cost = (e.cost as number | null) ?? null
      add(h.tokens, last.tokens)
      if ((e.usage as Usage | undefined)?.estimated) h.estimated = true
      h.cost += last.cost ?? 0
      count(last.tokens, last.cost) // helpers cost real tokens, so they count in the totals
      break
    }
    case 'retry': // the helper's call was tried again (the service was busy, or the practice switch)
      if (last) {
        last.retries = [...(last.retries ?? []), { attempt: e.attempt as number, status: (e.status as number | null) ?? null,
          reason: e.reason as string, wait: e.wait as number, simulated: !!e.simulated }]
      }
      break
    case 'tool_call':
      h.tools.push({ id: e.id as string, name: e.name as string, input: (e.input as Record<string, unknown>) ?? {},
        status: 'running', call: (e.call as number) || h.calls.length })
      break
    case 'tool_result': {
      const r = e.result as ToolResultEvent['result']
      const tool = h.tools.find((t) => t.id === r?.tool_use_id)
      if (tool && r) {
        const content = resultText(r.content)
        tool.status = (e.outcome as Outcome) ?? outcomeFromText(content, !!r.is_error)
        tool.chars = content.length
      }
      break
    }
    case 'hook': {
      const tool = h.tools.find((t) => t.id === e.id)
      if (tool) (tool.hooks ??= []).push(hookRecord(e as unknown as HookEvent))
      break
    }
  }
}

function hookRecord(e: HookEvent): HookRecord {
  return { hook: e.hook, verdict: e.verdict, reason: e.reason, error: e.error, original: e.original, ms: e.ms }
}

// ---- small lookups the views share ----

export function callsOfRun(m: RunModel, run: Run): Call[] {
  return run.callIds.map((id) => m.calls[id]).filter(Boolean)
}

export function previousCall(m: RunModel, callId: string): Call | undefined {
  const i = m.callOrder.indexOf(callId)
  return i > 0 ? m.calls[m.callOrder[i - 1]] : undefined
}

// Your hooks file as it was when this row's call was made; undefined in conversations saved
// before that was recorded (so nobody can say which hooks ran)
export function hooksLoaded(m: RunModel, row: ToolRow) {
  return m.calls[row.callId]?.request.hooks ?? undefined
}

export function hookOf(row: { hooks?: HookRecord[] }, hook: HookName): HookRecord | undefined {
  return row.hooks?.find((h) => h.hook === hook)
}

export function isToolCall(e: HarnessEvent): e is ToolCallEvent {
  return e.kind === 'tool_call'
}

export type { CompactedEvent }
