// Settings → Model: provider and model, thinking, caching, when changes apply, limits.
import type { Effort } from '../../api/types'
import { count } from '../../lib/format'
import { missingKeyHelp } from '../composer/providerWords'
import { CONCEPTS } from '../../learn/concepts'
import { switchProvider } from '../../store/selectors'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { Callout, RadioRow, Skeleton } from '../ui'
import { Changed, Heading, save } from './common'
import { NumberField } from './NumberField'
import { WorkflowDiagram } from '../run/WorkflowDiagram'

// ---- Model ----

export function ModelSection() {
  const info = useServer((s) => s.info)
  const settings = useServer((s) => s.settings)
  const running = useSession((s) => s.running)
  const current = useSession((s) => s.provider) ?? info?.provider
  const currentModel = useSession((s) => s.model) || info?.model
  if (!info) return <Skeleton className="h-40" />
  return (
    <div>
      <Heading title="Model">Which model answers, how it thinks and caches, and the limits on each message.</Heading>
      <ProviderAndModel current={current ?? null} currentModel={currentModel ?? null} running={running} />
      <ThinkingAndCaching provider={current ?? 'mock'} />
      <WorkflowSetting />
      <WhenChangesApply />
      <LimitsSection />
      <p className="mt-4 text-xs text-muted">Workspace folder the tools can use: <code>{info.folder}</code> · up to {settings?.limits.max_turns ?? info.max_turns} calls per message.</p>
    </div>
  )
}

// F340: two pick-one rows, the provider and then the chosen provider's models (the shared segmented look, one Tab
// stop each, arrow keys to move). What a provider costs, and why one can't be picked, stay on screen under them.
function ProviderAndModel({ current, currentModel, running }: { current: string | null; currentModel: string | null; running: boolean }) {
  const providers = useServer((s) => s.info?.providers) ?? []
  const chosen = providers.find((p) => p.name === current)
  const models = chosen ? chosen.models ?? [chosen.model] : []
  const missing = providers.filter((p) => p.missing_key && p.name !== current)
  return (
    <fieldset className="space-y-2 rounded-lg border border-line p-4">
      <legend className="px-1 font-medium">Provider and model</legend>
      <RadioRow label="Provider" value={current} options={providers.map((p) => [p.name, p.label])}
        disabled={running || ((name) => !!providers.find((p) => p.name === name)?.missing_key)}
        onChange={(name) => void switchProvider(name)} />
      {chosen && (models.length > 1 ? (
        <RadioRow label="Model" value={currentModel} options={models.map((m) => [m, <code key={m}>{m}</code>])}
          disabled={running} onChange={(m) => void switchProvider(chosen.name, m)} />
      ) : <p className="text-sm text-muted">model <code>{chosen.model}</code></p>)}
      {chosen && (
        <p className="text-xs text-muted">
          {chosen.missing_key ? missingKeyHelp(chosen.missing_key)
            : chosen.price ? `$${chosen.price.input} in · $${chosen.price.cached} cached · $${chosen.price.output} out, per million tokens (${chosen.price.note})`
              : "No cost to you. Tokens and cost are estimates (about 4 characters a token, at the chosen model's price)."}
        </p>
      )}
      {missing.map((p) => (
        <p key={p.name} className="text-xs text-muted"><b className="font-medium text-fg">{p.label}:</b> {missingKeyHelp(p.missing_key!)}</p>
      ))}
      {running && <p className="text-sm text-warn">Wait for the current message to finish to switch.</p>}
    </fieldset>
  )
}

