// What the Python server sends. Mirrors harness/web/server.py and harness/core/loop.py.

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  estimated?: boolean // the mock's guess (about 4 characters per token), not a real count
  mock_overhead_ms?: number // the mock: time spent starting claude -p, not the model's
}

// Content blocks inside messages (SDK objects turned into plain JSON by the server)
export type TextBlock = { type: 'text'; text: string }
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string | Block[]; is_error?: boolean }
export type ThinkingBlock = { type: 'thinking'; thinking?: string; signature?: string }
export type OtherBlock = { type: string; [k: string]: unknown }
export type Block = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | OtherBlock

export type Message = { role: 'user' | 'assistant'; content: string | Block[] }

export type Rule = 'allow' | 'ask' | 'block'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
// When prompt and tool edits take effect
export type Apply = 'message' | 'conversation'
// The longest reply (tokens) and the most model calls for one message
export type Limits = { max_tokens: number; max_turns: number }
export type Thinking = { enabled: boolean; budget: number; effort?: Effort }
// What a request actually sent for thinking: a budget, or adaptive (with an effort in output_config)
export type SentThinking = { type: 'enabled'; budget_tokens: number } | { type: 'adaptive'; display?: string }
// unattended: it needed your OK and nobody could be asked (Compare, Re-run, evals, helpers)
export type Outcome = 'ran' | 'error' | 'declined' | 'blocked' | 'unattended' | 'hook_blocked' | 'not_run'

export type SentTool = { name: string; description: string; source: string; permission: Rule }

export type RunConfig = {
  provider: string | null
  label: string | null
  model: string | null
  system?: string
  system_edited?: boolean
  descriptions?: string[]
  permissions?: Record<string, Rule>
  trim?: { enabled: boolean; keep_last: number } | null
  compact?: { enabled: boolean; over_chars: number } | null
  thinking?: Thinking | null
  cache?: { enabled: boolean } | null
  apply?: Apply
  limits?: Limits | null
  skills?: SkillsSetting | null
  faults?: Faults | null
  tools_at_once?: { enabled: boolean } | null
  workflow?: { enabled: boolean } | null
  run_code?: { enabled: boolean } | null
  extra_tools?: ExtraTools | null
  facts_shared?: number
  edited?: string[]
}

// Skills (features/skills.py): one line each in the prompt and a load_skill tool, or every skill in full
export type SkillMode = 'on_demand' | 'all_in_prompt'
export type SkillsSetting = { enabled: boolean; mode: SkillMode }
// Practice: make the service look busy (the first try of every call fails, and the loop tries again)
export type Faults = { busy: boolean }
// The 40 office tools (features/tool_search.py): all sent on every call, or found on demand with find_tool
export type ExtraTools = { enabled: boolean; mode: 'all' | 'find' }

export type TrimInfo = { count: number; chars: number } | { skipped: string } | null

// Your hooks file as it was for one message: which functions it had, or why it couldn't be used
export type HooksLoaded = { file?: string | null; functions: string[]; problem: string | null }
export type HookName = 'before_tool' | 'after_tool'
// allowed / blocked: before_tool's answer; kept / replaced: after_tool's; failed: either one crashed
export type HookVerdict = 'allowed' | 'blocked' | 'kept' | 'replaced' | 'failed'

type Base = { seq: number; time: number; msg?: number }

