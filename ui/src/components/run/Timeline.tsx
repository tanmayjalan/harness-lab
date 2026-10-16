// The conversation as a timeline: your message, then each model call as a thin divider with
// the tools it asked for underneath, then the answer. Click a call or tool to inspect it.
import { AlertTriangle, ArrowLeftRight, Brain, CircleStop, RotateCcw, Scissors, Shuffle, Sparkles, Undo2 } from 'lucide-react'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Call, Run, RunModel } from '../../model/derive'
import { callLimitHit, callsOfRun } from '../../model/derive'
import { cn } from '../../lib/cn'
import { approx, cost, count, ESTIMATE_TITLE, plural, seconds, tokens, tokensOut } from '../../lib/format'
import { Explain } from '../../learn/Explain'
import type { ConceptKey } from '../../learn/concepts'
import { Markdown } from '../Markdown'
import { Callout, Disclosure, RunningBanner, Tip } from '../ui'
import { ToolRow } from './ToolRow'
import { PlanCard } from './PlanCard'
import { WorkflowCard } from './WorkflowCard'
import { usePrefs, useUi } from '../../store/ui'
import { stopWords } from '../../lib/stopWords'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { inspectCall } from '../../store/selectors'
import { ONE_COLUMN } from '../../lib/layout'
import { promptCutWords } from '../../model/story'
import { providerName } from '../composer/providerWords'
import { storyNumbers, storySteps } from '../../model/story'
import { StoryRail, Takeaway } from './Story'
import { experimentRun } from './ExperimentPanels'
import { findExperiment } from '../../learn/experiments'
import { useCurrentProvider } from './EmptyState'

type Props = {
  model: RunModel
  inspectedCallId: string | null
  live: string
  running: boolean
  onRerun?: (run: Run) => void
  onCompare?: (run: Run) => void
  onRewind?: (run: Run) => void // go back to before this message, files too
}

// Quiet until you point at the message or tab into it; always shown on touch screens, which have no hover
const ON_HOVER = 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100'

// The first place each idea appears gets the full explanation (once, then never again)
function firstPlaces(model: RunModel) {
  const first: Partial<Record<ConceptKey, string>> = {}
  for (const id of model.callOrder) {
    const c = model.calls[id]
    const key: ConceptKey | null = c.stopReason === 'tool_use' ? 'tool_use' : c.stopReason === 'end_turn' ? 'end_turn'
      : c.stopReason ? 'other_stop' : null
    if (key && !first[key]) first[key] = id
    if (c.turn === 2 && !first.history) first.history = id
    if (c.trimmed && 'count' in c.trimmed && c.trimmed.count && !first.trimming) first.trimming = id
    if (c.thought !== undefined && !first.thinking) first.thinking = id
    if (c.request.cache && !first.caching) first.caching = id
    if (c.stopReason === 'tool_use' && !first.loop) first.loop = id
    if (c.retries?.length && !first.retry) first.retry = id
    if (c.atOnce?.together && !first.tools_at_once) first.tools_at_once = id
    for (const t of c.toolIds.map((tid) => model.tools[tid]).filter(Boolean)) {
      if (t.status === 'error' && !first.tool_error) first.tool_error = id
      // the first time one of your hooks ran at all (or, in older saves, blocked something)
      if ((t.status === 'hook_blocked' || t.hooks?.length) && !first.hook) first.hook = id
      if ((t.status === 'blocked' || t.status === 'unattended' || t.status === 'declined' || t.approval) && !first.permission) first.permission = id
      if (t.source !== 'built in' && !first.mcp) first.mcp = id
      if (t.name === 'remember_fact' && t.status === 'ran' && !first.facts) first.facts = id
      if (t.name === 'submit_expense' && !first.structured_output) first.structured_output = id
      if (t.name === 'search_files' && !first.retrieval) first.retrieval = id
      if (t.name === 'load_skill' && !first.skills) first.skills = id
      if (t.name === 'run_python' && !first.run_code) first.run_code = id
      if (t.name === 'find_tool' && !first.tool_search) first.tool_search = id
      // the example hook marks file and web text: the place to explain prompt injection
      if (t.result?.content.startsWith('[Untrusted content') && !first.prompt_injection) first.prompt_injection = id
    }
  }
  return first
}

