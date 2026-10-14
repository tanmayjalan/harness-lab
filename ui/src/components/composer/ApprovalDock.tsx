// The one place you answer an approval. It takes the composer's spot while the harness waits.
import { Hand, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Approval, ToolRow } from '../../model/derive'
import { pretty } from '../../lib/format'
import { Explain } from '../../learn/Explain'
import { decide } from '../../store/selectors'
import { useUi } from '../../store/ui'
import { Button, Kbd } from '../ui'

function what(a: Approval): { line: string; detail?: string; mono?: string } {
  // Where the file really is, from the server; older saves only had it in the question's wording
  if (a.tool === 'write_file' || !a.tool) return { line: 'The model wants to write a file:', mono: a.where ?? a.path, detail: a.content }
  if (a.tool === 'read_file' || a.tool === 'list_files') {
    const path = a.where ?? a.prompt.match(/(?:read the file|list the folder) (.*?)\. (?:That|Allow)/)?.[1] ?? String(a.input.path ?? '')
    return { line: a.tool === 'read_file' ? 'The model wants to read a file:' : 'The model wants to list a folder:', mono: path }
  }
  if (a.tool === 'run_python') { // the code itself, so you can read what will run as you (it isn't a sandbox)
    if (typeof a.input.code === 'string') return { line: 'The model wants to run Python code it wrote, as you, from the workspace folder:', detail: a.input.code }
    return { line: 'The model wants to run a Python script, as you, from the workspace folder:', mono: a.where ?? String(a.input.path ?? '') }
  }
  if (a.tool === 'remember_fact') {
    return { line: 'The model wants to remember this about you, and share it in every future conversation:',
      detail: `${a.input.label}: ${a.input.value}` }
  }
  return { line: 'The model wants to run a tool:', mono: a.tool, detail: pretty(a.input) }
}

export function ApprovalDock({ approval, row }: { approval: Approval; row?: ToolRow }) {
  const [always, setAlways] = useState(false)
  const dock = useRef<HTMLDivElement>(null)
  // Take focus from the (now hidden) message box so A and D work straight away
  useEffect(() => {
    if (!dock.current?.contains(document.activeElement)) dock.current?.focus()
  }, [])
  const w = what(approval)
  // Only Allow turns into Ask first outside the workspace (a tool set to Block never gets here)
  const why = approval.outside
    ? approval.setting === 'ask'
      ? <><code>{approval.tool}</code> is set to "Ask first", and the path is outside the workspace folder.</>
      : "The path is outside the workspace folder, so the harness asks first, even though it's set to Allow."
    : <><code>{approval.tool}</code> is set to "Ask first" in Settings → Tools.</>
  const old = approval.replaces
  const [sending, setSending] = useState<null | boolean>(null)
  // A ref, not state: two presses in the same moment (a key held down) must not both send
  const inFlight = useRef(false)
  const alwaysRef = useRef(always)
  alwaysRef.current = always
  const answer = useCallback(async (allowed: boolean) => {
    if (inFlight.current) return
    inFlight.current = true
    setSending(allowed)
    const ok = await decide(approval.id, allowed, allowed && alwaysRef.current ? approval.tool : undefined)
    // Sent: this panel is about to close, and must never answer again (a held key, a double press)
    if (!ok) {
      inFlight.current = false
      setSending(null) // it failed: the buttons work again
    }
  }, [approval.id, approval.tool])
  // The A and D keys answer through this panel, so they only work while it's on screen
  // and they honour "Always allow" exactly like the buttons do
  const allow = useRef<HTMLButtonElement>(null)
  // A and D only count after a moment: a key you were typing into the message box as the panel
  // appeared must not answer it. (Clicking Allow or Decline is never held back.)
  const armedAt = useRef(Date.now() + 800)
  useEffect(() => {
    useUi.getState().setApprovalDock({ answer, focus: () => allow.current?.focus(), armed: () => Date.now() >= armedAt.current })
    return () => useUi.getState().setApprovalDock(null)
  }, [answer])

  return (
    <div ref={dock} tabIndex={-1} role="group" aria-labelledby={`dock-${approval.id}`}
      className="space-y-3 rounded-xl border-2 border-warn/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent bg-panel p-4 shadow-lg" data-approval-dock>
      <div className="flex items-center gap-2 text-sm font-semibold text-warn">
        <Hand className="size-4" aria-hidden />
        <span id={`dock-${approval.id}`} role="alert">The harness is waiting for you</span>
      </div>
      <div className="space-y-1.5 text-sm">
        <div>{w.line} {w.mono && <code className="rounded bg-code px-1">{w.mono}</code>}</div>
        {w.detail && <pre className="code-block max-h-40">{w.detail}</pre>}
        {old && (
          <div className="text-xs text-warn">
            Replaces “{old.value}”{old.shared ? '' : ", which isn't shared now: allowing shares the new value"} (same label: {old.label}).
          </div>
        )}
        <div className="flex items-start gap-1.5 text-xs text-muted">
          {approval.outside && <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />}
          <span>Why it asks: {why}</span>
        </div>
      </div>
      <p className="text-xs text-muted">The harness waits as long as you need: nothing runs, and nothing is saved, until you choose. <span>Press A to allow or D to decline.</span></p>
      <Explain concept="approval" quiet />
      <div className="flex flex-wrap items-center gap-2">
        {/* first in the page order, so Tab reaches it before Allow; shown on the right */}
        {!approval.outside && row?.permission === 'ask' && (
          <label className="order-last ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="accent-[var(--accent)]" />
            Always allow <code>{approval.tool}</code>
            <span className="text-xs">
              (sets it to Allow in Settings → Tools{approval.tool === 'remember_fact'
                ? ': future facts are saved and shared without asking you)'
                : approval.tool === 'run_python'
                  ? ': code the model writes then runs without asking you; scripts outside the workspace will still ask)'
                  : '; paths outside the workspace will still ask)'}
            </span>
          </label>
        )}
        {approval.outside && (
          <span className="order-last ml-auto text-xs text-muted">"Always allow" isn't offered here: paths outside the workspace always ask.</span>
        )}
        <Button ref={allow} variant="primary" disabled={sending !== null} onClick={() => answer(true)}>
          {sending === true ? 'Allowing…' : <>Allow <span aria-hidden><Kbd onAccent>A</Kbd></span></>}
        </Button>
        <Button disabled={sending !== null} onClick={() => answer(false)}>
          {sending === false ? 'Declining…' : <>Decline <span aria-hidden><Kbd>D</Kbd></span></>}
        </Button>
      </div>
    </div>
  )
}