export type UserEvent = Base & { kind: 'user'; text: string }
export type RequestEvent = Base & {
  kind: 'request'
  turn: number
  max_turns: number
  messages: Message[]
  system: string
  provider: string // the label, e.g. "DeepSeek"
  model: string
  facts: number
  edited: string[]
  trimmed: TrimInfo
  max_tokens?: number // the reply length limit sent with the call
  thinking?: SentThinking | null // what was sent for thinking, or null when it wasn't asked for
  output_config?: { effort?: Effort } | null
  cache?: boolean // whether the request was marked for prompt caching
  start_changed?: boolean // the system prompt or tools differ from the previous call (cache lost)
  tools?: SentTool[]
  config?: RunConfig
  hooks?: HooksLoaded | null // missing in conversations saved before hook calls were recorded
  step?: number // a workflow's step this call belongs to (1, 2, ...); missing outside a workflow
  step_name?: WorkflowStepName
}
export type ResponseEvent = Base & {
  kind: 'response'
  turn: number
  stop_reason: string
  content: Block[]
  usage: Usage | null
  cost: number | null
  first_text?: number // when the first streamed word arrived (server time)
}
export type ToolCallEvent = Base & {
  kind: 'tool_call'
  id: string
  name: string
  input: Record<string, unknown>
  permission?: Rule
  outside?: boolean
  source?: string
}
export type ToolResultEvent = Base & {
  kind: 'tool_result'
  result: { tool_use_id: string; content: string | Block[]; is_error?: boolean }
  outcome?: Outcome
}
// One call of one of your hooks, for the tool call with this id (harness/core/loop.py, _run_one)
export type HookEvent = Base & {
  kind: 'hook'
  id: string
  hook: HookName
  verdict: HookVerdict
  reason?: string | null // why before_tool blocked it
  error?: string | null // what went wrong when it crashed
  original?: string | null // the tool's own output, when after_tool replaced it
  ms: number
}
export type ApprovalEvent = Base & {
  kind: 'approval'
  id: string
  prompt: string
  tool: string
  input: Record<string, unknown>
  path: string
  content: string
  // Newer events only:
  outside?: boolean // the path is outside the workspace (the loop's own check)
  where?: string // for file tools: where the file really is
  setting?: Rule // your rule for the tool, before the workspace check
  replaces?: { label: string; value: string; shared: boolean } // remember_fact: the fact with that label now
}
export type DecisionEvent = Base & { kind: 'decision'; id: string; allowed: boolean }
export type AnswerEvent = Base & { kind: 'answer'; text: string; provider: string; model: string }
export type ProviderEvent = Base & { kind: 'provider'; name: string; label: string; model: string; history: number }
export type CompactingEvent = Base & { kind: 'compacting'; before: number; limit: number }
export type CompactedEvent = Base & {
  kind: 'compacted'
  skipped?: string
  failed?: string
  summary?: string
  before?: number
  after?: number
  messages_before?: number
  messages_after?: number
  usage?: Usage | null
  cost?: number | null
}
// A helper agent's step; `step` says which kind, the rest are that kind's fields
export type SubEvent = Base & {
  kind: 'sub'
  step: 'request' | 'response' | 'tool_call' | 'tool_result' | 'hook' | 'retry'
  helper?: string
  call?: number
  [k: string]: unknown
}
// A workflow (features/workflow.py): a fixed chain of agents. Each step is a loop of its own; these say
// when one starts (and the text the code passed it) and when it ends (what it returned; a check's verdict)
export type WorkflowStepName = 'gather' | 'write' | 'check' | 'fix'
export type Verdict = 'pass' | 'problems' | 'unclear'
export type StepEvent = Base & { kind: 'step'; n: number; name: WorkflowStepName; label: string; sent: string
  system: string; tools: string[]; attempt?: number }
export type StepDoneEvent = Base & { kind: 'step_done'; n: number; name: WorkflowStepName; label: string; text: string
  chars: number; verdict?: Verdict; problems?: string; fixes_left?: number; last?: boolean; attempt?: number }
export type SimpleEvent = Base & { kind: 'stopping' | 'stopped' | 'done' }
// A reply asked for several tools, with "tools at once" on: did they run together, and if not, why
export type ToolsAtOnceEvent = Base & { kind: 'tools_at_once'; turn: number; count: number; together: boolean; reason: string | null }
// The service was busy or briefly down: the loop waited and sent the same request again (one call)
export type RetryEvent = Base & { kind: 'retry'; turn: number; attempt: number; status: number | null; reason: string
  wait: number; simulated: boolean }
export type ErrorEvent = Base & { kind: 'error'; message: string; detail?: string } // detail: the raw error when message is plain words

export type HarnessEvent =
  | UserEvent | RequestEvent | ResponseEvent | ToolCallEvent | ToolResultEvent | HookEvent | ApprovalEvent | DecisionEvent
  | AnswerEvent | ProviderEvent | CompactingEvent | CompactedEvent | SubEvent | SimpleEvent | ErrorEvent | RetryEvent
  | ToolsAtOnceEvent | StepEvent | StepDoneEvent

