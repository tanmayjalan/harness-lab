// The one place you answer an approval. It takes the composer's spot while the harness waits.
import { Hand, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Approval, ToolRow } from '../../model/derive'
import { pretty, shortPath } from '../../lib/format'
import { isMcpTool } from '../../model/permission'
import { useServer } from '../../store/server'
import { Explain } from '../../learn/Explain'
import { decide } from '../../store/selectors'
import { useUi } from '../../store/ui'
import { Button, Kbd } from '../ui'

// Inside the workspace, the path as the model gave it, under "workspace/": the full one only adds noise
// (and your user name, in a shared screenshot). Outside it, the real place: that is what you are asked about.
// F397: inside the lab folder (the code, your settings), from the lab folder's name on; anywhere else, in full
function inLab(full: string): string {
  const ws = useServer.getState().info?.folder
  const rel = ws ? shortPath(full, ws) : full
  if (!ws || rel === full) return full
  return `${ws.replace(/[\\/]+$/, '').split(/[\\/]/).slice(-2, -1)[0]}/${rel}`
}

function place(a: Approval, full: string): string {
  const p = a.input.path
  if (a.outside !== false || typeof p !== 'string' || !p || /^([a-zA-Z]:|[\\/~])/.test(p)) return inLab(full)
  return `workspace/${p.replace(/^\.[\\/]/, '').replace(/\\/g, '/')}`
}

function what(a: Approval): { line: string; detail?: string; mono?: string; full?: string; note?: string } {
  // Where the file really is, from the server; older saves only had it in the question's wording
  if (a.tool === 'write_file' || !a.tool) return { line: 'The model wants to write a file:', mono: place(a, a.where ?? a.path), full: a.where ?? a.path, detail: a.content }
  if (a.tool === 'read_file' || a.tool === 'list_files') {
    const path = a.where ?? a.prompt.match(/(?:read the file|list the folder) (.*?)\. (?:That|Allow)/)?.[1] ?? String(a.input.path ?? '')
    return { line: a.tool === 'read_file' ? 'The model wants to read a file:' : 'The model wants to list a folder:', mono: place(a, path), full: path }
  }
  if (a.tool === 'run_python') { // the code itself, so you can read what will run as you (it isn't a sandbox)
    if (typeof a.input.code === 'string') return { line: 'The model wants to run Python code it wrote, as you, from the workspace folder:', detail: a.input.code }
    // A script file: what it says now (F388), so you read what will run before you allow it
    const s = a.script
    return { line: 'The model wants to run a Python script, as you, from the workspace folder:', mono: place(a, a.where ?? String(a.input.path ?? '')),
      full: a.where ?? String(a.input.path ?? ''),
      detail: s?.text,
      note: !s ? undefined
        : s.error !== undefined ? `The file ${s.error}, so you can't see what it would run.`
        : `This is the file as it is now${s.cut ? ' (only its start is shown)' : ''}. It could still change before it runs.` }
  }
  if (a.tool === 'remember_fact') {
    return { line: 'The model wants to remember this about you, and share it in every future conversation:',
      detail: `${a.input.label}: ${a.input.value}` }
  }
  return { line: 'The model wants to run a tool:', mono: a.tool, detail: pretty(a.input) }
}

// F390: what "Always allow" really does: a lasting rule, used everywhere nobody can be asked too, and for code
// or another program's tool the workspace is no limit at all
export function alwaysNote(tool: string | undefined) {
  const where = 'sets it to Allow in Settings → Tools, in every conversation and in Compare, Re-run and evals'
  if (tool === 'remember_fact') return `${where}: future facts are saved and shared without asking you`
  if (tool === 'run_python') return `${where}: code the model writes then runs without asking you, and the code can still reach any file, not only the workspace`
  if (isMcpTool(tool)) return `${where}: another program decides what it does, and it then runs without asking you`
  return `${where}; paths outside the workspace will still ask`
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
  const alwaysRef = useRef(always) // set by the checkbox: answer() below is made once and reads it when called
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
  // (Set once the panel is on screen; until then nothing counts.) Before the effect below, which reads it
  const armedAt = useRef(Infinity)
  useEffect(() => { armedAt.current = Date.now() + 800 }, [])
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
        <div>{w.line} {w.mono && <code className="rounded bg-code px-1" title={w.full && w.full !== w.mono ? w.full : undefined}>{w.mono}</code>}</div>
        {w.detail && <pre className="code-block max-h-40">{w.detail}</pre>}
        {w.note && <p className="text-xs text-muted">{w.note}</p>}
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
            <input type="checkbox" checked={always} onChange={(e) => { alwaysRef.current = e.target.checked; setAlways(e.target.checked) }} className="accent-[var(--accent)]" />
            Always allow <code>{approval.tool}</code>
            <span className="text-xs">({alwaysNote(approval.tool)})</span>
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
