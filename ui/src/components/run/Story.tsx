// A message as a story: one numbered step per trip to the model, in plain sentences, and after the answer one
// "What just happened" takeaway. Today's full view (call lines, tool rows, explanations) is under "Show details".
import type { ReactNode } from 'react'
import { Lightbulb } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { Run, RunModel } from '../../model/derive'
import type { StoryStep } from '../../model/story'
import { promptCutWords, storyTakeaway } from '../../model/story'
import { ExplainIcon } from '../../learn/Explain'
import { CONCEPTS } from '../../learn/concepts'
import { usePrefs, useUi } from '../../store/ui'

const TONE = { ok: 'text-muted', bad: 'text-bad', warn: 'text-warn', pending: 'text-accent' } as const

// `active`: the message is running, so its last step is the one happening now. `waiting`: shown as the next
// step while the harness waits (for the first call, or between calls)
export function StoryRail({ steps, active, waiting, hint }: { steps: StoryStep[]; active: boolean; waiting?: ReactNode; hint: boolean }) {
  if (!steps.length && !waiting) return null
  const lastN = steps.length
  return (
    <ol aria-label="What happened, step by step" data-testid="story" className="ml-3 space-y-3 border-l-2 border-line pl-6">
      {steps.map((s) => {
        const now = active && !waiting && s.n === lastN
        return (
          <li key={s.callId} className="relative" aria-current={now ? 'step' : undefined}>
            <Num n={s.n} now={now} />
            {s.kind === 'waiting' ? <div className="text-sm italic text-muted">{s.lead}</div> : (
              <div className={cn('text-sm', s.kind === 'failed' && 'text-bad', s.kind === 'cut' && 'text-warn')}>
                <span className={s.tools.length ? 'text-muted' : ''}>{s.lead}</span>
                {s.tools.length === 1 && <> <ToolWhat step={s} i={0} hint={hint && s.n === 1} /></>}
              </div>
            )}
            {s.tools.length > 1 && (
              <ul className="mt-0.5 space-y-1">
                {s.tools.map((t, i) => (
                  <li key={t.toolId} className="text-sm">
                    <ToolWhat step={s} i={i} hint={hint && s.n === 1 && i === 0} />
                    <div className={cn('text-[0.8125rem]', TONE[t.tone])}>↩ {t.back}</div>
                  </li>
                ))}
              </ul>
            )}
            {s.tools.length === 1 && <div className={cn('text-[0.8125rem]', TONE[s.tools[0].tone])}>↩ {s.tools[0].back}</div>}
            {s.promptCut && <p className="mt-1 text-[0.8125rem] text-warn">{promptCutWords(s.promptCut)}</p>}
          </li>
        )
      })}
      {waiting && (
        <li className="relative" aria-current="step">
          <Num n={lastN + 1} now />
          {waiting}
        </li>
      )}
    </ol>
  )
}

function Num({ n, now }: { n: number; now: boolean }) {
  return (
    <span aria-hidden className={cn('absolute top-0 -left-[2.3rem] flex size-6 items-center justify-center rounded-full border bg-panel text-xs',
      now ? 'border-accent text-accent' : 'border-line-strong text-muted')}>{n}</span>
  )
}

// What the model asked for: a button that opens the request in Inspector → Tools (as a tool row does)
function ToolWhat({ step, i, hint }: { step: StoryStep; i: number; hint: boolean }) {
  const t = step.tools[i]
  return (
    <>
      <button type="button" title="See this request in the Inspector: what was sent and what came back"
        onClick={() => { usePrefs.getState().sawInspectHint(); useUi.getState().inspect(step.callId, 'tools', { toolId: t.toolId }) }}
        className="rounded text-left text-fg focus-ring hover:text-accent hover:underline">{t.what}</button>
      {hint && <span className="ml-1.5 text-xs text-accent">inspect →</span>}
    </>
  )
}

// One takeaway about this message, after the answer, with the idea it shows one click away
export function Takeaway({ model, run }: { model: RunModel; run: Run }) {
  const t = storyTakeaway(model, run)
  if (!t) return null
  return (
    <div data-testid="takeaway" className="mt-1 border-l-[3px] border-line-strong py-1 pl-3.5 text-sm">
      <h3 className="flex items-center gap-1.5 font-semibold"><Lightbulb className="size-3.5 text-warn" aria-hidden /> What just happened</h3>
      <p className="text-muted">{t.text}</p>
      <ExplainIcon concept={t.concept} label={CONCEPTS[t.concept].plain} className="mt-1" />
    </div>
  )
}
