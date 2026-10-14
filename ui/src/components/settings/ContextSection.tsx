// Settings → Context: trimming and summarising.
import { useEffect, useState } from 'react'
import type { Settings } from '../../api/types'
import { tokens } from '../../lib/format'
import { CONCEPTS } from '../../learn/concepts'
import { charsToPercent, percentToChars, windowFor } from '../../model/context'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { Callout, Field } from '../ui'
import { Changed, Heading, save } from './common'
import { NumberField } from './NumberField'

// ---- Context ----

export function ContextSection({ settings }: { settings: Settings }) {
  const provider = useSession((s) => s.provider) ?? useServer.getState().info?.provider
  const model = useSession((s) => s.model) || useServer.getState().info?.model
  const window = useServer((s) => windowFor(s.info, provider, model))
  const anthropic = provider === 'anthropic'
  const keep = settings.trim.keep_last
  const over = settings.compact.over_chars
  // The % box keeps what you type until you leave it (or press Enter); blank puts the saved value back
  const [pct, setPct] = useState(() => (window ? String(charsToPercent(over, window)) : ''))
  useEffect(() => { if (window) setPct(String(charsToPercent(over, window))) }, [over, window])
  const commitPct = () => {
    const n = Number(pct)
    if (!window || pct.trim() === '' || !Number.isFinite(n) || n <= 0) return setPct(window ? String(charsToPercent(over, window)) : '')
    const chars = Math.min(1_000_000, Math.max(2000, percentToChars(n, window)))
    setPct(String(charsToPercent(chars, window)))
    if (chars !== over) void save({ compact: { enabled: settings.compact.enabled, over_chars: chars } }, 'Summarising limit saved')
  }

  return (
    <div className="space-y-6">
      <Heading title="Context">Two ways to keep calls from growing without end. Watch the effect in the Inspector's size chart.</Heading>
      {anthropic && (
        <Callout tone="warn">
          Trimming is off with the Anthropic API: it refuses a request whose earlier messages changed, and offers its own
          server-side option instead (context editing). Summarising works: it replaces the older history with a new one.
        </Callout>
      )}
      <fieldset disabled={anthropic} className="space-y-2 rounded-lg border border-line p-4 disabled:opacity-60">
        <legend className="flex items-center gap-1.5 px-1 font-medium">Trimming {settings.trim.enabled && <Changed title="Changed from the default (off)" />}</legend>
        <p className="text-sm text-muted">{CONCEPTS.trimming.setting}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.trim.enabled}
            onChange={(e) => save({ trim: { enabled: e.target.checked, keep_last: keep } }, `Trimming is ${e.target.checked ? 'on' : 'off'}`)} />
          Trim old tool results in the copy sent
        </label>
        <NumberField label="Keep the tool results of the last" value={settings.trim.keep_last} min={0} max={20} defaultValue={2} className="w-16"
          unit="model calls whole"
          onCommit={(n) => save({ trim: { enabled: settings.trim.enabled, keep_last: n } }, 'Trimming limit saved')} />
      </fieldset>
      <fieldset className="space-y-2 rounded-lg border border-line p-4 disabled:opacity-60">
        <legend className="flex items-center gap-1.5 px-1 font-medium">Summarising {settings.compact.enabled && <Changed title="Changed from the default (off)" />}</legend>
        <p className="text-sm text-muted">{CONCEPTS.summarising.setting} It costs one extra call when it happens.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.compact.enabled}
            onChange={(e) => save({ compact: { enabled: e.target.checked, over_chars: over } }, `Summarising is ${e.target.checked ? 'on' : 'off'}`)} />
          Summarise older history when it gets long
        </label>
        <NumberField label="When the history passes" value={settings.compact.over_chars} min={2000} max={1_000_000}
          defaultValue={40000} step={1000} unit="characters"
          onCommit={(n) => save({ compact: { enabled: settings.compact.enabled, over_chars: n } }, 'Summarising limit saved')} />
        {window && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <>
              <span className="text-muted">≈</span>
              <Field size="sm" type="number" min={0.1} max={100} step={0.5} aria-label="Threshold as a percentage of the model's window"
                value={pct} onChange={(e) => setPct(e.target.value)} onBlur={commitPct}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitPct() } }}
                className="w-20" />
              <span className="text-muted">% of <code>{model}</code>'s window ({tokens(window)} tokens, at ~4 characters a token)</span>
            </>
          </label>
        )}
      </fieldset>
    </div>
  )
}
