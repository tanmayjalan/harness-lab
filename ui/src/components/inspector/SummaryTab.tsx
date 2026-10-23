// The Inspector's Summary tab: the call in numbers
import { Scissors } from 'lucide-react'
import { useMemo } from 'react'
import type { RequestEvent } from '../../api/types'
import type { RunModel } from '../../model/derive'
import { sourceNote } from '../../model/context'
import { callTiming, receivedLine, sentChars, tokenSeries, type CallView } from '../../model/inspector'
import { approx, cost, count, plural, seconds, tokens, tokensOut } from '../../lib/format'
import { ExplainIcon } from '../../learn/Explain'
import { stopWords } from '../../lib/stopWords'
import type { ConceptKey } from '../../learn/concepts'
import { useServer } from '../../store/server'
import { usePrefs, useUi } from '../../store/ui'
import { Badge, Callout, Section, Stat } from '../ui'
import { providerName } from '../composer/providerWords'
import { callRef } from './callNames'
import { ConversationCard } from './ConversationCard'
import { MadeOf } from './MadeOf'
import { TimeBar } from './TimeBar'
import { TokenChart } from './TokenChart'
import { WindowMeter } from './WindowMeter'

const STOP: Record<string, { label: string; tone: 'accent' | 'ok' | 'bad'; concept: ConceptKey }> = {
  tool_use: { label: 'asked for tools', tone: 'accent', concept: 'tool_use' },
  end_turn: { label: 'finished', tone: 'ok', concept: 'end_turn' },
}

export function SummaryTab({ view, model }: { view: CallView; model: RunModel }) {
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
  const priceSource = useServer((s) => sourceNote(s.info, cfg?.provider, 'prices'))
  const timing = call.response ? callTiming(model, call) : null
  const claudeOut = call.response?.usage?.mock_claude_output_tokens
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
        <Stat label="Reply time" hint={timing?.overhead ? `the model, and at least ${seconds(timing.overhead)} starting claude -p` : undefined}>
          {timing?.model != null ? seconds(timing.model) : call.failed ? '–' : '…'}</Stat>
        <Stat label="Cost (this call)">{call.cost != null ? cost(call.cost, call.estimated) : '–'}</Stat>
        {call.tokens.read || call.tokens.wrote ? (
          <>
            <Stat label="Tokens in"
              hint={[call.tokens.cached && `${tokens(call.tokens.cached)} from cache`, call.tokens.written && `${tokens(call.tokens.written)} written to cache`]
                .filter(Boolean).join(' · ') || undefined}>{approx(tokens(call.tokens.read), call.estimated)}</Stat>
            <Stat label="Tokens out" hint={claudeOut ? `claude -p counted ${count(claudeOut)}, thinking included` : undefined}>
              {tokensOut(call.tokens.wrote, call.estimated)}</Stat>
          </>
        ) : (
          <div className="col-span-2 flex items-center rounded-md bg-sunken px-2.5 text-xs text-muted">
            {call.response ? "This provider doesn't report tokens, so sizes below are in characters."
              : call.failed ? 'No reply, so no tokens came back.' : 'Waiting for the reply…'}
          </div>
        )}
      </div>
      {call.estimated && <p className="text-xs text-muted">The mock counts about 4 characters per token, so these numbers are estimates. It can't see the model's thinking, so tokens out and cost are at least what's shown.</p>}
      {call.cost != null && rates && (
        <p className="text-xs text-muted">
          Cost worked out at ${rates.input.toFixed(2)} in / ${rates.output.toFixed(2)} out per million tokens{priceSource && ` (${priceSource})`}.
          {call.estimated && ' Not charged: the mock runs on your Claude Code plan.'}
        </p>
      )}
      <WindowMeter call={call} previous={previous} />
      {timing && <TimeBar t={timing} />}
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
            Thinking: <b>{thinkingLabel(call.request, call.thought !== undefined)}</b> <ExplainIcon concept="thinking" />
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

function thinkingLabel(r: RequestEvent, thought: boolean) {
  const t = sentThinking(r)
  // Some models (Opus 5.5) think whatever is asked, so say what came back, not only what was asked for
  if (!t) return thought ? 'not asked for, but the model thought anyway' : 'not asked for'
  if (t.type === 'disabled') return thought ? 'turned off, but the model thought anyway' : 'turned off (thinking: disabled)'
  if (t.type === 'adaptive') return `adaptive, effort ${r.output_config?.effort ?? 'medium'}`
  return `on, up to ${count(t.budget_tokens)} tokens`
}