export const Timeline = memo(function Timeline({ model, inspectedCallId, live, running, onRerun, onCompare, onRewind }: Props) {
  const selectedTool = useUi((s) => s.selectedToolId)
  const selectCall = useUi((s) => s.selectCall)
  const first = firstPlaces(model)
  const last = model.runs[model.runs.length - 1]
  // F322: the messages you watched while they ran (this conversation, this visit). Only a failure among them is
  // an alert; an old one is shown, not read out again every time the conversation opens
  const conversation = useSession((s) => s.conversation)
  const watched = useRef(new Set<string>())
  if (running) watched.current.add(`${conversation}:${last && last.outcome === 'running' ? last.index : model.runs.length + 1}`)

  return (
    <div className="space-y-6">
      {model.runs.map((run) => (
        <div key={run.index} className="space-y-3">
          {/* F433: a heading per message, so a screen reader can jump between them */}
          <h2 className="sr-only">Message {run.index}</h2>
          {model.switches.filter((s) => s.beforeRun === run.index).map((s) => (
            <SystemNote key={s.seq} icon={<Shuffle className="size-3.5" />} announce
              after={<Explain concept="switch" quiet className="mt-2 text-left" />}>
              Switched to <b>{s.label}</b> (<code>{s.model}</code>).{' '}
              {s.history ? `The whole history (${plural(s.history, 'entry', 'entries')}) goes to it with this message.` : ''}
            </SystemNote>
          ))}
          <UserMessage run={run} running={running} onRerun={onRerun} onCompare={onCompare} onRewind={onRewind} />
          <RunBody run={run} model={model} first={first} inspectedCallId={inspectedCallId} selectedTool={selectedTool}
            onSelect={selectCall} live={run === last && running ? live : ''} active={run === last && running} latest={run === last}
            justFailed={run === last && watched.current.has(`${conversation}:${run.index}`)} />
        </div>
      ))}
      {model.switches.filter((s) => s.beforeRun > model.runs.length).map((s) => (
        <SystemNote key={s.seq} icon={<Shuffle className="size-3.5" />} announce
          after={<Explain concept="switch" quiet className="mt-2 text-left" />}>
          Switched to <b>{s.label}</b> (<code>{s.model}</code>).{' '}
          {s.history ? `Your next message sends the whole history (${plural(s.history, 'entry', 'entries')}) to a model that has never seen it.` : ''}
        </SystemNote>
      ))}
    </div>
  )
})

