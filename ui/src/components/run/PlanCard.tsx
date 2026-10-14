import { CheckCircle2, Circle, CircleDot, ListChecks } from 'lucide-react'
import type { PlanStep } from '../../model/derive'
import { cn } from '../../lib/cn'
import { Explain } from '../../learn/Explain'

export function PlanSteps({ steps }: { steps: PlanStep[] }) {
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => (
        <li key={i} className={cn('flex items-start gap-2 text-sm', s.status === 'done' && 'text-muted line-through')}>
          {s.status === 'done' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" role="img" aria-label="done" />
            : s.status === 'in_progress' ? <CircleDot className="mt-0.5 size-4 shrink-0 text-accent" role="img" aria-label="in progress" />
              : <Circle className="mt-0.5 size-4 shrink-0 text-muted" role="img" aria-label="to do" />}
          <span>{s.text}</span>
        </li>
      ))}
    </ol>
  )
}

// The model's latest plan for this message, pinned under the message
export function PlanCard({ steps }: { steps: PlanStep[] }) {
  const done = steps.filter((s) => s.status === 'done').length
  return (
    <div className="space-y-2 rounded-lg border border-line bg-panel p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ListChecks className="size-4 text-accent" aria-hidden /> Plan
        <span className="font-normal text-muted">{done} of {steps.length} done</span>
      </div>
      <PlanSteps steps={steps} />
      <Explain concept="plan" />
    </div>
  )
}
