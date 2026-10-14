// A workflow: the message went through a fixed chain of agents. The card shows the chain as a
// diagram (the outer chain, with the inner loop in each step), then each step: what your code
// passed it, how many calls its own loop took, and what it handed back.
import { Workflow } from 'lucide-react'
import type { Run, RunModel, WorkflowStep } from '../../model/derive'
import { cn } from '../../lib/cn'
import { count, plural, seconds } from '../../lib/format'
import { Explain } from '../../learn/Explain'
import { Spinner } from '../ui'
import { WorkflowDiagram } from './WorkflowDiagram'

export const FIXES = 2 // as in features/workflow.py

// What the code did with a check's reply, in plain words
export function verdictWords(st: WorkflowStep): string {
  if (st.verdict === 'pass') return 'PASS: the draft is the answer'
  if (st.verdict === 'unclear') return "neither PASS nor PROBLEMS, so the code couldn't tell: it kept the draft"
  if (st.verdict === 'problems') return st.last ? `problems, but no fixes left (${FIXES} done): the last draft is the answer` : 'problems: the draft goes back to be fixed'
  return ''
}

export function WorkflowCard({ run, model }: { run: Run; model: RunModel }) {
  const steps = run.workflow ?? []
  const running = steps.some((s) => s.running)
  const calls = steps.reduce((n, s) => n + s.callIds.length, 0)
  return (
    <section aria-label="Workflow" className="space-y-2 rounded-lg border border-line bg-panel px-3 py-2.5 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Workflow className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="font-medium">Workflow</span>
        <span className="text-muted">a fixed chain of agents: your code decides the steps</span>
        {running && <Spinner className="shrink-0 text-accent" />}
        <span className="ml-auto text-xs text-muted">{plural(steps.length, 'step')} · {plural(calls, 'call')}</span>
      </div>
      <WorkflowDiagram steps={steps} answered={run.outcome === 'answered' && !running} fixes={FIXES} className="max-h-72" />
      <ol className="space-y-1.5 border-l-2 border-line pl-3 text-xs">
        {steps.map((st) => <StepRow key={st.n} step={st} model={model} />)}
      </ol>
      <Explain concept="workflow" quiet />
    </section>
  )
}

function StepRow({ step: st, model }: { step: WorkflowStep; model: RunModel }) {
  const tools = st.callIds.flatMap((id) => model.calls[id]?.toolIds ?? []).map((id) => model.tools[id]?.name).filter(Boolean)
  const secs = st.endedAt != null ? st.endedAt - st.startedAt : undefined
  const words = verdictWords(st)
  return (
    <li className="space-y-0.5">
      <div className="text-muted">
        <b className="font-semibold text-fg">{st.n}. {st.label}{st.attempt ? ` ${st.attempt}` : ''}</b>
        {' '}· {plural(st.callIds.length, 'call')}
        {tools.length > 0 && <> · {tools.join(', ')}</>}
        {!st.tools.length && ' · no tools'}
        {secs != null && ` · ${seconds(secs)}`}
        {st.running && ' · running…'}
      </div>
      <details className="pl-3">
        <summary className="cursor-pointer text-muted hover:text-fg">
          your code sent it {count(st.sent.length)} characters{st.text != null && <>, it returned {count(st.text.length)}</>}
        </summary>
        <div className="mt-1 space-y-1">
          <p className="text-muted">Its instructions: <span className="text-fg">{st.system}</span></p>
          <pre className="max-h-40 overflow-auto rounded bg-sunken p-2 whitespace-pre-wrap text-fg">{st.sent}</pre>
          {st.text != null && (
            <>
              <p className="text-muted">It returned:</p>
              <pre className="max-h-40 overflow-auto rounded bg-sunken p-2 whitespace-pre-wrap text-fg">{st.text}</pre>
            </>
          )}
        </div>
      </details>
      {words && (
        <div className={cn('pl-3', st.verdict === 'pass' ? 'text-ok' : st.verdict === 'problems' && !st.last ? 'text-warn' : 'text-muted')}>
          → {words}
        </div>
      )}
    </li>
  )
}
