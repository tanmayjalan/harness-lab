import { useEffect } from 'react'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useUi } from '../../store/ui'
import { IconButton } from '../ui'

// Short messages in the corner: saved, switched, or what went wrong.
// A dialog makes everything outside it unreachable (and hidden from screen readers), so while one is
// open the page-level Toaster stays empty and the dialog mounts its own with inDialog.
// Screen readers hear a toast through the Announcer, not through the toast itself.
export function Toaster({ inDialog = false }: { inDialog?: boolean }) {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismiss)
  const dialogOpen = useUi((s) => s.settingsOpen || s.helpOpen || s.experimentsOpen)
  if (inDialog !== dialogOpen) return null
  return (
    <div data-toaster className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => <ToastCard key={t.id} t={t} onDismiss={() => dismiss(t.id)} />)}
    </div>
  )
}

function ToastCard({ t, onDismiss }: { t: ReturnType<typeof useUi.getState>['toasts'][number]; onDismiss: () => void }) {
  // A toast with a button is something to act on: move focus to it, but only if you are not typing anywhere
  useEffect(() => {
    if (!t.action) return
    const id = requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      document.querySelector<HTMLElement>(`[data-toast="${t.id}"] [data-action]`)?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [t.id, t.action])
  return (
    <div data-toast={t.id}
      onMouseEnter={() => useUi.getState().holdToast(t.id)} onMouseLeave={() => useUi.getState().releaseToast(t.id)}
      onFocus={() => useUi.getState().holdToast(t.id)} onBlur={() => useUi.getState().releaseToast(t.id)}
      className={cn('pop-in pointer-events-auto flex gap-2 rounded-lg border bg-panel p-3 text-sm shadow-xl',
        t.kind === 'error' ? 'border-bad/40' : 'border-line')}>
      {t.kind === 'error' ? <TriangleAlert className="size-4 shrink-0 text-bad" />
        : t.kind === 'ok' ? <CheckCircle2 className="size-4 shrink-0 text-ok" /> : <Info className="size-4 shrink-0 text-accent" />}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t.title}</div>
        {t.body && <div className="text-xs break-words whitespace-pre-line text-muted">{t.body}</div>}
        {t.action && (
          <button type="button" data-action onClick={() => { t.action!.run(); onDismiss() }}
            className="mt-1 rounded border border-line px-2 py-0.5 text-xs font-medium hover:border-accent hover:text-accent">
            {t.action.label}
          </button>
        )}
      </div>
      <IconButton size="sm" label="Dismiss" onClick={onDismiss} className="self-start text-muted hover:text-fg">
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}
