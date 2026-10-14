// The experiments, from anywhere: picking one starts a new conversation with its message ready.
import * as Dialog from '@radix-ui/react-dialog'
import { Toaster } from './Toaster'
import { Announcer } from './Announcer'
import { X } from 'lucide-react'
import type { Experiment } from '../../learn/experiments'
import { newConversation } from '../../store/selectors'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { IconButton } from '../ui'
import { askThenPick, ExperimentGrid } from '../run/EmptyState'

export function ExperimentsDialog() {
  const open = useUi((s) => s.experimentsOpen)
  const running = useSession((s) => s.running)
  const pick = async (x: Experiment) => {
    useUi.getState().setExperimentsOpen(false)
    // a fresh conversation, unless this one is known to be empty (not just not loaded yet), but only
    // once you've agreed to replace anything you typed
    const s = useSession.getState()
    await askThenPick(x, s.loaded && !s.derived.runs.length ? undefined : () => newConversation())
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => useUi.getState().setExperimentsOpen(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60" />
        <Dialog.Content aria-describedby={undefined} onCloseAutoFocus={(e) => useUi.getState().restoreFocus(e)}
          onInteractOutside={(e) => { if ((e.target as Element).closest('[data-toaster]')) e.preventDefault() }}
          className="pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[min(56rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-panel shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <Dialog.Title className="text-lg font-semibold">Experiments</Dialog.Title>
            <Dialog.Close asChild><IconButton size="sm" label="Close" className="text-muted hover:text-fg"><X className="size-4" /></IconButton></Dialog.Close>
          </div>
          <div className="overflow-y-auto p-4">
            <p className="mb-4 text-sm text-muted">
              Each one starts a new conversation with its message ready to send, and tells you where to look.
              {running && ' Wait for the current message to finish first.'}
            </p>
            <ExperimentGrid disabled={running} onPick={pick} />
          </div>
          <Toaster inDialog />
          <Announcer />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
