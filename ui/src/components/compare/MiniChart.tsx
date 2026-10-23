// A small bar chart: the tokens each call read
import type { CompareSide } from '../../api/types'
import { tokens } from '../../lib/format'

export function MiniChart({ calls, firstRun }: { calls: NonNullable<CompareSide['calls']>; firstRun: boolean }) {
  const max = Math.max(...calls.map((c) => c.input_tokens + c.cache_read), 1)
  return (
    <figure>
      <div className="flex h-12 items-end gap-1" role="img"
        aria-label={`Tokens read by each call: ${calls.map((c) => `call ${c.turn} ${tokens(c.input_tokens + c.cache_read)}`).join(', ')}`}>
        {calls.map((c, i) => (
          <div key={i} title={`Call ${c.turn}: ${tokens(c.input_tokens + c.cache_read)} tokens in`}
            className="w-4 rounded-sm bg-accent/60" style={{ height: `${Math.max(6, ((c.input_tokens + c.cache_read) / max) * 100)}%` }} />
        ))}
      </div>
      <figcaption className="text-xs text-muted">tokens in, per call{firstRun && ' (first run)'}</figcaption>
    </figure>
  )
}