function UserMessage({ run, running, onRerun, onCompare, onRewind }:
  { run: Run; running: boolean; onRerun?: (r: Run) => void; onCompare?: (r: Run) => void; onRewind?: (r: Run) => void }) {
  // only messages with a checkpoint (a saved copy of the files before them): not those saved before Rewind existed
  const rewindable = useSession((s) => s.rewindable.includes(run.userSeq))
  const rewind = onRewind && rewindable ? onRewind : undefined
  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2 text-base break-words whitespace-pre-wrap text-on-accent shadow-sm">
        {/* the space is inside the hidden part: the bubble keeps white space (pre-wrap), so a visible one would indent it */}
        <span className="sr-only">You: </span>{run.text}
      </div>
      {!running && (onRerun || onCompare || rewind) && (
        <div className={cn('flex gap-1', ON_HOVER)}>
          {onRerun && (
            <Tip text="Send this message again with your current settings (model, prompt, tools and permissions, thinking, caching, limits, facts about you) and compare the two">
              <button type="button" onClick={() => onRerun(run)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted focus-ring hover:bg-sunken hover:text-fg">
                <RotateCcw className="size-3" /> Re-run with current settings
              </button>
            </Tip>
          )}
          {rewind && (
            <Tip text="Go back to before this message: this message and the later ones are removed, and the files the tools changed are put back as they were. You see the list first">
              <button type="button" onClick={() => rewind(run)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted focus-ring hover:bg-sunken hover:text-fg">
                <Undo2 className="size-3" /> Rewind to here
              </button>
            </Tip>
          )}
          {onCompare && (
            <Tip text="Ask this question with two different setups side by side">
              <button type="button" onClick={() => onCompare(run)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted focus-ring hover:bg-sunken hover:text-fg">
                <ArrowLeftRight className="size-3" /> Compare this question
              </button>
            </Tip>
          )}
        </div>
      )}
    </div>
  )
}

type BodyProps = {
  run: Run
  model: RunModel
  first: Partial<Record<ConceptKey, string>>
  inspectedCallId: string | null
  selectedTool: string | null
  onSelect: (callId: string, toolId?: string | null) => void
  live: string
  active: boolean
  latest: boolean // the newest message: its numbers stay in view
  justFailed: boolean // it ran while you watched: a failure is read out at once
}

function RunBody({ run, model, first, inspectedCallId, selectedTool, live, active, latest, justFailed }: BodyProps) {
  const calls = callsOfRun(model, run)
  const plan = latestPlan(model, calls)
  const lastCall = calls[calls.length - 1]
  const waiting = active && !live && (model.status === 'waiting_model' || model.status === 'summarising')
  const hintSeen = usePrefs((s) => s.inspectHintSeen)
  const limitHit = callLimitHit(run)
  // Seconds spent waiting for your Allow or Decline in this message
  const waitedForYou = calls.flatMap((c) => c.toolIds.map((id) => model.tools[id]?.approval))
    .reduce((n, a) => n + (a?.askedAt && a.decidedAt ? a.decidedAt - a.askedAt : 0), 0)

  // The story by default; today's full view under "Show details" (open by default in Learning mode, or if you chose so)
  const alwaysOpen = usePrefs((s) => s.learningMode || s.alwaysDetails)
  const [picked, setPicked] = useState<boolean | null>(null)
  const open = picked ?? alwaysOpen
  const provider = useCurrentProvider()
  const all = storySteps(model, run)
  const inFlight = active && all.at(-1)?.kind === 'waiting'
  const steps = inFlight ? all.slice(0, -1) : all
  const waitingNode = active && (model.status === 'summarising' || inFlight || (waiting && (!lastCall || !!lastCall.response)))
    ? <WaitingLine since={inFlight ? lastCall!.startedAt : run.startedAt}
      text={model.status === 'summarising' ? 'Summarising the older history first…' : 'Waiting for the model…'} />
    : undefined
  const finished = run.outcome !== 'running'
  const detailsId = `details-${run.index}`
  const x = findExperiment(useUi((s) => s.experimentId))
  const revealHere = !!x && experimentRun(model, x) === run

  return (
    <div className="space-y-2">
      {run.compaction && <Compaction run={run} />}
      {plan && <PlanCard steps={plan} />}
      {run.workflow && <WorkflowCard run={run} model={model} />}
      <StoryRail steps={steps} active={active} waiting={waitingNode} hint={!hintSeen && run.index === 1} />
      {active && run.stopping && run.outcome === 'running' && (
        <SystemNote icon={<CircleStop className="size-3.5 animate-pulse-soft" />} announce>
          Stopping… a model call that has started can't be cut off, so the harness stops as soon as it returns.
        </SystemNote>
      )}
      {live && <LiveBubble text={live} />}
      {run.answer && <AnswerBubble run={run} />}
      {run.cutOff && (
        <SystemNote icon={<CircleStop className="size-3.5" />}>
          {run.cutOff === 'max_tokens'
            ? <>Cut off: the reply reached the longest-reply limit ({count(lastCall?.request.max_tokens ?? 0)} tokens), so it isn't finished. Change the limit in <LimitsLink />.</>
            : <>Cut off: the model stopped early ({run.cutOff}), so the reply isn't finished.</>}
        </SystemNote>
      )}
      {run.stopping && run.outcome === 'answered' && (
        <SystemNote icon={<CircleStop className="size-3.5" />}>
          You pressed Stop during call {lastCall?.turn ?? 1}. A call that has started can't be cut off, so it finished;
          its reply was the final answer, so there was nothing left to stop.
        </SystemNote>
      )}
      {run.outcome === 'stopped' && (
        <SystemNote icon={<CircleStop className="size-3.5" />}>
          Stopped. The conversation so far is kept.
        </SystemNote>
      )}
      {run.outcome === 'error' && limitHit && (
        <SystemNote icon={<CircleStop className="size-3.5" />}>
          Stopped: this message reached the limit of {limitHit} model calls.
          The conversation so far is kept; change the limit in <LimitsLink />.
        </SystemNote>
      )}
      {run.outcome === 'error' && !limitHit && (
        <Callout tone="bad" live={justFailed} icon={<AlertTriangle className="size-4" />}>
          <b>The model call failed.</b> The conversation so far is kept. <div className="text-fg/80">{run.error}</div>
          {run.errorDetail && (
            <Disclosure className="mt-1 text-xs text-fg/70" summary="The error itself">
              <code className="break-all">{run.errorDetail}</code></Disclosure>
          )}
        </Callout>
      )}
      {calls.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted">
          <span data-testid="story-numbers">{finished ? storyNumbers(model, run, run.answer?.provider ?? provider) : ''}</span>
          <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setPicked(!open)}
            className="rounded px-1 text-accent focus-ring hover:underline">
            {open ? 'Hide details ▴' : 'Show details ▾'}
          </button>
        </div>
      )}
      {open && calls.length > 0 && (
        <div id={detailsId} data-testid="details" className="space-y-2 rounded-xl border border-dashed border-line-strong bg-sunken/40 px-3 pt-1 pb-2">
      {calls.map((call) => {
        // With the workflow on, each step's calls sit under its name ("Call 1" starts again in each step)
        const step = call.step != null ? run.workflow?.find((st) => st.n === call.step) : undefined
        return (
        <div key={call.id} className="space-y-1.5">
          {step && step.callIds[0] === call.id && (
            <div className="pt-1 text-xs font-semibold text-muted">
              Step {step.n}: {step.label}{step.attempt ? ` ${step.attempt}` : ''}
              <span className="font-normal"> · its own loop, with {step.tools.length ? 'read-only tools' : 'no tools'}</span>
            </div>
          )}
          <CallDivider call={call} selected={call.id === inspectedCallId} multi={model.runs.length > 1}
            hint={!hintSeen && call.id === model.callOrder[0]}
            // picking a call is what opens the Inspector, and focus goes there (on a narrow screen, its own view)
            onClick={() => inspectCall(call.id, { focus: true })} />
          {first.history === call.id && <Explain concept="history" quiet />}
          {call.promptCut && <Callout tone="warn" size="sm">{promptCutWords(call.promptCut)}</Callout>}
          {first.retry === call.id && <Explain concept="retry" quiet />}
          {first.tools_at_once === call.id && <Explain concept="tools_at_once" quiet />}
          {first.trimming === call.id && <Explain concept="trimming" quiet />}
          {first.caching === call.id && call.response && <Explain concept="caching" quiet />}
          {call.thought !== undefined && <Thought text={call.thought} first={first.thinking === call.id} />}
          {call.interim && (
            <div className="flex gap-1.5 pl-3 text-sm text-muted italic" title="Text the model wrote in the same reply as its tool request">
              <span className="shrink-0 not-italic font-medium">model:</span><Markdown text={call.interim} />
            </div>
          )}
          {call.toolIds.length > 0 && (
            <div className="space-y-1.5 pl-3">
              {call.toolIds.map((id) => model.tools[id]).filter(Boolean).map((row) => (
                <ToolRow key={row.id} row={row} selected={selectedTool === row.id}
                  setting={call.request.tools?.find((t) => t.name === row.name)?.permission} loaded={call.request.hooks}
                  onSelect={() => useUi.getState().inspect(call.id, 'tools', { toolId: row.id })} />
              ))}
            </div>
          )}
          {first.loop === call.id && <Explain concept="loop" quiet />}
          {first.tool_use === call.id && <Explain concept="tool_use" quiet />}
          {first.tool_error === call.id && <Explain concept="tool_error" quiet />}
          {first.hook === call.id && <Explain concept="hook" quiet />}
          {first.permission === call.id && <Explain concept="permission" quiet />}
          {first.mcp === call.id && <Explain concept="mcp" quiet />}
          {first.facts === call.id && <Explain concept="facts" quiet />}
          {first.structured_output === call.id && <Explain concept="structured_output" quiet />}
          {first.retrieval === call.id && <Explain concept="retrieval" quiet />}
          {first.skills === call.id && <Explain concept="skills" quiet />}
          {first.run_code === call.id && <Explain concept="run_code" quiet />}
          {first.tool_search === call.id && <Explain concept="tool_search" quiet />}
          {first.prompt_injection === call.id && <Explain concept="prompt_injection" quiet />}
          {first.end_turn === call.id && <Explain concept="end_turn" quiet />}
          {first.other_stop === call.id && <Explain concept="other_stop" quiet />}
        </div>
        )
      })}
          {run.answer && <DetailNumbers run={run} calls={calls} waitedForYou={waitedForYou} />}
          <AlwaysDetails />
        </div>
      )}
      {/* one takeaway after the newest answer; an experiment's own reveal takes its place */}
      {latest && finished && !revealHere && <Takeaway model={model} run={run} />}
    </div>
  )
}

// "Always show details": the choice is kept (also in Settings → Display)
function AlwaysDetails() {
  const on = usePrefs((s) => s.alwaysDetails)
  return (
    <label className="flex items-center gap-1.5 pt-1 text-xs text-muted">
      <input type="checkbox" checked={on} onChange={(e) => usePrefs.getState().setAlwaysDetails(e.target.checked)} />
      Always show details
    </label>
  )
}

export function latestPlan(model: RunModel, calls: Call[]) {
  for (let i = calls.length - 1; i >= 0; i--) {
    const ids = calls[i].toolIds
    for (let j = ids.length - 1; j >= 0; j--) {
      const row = model.tools[ids[j]]
      if (row?.plan && (row.status === 'ran' || row.status === 'running')) return row.plan
    }
  }
  return null
}

type DividerProps = { call: Call; selected: boolean; onClick: () => void; multi: boolean; hint: boolean }

function CallDivider({ call, selected, onClick, multi, hint }: DividerProps) {
  // What the reply asked for, not how many rows have arrived so far
  const asked = (call.response?.content ?? []).filter((b) => b.type === 'tool_use').length
  const n = Math.max(asked, call.toolIds.length)
  const what = call.failed ? 'failed' : stopWords(call.stopReason, n)
  const bad = !!call.failed || (call.stopReason && !['tool_use', 'end_turn'].includes(call.stopReason))
  const trim = call.trimmed && 'count' in call.trimmed && call.trimmed.count ? call.trimmed : null
  const ref = useRef<HTMLButtonElement>(null)
  const following = useUi((s) => s.followLatest)
  // F426: the line says whether the Inspector beside the chat is showing it (a narrow screen shows it as another view)
  const wide = !(typeof matchMedia !== 'undefined' && matchMedia(`(max-width: ${ONE_COLUMN - 1}px)`).matches)
  const besideChat = usePrefs((s) => s.inspectorOpen) && wide
  // Picked by hand ([ ], the size chart): bring it into view in the chat too
  useEffect(() => {
    if (selected && !following) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, following])
  return (
    <button ref={ref} type="button" onClick={() => { usePrefs.getState().sawInspectHint(); onClick() }} aria-current={selected ? 'true' : undefined}
      data-call-id={call.id} aria-controls={besideChat ? 'inspector' : undefined} aria-expanded={wide ? besideChat && selected : undefined}
      title="Inspect this call: what was sent and what came back"
      className={cn('group flex w-full items-center gap-2 rounded py-0.5 text-xs transition-colors focus-ring',
        selected ? 'text-accent' : 'text-muted hover:text-fg')}>
      <span className={cn('h-px w-3 shrink-0', selected ? 'bg-accent' : 'bg-line')} />
      {/* The pill wraps; its dots are drawn by CSS in front of each item, and the inner box is clipped
          (padding is outside the clip), so a wrapped line never starts with "·" (F320, as in the footer) */}
      <span className={cn('min-w-0 rounded-2xl border px-2',
        selected ? 'border-accent bg-accent-soft' : 'border-transparent group-hover:border-line group-hover:bg-panel')}>
        <span className="block overflow-hidden">
        <span className="-ml-3 flex flex-wrap items-center gap-y-0.5">
        <b className={cn('font-semibold', SEP)}>{multi && `Message ${call.runIndex} · `}{call.stepLabel && `${call.stepLabel} · `}Call {call.turn}{call.maxTurns <= 5 && ` (max ${call.maxTurns})`}</b>
        <span className={cn(SEP, bad && 'text-bad')}>{what}</span>
        {call.thought !== undefined && <span className={SEP} title="The model thought before it replied">thought</span>}
        {call.request.start_changed && call.request.cache && (
          <span className={cn(SEP, 'text-warn')} title="The system prompt or tools changed since the last call, so nothing before them could come from the cache">
            start changed
          </span>
        )}
        {trim && <span className={cn(SEP, 'text-warn')} title="Older tool results were shortened in the copy sent on this call">
          <Scissors aria-hidden className="mr-0.5 inline size-3 align-[-0.125em]" />trimmed {plural(trim.count, 'result')} ({count(trim.chars)} characters)</span>}
        {call.trimmed && 'skipped' in call.trimmed && <span className={SEP} title={call.trimmed.skipped}>trimming skipped</span>}
        {call.atOnce && (call.atOnce.together
          ? <span className={SEP} title="These tools ran at the same time, so they took about as long as the slowest one">{call.atOnce.count} tools at once</span>
          : <span className={cn(SEP, 'text-muted')} title={`Run one by one: ${call.atOnce.reason ?? ''}`}>one by one</span>)}
        {!!call.retries?.length && (
          <span className={cn(SEP, 'text-warn')} title={`The service was busy or briefly down: the harness waited and sent the same request again${call.retries.some((r) => r.simulated) ? ' (the practice switch)' : ''}`}>
            tried again ×{call.retries.length}
          </span>
        )}
        {call.promptCut && (
          <span className={cn(SEP, 'text-warn')} title={promptCutWords(call.promptCut)}>
            prompt cut by the server
          </span>
        )}
        {call.seconds != null && <span className={SEP}>{seconds(call.seconds)}</span>}
        {call.tokens.read > 0 && <span className={SEP} title={call.estimated ? ESTIMATE_TITLE : undefined}>{approx(tokens(call.tokens.read), call.estimated)} tokens in / {tokensOut(call.tokens.wrote, call.estimated)} out</span>}
        {hint && <span className={cn(SEP, 'text-accent')}>inspect →</span>}
        </span>
        </span>
      </span>
      <span className={cn('h-px flex-1', selected ? 'bg-accent' : 'bg-line')} />
    </button>
  )
}

// The way to the limits, as a button where the words used to be plain text (F361)
function LimitsLink() {
  return (
    <button type="button" className="text-accent hover:underline" onClick={() => useUi.getState().openSettings('model')}>
      Settings → Model → Limits
    </button>
  )
}

// A footer item with its separator dot drawn in front by CSS (F320)
const SEP = "before:px-1.5 before:content-['·']"

// `pinned`: the numbers stay in view (the newest message, or the one being inspected); otherwise they show on hover
function AnswerBubble({ run }: { run: Run }) {
  return (
    <div className="rounded-2xl rounded-bl-md border border-line bg-panel px-4 py-3 shadow-sm">
      <h3 className="sr-only">The model's reply</h3>
      <Markdown text={run.answer!.text} />
    </div>
  )
}

// Today's numbers for the message, inside its details
function DetailNumbers({ run, calls, waitedForYou }: { run: Run; calls: Call[]; waitedForYou: number }) {
  const info = useServer((s) => s.info)
  const secs = run.endedAt ? run.endedAt - run.startedAt : undefined
  const est = calls.some((c) => c.estimated)
  return (
    <div className="ml-1 overflow-hidden text-xs text-muted">
      {/* Each item carries its dot in front; the first one on every line is pushed past the clipped left edge */}
      <div className="-ml-3 flex flex-wrap">
        <span className={SEP}>{providerName(info?.providers, run.answer!.provider)} · <code>{run.answer!.model}</code></span>
        <span className={SEP}>{plural(calls.length, 'call')}</span>
        {secs != null && <span className={SEP}>{seconds(secs)}{waitedForYou >= 1 && ` (${Math.round(waitedForYou)}s waiting for you)`}</span>}
        {run.tokens.read > 0 && <span className={SEP} title={est ? ESTIMATE_TITLE : undefined}>{approx(tokens(run.tokens.read), est)} tokens in / {tokensOut(run.tokens.wrote, est)} out</span>}
        {run.cost > 0 && <span className={SEP}>{cost(run.cost, est)}</span>}
      </div>
    </div>
  )
}

// "Waiting for the model…" with the time so far; on the mock, a word on why it can take a while
function WaitingLine({ text, since }: { text: string; since: number }) {
  const mock = useSession((s) => s.provider) === 'mock'
  return (
    <RunningBanner text={text} startedAt={since} className="ml-3">
      {(secs) => mock && secs >= 10 && (
        <p className="text-xs text-muted">The mock starts <code>claude -p</code> for every call and doesn't stream: about 5 to 30 seconds is normal.</p>
      )}
    </RunningBanner>
  )
}

function LiveBubble({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      <div className="rounded-2xl rounded-bl-md border border-dashed border-accent bg-panel px-4 py-3">
        <Markdown text={text} />
      </div>
      <div className="flex items-center gap-1 pl-2 text-xs text-muted">
        <Sparkles className="size-3 animate-pulse-soft text-accent" /> writing… the reply streams in as it's written
      </div>
    </div>
  )
}

function Compaction({ run }: { run: Run }) {
  const c = run.compaction!
  if (c.failed) {
    return <SystemNote>Summarising failed, so the full history was sent this time. ({c.failed})</SystemNote>
  }
  if (c.skipped) {
    return <SystemNote>Summarising skipped: {c.skipped}</SystemNote>
  }
  return (
    <SystemNote after={<Explain concept="summarising" quiet className="mt-2 text-left" />}>
      History summarised before this message: {count(c.before ?? 0)} → {count(c.after ?? 0)} characters
      ({c.messages_before} → {c.messages_after} entries in the messages list).
    </SystemNote>
  )
}

// `announce`: read out when it appears (a switch, a stop), not only shown. Only the sentence is in the live
// region; `after` (an explanation) shows under it without being read out with it (F323)
function SystemNote({ icon, children, announce = false, after }: { icon?: ReactNode; children: ReactNode; announce?: boolean; after?: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl text-center text-xs text-muted">
      <div className="inline-flex items-start gap-1.5">
        {icon && <span className="mt-0.5">{icon}</span>}
        <div>
          <div {...(announce ? { role: 'status' } : {})}>{children}</div>
          {after}
        </div>
      </div>
    </div>
  )
}

// What the model thought before replying, folded by default
function Thought({ text, first }: { text: string; first: boolean }) {
  return (
    <div className="space-y-1.5 pl-3">
      <Disclosure className="rounded-md border border-dashed border-line text-sm" summaryClassName="px-2.5 py-1 text-xs text-muted hover:text-fg"
        summary={<span className="inline-flex items-start gap-1.5"><Brain className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{text ? <>Thinking · {count(text.length)} characters (click to read)</> : <>Thinking · this provider doesn't return the text, only that it thought</>}</span></span>}>
        {text && <div className="border-t border-line px-2.5 py-2 text-xs whitespace-pre-wrap text-muted">{text}</div>}
      </Disclosure>
      {first && <Explain concept="thinking" quiet />}
    </div>
  )
}