const BUDGETS = [2000, 4000, 8000, 12000]
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// What each provider does with the two switches, in plain words
const THINKING_NOTE: Record<string, string> = {
  anthropic: 'Opus 5.5 always thinks; this sets how hard (the effort) and asks for a summary of its reasoning, which you can read under each call. "Default" sends no thinking setting, so Opus uses its own default effort.',
  mock: "claude -p gets the budget (Off = 0). Haiku then thinks or doesn't; Opus and Sonnet 5.5 may think a little anyway. You see that it thought, but not the text: claude -p doesn't return it.",
  deepseek: "Sent as a budget. If DeepSeek's endpoint doesn't accept it, the call fails with the reason: turn it off then.",
}
const CACHE_NOTE: Record<string, string> = {
  anthropic: 'From the second call on, watch "from cache" in the Inspector. The first call writes the cache (a little dearer).',
  mock: "No effect on the mock: it can't cache. Its token numbers are estimates. Use the Anthropic API to see the switch make a difference (DeepSeek caches on its own, so it shows no difference there).",
  deepseek: 'DeepSeek caches repeated starts by itself, so you see cache hits with this on or off.',
}

function ThinkingAndCaching({ provider }: { provider: string }) {
  const settings = useServer((s) => s.settings)
  const style = useServer((s) => s.info?.providers.find((p) => p.name === provider)?.thinking ?? 'budget')
  if (!settings) return null
  const t = settings.thinking
  const effort = t.effort ?? 'medium'
  const c = settings.cache
  const set = (on: boolean, change: Partial<typeof t>, what: string) =>
    save({ thinking: { enabled: on, budget: t.budget, effort, ...change } }, what)
  return (
    <div className="mt-6 space-y-4">
      <fieldset className="space-y-2 rounded-lg border border-line p-4">
        <legend className="flex items-center gap-1.5 px-1 font-medium">Thinking {t.enabled && <Changed title="Changed from the default (off)" />}</legend>
        <p className="text-sm text-muted">{CONCEPTS.thinking.short}</p>
        {style === 'adaptive' ? (
          <RadioRow label="Thinking effort" value={t.enabled ? effort : 'off'}
            options={(['off', ...EFFORTS] as const).map((e) => [e, e === 'off' ? 'Default' : e])}
            onChange={(e) => (e === 'off' ? set(false, {}, 'Thinking: default') : set(true, { effort: e as Effort }, `Thinking effort: ${e}`))} />
        ) : (
          <RadioRow label="Thinking budget" value={t.enabled ? String(t.budget) : '0'}
            options={[0, ...BUDGETS].map((b) => [String(b), b === 0 ? 'Off' : `${b / 1000}k tokens`])}
            onChange={(v) => { const b = Number(v); return b === 0 ? set(false, {}, 'Thinking is off') : set(true, { budget: b }, `Thinking is on (${count(b)} tokens)`) }} />
        )}
        <p className="text-xs text-muted">
          {style === 'adaptive' ? 'Effort: how hard the model thinks (low is fastest and cheapest). ' : 'Budget: the most tokens it may spend thinking. '}
          {THINKING_NOTE[provider] ?? ''}
        </p>
      </fieldset>
      <fieldset className="space-y-2 rounded-lg border border-line p-4">
        <legend className="flex items-center gap-1.5 px-1 font-medium">Prompt caching {c.enabled && <Changed title="Changed from the default (off)" />}</legend>
        <p className="text-sm text-muted">{CONCEPTS.caching.short}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={c.enabled}
            onChange={(e) => save({ cache: { enabled: e.target.checked } }, `Caching is ${e.target.checked ? 'on' : 'off'}`)} />
          Mark each request so the provider can keep it (adds cache_control marks)
        </label>
        <p className="text-xs text-muted">{CACHE_NOTE[provider] ?? ''}</p>
      </fieldset>
    </div>
  )
}

