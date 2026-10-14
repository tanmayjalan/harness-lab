// Look inside one model call: what the harness sent, what came back, and how big it was.
import * as Tabs from '@radix-ui/react-tabs'
import { ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Download, PanelRightClose, Radio, Scissors } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RequestEvent } from '../../api/types'
import type { Call, RunModel } from '../../model/derive'
import { callsCsv, conversationReport } from '../../model/report'
import { windowFor } from '../../model/context'
import { breakdown, callTiming, callView, receivedLine, sentChars, tokenSeries, windowUsed, type CallView, type Part, type Timing } from '../../model/inspector'
import { ruleBadge } from '../../model/permission'
import { cn } from '../../lib/cn'
import { useShownInspectorWidth } from '../../lib/layout'
import { approx, count, dollars, plural, pretty, seconds, tokens } from '../../lib/format'
import { Explain, ExplainIcon } from '../../learn/Explain'
import { stopWords } from '../../lib/stopWords'
import type { ConceptKey } from '../../learn/concepts'
import { useInspectedCallId } from '../../store/selectors'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { toast, usePrefs, useUi, type InspectorTab } from '../../store/ui'
import { Badge, Button, Callout, Disclosure, IconButton, Kbd, Section, SectionLabel, Select, Stat } from '../ui'
import { providerName } from '../composer/providerWords'
import { MessageBody } from './ContentBlock'
import { JsonTree } from './JsonTree'
import { MessageList } from './MessageList'
import { RoundTrips } from './RoundTrip'
import { LoopDiagram, type LoopNode } from './LoopDiagram'
import { HooksCard, hookNote } from './HooksCard'
import { TokenChart } from './TokenChart'

