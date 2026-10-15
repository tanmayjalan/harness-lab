// How the harness decided whether a tool call may run: the checks in the order the loop makes
// them (harness/core/loop.py, _run_one). The model asks; the harness decides.
// Your hooks (checks 1 and 6) are shown from what was recorded for this call, never guessed
// from the hooks file as it is now.
import { Ban, Check, CircleSlash, Hand, Minus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { HookName, HooksLoaded, Rule } from '../../api/types'
import { hookOf, type HookRecord, type ToolRow } from '../../model/derive'
import { isMcpTool, RULES } from '../../model/permission'
import { cn } from '../../lib/cn'

type Verdict = 'pass' | 'stop' | 'skip' | 'wait'

const FILE_TOOLS = new Set(['list_files', 'read_file', 'write_file'])

function Check_({ n, title, verdict, children }: { n: number; title: string; verdict: Verdict; children: ReactNode }) {
  const icon = verdict === 'pass' ? <Check className="size-3.5 text-ok" role="img" aria-label="passed" />
    : verdict === 'stop' ? <Ban className="size-3.5 text-bad" role="img" aria-label="stopped here" />
      : verdict === 'wait' ? <Hand className="size-3.5 text-warn" role="img" aria-label="waiting" />
        : <Minus className="size-3.5 text-muted" role="img" aria-label="not reached" />
  return (
    <li className={cn('flex gap-2', verdict === 'skip' && 'text-muted')}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className="font-medium">{n}. {title}</span> <span className="text-muted">— {children}</span>
      </span>
    </li>
  )
}

// F396: where a tool that ran did its work. Some ran here but went online: say so, not "on this computer"
export function ranWhere(name: string): string {
  if (name === 'get_weather') return 'it ran here; it sent a request to the internet (open-meteo.com)'
  if (name === 'run_python') return 'it ran here, as you; the code may have reached the internet'
  if (isMcpTool(name)) return 'another program (its MCP server) ran it; it may have reached the internet'
  return 'it ran here, on this computer'
}

export function took(ms: number) {
  return ms < 1 ? 'under 1 ms' : `${Math.round(ms)} ms`
}

// When there's no record of a hook call: say why, from what was loaded for this message
function noRecord(hook: HookName, loaded: HooksLoaded | null | undefined): string {
  if (loaded === undefined) return 'not recorded: this conversation was saved before hook calls were recorded.'
  if (loaded?.problem) return `your hooks file had a mistake, so no hook ran (${loaded.problem}).`
  if (!loaded?.functions.includes(hook)) return `no ${hook} in your hooks file for this message, so nothing to check.`
  return 'not recorded.'
}

function afterText(after: HookRecord) {
  switch (after.verdict) {
    case 'replaced': return `rewrote the result before the model saw it (${took(after.ms)}). Both versions are below.`
    case 'failed': return <>crashed ({after.error}). The tool's output was thrown away; the model gets the error instead.</>
    default: return `looked at the result and left it as it was (${took(after.ms)}).`
  }
}

// `setting`: the rule from your settings (or the default) for this tool, as it was sent with the call
// `loaded`: your hooks file as it was for this call's message (undefined: an older saved conversation)
export function AccessChecks({ row, setting, loaded }: { row: ToolRow; setting?: Rule; loaded?: HooksLoaded | null }) {
  const s = row.status
  const before = hookOf(row, 'before_tool')
  const after = hookOf(row, 'after_tool')
  const beforeFailed = before?.verdict === 'failed'
  const hooked = s === 'hook_blocked'
  const fileTool = FILE_TOOLS.has(row.name) || (row.name === 'run_python' && 'path' in row.input) // a script by its path
  const rule = row.permission // the rule that actually applied (after the workspace check)
  const blocked = s === 'blocked'
  const unattended = s === 'unattended' // it needed your OK and nobody could be asked here
  const reachedRule = !hooked && !beforeFailed && s !== 'not_run'
  const reachedYou = reachedRule && !blocked && rule === 'ask'
  const ran = (s === 'ran' || s === 'error') && !beforeFailed
  const reason = before?.reason ?? (hooked ? row.result?.content.replace(/^Blocked by the user's hook: /, '').replace(/\. Don't try it again\.$/, '') : '')
  const stoppedFirst = beforeFailed ? 'not checked: your hook crashed first.' : 'not checked: your hook stopped it first.'

  return (
    <div className="space-y-1.5">
      <ol className="space-y-1 text-xs">
        <Check_ n={1} title="Your hook, before it runs (before_tool)"
          verdict={hooked || beforeFailed ? 'stop' : before ? 'pass' : 'skip'}>
          {hooked ? <>blocked it: “{reason}”{before ? ` (${took(before.ms)})` : ''}. Nothing else was checked.</>
            : beforeFailed ? <>crashed ({before.error}), so the tool never ran. The model gets the error.</>
              : before ? `config/my_hooks.py looked at the call and let it through (${took(before.ms)}).`
                : s === 'not_run' ? 'not reached: the tool call never started.'
                  : noRecord('before_tool', loaded)}
        </Check_>
        <Check_ n={2} title="Inside the workspace folder?" verdict={!reachedRule ? 'skip' : row.outside ? 'wait' : 'pass'}>
          {s === 'not_run' ? 'not reached.' : !reachedRule ? stoppedFirst
            : !fileTool ? 'not a file tool, so this check doesn\'t apply.'
            : row.outside ? (setting === 'block' ? 'no: the path is outside the workspace folder, but the tool is set to Block anyway.'
              : setting === 'ask' ? "no: the path is outside the workspace folder; it's set to Ask first anyway."
                : 'no: the path is outside the workspace folder, so "Allow" becomes "Ask first".')
              : 'yes: the path is inside the workspace folder.'}
        </Check_>
        <Check_ n={3} title="Your rule for this tool" verdict={!reachedRule ? 'skip' : blocked || unattended ? 'stop' : rule === 'ask' ? 'wait' : 'pass'}>
          {!reachedRule ? <>{s === 'not_run' ? 'not reached' : 'not checked'}{setting ? <> (it's set to <b>{RULES[setting].label}</b>)</> : null}{s === 'not_run' ? '.' : `: your hook ${beforeFailed ? 'crashed' : 'stopped it'} first.`}</> : (
            <>
              {setting ? <>set to <b>{RULES[setting].label}</b>{rule && rule !== setting ? <> (applied as <b>{RULES[rule].label}</b>)</> : null}</>
                : rule ? <><b>{RULES[rule].label}</b></> : 'unknown (an older saved conversation)'}
              {blocked ? ': refused. The model is told it was blocked.'
                : unattended ? ': nobody can be asked here (Compare, Re-run, evals and helpers run on their own), so it wasn\'t run. The model is told why.'
                  : rule === 'ask' ? ': the harness asks you.' : ': it may run.'}
            </>
          )}
        </Check_>
        <Check_ n={4} title="You decide" verdict={!reachedYou ? 'skip' : s === 'declined' ? 'stop' : s === 'awaiting' ? 'wait' : 'pass'}>
          {unattended ? 'nobody could be asked: nothing waits for an answer here.'
            : !reachedYou ? 'not needed for this call.'
            : s === 'awaiting' ? 'waiting for your Allow or Decline.'
              : s === 'declined' ? 'you declined. The model is told, and carries on without it.'
                : 'you allowed it.'}
        </Check_>
        <Check_ n={5} title="The harness runs the tool"
          verdict={ran ? (s === 'error' && after?.verdict !== 'failed' ? 'stop' : 'pass') : s === 'running' && !beforeFailed ? 'wait' : 'skip'}>
          {beforeFailed ? 'never ran: your before_tool crashed first.'
            : s === 'ran' ? `${ranWhere(row.name)}.`
              : s === 'error' && after?.verdict === 'failed' ? `${ranWhere(row.name)}; then your after_tool crashed (check 6).`
                : s === 'error' ? 'it ran but failed; the error goes back to the model (is_error: true).'
                  : s === 'running' ? 'running now…'
                    : s === 'not_run' ? (row.result?.content.startsWith('Not run: the reply was cut off')
                      ? 'never ran: the reply was cut off before this request was complete.'
                      : row.result?.content.includes("wasn't offered to you")
                        ? "never ran: this call didn't offer that tool, so the harness refused it (whatever your rule says). The model is told why."
                        : 'never ran: you stopped the message first.') : 'didn\'t run.'}
        </Check_>
        <Check_ n={6} title="Your hook, after it runs (after_tool)"
          verdict={after ? (after.verdict === 'failed' ? 'stop' : 'pass') : 'skip'}>
          {after ? afterText(after)
            : !ran && s !== 'running' && s !== 'awaiting' ? 'not reached: the tool didn\'t run.'
              : (s === 'running' || s === 'awaiting') && loaded?.functions.includes('after_tool') ? 'runs once the tool has finished.'
                : noRecord('after_tool', loaded)}
        </Check_>
      </ol>
      <p className="flex items-start gap-1 text-xs text-muted">
        <CircleSlash className="mt-0.5 size-3.5 shrink-0" />
        The model never runs anything: it can only ask. Every tool this call offered goes to the model (even blocked
        ones), and whatever happens here, it gets a result back for its request.
      </p>
    </div>
  )
}
