import { Ban, Check, ChevronRight, Clock, Hand, Wrench, X } from 'lucide-react'
import { useState } from 'react'
import { hookOf, type ToolRow as Row } from '../../model/derive'
import { ruleBadge, statusLabel } from '../../model/permission'
import { cn } from '../../lib/cn'
import { count, pretty, shortArgs } from '../../lib/format'
import { Badge, Spinner, Tip } from '../ui'
import type { HookName, HooksLoaded, Rule } from '../../api/types'
import { AccessChecks } from './AccessChecks'
import { HelperCard } from './HelperCard'
import { PlanSteps } from './PlanCard'
import { ExplainIcon } from '../../learn/Explain'
import { Clipped } from '../inspector/ContentBlock'
import { useUi } from '../../store/ui'
import { laterThan } from '../../learn/experiments'

function StatusIcon({ status }: { status: Row['status'] }) {
  const cls = 'size-3.5 shrink-0'
  switch (status) {
    case 'running': return <Spinner quiet className="text-accent" /> // the row's words say "running" (F323)
    case 'awaiting': return <Hand className={cn(cls, 'text-warn')} role="img" aria-label="waiting for you" />
    case 'ran': return <Check className={cn(cls, 'text-ok')} role="img" aria-label="done" />
    case 'not_run': return <Clock className={cn(cls, 'text-muted')} role="img" aria-label="not run" />
    case 'blocked':
    case 'hook_blocked': return <Ban className={cn(cls, 'text-bad')} role="img" aria-label="blocked" />
    case 'unattended': return <Hand className={cn(cls, 'text-warn')} role="img" aria-label="not run: nobody to ask" />
    default: return <X className={cn(cls, 'text-bad')} role="img" aria-label={status} />
  }
}

