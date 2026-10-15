// A message told as a story: each model call becomes one plain sentence ("The model asked for a tool: look
// up the weather in Paris"), each tool what the harness did with it ("↩ The harness ran it here and sent
// back: 20.9 °C, overcast"). Plain words only: no tool_use, stop_reason or other API names. Pure: no screen code.
import type { ConceptKey } from '../learn/concepts'
import type { PromptCut } from '../api/types'
import { count, dollars, plural, seconds, shortArgs } from '../lib/format'
import { callLimitHit, callsOfRun, type Call, type Run, type RunModel, type ToolRow } from './derive'

export type StoryTool = { toolId: string; what: string; back: string; tone: 'ok' | 'bad' | 'warn' | 'pending' }
export type StoryStep = {
  callId: string
  n: number // its place in the message: 1, 2, ...
  kind: 'tools' | 'answer' | 'cut' | 'failed' | 'waiting' | 'replied'
  lead: string // "The model asked for a tool:", "The model answered:", ...
  tools: StoryTool[]
  promptCut?: PromptCut // the server cut the prompt of this call (see promptCutWords)
}

// What a cut prompt means, in plain words: the server read only part of what the harness sent
export function promptCutWords(cut: PromptCut) {
  return `The server read only ${count(cut.read)} of about ${count(cut.sent_about)} tokens: its window was too small, so `
    + 'it cut the prompt to fit, and the start (the instructions and the tool list) may be lost. For Ollama, '
    + 'give models a bigger window: setx OLLAMA_CONTEXT_LENGTH 32768, then restart Ollama.'
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const quote = (v: unknown, max = 60) => { const s = str(v).replace(/\s+/g, ' ').trim(); return `"${s.length > max ? `${s.slice(0, max - 1)}…` : s}"` }
const UNITS: Record<string, [string, string]> = { celsius: ['°C', 'Celsius'], fahrenheit: ['°F', 'Fahrenheit'], kelvin: ['K', 'Kelvin'] }
const unit = (u: unknown, word = false) => { const k = str(u).toLowerCase(); return UNITS[k]?.[word ? 1 : 0] ?? str(u) }

// What the model asked for, as the end of "The model asked for a tool: …"
export function toolPhrase(name: string, input: Record<string, unknown>): string {
  const i = input ?? {}
  switch (name) {
    case 'get_weather': return `look up the weather in ${str(i.city)}`
    case 'convert_temperature': return `convert ${str(i.value)} ${unit(i.from_unit)} to ${unit(i.to_unit, true)}`
    case 'read_file': return `read the file ${str(i.path)}`
    case 'write_file': return `write the file ${str(i.path)}`
    case 'list_files': return i.path && str(i.path) !== '.' ? `list the files in ${str(i.path)}` : 'list the files in the workspace'
    case 'search_files': return `search the files for ${quote(i.query)}`
    case 'calculate': return `work out ${str(i.expression)}`
    case 'get_current_time': return i.timezone ? `get the time in ${str(i.timezone)}` : 'get the current time'
    case 'roll_dice': return `roll ${i.count && Number(i.count) > 1 ? `${str(i.count)} dice` : 'a die'}${i.sides ? ` with ${str(i.sides)} sides` : ''}`
    case 'remember_fact': return `remember about you: ${quote(`${str(i.label)}: ${str(i.value)}`)}`
    case 'submit_expense': return `file an expense: ${str(i.amount)} ${str(i.currency)}${i.category ? `, ${str(i.category)}` : ''}`
    case 'update_plan': return 'update its plan'
    case 'delegate': return `hand a job to a helper: ${quote(i.task)}`
    case 'run_python': return typeof i.code === 'string' ? 'run some Python code it wrote' : `run the script ${str(i.path)}`
    case 'find_tool': return `find a tool for ${quote(i.query)}`
    case 'load_skill': return `load the instructions for ${quote(i.name)}`
  }
  const args = shortArgs(i, 50)
  return `use ${name}${args ? ` (${args})` : ''}`
}

// The first readable line of what came back, cut short (the example hook's "[Untrusted content…]" line is skipped)
export function resultLine(content: string, max = 90): string {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('[Untrusted content'))
  const first = lines[0] ?? ''
  if (first.length > max) return `${first.slice(0, max - 1)}…`
  return lines.length > 1 ? `${first} …` : first
}

// What the harness did with one request, as the "↩" line under it
export function backLine(row: ToolRow, here = true): Pick<StoryTool, 'back' | 'tone'> {
  const got = row.result ? resultLine(row.result.content) : ''
  switch (row.status) {
    case 'ran': return { back: got ? `The harness ran it${here ? ' here' : ''} and sent back: ${got}` : `The harness ran it${here ? ' here' : ''}; it sent back nothing`, tone: 'ok' }
    case 'error': return { back: `It failed, and the harness sent the error back: ${got || 'no details'}`, tone: 'bad' }
    case 'blocked': return { back: 'The harness refused it (it is set to Block) and told the model.', tone: 'bad' }
    case 'hook_blocked': return { back: 'A safety check stopped it before it ran, and the model was told why.', tone: 'bad' }
    case 'declined': return { back: 'You declined it, and the harness told the model.', tone: 'bad' }
    case 'unattended': return { back: 'Not run: nobody was there to allow it.', tone: 'warn' }
    case 'not_run': return { back: 'Not run: the message stopped first.', tone: 'warn' }
    case 'awaiting': return { back: 'Waiting for you to allow it…', tone: 'pending' }
    case 'running': return { back: 'The harness is running it…', tone: 'pending' }
  }
}

