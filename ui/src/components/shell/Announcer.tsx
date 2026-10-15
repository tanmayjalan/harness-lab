import { useEffect, useState } from 'react'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'

// One always-present live region: screen readers announce changes inside it reliably,
// where a toast that appears already holding its text is often skipped.
export function Announcer() {
  const toasts = useUi((s) => s.toasts)
  const waiting = useSession((s) => s.derived.pendingApproval)
  const dialog = useUi((s) => s.anyDialogOpen())
  const last = toasts[toasts.length - 1]
  const [text, setText] = useState('')
  // The same words twice must still change the region, or a screen reader stays silent the second time
  const say = (t: string) => setText((prev) => `${t}${prev.endsWith('​') ? '' : '​'}`)
  useEffect(() => { if (last) say(`${last.title}${last.body ? `. ${last.body}` : ''}`) }, [last?.id])
  // a sentence the page asked to have read out (say() in the ui store): the call [ and ] moved to, a guess
  const spoken = useUi((s) => s.spoken)
  useEffect(() => { if (spoken.n) say(spoken.text) }, [spoken.n])
  // The approval panel announces itself (role="alert") when it is on screen. On another screen the
  // "waiting for you" toast says it (and this region mirrors that toast), and on the narrow Inspect pane
  // the page switches back to the chat. So this only has to cover an open dialog.
  useEffect(() => {
    if (waiting && dialog) say('The harness is waiting for you: a tool needs your Allow or Decline. Close this dialog to answer.')
  }, [waiting?.id])
  return <div className="sr-only" role="status" aria-live="polite" data-announcer>{text}</div>
}