// One tool the model asked for and the harness ran (or didn't). Click to see input and result.
// `loaded`: your hooks file as it was for this call (undefined in older saved conversations)
export function ToolRow({ row, selected, onSelect, setting, loaded }:
  { row: Row; selected: boolean; onSelect: () => void; setting?: Rule; loaded?: HooksLoaded | null }) {
  const [open, setOpen] = useState(false)
  const status = statusLabel(row.status, row.result?.content)
  const rewrote = hookOf(row, 'after_tool')?.verdict === 'replaced' ? hookOf(row, 'after_tool') : undefined
  const crashed = row.hooks?.find((h) => h.verdict === 'failed')
  const rule = ruleBadge(row)
  // F413: before hooks are taught (an experiment from an earlier tier), the badge says what happened in plain words
  const early = useUi((s) => laterThan('hook', s.experimentId))
  const result = row.status === 'ran' && row.result
    ? row.result.chars > 60 ? `${count(row.result.chars)} characters` : row.result.content.replace(/\s+/g, ' ')
    : null
  // A row you allowed says so, like one you declined does; a failed one shows the start of its error
  const error = row.status === 'error' && row.result ? row.result.content.replace(/\s+/g, ' ').slice(0, 60) : null
  const summary = loadedBy(row) ?? error ?? (result ? (row.approval?.decision ? `you allowed · ${result}` : result) : status.label)
  const decidedIn = row.approval?.askedAt && row.approval.decidedAt ? Math.round(row.approval.decidedAt - row.approval.askedAt) : null

  return (
    <div className={cn('rounded-md border bg-panel transition-colors',
      selected ? 'border-accent ring-1 ring-accent/30' : 'border-line')}>
      <button type="button" aria-expanded={open} aria-describedby={`row-help-${row.id}`} aria-current={selected ? 'true' : undefined}
        onClick={() => { useUi.getState().setKeepScroll(true); setOpen(!open); onSelect() }}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm focus-ring hover:bg-sunken/60">
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted transition-transform', open && 'rotate-90')} aria-hidden />
        <StatusIcon status={row.status} />
        <Wrench className="size-3.5 shrink-0 text-muted" aria-hidden />
        <code className="shrink-0 max-w-[40%] truncate font-semibold" title={row.name}>{row.name}</code>
        <code className="min-w-0 truncate text-muted" title={shortArgs(row.input, 400)}>{shortArgs(row.input)}</code>
        <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          {rule && (row.permission !== 'allow' || row.outside || row.status === 'hook_blocked') && (
            <Tip text={rule.help}><span><Badge tone={rule.tone}>{rule.label}</Badge></span></Tip>
          )}
          {/* only when a hook did something: a pass would be noise on every row */}
          {rewrote && (
            <Tip text={early ? "The harness changed the tool's result before the model saw it. Open the row to compare; the experiment \"Stopped by a hook\" shows how."
              : "Your after_tool hook replaced the tool's result before the model saw it. Open the row to compare."}><span>
              <Badge tone="warn">{early ? 'result changed by the harness' : 'rewritten by your hook'}</Badge></span></Tip>
          )}
          {crashed && (
            <Tip text={`Your ${crashed.hook} hook crashed: ${crashed.error}`}><span><Badge tone="bad">your hook crashed</Badge></span></Tip>
          )}
          <span title={error ?? summary} className={cn('max-w-48 truncate text-xs',
            status.tone === 'bad' ? 'text-bad' : status.tone === 'warn' ? 'text-warn' : 'text-muted')}>
            {summary}
          </span>
        </span>
      </button>
      <span id={`row-help-${row.id}`} className="sr-only">
        {rule?.help} {rewrote && 'Your after_tool hook replaced the result.'} {crashed && `Your ${crashed.hook} hook crashed.`}
      </span>
      {row.helper && <div className="border-t border-line px-3 py-2"><HelperCard helper={row.helper} report={row.result?.content} /></div>}
      {row.plan && open && <div className="border-t border-line px-3 py-2"><PlanSteps steps={row.plan} /></div>}
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2 text-sm">
          <div className="text-xs text-muted">
            <ExplainIcon concept="tool" className="mr-1 align-middle" />
            The model asked for <code>{row.name}</code>; {whatHappened(row.status, crashed?.hook)}
            {row.source !== 'built in' && <> (from <b>{row.source}</b>)</>}.
            {' '}Its id, <code className="break-all">{row.id}</code>, ties the request to its result.
          </div>
          <Labeled label="Input the model chose"><pre className="code-block">{pretty(row.input)}</pre></Labeled>
          <Labeled label="How the harness decided whether it may run"><AccessChecks row={row} setting={setting} loaded={loaded} /></Labeled>
          {decidedIn != null && <div className="text-xs text-muted">You decided in {decidedIn}s.</div>}
          {rewrote?.original != null && (
            <Labeled label="What the tool returned (before your after_tool)"><Clipped text={rewrote.original} /></Labeled>
          )}
          {row.result && (
            <Labeled label={row.result.isError ? 'Error sent back to the model (is_error: true)'
              : rewrote ? 'What the model got (after your after_tool)' : 'Result sent back to the model'}>
              <Clipped text={row.result.content} className={cn(row.result.isError && 'text-bad')} />
            </Labeled>
          )}
        </div>
      )}
    </div>
  )
}

// find_tool's row says which tools it loaded, read from its "- name: description" lines (features/tool_search.py)
function loadedBy(row: Row): string | null {
  if (row.name !== 'find_tool' || row.status !== 'ran' || !row.result) return null
  const names = [...row.result.content.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1])
  return names.length ? `loaded: ${names.join(', ')}` : 'found nothing'
}

// The opening sentence of an opened row, so it never says "ran" for a tool that didn't
// `crashed`: which of your hooks crashed, if one did
function whatHappened(status: Row['status'], crashed?: HookName): string {
  switch (status) {
    case 'ran': return 'the harness ran it here, on this computer'
    case 'error': return crashed === 'before_tool' ? 'your before_tool hook crashed, so the harness did not run it'
      : crashed === 'after_tool' ? 'the harness ran it here, on this computer, then your after_tool hook crashed'
        : 'the harness ran it here, on this computer, and it failed'
    case 'running': return 'the harness is running it here, on this computer'
    case 'awaiting': return 'the harness is waiting for you to allow or decline it'
    case 'declined': return 'you declined it, so the harness did not run it'
    case 'blocked':
    case 'hook_blocked': return 'the harness refused it (see the checks below)'
    case 'unattended': return 'it needed your OK, and nobody could be asked here, so the harness did not run it'
    case 'not_run': return 'it never ran'
  }
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted">{label}</div>
      {children}
    </div>
  )
}
