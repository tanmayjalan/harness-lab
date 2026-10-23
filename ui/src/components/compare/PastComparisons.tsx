// Earlier comparisons, to open again
import { History } from 'lucide-react'
import { timeAgo } from '../../lib/format'
import { useCompare } from '../../store/compare'
import { Button } from '../ui'

export function PastComparisons() {
  const history = useCompare((s) => s.history)
  const openPast = useCompare((s) => s.openPast)
  if (!history.length) return null
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold"><History className="size-4 text-muted" /> Past comparisons</h2>
      <ul className="divide-y divide-line rounded-lg border border-line bg-panel text-sm">
        {history.slice(0, 20).map((h) => (
          <li key={h.id} className="flex items-center gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">“{h.text}”</span>
            <span className="min-w-0 max-w-[45%] truncate text-xs text-muted" title={h.sides.join(' vs ')}>{h.sides.join(' vs ')}</span>
            <span className="shrink-0 text-xs text-muted">{h.repeat > 1 && `${h.repeat} runs · `}{timeAgo(h.time)}</span>
            <Button size="sm" variant="ghost" aria-label={`Open “${h.text}”`} onClick={() => void openPast(h.id)}>Open</Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
