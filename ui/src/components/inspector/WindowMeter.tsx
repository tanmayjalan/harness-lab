// How full the model's context window was
import type { Call } from '../../model/derive'
import { sourceNote, windowFor } from '../../model/context'
import { windowUsed } from '../../model/inspector'
import { cn } from '../../lib/cn'
import { approx, tokens } from '../../lib/format'
import { Explain } from '../../learn/Explain'
import { useServer } from '../../store/server'
import { SectionLabel } from '../ui'

// How full the model's context window was on this call
export function WindowMeter({ call, previous }: { call: Call; previous: Call | null }) {
  const window = useServer((s) => windowFor(s.info, call.request.config?.provider, call.request.model))
  const source = useServer((s) => sourceNote(s.info, call.request.config?.provider, 'windows'))
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
      {source && <p className="text-xs text-muted">Window size from {source}.</p>}
      <Explain concept="context_window" quiet />
    </figure>
  )
}
