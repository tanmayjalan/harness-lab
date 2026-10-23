// How a side's figure differs from side A's
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Spread } from '../../api/types'
import { cn } from '../../lib/cn'

// A difference from side A. Coloured better/worse only when both sides did the same thing;
// otherwise "less" isn't "better" (a side whose tools were blocked is faster, not better)
// F349a, F441: and only when it is worth believing: three runs or more, a change of at least 10 %, and the two
// sides' ranges (fastest to slowest run) not overlapping. Anything less is shown plain, with no arrow
export function Delta({ value, base, unit, comparable, runs, format, range, baseRange, estimated }:
  { value: number; base: number | null; unit?: string; comparable: boolean; runs: number; format: (n: number) => string
    range?: Spread; baseRange?: Spread; estimated?: boolean }) {
  if (base == null || value === base) return null
  const d = value - base
  const big = runs >= 3 && Math.abs(d) / Math.max(Math.abs(base), 1e-9) >= 0.1
  const apart = !range || !baseRange || range.max < baseRange.min || range.min > baseRange.max
  const judged = comparable && big && apart
  const why = !comparable ? ' (the sides used different tools, so this is not better or worse)'
    : runs < 3 ? '. Too few runs to call better or worse: with fewer than 3, a difference may be chance.'
      : !big ? '. Too small a change to call better or worse.'
        : !apart ? "'s middle, but the two sides' runs overlap, so it isn't called better or worse." : ''
  return (
    <span className={cn('text-xs whitespace-nowrap', !judged ? 'text-muted' : d < 0 ? 'text-ok' : 'text-bad')}
      title={`${d < 0 ? 'less' : 'more'} than side A${why}`}>
      {judged && (d < 0 ? <ArrowDown aria-hidden className="inline size-3 align-[-0.125em]" /> : <ArrowUp aria-hidden className="inline size-3 align-[-0.125em]" />)}
      {estimated && '≈ '}{d > 0 ? '+' : '−'}{format(Math.abs(d))}{unit}
      {judged && <span className="sr-only">{d < 0 ? '(better)' : '(worse)'}</span>}
    </span>
  )
}
