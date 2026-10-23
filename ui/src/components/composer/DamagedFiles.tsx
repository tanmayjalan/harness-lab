// A saved file the server couldn't read (lab_settings.json with a mistake, say) was moved aside and the
// defaults are used instead. Say so above the message box, not only in Settings, or your choices just seem gone.
import { useServer } from '../../store/server'
import { Callout } from '../ui'

export function DamagedFiles({ className = 'mx-1' }: { className?: string }) {
  const damaged = useServer((s) => s.settings?.damaged)
  if (!damaged?.length) return null
  return (
    <>
      {damaged.map((d) => (
        <Callout key={d} tone="warn" size="sm" className={className}>A saved file couldn't be read: {d}</Callout>
      ))}
    </>
  )
}
