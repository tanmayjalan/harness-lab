// "Rewind to here": before going back, the server says what it would do (the messages that go, the files put
// back or deleted, changes made since the last reply by anything else that it would overwrite, what can't be
// undone), and you confirm. No Undo after.
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import type { RewindPreview } from '../../api/types'
import { Explain } from '../../learn/Explain'
import { plural } from '../../lib/format'
import type { Run } from '../../model/derive'
import { errorMessage, rewindTo } from '../../store/selectors'
import { Button, Callout, IconButton, Spinner } from '../ui'

export function RewindDialog({ run, onClose }: { run: Run | null; onClose: () => void }) {
  const [preview, setPreview] = useState<RewindPreview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rewound = useRef<'filled' | 'asked' | null>(null) // after a rewind: was the message put in the box?
  const seq = run?.userSeq

  // Another message (or closing) clears the last answer, so opening it again never shows it, even for a moment
  const [shownSeq, setShownSeq] = useState(seq)
  if (seq !== shownSeq) {
    setShownSeq(seq)
    setPreview(null)
    setProblem(null)
  }

  useEffect(() => {
    if (seq === undefined) return
    let current = true
    rewound.current = null
    api.rewindPreview(seq).then((p) => { if (current) setPreview(p) },
      (err) => { if (current) setProblem(errorMessage(err)) })
    return () => { current = false }
  }, [seq])

  const go = async () => {
    if (seq === undefined || busy) return
    setBusy(true)
    const done = await rewindTo(seq)
    setBusy(false)
    if (done) {
      rewound.current = done
      onClose()
    }
  }

  return (
    <Dialog.Root open={!!run} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60" />
        <Dialog.Content aria-describedby={undefined}
          // after a rewind, the message is back in the box: stay there rather than on a button that's gone.
          // If the box had your own text in it, the toast asks first: go to its Replace button
          onCloseAutoFocus={(e) => {
            if (!rewound.current) return
            e.preventDefault()
            const ask = rewound.current === 'asked' && document.querySelector<HTMLButtonElement>('[data-toaster] button[data-action]')
            ;(ask || document.getElementById('message-box'))?.focus()
          }}
          className="pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[min(36rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-panel shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <Dialog.Title className="text-lg font-semibold">Rewind to before this message?</Dialog.Title>
            <Dialog.Close asChild><IconButton size="sm" label="Close" className="text-muted hover:text-fg"><X className="size-4" /></IconButton></Dialog.Close>
          </div>
          <div className="space-y-3 overflow-y-auto p-4 text-sm">
            <p className="rounded-md bg-sunken px-3 py-1.5 break-words whitespace-pre-wrap">{run?.text}</p>
            {problem ? (
              <Callout tone="bad" live>{problem}</Callout>
            ) : !preview ? (
              <p className="flex items-center gap-2 text-muted"><Spinner quiet /> Checking what would change…</p>
            ) : (
              <Plan preview={preview} />
            )}
            <Explain concept="checkpoints" quiet />
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">
            <Dialog.Close asChild><Button>Cancel</Button></Dialog.Close>
            <Button variant="danger" disabled={!preview || busy} onClick={() => void go()}>
              {busy && <Spinner quiet />} Rewind
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Plan({ preview: p }: { preview: RewindPreview }) {
  const later = p.messages - 1
  return (
    <>
      <p>
        {later ? `This message and the ${plural(later, 'message')} after it are removed, with their replies.`
          : 'This message and its reply are removed.'}
        {' '}Its text goes back in the message box (if you have typed something there, you are asked first). There
        is no Undo.
      </p>
      {p.files === null ? (
        <Callout tone="warn">
          The files weren't saved before this message (the workspace was over 5,000 files or 50 MB), so they stay as
          they are now. Only the conversation goes back.
        </Callout>
      ) : !p.files.restore.length && !p.files.delete.length ? (
        <p className="text-muted">No files change: they are as they were before this message.</p>
      ) : (
        <>
          <Files label="Put back as they were" names={p.files.restore} />
          <Files label="Deleted (added since)" names={p.files.delete} />
        </>
      )}
      {p.edited.length > 0 && (
        <Callout tone="warn">
          <Files label="Changed since the last reply, not by this conversation: rewinding overwrites these" names={p.edited} />
        </Callout>
      )}
      <Files label="Couldn't be read when they were saved, so they stay as they are" names={p.unreadable} />
      {p.cannot_undo.length > 0 && (
        <Section label="Can't be undone: it happened outside the workspace">
          {p.cannot_undo.map((x) => <li key={`${x.tool}:${x.why}`}><code>{x.tool}</code>: {x.why}</li>)}
        </Section>
      )}
    </>
  )
}

function Files({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null
  return <Section label={label}>{names.map((n) => <li key={n}><code>{n}</code></li>)}</Section>
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{label}:</h3>
      <ul aria-label={label} className="mt-1 list-disc space-y-0.5 pl-5">{children}</ul>
    </div>
  )
}