export function LimitsSection() {
  const settings = useServer((s) => s.settings)
  if (!settings) return null
  const { max_tokens: mt, max_turns: turns } = settings.limits
  const t = settings.thinking
  return (
    <>
    <fieldset className="mt-4 space-y-3 rounded-lg border border-line p-4">
      <legend className="flex items-center gap-1.5 px-1 font-medium">Limits {(mt !== 16000 || turns !== 20) && <Changed />}</legend>
      <NumberField label="Longest reply (max_tokens)" value={mt} min={256} max={16000} defaultValue={16000} step={100} unit="tokens"
        hint='A longer reply is cut off and stops with "max_tokens". Thinking counts towards it.'
        onCommit={(n) => save({ limits: { max_tokens: n, max_turns: turns } }, 'Limits saved')} />
      {t.enabled && t.budget >= mt && (
        <Callout tone="warn" size="sm">
          The thinking budget ({count(t.budget)} tokens) is as large as the longest reply, so thinking can use it all
          and leave nothing for the answer. Some providers refuse such a call. Lower the budget or raise the limit.
        </Callout>
      )}
      <NumberField label="Most model calls for one message (max_turns)" value={turns} min={2} max={20} defaultValue={20}
        className="w-16" hint="The harness's own cap; each model call counts as one. Stops a model that keeps asking for tools."
        onCommit={(n) => save({ limits: { max_tokens: mt, max_turns: n } }, 'Limits saved')} />
    </fieldset>
    <fieldset className="mt-4 space-y-2 rounded-lg border border-line p-4">
      <legend className="px-1 font-medium">Practice</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={!!settings.faults?.busy}
          onChange={(e) => void save({ faults: { busy: e.target.checked } }, `Practice switch is ${e.target.checked ? 'on' : 'off'}`)} />
        <span>
          A busy service {settings.faults?.busy && <Changed />}
          <span className="block text-xs text-muted">
            The first try of every call fails as if the service were overloaded (529), before anything is sent, so you can
            watch the harness wait and try again. Off for real use.
          </span>
        </span>
      </label>
    </fieldset>
    </>
  )
}

// One agent for each message, or a fixed chain of agents run by code (features/workflow.py)
export function WorkflowSetting() {
  const settings = useServer((s) => s.settings)
  if (!settings?.workflow) return null
  const on = settings.workflow.enabled
  return (
    <fieldset className="mt-4 space-y-2 rounded-lg border border-line p-4">
      <legend className="flex items-center gap-1.5 px-1 font-medium">How each message is answered {on && <Changed />}</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={on}
          onChange={(e) => void save({ workflow: { enabled: e.target.checked } }, `The workflow is ${e.target.checked ? 'on' : 'off'}`)} />
        <span>
          Answer with a workflow (a chain of agents)
          <span className="block text-xs text-muted">{CONCEPTS.workflow.setting} Each step uses its own instructions, not your
            system prompt; tools for gathering are the read-only ones. The most calls per message (Limits) counts every step.</span>
        </span>
      </label>
      <WorkflowDiagram className="max-h-60" />
    </fieldset>
  )
}

export function WhenChangesApply() {
  const settings = useServer((s) => s.settings)
  if (!settings) return null
  const options = [
    { id: 'message', title: 'From your next message',
      help: 'Edit the prompt or a tool and the very next message uses it: best for experimenting. But the start of the request changes, so nothing earlier can come from the cache.' },
    { id: 'conversation', title: 'From your next conversation',
      help: 'A conversation keeps the prompt, the tool descriptions and the facts about you it started with (as Claude Code does), so its start never changes and caching keeps working. Allow / Ask first / Block and the rest still apply from your next message; Re-run and Compare use your current settings.' },
  ] as const
  return (
    <fieldset className="mt-4 space-y-2 rounded-lg border border-line p-4">
      <legend className="flex items-center gap-1.5 px-1 font-medium">When prompt and tool changes apply
        {settings.apply === 'conversation' && <Changed title="Changed from the default (from your next message)" />}</legend>
      {/* F346: saved when picked, so arrow keys only move (no save and toast on every arrow) */}
      <RadioRow label="When changes apply" value={settings.apply} options={options.map((o) => [o.id, o.title])}
        onChange={(id) => { const o = options.find((x) => x.id === id)!; void save({ apply: o.id }, `When changes apply: ${o.title.toLowerCase()}`) }} />
      <dl className="space-y-1 text-xs text-muted">
        {options.map((o) => (
          <div key={o.id}><dt className="inline font-medium text-fg">{o.title}: </dt><dd className="inline">{o.help}</dd></div>
        ))}
      </dl>
    </fieldset>
  )
}
