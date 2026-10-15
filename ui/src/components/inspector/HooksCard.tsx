// Your hooks for one model call: which file and functions were loaded for its message, and what
// each hook call decided for the tools this call asked for (the "hook" events from loop.py).
import type { HookVerdict } from '../../api/types'
import type { Call, RunModel } from '../../model/derive'
import { ExplainIcon } from '../../learn/Explain'
import { took } from '../run/AccessChecks'

export const VERDICT_WORDS: Record<HookVerdict, string> = {
  allowed: 'let it through',
  blocked: 'blocked it',
  kept: 'left the result as it was',
  replaced: 'rewrote the result',
  failed: 'crashed',
}

// "1 blocked, 1 rewrote": only what a hook actually did, for the loop diagram
export function hookNote(model: RunModel, call: Call): string {
  const n = { blocked: 0, replaced: 0, failed: 0 }
  for (const id of call.toolIds) {
    for (const h of model.tools[id]?.hooks ?? []) if (h.verdict in n) n[h.verdict as keyof typeof n]++
  }
  return [n.blocked && `${n.blocked} blocked`, n.replaced && `${n.replaced} rewrote`, n.failed && `${n.failed} crashed`]
    .filter(Boolean).join(', ')
}

// The path from config/ on, the way the README names it
function shortPath(file?: string | null) {
  return file ? file.replace(/^.*[\\/](config[\\/])/, '$1').replace(/\\/g, '/') : 'config/my_hooks.py'
}

// F447: the sandbox (harness/web/sandbox.py, prepare()) copies config/ into a "harness-sandbox-..." temporary
// folder and runs that copy, so the file named is not the one in your Harness folder
function HooksFile({ file }: { file?: string | null }) {
  const path = <code>{shortPath(file)}</code>
  return file && /[\\/]harness-sandbox-[^\\/]*[\\/]/.test(file) ? <>a sandbox copy of {path}</> : path
}

export function HooksCard({ model, call }: { model: RunModel; call: Call }) {
  const loaded = call.request.hooks
  const rows = call.toolIds.map((id) => model.tools[id]).filter(Boolean)
  const records = rows.flatMap((r) => (r.hooks ?? []).map((h) => ({ row: r, h })))
  return (
    <section aria-label="Your hooks in this call" className="space-y-1.5 rounded-md border border-line p-2 text-xs">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        Your hooks in this call <ExplainIcon concept="hook" />
      </div>
      <p className="text-muted">
        {loaded === undefined ? 'Not recorded: this conversation was saved before hook calls were recorded.'
          : !loaded ? 'No hooks were given to this run.'
            : loaded.problem ? <>Your hooks file, <HooksFile file={loaded.file} />, had a mistake, so no hook ran: <span className="text-bad">{loaded.problem}</span></>
              : !loaded.functions.length ? <>Your hooks file, <HooksFile file={loaded.file} />, has no <code>before_tool</code> or <code>after_tool</code>, so no hook ran.</>
                : <>
                  Loaded from <HooksFile file={loaded.file} /> for this message:{' '}
                  {loaded.functions.map((f, i) => <span key={f}>{i > 0 && ', '}<code>{f}</code></span>)}.
                  {' '}They run here, around every tool call: <code>before_tool</code> first (it can block the call),
                  {' '}<code>after_tool</code> once the tool has run (it can rewrite the result).
                </>}
      </p>
      {records.length > 0 ? (
        <ul className="space-y-0.5">
          {records.map(({ row, h }, i) => (
            <li key={`${row.id}-${h.hook}-${i}`}>
              <code className="font-semibold">{row.name}</code> · <code>{h.hook}</code> ·{' '}
              <span className={h.verdict === 'blocked' || h.verdict === 'failed' ? 'text-bad' : h.verdict === 'replaced' ? 'text-warn' : 'text-ok'}>
                {VERDICT_WORDS[h.verdict]}
              </span>
              {h.reason && <>: “{h.reason}”</>}
              {h.error && <>: {h.error}</>}
              <span className="text-muted"> · {took(h.ms)}</span>
            </li>
          ))}
        </ul>
      ) : loaded?.functions.length && !loaded.problem ? (
        <p className="text-muted">{rows.length ? 'No hook call recorded for these tools yet.' : 'This call asked for no tools, so no hook ran.'}</p>
      ) : null}
    </section>
  )
}
