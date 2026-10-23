// What a call is made of, as a bar
import { breakdown, type CallView } from '../../model/inspector'
import { cn } from '../../lib/cn'
import { count } from '../../lib/format'
import { SectionLabel } from '../ui'
import { PART_COLOURS } from './colours'

// A thin bar: how much of this call is the same every time, and how much is new
export function MadeOf({ view }: { view: CallView }) {
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