export type Snapshot = {
  gen: number
  running: boolean
  events: HarnessEvent[]
  conversation: string
  provider: string | null
  model: string
  live: string
  frozen?: boolean // this conversation keeps the prompt and tools it began with
  origin?: Origin | null // an opened side of a comparison, or the new run of a re-run
  rewindable?: number[] // the seq of each of your messages that has a checkpoint: it offers "Rewind to here"
}

export type Price = { input: number; cached: number; output: number; cache_write?: number; note?: string } | null

export type ProviderInfo = {
  name: string; label: string; model: string; models?: string[]; missing_key: string | null; price: Price
  thinking?: 'adaptive' | 'budget' // how this provider takes thinking
  model_prices?: Record<string, NonNullable<Price>> | null // the mock: prices per model it imitates
  context_windows?: Record<string, number> | null // the most each model can take in on one call (tokens)
}

export type ToolDef = { name: string; description: string; input_schema?: unknown }

export type Info = {
  provider: string | null
  mode: string
  model: string
  providers: ProviderInfo[]
  folder: string
  frontend?: { built: boolean; folder: string }
  max_turns: number
  system: string
  tools: ToolDef[]
}

export type SettingsTool = {
  name: string
  description: string
  default_description: string
  permission: Rule
  default_permission: Rule
  input_schema: unknown
  source: string
}

export type Settings = {
  system: string
  system_default: string
  tools: SettingsTool[]
  changed: string[]
  trim: { enabled: boolean; keep_last: number }
  compact: { enabled: boolean; over_chars: number }
  thinking: Thinking
  cache: { enabled: boolean }
  apply: Apply
  limits: Limits
  mcp_problems: string[]
  hooks: { file: string; functions: string[]; problem: string | null }
  file: string
  // the skill files found, and exactly what's added to the prompt with skills on (older servers: missing)
  skills?: { setting: SkillsSetting; found: { name: string; description: string }[]; addition: string; folder: string }
  faults?: Faults
  tools_at_once?: { enabled: boolean }
  workflow?: { enabled: boolean }
  run_code?: { enabled: boolean }
  extra_tools?: ExtraTools
}

export type SettingsChange = {
  system?: string
  descriptions?: Record<string, string>
  permissions?: Record<string, Rule>
  trim?: { enabled: boolean; keep_last: number }
  compact?: { enabled: boolean; over_chars: number }
  thinking?: Thinking
  cache?: { enabled: boolean }
  apply?: Apply
  limits?: Limits
  skills?: SkillsSetting
  faults?: Faults
  tools_at_once?: { enabled: boolean }
  workflow?: { enabled: boolean }
  run_code?: { enabled: boolean }
  extra_tools?: ExtraTools
}

export type Fact = { label: string; value: string; share: boolean }
export type Profile = { facts: Fact[]; shared: number; addition: string; file: string }

export type ConversationItem = {
  id: string
  title: string
  updated: number
  messages: number
  runs?: number
  provider?: string | null
  model?: string | null
  badge?: string[]
  kind?: string | null // 'compare': one side of a comparison, kept for inspecting
}
export type Conversations = { current: string; items: ConversationItem[] }

export type CompareSide = {
  label: string
  provider: string
  model: string
  config?: RunConfig & { tools?: SentTool[] }
  // outcome: why a tool didn't run as asked (blocked, declined, hook_blocked, error)
  tools: { name: string; input: Record<string, unknown>; blocked?: boolean; failed?: boolean; outcome?: string }[]
  answer?: string
  error?: string
  seconds: number
  tokens_read: number
  tokens_written: number
  cost: number | null
  calls?: { turn: number; sub: boolean; input_tokens: number; cache_read: number; output_tokens: number; cost: number | null; seconds: number }[]
  conversation?: string
  approved?: string[] // tools you allowed in the saved run
  waited?: number // seconds the saved run waited for you (left out of its time)
  allow_ask?: boolean // Ask-first tools were let through for this comparison
  stats?: RunStats // with several runs per side: the middle and range over them
  stopped?: boolean // Stop was pressed: fewer runs than asked for, or the one run cut short
}
export type Spread = { median: number; min: number; max: number } | null
// Everything but `runs` counts only the runs that answered (`answered`): not the failed or stopped ones.
// same_tools: answered runs with the most common tool sequence. Older saves count every run and lack
// `stopped` and `failures`, and their `answers` include the errors.
export type RunStats = { runs: number; seconds: Spread; tokens_read: Spread; tokens_written: Spread; cost: Spread;
  same_answer: number; answered?: number; same_tools?: number; tools: string[][]; errors: number; answers?: (string | null)[]
  stopped?: number; failures?: string[] }
