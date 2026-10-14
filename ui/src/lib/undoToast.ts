// A confirmation with an Undo button: for every action that throws something away without asking first.
import { errorMessage } from '../store/selectors'
import { toast } from '../store/ui'

export function undoToast(title: string, undo: () => void | Promise<void>, body?: string) {
  toast({
    kind: 'ok', title, body,
    action: {
      label: 'Undo',
      run: () => void new Promise<void>((resolve) => resolve(undo())).catch((err) => toast({ kind: 'error', title: "Couldn't undo", body: errorMessage(err) })),
    },
  })
}