export function Inspector({ onClose }: { onClose?: () => void }) {
  const model = useSession((s) => s.derived)
  const callId = useInspectedCallId()
  const follow = useUi((s) => s.followLatest)
  const tab = usePrefs((s) => s.inspectorTab)
  const setTab = usePrefs((s) => s.setInspectorTab)
  const view = useMemo(() => (callId ? callView(model, callId) : null), [model, callId])
  // The width on screen, not the stored one. Below 520 px (the usual 440 included) the follow control is
  // an icon and the loop diagram is compact; the count needs 600 px, so between 520 and 600 the picker
  // keeps room for its longest name
  const shownWidth = useShownInspectorWidth()
  const narrowPanel = shownWidth < 520
  const showCount = shownWidth >= 600
  const newestId = model.callOrder[model.callOrder.length - 1]
  const newest = newestId ? model.calls[newestId] : null
  // One scrolling box for every call: another call starts at its top, not where the last one was left
  const scroller = useRef<HTMLDivElement>(null)
  const shownId = view?.call.id
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [shownId])

  return (
    <aside aria-label="Inspector" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        {/* with a call shown the picker needs the room: the title is for screen readers only (the panel is labelled),
            and a narrow panel also drops the count and shows the follow control as an icon */}
        <h2 className={cn('text-sm font-semibold', view && 'sr-only')}>Inspector</h2>
        {view && <CallPicker model={model} current={view.call} />}
        {view && showCount && (
          <span className="shrink-0 text-xs text-muted tabular-nums">
            {model.callOrder.indexOf(view.call.id) + 1} of {plural(model.callOrder.length, 'call')}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {newest && (follow ? (
            <span className="flex shrink-0 items-center gap-1 px-2 text-xs text-muted"
              title="New calls show here as they arrive. Pick any call to stop following.">
              <Radio className="size-3.5" /> <span className={cn(narrowPanel && 'sr-only')}>Following new calls</span>
            </span>
          ) : narrowPanel ? (
            <IconButton label={`${followLabel(view?.call ?? null, newest)}: show the newest call, and keep following new ones`} size="sm"
              onClick={() => useUi.getState().follow()}><Radio className="size-4" /></IconButton>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => useUi.getState().follow()} title="Show the newest call, and keep following new ones">
              <Radio className="size-3.5" /> {followLabel(view?.call ?? null, newest)}
            </Button>
          ))}
          {onClose && <IconButton label="Hide the inspector" size="sm" onClick={onClose}><PanelRightClose className="size-4" /></IconButton>}
        </div>
      </div>
      {!view ? (
        <div className="space-y-4 overflow-y-auto p-4">
          <p className="text-sm text-muted">
            Each model call shows up here once you send a message. Pick one in the chat (the <b>Call 1</b>, <b>Call 2</b>{" "}
            dividers) to see exactly what the harness sent and what came back. <Kbd>[</Kbd> and <Kbd>]</Kbd> step
            through calls; "Follow latest" goes back to the newest.
          </p>
        </div>
      ) : (
        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as InspectorTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-line px-3 pt-2">
            <LoopDiagram active={loopNode(view.call)} path={loopPath(view.call)} className="mx-auto max-w-[560px]" compact={narrowPanel}
              hooks={hookNote(model, view.call)}
              early={!!view.call.stopReason && !['tool_use', 'end_turn'].includes(view.call.stopReason)} />
            {/* At Large text the tabs may not fit: the list scrolls sideways instead of widening the panel.
                The -mb-px sits on the list, not the tabs, so the scrolling box has no 1 px to scroll up and down;
                a scrolling box clips what is drawn outside it, so the focus ring is drawn inside each tab */}
            <Tabs.List aria-label="What to show" className="-mb-px mt-1 flex gap-1 overflow-x-auto">
              {([['summary', 'Summary'], ['sent', 'Sent'], ['received', 'Received'], ['tools', 'Tools'], ['raw', 'Raw']] as const).map(([v, l]) => (
                <Tabs.Trigger key={v} value={v}
                  // the browser does not scroll a partly visible tab into view when it takes focus
                  onFocus={(e) => e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
                  className="shrink-0 border-b-2 border-transparent focus-ring focus-visible:outline-offset-[-2px] px-2.5 py-1.5 text-sm text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
                  {l}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-4">
            <Tabs.Content value="summary"><SummaryTab view={view} model={model} /></Tabs.Content>
            <Tabs.Content value="sent"><SentTab view={view} /></Tabs.Content>
            <Tabs.Content value="received"><ReceivedTab call={view.call} /></Tabs.Content>
            <Tabs.Content value="tools"><ToolsTab call={view.call} model={model} /></Tabs.Content>
            <Tabs.Content value="raw"><RawTab call={view.call} /></Tabs.Content>
            <CallEnd model={model} current={view.call} />
          </div>
        </Tabs.Root>
      )}
    </aside>
  )
}

// A call named the way the picker names it
function callName(c: Call) {
  return `message ${c.runIndex} · call ${c.turn}`
}

// The follow button: on the newest call already, there's nothing to jump to, only new calls to follow
function followLabel(shown: Call | null, newest: Call) {
  return shown?.id === newest.id ? 'Follow new calls' : `Follow latest (${callName(newest)})`
}

// Another call, named from where you are: its message only when it's a different one
function callRef(c: Call, from: Call) {
  return c.runIndex === from.runIndex ? `call ${c.turn}` : `message ${c.runIndex} · call ${c.turn}`
}

// Where in the loop this call ended up
function loopNode(call: Call): LoopNode {
  if (!call.response) return 'call'
  if (call.stopReason === 'tool_use') return 'tools'
  return call.stopReason === 'end_turn' ? 'answer' : 'reply'
}

function loopPath(call: Call): LoopNode[] {
  const first = (call.stepTurn ?? call.turn) === 1 // (a workflow step's first call starts afresh too)
  if (!call.response) return first ? ['you', 'call'] : ['tools', 'call']
  const start: LoopNode[] = first ? ['you', 'call', 'reply'] : ['tools', 'call', 'reply']
  return call.stopReason === 'tool_use' ? [...start, 'tools'] : call.stopReason === 'end_turn' ? [...start, 'answer'] : start
}

function CallPicker({ model, current }: { model: RunModel; current: Call }) {
  const i = model.callOrder.indexOf(current.id)
  const go = (d: number) => {
    const id = model.callOrder[i + d]
    if (id) useUi.getState().selectCall(id)
  }
  // The buttons say where they go: the next call can be in another message
  const target = (d: number) => {
    const id = model.callOrder[i + d]
    return id ? `: ${callName(model.calls[id])}` : ''
  }
  const newestId = model.callOrder[model.callOrder.length - 1]
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <IconButton label={`Previous call${target(-1)}`} shortcut="[" size="sm" disabled={i <= 0} onClick={() => go(-1)}>
        <ChevronLeft className="size-4" />
      </IconButton>
      <Select size="sm" aria-label="Call to inspect" value={current.id}
        onChange={(e) => useUi.getState().selectCall(e.target.value)}
        className="min-w-0 px-1.5">
        {model.runs.map((run) => (
          <optgroup key={run.index} label={`Message ${run.index}: ${run.text.slice(0, 40)}`}>
            {run.callIds.map((id) => (
              <option key={id} value={id}>{`Message ${run.index} · call ${model.calls[id].turn}${model.calls[id].stepLabel ? ` (${model.calls[id].stepLabel})` : ''}${id === newestId ? ' (newest)' : ''}`}</option>
            ))}
          </optgroup>
        ))}
      </Select>
      <IconButton label={`Next call${target(1)}`} shortcut="]" size="sm" disabled={i >= model.callOrder.length - 1} onClick={() => go(1)}>
        <ChevronRight className="size-4" />
      </IconButton>
    </div>
  )
}

// What a call did, in the words of the Summary badge
function outcome(c: Call) {
  if (c.failed) return 'failed: no reply'
  if (!c.stopReason) return 'waiting for the reply…'
  return stopWords(c.stopReason, (c.response?.content ?? []).filter((b) => b.type === 'tool_use').length)
}

// The foot of every tab: this call is over, and here is the next one (a long tab otherwise just stops)
function CallEnd({ model, current }: { model: RunModel; current: Call }) {
  const i = model.callOrder.indexOf(current.id)
  const prevId = model.callOrder[i - 1]
  const nextId = model.callOrder[i + 1]
  const next = nextId ? model.calls[nextId] : null
  const nextRun = next && next.runIndex !== current.runIndex ? model.runs.find((r) => r.index === next.runIndex) : null
  const select = (id: string) => useUi.getState().selectCall(id)
  return (
    <nav aria-label="Other calls" className="mt-6 space-y-2 border-t border-line pt-4">
      <p className="text-xs text-muted">End of message {current.runIndex} · call {current.turn}</p>
      {next ? (
        <button type="button" onClick={() => select(next.id)}
          className="focus-ring flex w-full items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-left hover:border-accent hover:bg-sunken">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Next: {callRef(next, current)}</span>
            <span className="block truncate text-xs text-muted">
              {nextRun ? `A new message: “${nextRun.text.slice(0, 60)}${nextRun.text.length > 60 ? '…' : ''}”` : outcome(next)}
            </span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-accent" />
        </button>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted">
          This is the newest call. A new one shows up here when the model is called again.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {prevId && (
          <button type="button" onClick={() => select(prevId)} className="focus-ring rounded text-accent hover:underline">
            ← Previous: {callRef(model.calls[prevId], current)}
          </button>
        )}
        <span className="ml-auto"><Kbd>[</Kbd> and <Kbd>]</Kbd> step through calls</span>
      </div>
    </nav>
  )
}

const STOP: Record<string, { label: string; tone: 'accent' | 'ok' | 'bad'; concept: ConceptKey }> = {
  tool_use: { label: 'asked for tools', tone: 'accent', concept: 'tool_use' },
  end_turn: { label: 'finished', tone: 'ok', concept: 'end_turn' },
}

function SummaryTab({ view, model }: { view: CallView; model: RunModel }) {
  const { call, previous } = view
  const selectCall = useUi((s) => s.selectCall)
  const points = useMemo(() => tokenSeries(model), [model])
  const stop = call.stopReason
    ? { ...(STOP[call.stopReason] ?? { tone: 'bad' as const, concept: 'other_stop' as ConceptKey }), label: stopWords(call.stopReason, 0).replace('asked for 0 tools', 'asked for tools') }
    : null
  const setTab = usePrefs((s) => s.setInspectorTab)
  const added = view.messages.filter((m) => m.isNew).length
  const trimmed = call.trimmed && 'count' in call.trimmed ? call.trimmed : null
  const asked = (call.response?.content ?? []).filter((b) => b.type === 'tool_use') as { name: string }[]
  const chars = sentChars(call)
  const prevChars = previous ? sentChars(previous) : 0
  const cfg = call.request.config
  // How much cheaper a cached token is, from this provider's prices (e.g. 95%)
  const rates = useServer((s) => {
    const p = s.info?.providers.find((x) => x.name === cfg?.provider)
    return p?.model_prices?.[call.request.model] ?? p?.price ?? null
  })
  const providers = useServer((s) => s.info?.providers)
  const discount = rates && rates.input ? Math.round((1 - rates.cached / rates.input) * 100) : null

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">The call in numbers: time, cost, size, and what it is made of.</p>
      <ConversationCard model={model} />
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">Message {call.runIndex} · call {call.turn}{call.stepLabel && ` · ${call.stepLabel} step`}</h3>
          {stop ? (
            <Badge tone={stop.tone}><code>{call.stopReason}</code> · {stop.label}</Badge>
          ) : call.failed ? <Badge tone="bad">failed: no reply</Badge>
            : <Badge tone="accent">waiting for the reply…</Badge>}
          {stop && <ExplainIcon concept={stop.concept} />}
        </div>
        <p className="text-sm text-muted">
          {call.turn === 1 ? 'The first call for this message.' : `Call ${call.turn} of at most ${call.maxTurns} for this message.`}
          {' '}Sent to <code className="font-semibold text-fg">{call.request.model}</code> via {providerName(providers, call.request.provider)}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Model time">{call.seconds != null ? seconds(call.seconds) : call.failed ? '–' : '…'}</Stat>
        <Stat label="Cost (this call)">{call.cost != null ? approx(dollars(call.cost), call.estimated) : '–'}</Stat>
        {call.tokens.read || call.tokens.wrote ? (
          <>
            <Stat label="Tokens in"
              hint={[call.tokens.cached && `${tokens(call.tokens.cached)} from cache`, call.tokens.written && `${tokens(call.tokens.written)} written to cache`]
                .filter(Boolean).join(' · ') || undefined}>{approx(tokens(call.tokens.read), call.estimated)}</Stat>
            <Stat label="Tokens out">{approx(tokens(call.tokens.wrote), call.estimated)}</Stat>
          </>
        ) : (
          <div className="col-span-2 flex items-center rounded-md bg-sunken px-2.5 text-xs text-muted">
            {call.response ? "This provider doesn't report tokens, so sizes below are in characters."
              : call.failed ? 'No reply, so no tokens came back.' : 'Waiting for the reply…'}
          </div>
        )}
      </div>
      {call.estimated && <p className="text-xs text-muted">The mock counts about 4 characters per token, so these numbers are estimates.</p>}
      <WindowMeter call={call} previous={previous} />
      {call.response && <TimeBar t={callTiming(model, call)} />}
      {call.retries?.map((r) => (
        <p key={r.attempt} className="text-xs text-warn">
          {r.status ? `The service said ${r.status} (${r.reason}${r.simulated ? '; simulated by the practice switch' : ''})`
            : `The call failed (${r.reason})`}: the harness waited {seconds(r.wait)} and sent the same request again. <ExplainIcon concept="retry" />
        </p>
      ))}

      <Section title="What went in" aside={<span className="flex items-center gap-2"><ExplainIcon concept="history" />
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setTab('sent')}>Open the Sent tab →</button></span>}>
        <MadeOf view={view} />
        <ul className="space-y-1 text-sm">
          <li>
            <b>{plural(view.messages.length, 'entry', 'entries')}</b> in the messages list
            {previous ? <> · <span className="text-ok">{added} new</span> since {callRef(previous, call)}</> : null}
            {view.afterSummary && <> · <span className="text-warn">older history replaced by a summary</span></>}
          </li>
          <li>
            {count(chars)} characters{!call.tokens.read && ` (≈ ${tokens(Math.round(chars / 4))} tokens)`}
            {previous && chars > prevChars && <span className="text-muted"> (+{count(chars - prevChars)} on {callRef(previous, call)}: the history grew)</span>}
          </li>
          <li>
            System prompt{cfg?.system_edited ? <Badge tone="warn" className="ml-1">edited</Badge> : ' (default)'}
            {call.request.facts > 0 && <> + {plural(call.request.facts, 'fact')} about you</>}
          </li>
          <li>{plural(call.request.tools?.length ?? 0, 'tool description')}{call.request.edited.length > 0 && <span className="text-muted"> · your edits: {call.request.edited.join(', ')}</span>}</li>
          {trimmed?.count ? (
            <li className="text-warn"><Scissors aria-hidden className="mr-1 inline size-3.5 align-[-0.125em]" />Trimmed {plural(trimmed.count, 'old tool result')} ({count(trimmed.chars)} characters) in this copy <ExplainIcon concept="trimming" /></li>
          ) : null}
          {call.trimmed && 'skipped' in call.trimmed && <li className="text-muted">{/^Trimming/.test(call.trimmed.skipped) ? call.trimmed.skipped : `Trimming is on but was skipped: ${call.trimmed.skipped}`}</li>}
          {call.request.start_changed && !call.request.cache && (
            <li className="text-muted">The system prompt or tools changed since {previous ? callRef(previous, call) : 'the last call'}.</li>
          )}
          {call.request.start_changed && call.request.cache && (
            <li className="text-warn">
              The start of this request (system prompt or tools) differs from {previous ? callRef(previous, call) : 'the last call'}, so nothing could come from
              the cache. Settings → Model → "From your next conversation" keeps it fixed. <ExplainIcon concept="caching" />
            </li>
          )}
          <li>
            Thinking: <b>{thinkingLabel(call.request)}</b> <ExplainIcon concept="thinking" />
            {' '}· Caching: {call.request.cache ? <b>on</b> : 'off'} <ExplainIcon concept="caching" />
          </li>
          {call.request.cache && call.response && (
            <li className={call.tokens.cached ? 'text-ok' : 'text-muted'}>
              {call.estimated ? "The mock can't cache, so nothing is read from a cache here (see Help → what the mock can't show)."
                : call.tokens.cached
                  ? <>{tokens(call.tokens.cached)} of {tokens(call.tokens.read)} input tokens came from the cache{discount ? ` (${discount}% cheaper than normal input)` : ''}</>
                  : call.tokens.written ? `Nothing read from the cache yet: this call wrote ${tokens(call.tokens.written)} tokens to it, for the next call to read.`
                    : call.tokens.read ? 'Nothing came from the cache this time (below the minimum size, or the start of the request changed).'
                      : "This provider doesn't report cache use."}
            </li>
          )}
        </ul>
      </Section>

      <Section title="What came back" aside={
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setTab('received')}>Open the Received tab →</button>}>
        {!call.response ? (
          call.failed
            ? <Callout tone="bad" size="sm">Nothing came back: {call.failed}</Callout>
            : <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {asked.length > 0
              ? <li>{plural(asked.length, 'tool request')}: {asked.map((a, i) => (
                <button key={i} type="button" aria-label={`${a.name}: see its round trip`} title="See this tool's round trip"
                  onClick={() => setTab('tools')} className="mr-1 rounded bg-code px-1 font-mono text-accent hover:underline">{a.name}</button>
              ))}</li>
              : <li className={call.stopReason === 'end_turn' ? undefined : 'text-warn'}>{receivedLine(call.stopReason, 0)}</li>}
            {call.interim && <li className="text-muted">Plus a little text: “{call.interim.slice(0, 80)}{call.interim.length > 80 ? '…' : ''}”</li>}
          </ul>
        )}
      </Section>

      <Section title="Size of each call" aside={<ExplainIcon concept="tokens" />}>
        <TokenChart points={points} selected={call.id} onSelect={(id) => selectCall(id)} useTokens={model.tokensReported} estimated={model.tokensEstimated} />
      </Section>
    </div>
  )
}

// What a call asked for: a budget, or adaptive thinking with an effort (older saved runs stored a number)
function sentThinking(r: RequestEvent) {
  const t = r.thinking as unknown
  if (typeof t === 'number') return { type: 'enabled' as const, budget_tokens: t }
  return (t as RequestEvent['thinking']) ?? null
}

function thinkingLabel(r: RequestEvent) {
  const t = sentThinking(r)
  if (!t) return 'default (not asked for)'
  if (t.type === 'adaptive') return `adaptive, effort ${r.output_config?.effort ?? 'medium'}`
  return `on, up to ${count(t.budget_tokens)} tokens`
}

function SentTab({ view }: { view: CallView }) {
  const { call } = view
  const [onlyNew, setOnlyNew] = useState(false)
  const shown = onlyNew ? view.messages.filter((m) => m.isNew) : view.messages
  // Tools not offered on the previous call (find_tool loaded them): green, as new messages are
  const before = new Set((view.previous?.request.tools ?? []).map((t) => t.name))
  const newTools = view.previous?.request.tools ? (call.request.tools ?? []).map((t) => t.name).filter((n) => !before.has(n)) : []
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">Exactly what the harness sent: the system prompt, the tools offered and the messages list; green is new since the previous call.</p>
      <Section title="System prompt" aside={<span className="flex gap-2">
        {call.request.facts > 0 && <ExplainIcon concept="facts" />}<ExplainIcon concept="system_prompt" />
      </span>}>
        <Disclosure className="rounded-md border border-line" summaryClassName="px-2.5 py-1.5 text-sm" summary={<>
          {count(call.request.system.length)} characters
          {call.request.facts > 0 && <span className="text-ok"> · includes {plural(call.request.facts, 'fact')} about you</span>}
        </>}>
          <pre className="code-block rounded-t-none">
            <SystemText text={call.request.system} withFacts={call.request.facts > 0} />
          </pre>
        </Disclosure>
      </Section>

      <Section title={`Tools offered (${call.request.tools?.length ?? 0})`}>
        <Disclosure className="rounded-md border border-line" summaryClassName="px-2.5 py-1.5 text-sm"
          summary={<>
            {(call.request.tools ?? []).map((t) => t.name).join(', ') || 'none'}
            {newTools.length > 0 && <span className="text-ok"> · new since {callRef(view.previous!, call)}: {newTools.join(', ')}</span>}
          </>}>
          <ul className="divide-y divide-line">
            {(call.request.tools ?? []).map((t) => {
              const rule = ruleBadge({ permission: t.permission, outside: false, status: 'ran' })
              return (
                <li key={t.name} className={cn('space-y-0.5 px-2.5 py-1.5 text-sm', newTools.includes(t.name) && 'added')}>
                  <div className="flex items-center gap-2">
                    <code className="font-semibold">{t.name}</code>
                    {rule && <Badge tone={rule.tone}>{rule.label}</Badge>}
                    {t.source !== 'built in' && <Badge>{t.source}</Badge>}
                  </div>
                  <p className="text-xs text-muted">{t.description}</p>
                </li>
              )
            })}
          </ul>
        </Disclosure>
      </Section>

      <Section title={`Messages list (${plural(view.messages.length, 'entry', 'entries')})`}
        aside={
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> only new
          </label>
        }>
        {view.previous ? (
          <p className="text-xs text-muted">
            The whole history goes every call. <span className="added rounded px-1">Green</span> = new since {callRef(view.previous, call)}
            (open); older entries start folded. Click any entry to open or fold it.
          </p>
        ) : (
          <p className="text-xs text-muted">First call: everything here is new. From the next call on, new entries show in green.</p>
        )}
        <MessageList key={`${call.id}-${onlyNew}`} messages={shown} wash={!!view.previous} />
      </Section>
    </div>
  )
}

// The facts about you go at the end of the prompt under this heading (harness/features/memory.py),
// so the part to highlight is read from what this call actually sent
const FACTS_HEADING = '\n\nAbout the user ('

function SystemText({ text, withFacts }: { text: string; withFacts: boolean }) {
  const at = withFacts ? text.lastIndexOf(FACTS_HEADING) : -1
  if (at < 0) return <>{text}</>
  return <>{text.slice(0, at + 2)}<mark className="added-text" title="Added from Settings → Memory">{text.slice(at + 2)}</mark></>
}

function ReceivedTab({ call }: { call: Call }) {
  if (!call.response) return <p className="text-sm text-muted">The model hasn't replied yet.</p>
  const u = call.response.usage
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">What the model sent back, block by block.</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">stop_reason</span><code className="rounded bg-code px-1">{call.stopReason}</code>
        {u && <span className="text-muted">· usage: {count(u.input_tokens ?? 0)} in, {count(u.cache_read_input_tokens ?? 0)} cached, {count(u.output_tokens ?? 0)} out{(u.cache_creation_input_tokens ?? 0) > 0 && ` · ${count(u.cache_creation_input_tokens ?? 0)} written to cache`}</span>}
      </div>
      <MessageBody message={{ role: 'assistant', content: call.response.content }} />
      <p className="text-xs text-muted">The harness adds this reply to the history, tool requests and all, before running any tools.</p>
    </div>
  )
}