export type CompareResult = { results: CompareSide[]; profile_included: boolean; id?: string }
export type CompareStatus = { running: boolean; started?: number; repeat?: number; sides?: { label: string; done: number }[] }
// kind: a comparison, or a re-run (a saved message sent again; it also keeps which conversation and message)
export type PastComparison = { id: string; time: number; text: string; repeat: number; sides: string[]; kind?: 'compare' | 'rerun' }
export type SavedComparison = { id: string; time: number; text: string; look_for: string; repeat: number; sides: CompareSide[]
  kind?: 'compare' | 'rerun'; conversation?: string; seq?: number }
export type RerunResult = { text: string; baseline: CompareSide; rerun: CompareSide; id?: string }
// What going back to before one of your messages would do (POST /rewind/preview)
export type RewindPreview = {
  seq: number
  message: number // which of your messages it is: 1, 2, ...
  text: string
  messages: number // how many of your messages go (this one and every later one)
  files: { restore: string[]; delete: string[] } | null // null: the workspace was too big to keep a copy of
  edited: string[] // files you changed since the last reply that the rewind overwrites
  unreadable: string[] // files the checkpoint couldn't read: left as they are
  cannot_undo: { tool: string; why: string }[] // what the removed messages' tools did outside the workspace
}
export type RewindResult = { text: string; files: boolean; restored: number; deleted: number }
// Where an opened conversation came from: side A, B or C of a comparison, or a re-run's new run
export type Origin =
  | { comparison: string; side: string; kind?: 'rerun' }
  | { kind: 'eval'; round: string; question: string; attempt: number } // one run of an eval round, opened with Inspect

export type SavedRun = { seq: number; time: number; text: string; config: RunConfig | null }
export type SavedConversation = {
  id: string
  title: string
  created: number
  updated: number
  runs?: SavedRun[]
  messages: Message[]
  events: HarnessEvent[]
}

// ---- evals (fixed questions that score a setup) ----
export type EvalCase = {
  question: string; passed: number; runs: number; verdict: 'PASS' | 'MIXED' | 'FAIL' | 'NOT JUDGED'; problems: string[]
  tools: string[][]; seconds: number[]; tokens: number[]; cost: (number | null)[]; answers: (string | null)[]
  checked?: string[] // what the question checks, in words
  judge_notes?: (string | null)[] // per run: the judge's reason, when it judged
  conversations?: (string | null)[] // per run: the saved conversation, to inspect
  // Newer results only (older saved runs lack these):
  ran?: number // runs that finished; `runs` leaves out the ones the judge couldn't grade
  unjudged?: number // runs the judge itself failed on: neither passed nor failed
  run_problems?: string[][] // per run: why it failed (empty: it passed)
  judge_verdicts?: ('PASS' | 'FAIL' | 'UNJUDGED' | null)[] // per run: what the judge said, when it judged
  errors?: (string | null)[] // per run: the error it ended with, kept apart from the answers
}
// A question as written in config/evals.json
export type EvalQuestion = { question: string; tools: string[]; answer_has?: string[]; judge?: string; tool_may_not_work?: boolean }
export type EvalResult = {
  id?: string; time?: number; provider: string; label: string; model: string; repeat: number; use_my_settings: boolean
  judge: string | null; setup: string[]; passed: number; total: number; cases: EvalCase[]; estimated?: boolean
  only?: string // "Only questions containing", when used
  incomplete?: boolean // stopped before every question ran
  unjudged?: number // runs left out because the judge itself failed
}
export type EvalRun = Omit<EvalResult, 'cases'> & { id: string; time: number; questions: number }
export type EvalStatus = {
  running: boolean; done?: number; total?: number; provider?: string; model?: string; started?: number
  result?: EvalResult; error?: string
}
