// F392: a hooks file with a mistake means no hook runs at all (the harness carries on without them, so the
// .env block in config/my_hooks.py is off too). Say so above the message box, not only in Settings.
import { shortPath } from '../../lib/format'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { Callout } from '../ui'

// The file is read again before every message: the newest call's record says how it was for that message;
// before any call, the settings (read when the page loaded or Settings opened) say how it is now
export function useHooksProblem(): { problem: string; file: string | null; recorded: boolean } | null {
  const settingsHooks = useServer((s) => s.settings?.hooks)
  const latest = useSession((s) => {
    const order = s.derived.callOrder
    return order.length ? s.derived.calls[order[order.length - 1]]?.request.hooks : undefined
  })
  if (latest) return latest.problem ? { problem: latest.problem, file: latest.file ?? null, recorded: true } : null
  return settingsHooks?.problem ? { problem: settingsHooks.problem, file: settingsHooks.file, recorded: false } : null
}

export function HooksProblem() {
  const found = useHooksProblem()
  const workspace = useServer((s) => s.info?.folder)
  if (!found) return null
  const file = found.file ? shortPath(found.file, workspace) : 'config/my_hooks.py'
  return (
    <Callout tone="bad" size="sm" className="mx-1">
      {found.recorded ? 'Your hooks file had a mistake for your last message, so no hook ran' : 'Your hooks file has a mistake, so no hook is running'}
      {' '}(not even the block on secret-looking files): {found.problem}. Fix <code title={found.file ?? undefined}>{file}</code>; the
      next message reads it again.{' '}
      <button type="button" className="text-accent hover:underline" onClick={() => useUi.getState().openSettings('tools')}>Settings → Tools</button>
    </Callout>
  )
}