function RawTab({ call }: { call: Call }) {
  const [command, setCommand] = useState({ n: 0, open: false })
  const [copied, setCopied] = useState('')
  const copy = async (what: string, value: unknown) => {
    try {
      await navigator.clipboard.writeText(pretty(value))
      setCopied(what)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      toast({ kind: 'error', title: "Couldn't copy", body: 'Your browser refused clipboard access.' })
    }
  }
  const schemas = useServer((s) => s.settings?.tools)
  const r = call.request
  // Exactly the body the harness sends to the model's API (harness/core/loop.py: client.messages.create)
  // (with caching on, the system prompt goes as a block and the last tool carries a cache mark;
  // the messages in the event already carry theirs)
  const mark = { type: 'ephemeral' }
  const sentTools = r.tools ?? []
  const apiRequest = {
    model: r.model,
    max_tokens: r.max_tokens ?? 16000,
    ...(sentThinking(r) ? { thinking: sentThinking(r) } : {}),
    ...(r.output_config ? { output_config: r.output_config } : {}),
    system: r.cache ? [{ type: 'text', text: r.system, cache_control: mark }] : r.system,
    tools: sentTools.map((t, i) => ({
      name: t.name, description: t.description,
      input_schema: schemas?.find((s) => s.name === t.name)?.input_schema ?? '(not loaded)',
      ...(r.cache && i === sentTools.length - 1 ? { cache_control: mark } : {}),
    })),
    messages: r.messages,
  }
  const apiResponse = call.response
    ? { stop_reason: call.response.stop_reason, content: call.response.content, usage: call.response.usage }
    : null
  const parts: [string, string, ReactNode, unknown, number][] = [
    ['api-request', 'Sent to the model', <>The API request body, rebuilt from the harness's record (tool input shapes come from your current settings): the <b>whole conversation</b> goes every call, with the system prompt and every tool description.</>, apiRequest, 1],
    ['api-response', 'Came back from the model', 'The API reply: why it stopped, what it wrote or asked for, and how many tokens it used.', apiResponse, 1],
    ['events', "The harness's own record (not sent)", <>The events the harness logged for this call. Fields like <code>seq</code>, <code>time</code>, <code>msg</code>, <code>config</code> and <code>provider</code> are its bookkeeping, for this page: the model never sees them.</>, { request: call.request, response: call.response ?? null }, 0],
  ]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <span className="mr-auto">This call as JSON. Click any line to open or fold it.</span>
        <Button size="sm" variant="ghost" onClick={() => setCommand({ n: command.n + 1, open: true })}><ChevronsUpDown className="size-3.5" /> Open all</Button>
        <Button size="sm" variant="ghost" onClick={() => setCommand({ n: command.n + 1, open: false })}><ChevronsDownUp className="size-3.5" /> Fold all</Button>
      </div>
      {parts.map(([key, label, help, value, depth]) => (
        <section key={key} className="space-y-1 rounded-md border border-line p-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">{label} {value !== null && <span className="font-normal text-muted">· {count(pretty(value).length)} characters</span>}</span>
            {value !== null && (
              <Button size="sm" variant="ghost" onClick={() => copy(key, value)}>
                <Copy className="size-3.5" /> <span role="status">{copied === key ? 'Copied' : 'Copy'}</span>
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">{help}</p>
          {value === null ? <p className="text-xs text-muted">Nothing yet.</p>
            : <JsonTree key={`${call.id}-${key}`} value={value} command={command} openDepth={depth} label={label} />}
        </section>
      ))}
    </div>
  )
}

// Full colours, each at least 3:1 against the panel; a 1 px gap of panel between parts tells them apart
export const PART_COLOURS: Record<Part['key'], string> = {
  system: 'bg-muted', tools: 'bg-warn', earlier: 'bg-line-strong', results: 'bg-accent', new: 'bg-ok',
}
export const TIME_COLOURS = { model: 'bg-accent', overhead: 'bg-line-strong', retrying: 'bg-bad', tools: 'bg-ok', waited: 'bg-warn' }

// A thin bar: how much of this call is the same every time, and how much is new
function MadeOf({ view }: { view: CallView }) {
  const parts = breakdown(view)
  const total = parts.reduce((n, p) => n + p.chars, 0) || 1
  return (
    <figure className="space-y-1">
      <SectionLabel>What this call is made of (by characters)</SectionLabel>
      <div className="flex h-3 w-full gap-px overflow-hidden rounded forced-color-adjust-none" role="img"
        aria-label={`What this call is made of: ${parts.map((p) => `${p.label} ${count(p.chars)} characters`).join(', ')}`}>
        {parts.filter((p) => p.chars).map((p) => (
          <div key={p.key} className={PART_COLOURS[p.key]} style={{ width: `${(p.chars / total) * 100}%` }}
            title={`${p.label}: ${count(p.chars)} characters (${Math.round((p.chars / total) * 100)}%)`} />
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        {parts.filter((p) => p.chars).map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className={cn('inline-block size-2 rounded-sm forced-color-adjust-none', PART_COLOURS[p.key])} aria-hidden />
            {p.label} {Math.round((p.chars / total) * 100)}%
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

// Where this call's time went
function TimeBar({ t }: { t: Timing }) {
  const model = Math.max(0, (t.model ?? 0) - (t.overhead ?? 0))
  const parts = [
    { key: 'model', label: 'the model replying', s: model, colour: TIME_COLOURS.model },
    { key: 'overhead', label: 'starting claude -p (the mock only)', s: t.overhead ?? 0, colour: TIME_COLOURS.overhead },
    { key: 'retrying', label: 'waiting to try again', s: t.retrying, colour: TIME_COLOURS.retrying },
    { key: 'tools', label: 'running its tools', s: t.tools, colour: TIME_COLOURS.tools },
    { key: 'waited', label: 'waiting for you', s: t.waited, colour: TIME_COLOURS.waited },
  ].filter((p) => p.s > 0.05)
  const total = parts.reduce((n, p) => n + p.s, 0) || 1
  return (
    <figure className="space-y-1">
      <SectionLabel as="figcaption">Where the time went, from this call to the next</SectionLabel>
      <div className="flex h-3 w-full gap-px overflow-hidden rounded forced-color-adjust-none" role="img"
        aria-label={parts.map((p) => `${p.label} ${seconds(p.s)}`).join(', ')}>
        {parts.map((p) => <div key={p.key} className={p.colour} style={{ width: `${(p.s / total) * 100}%` }} title={`${p.label}: ${seconds(p.s)}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className={cn('inline-block size-2 rounded-sm forced-color-adjust-none', p.colour)} aria-hidden />{p.label} {seconds(p.s)}
          </span>
        ))}
      </div>
      {t.firstWord != null && <p className="text-xs text-muted">The first word arrived after {seconds(t.firstWord)} (streaming): that's what you wait for before anything shows.</p>}
    </figure>
  )
}

const OUTCOME_WORDS: Record<string, string> = {
  ran: 'ran', error: 'failed', declined: 'declined', blocked: 'blocked', unattended: 'not run (nobody to ask)',
  hook_blocked: 'hook-blocked', not_run: 'not run',
  running: 'running', awaiting: 'waiting',
}

// The whole conversation in numbers, and a CSV of every call
function ConversationCard({ model }: { model: RunModel }) {
  const r = conversationReport(model)
  const download = () => {
    const url = URL.createObjectURL(new Blob([callsCsv(model)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'harness-conversation-calls.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-1">
    <Disclosure className="rounded-lg border border-line bg-sunken/60 px-3 py-2 text-sm" summaryClassName="font-medium" summary={<>
      This conversation <span className="font-normal text-muted">· {plural(r.messages, 'message')}, {plural(r.calls, 'model call')}
        {r.tokensIn > 0 && `, ${approx(tokens(r.tokensIn), r.estimated)} tokens in`}{r.cost != null && `, ${dollars(r.cost)}`}</span>
    </>}>
      <ul className="mt-2 space-y-0.5 text-xs">
        <li>{plural(r.calls, 'model call')}{r.helperCalls > 0 && ` + ${plural(r.helperCalls, 'helper call')}`}</li>
        <li>Tools: {Object.entries(r.toolRuns).map(([k, n]) => `${n} ${OUTCOME_WORDS[k] ?? k}`).join(', ') || 'none'}</li>
        <li>Time: {seconds(r.modelSeconds)} model, {seconds(r.toolSeconds)} tools{r.waitedSeconds > 0 && `, ${seconds(r.waitedSeconds)} waiting for you`}</li>
        {r.tokensIn > 0 && <li>Tokens: {approx(tokens(r.tokensIn), r.estimated)} in, {tokens(r.tokensOut)} out{r.cost != null && ` · ${dollars(r.cost)}`}</li>}
        {r.nextCallAtLeast > 0 && (
          <li className="text-muted">Your next message's first call will send at least {tokens(r.nextCallAtLeast)} tokens: everything so far goes again.</li>
        )}
      </ul>
    </Disclosure>
    <Button size="sm" variant="ghost" className="-ml-2" onClick={download} disabled={!r.calls}
      title="One row per model call: tokens, cache, cost, tools and outcomes">
      <Download className="size-3.5" /> Export every call as CSV
    </Button>
    </div>
  )
}

// How full the model's context window was on this call
function WindowMeter({ call, previous }: { call: Call; previous: Call | null }) {
  const window = useServer((s) => windowFor(s.info, call.request.config?.provider, call.request.model))
  if (!window) return null
  const counted = call.tokens.read > 0
  const { used, atLeast } = windowUsed(call, previous)
  const share = used / window
  const pct = share * 100
  return (
    <figure className="space-y-1">
      <figcaption className="flex items-baseline justify-between text-xs">
        <SectionLabel as="span">Context window</SectionLabel>
        <span className={cn('tabular-nums', share > 0.8 ? 'text-bad' : share > 0.5 ? 'text-warn' : 'text-muted')}>
          {atLeast && 'at least '}{approx(tokens(used), !counted || call.estimated)} of {tokens(window)} tokens ({pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%)
        </span>
      </figcaption>
      <div className="h-2 w-full overflow-hidden rounded border border-line-strong bg-sunken forced-color-adjust-none" role="meter" aria-valuemin={0} aria-valuemax={window} aria-valuenow={used}
        aria-label="How much of the model's context window this call used">
        <div className={cn('h-full', share > 0.8 ? 'bg-bad' : share > 0.5 ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.min(100, Math.max(0.5, pct))}%` }} />
      </div>
      <Explain concept="context_window" quiet />
    </figure>
  )
}

// One tool's whole journey: asked for, run here, sent back (the plain-words walkthrough)
function ToolsTab({ call, model }: { call: Call; model: RunModel }) {
  const any = call.toolIds.length > 0 || (call.request.messages ?? []).some((m) =>
    Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'))
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">How each tool this call touched went: the model asks, the harness decides and runs it here, and the result goes back in the next call.</p>
      <HooksCard model={model} call={call} />
      <RoundTrips model={model} callId={call.id} />
      {!any && <p className="text-sm text-muted">This call asked for no tools and carried no tool results.</p>}
    </div>
  )
}
