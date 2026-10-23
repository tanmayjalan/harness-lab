// Where a call's time went, as a bar
import type { Timing } from '../../model/inspector'
import { cn } from '../../lib/cn'
import { seconds } from '../../lib/format'
import { SectionLabel } from '../ui'
import { TIME_COLOURS } from './colours'

// Where this call's time went
export function TimeBar({ t }: { t: Timing }) {
  const model = Math.max(0, (t.model ?? 0) - (t.overhead ?? 0))
  const parts = [
    { key: 'model', label: 'the model replying', s: model, colour: TIME_COLOURS.model },
    { key: 'overhead', label: 'starting claude -p (the mock only; at least)', s: t.overhead ?? 0, colour: TIME_COLOURS.overhead },
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