function asked(call: Call) {
  return (call.response?.content ?? []).filter((b) => b.type === 'tool_use').length
}

// One step per model call in the message, in order
export function storySteps(model: RunModel, run: Run): StoryStep[] {
  const calls = callsOfRun(model, run)
  let toolSteps = 0
  let ranOne = false
  return calls.map((call, i): StoryStep => ({ ...step(call, i), ...(call.promptCut ? { promptCut: call.promptCut } : {}) }))

  function step(call: Call, i: number): StoryStep {
    const n = i + 1
    const rows = call.toolIds.map((id) => model.tools[id]).filter(Boolean)
    if (rows.length || call.stopReason === 'tool_use') {
      const many = Math.max(rows.length, asked(call)) > 1
      const lead = many ? `The model asked for ${Math.max(rows.length, asked(call))} tools at once:`
        : toolSteps ? 'The model asked for another tool:' : 'The model asked for a tool:'
      toolSteps++
      const tools = rows.map((row) => {
        const b = backLine(row, !ranOne)
        if (row.status === 'ran') ranOne = true
        return { toolId: row.id, what: toolPhrase(row.name, row.input), ...b }
      })
      return { callId: call.id, n, kind: 'tools', lead, tools }
    }
    if (call.failed) return { callId: call.id, n, kind: 'failed', lead: 'The call to the model failed.', tools: [] }
    if (!call.response) return { callId: call.id, n, kind: 'waiting', lead: 'Waiting for the model…', tools: [] }
    if (call.stopReason === 'max_tokens') return { callId: call.id, n, kind: 'cut', lead: 'The reply was cut off at the longest-reply limit:', tools: [] }
    if (call.stopReason && call.stopReason !== 'end_turn') return { callId: call.id, n, kind: 'cut', lead: 'The model stopped early:', tools: [] }
    const last = i === calls.length - 1
    return { callId: call.id, n, kind: last && run.answer ? 'answer' : 'replied', lead: last && run.answer ? 'The model answered:' : 'The model replied.', tools: [] }
  }
}

// (provider: its name or its label, e.g. "mock" or "Mock (claude -p)")
// The message's numbers on one quiet line: "3 trips to the model · 22s · about $0.03 if this were the paid API"
export function storyNumbers(model: RunModel, run: Run, provider: string | null): string {
  const calls = callsOfRun(model, run)
  const parts = [`${plural(calls.length, 'trip')} to the model`]
  if (run.endedAt) parts.push(seconds(run.endedAt - run.startedAt))
  if (run.cost > 0) {
    const estimated = calls.some((c) => c.estimated)
    parts.push(`about ${dollars(run.cost)}${estimated ? ' or more' : ''}${provider && /^mock/i.test(provider) ? ' if this were the paid API' : ''}`)
  }
  return parts.join(' · ')
}

// "What just happened": one plain takeaway about this message, and the idea it is about
export function storyTakeaway(model: RunModel, run: Run): { text: string; concept: ConceptKey } | null {
  if (run.outcome === 'running') return null
  const limit = callLimitHit(run)
  if (run.outcome === 'error' && limit !== null) {
    return { concept: 'max_turns', text: `The harness stopped this message after ${plural(limit, 'call')} to the model: the call limit. Without that cap, a model that keeps asking for tools could loop and spend without end.` }
  }
  if (run.outcome === 'error') return null // the failure itself says what went wrong
  if (run.outcome === 'stopped') return { concept: 'stop', text: 'You stopped it. A call that had already started finished first; the conversation so far is kept.' }
  if (run.cutOff) return { concept: 'other_stop', text: 'The reply hit the longest-reply limit, so it stops part-way. The harness shows what arrived and says why it ended.' }
  const rows = callsOfRun(model, run).flatMap((c) => c.toolIds.map((id) => model.tools[id])).filter(Boolean)
  if (!rows.length) {
    return { concept: 'model_call', text: 'The model answered straight away: one trip, no tools needed. Each trip sends the whole conversation again, because the model remembers nothing between calls.' }
  }
  const extra = [
    rows.some((r) => r.status === 'error') && 'A tool failed: the error went back to the model like any other result, and it carried on.',
    rows.some((r) => ['blocked', 'hook_blocked', 'declined', 'unattended'].includes(r.status)) && 'A request was refused, and the model was told, so it could carry on.',
  ].filter(Boolean).join(' ')
  return {
    concept: 'loop',
    text: `The model never ran anything itself. It asked for ${plural(rows.length, 'tool')}; each time, the harness did the work, added the result to the conversation and called the model again. That repeat is the loop.${extra ? ` ${extra}` : ''}`,
  }
}
