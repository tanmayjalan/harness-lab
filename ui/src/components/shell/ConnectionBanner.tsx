import { WifiOff } from 'lucide-react'
import { useSession } from '../../store/session'

export function ConnectionBanner() {
  const connection = useSession((s) => s.connection)
  if (connection !== 'lost') return null
  return (
    <div role="alert" className="flex items-start gap-2 bg-bad-soft px-3 py-1.5 text-sm text-bad">
      <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="flex min-w-0 flex-wrap gap-x-1">
        <span>Lost contact with the server. Is it still running? Start it with <code className="rounded bg-code px-1">start.bat</code>. Retrying…</span>
        <span>A reply in progress may have finished or failed: it shows here when contact returns.</span>
      </p>
    </div>
  )
}
