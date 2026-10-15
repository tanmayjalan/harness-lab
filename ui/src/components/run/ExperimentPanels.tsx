// While a conversation follows an experiment, three small panels, each where the eye is at that
// moment: a one-line header at the top; the guess and "where to look" just above the message box
// (before you send and while it runs); and what it showed, right under the answer.
import { Callout, chipClass, IconButton, RadioRow } from '../ui'
import { ArrowRight, FlaskConical, Lightbulb, Undo2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cannotShow, experimentDone, findExperiment, nextExperiment, type Experiment } from '../../learn/experiments'
import { newConversation } from '../../store/selectors'
import { putBack } from '../../learn/setup'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { useCurrentProvider } from './EmptyState'
import type { Run, RunModel } from '../../model/derive'
import { say, takeRestoredExperiment, usePrefs, useUi, type InspectorTab } from '../../store/ui'
import { cn } from '../../lib/cn'
import { askThenPick } from './EmptyState'

// The run sent for the experiment: its message, the newest if it was sent more than once
export function experimentRun(model: RunModel, x: Experiment): Run | null {
  for (let i = model.runs.length - 1; i >= 0; i--) if (model.runs[i].text.trim() === x.message.trim()) return model.runs[i]
  return null
}

const finishedRun = (run: Run | null): run is Run => !!run && run.outcome !== 'running'

function useExperiment(model: RunModel) {
  const x = findExperiment(useUi((s) => s.experimentId))
  const run = x ? experimentRun(model, x) : null
  return { x, run, latest: !!run && run === model.runs[model.runs.length - 1] }
}

function Result({ x, model, run, guess }: { x: Experiment; model: RunModel; run: Run; guess: string | null }) {
  if (!x.predict) return null
  const actual = x.predict.actual(model, run)
  return (
    <>{guess ? <>You guessed <b>{guess}</b>; it was <b>{actual}</b>.{guess === actual ? ' Right!' : ''}</> : <>It was <b>{actual}</b>.</>}</>
  )
}

export function ExperimentHeader({ model }: { model: RunModel }) {
  const { x, run, latest } = useExperiment(model)
  const guess = useUi((s) => s.guess)
  const provider = useCurrentProvider()
  const finished = finishedRun(run)
  const done = !!x && finished && experimentDone(x, run, provider)
  useEffect(() => {
    if (x && done) usePrefs.getState().markExperimentDone(x.id)
  }, [x, done])
  // F411: once its message is in this conversation, the experiment belongs to it (so reopening it after a reload keeps it)
  const conversation = useSession((s) => s.conversation)
  useEffect(() => {
    if (x && run && conversation && useUi.getState().experimentConversation !== conversation) useUi.setState({ experimentConversation: conversation })
  }, [x, run, conversation])
  if (!x) return null
  return (
    <Callout tone="info" data-testid="experiment-header" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
      <FlaskConical className="size-4 shrink-0 text-accent" aria-hidden />
      <b>Experiment: {x.title}</b>
      {finished && !latest && x.predict && <span className="text-muted">· <Result x={x} model={model} run={run} guess={guess} /></span>}
      {cannotShow(x, provider) && <span className="text-xs text-warn">Needs {x.needs} to show anything.</span>}
      <IconButton size="sm" label="Close this experiment" tip="Close this experiment (any settings it changed stay until you undo them)"
        onClick={() => useUi.getState().setExperiment(null)}
        className="-my-1 ml-auto text-muted hover:bg-panel hover:text-fg"><X className="size-3.5" /></IconButton>
    </Callout>
  )
}

// Above the message box: guess first, and where to look while it runs
export function ExperimentNow({ model }: { model: RunModel }) {
  const { x, run } = useExperiment(model)
  const guess = useUi((s) => s.guess)
  const first = useRef<HTMLDivElement>(null)
  const asking = !!x?.predict && !run
  // F411: after a reload, an experiment not sent yet puts its message back in the (empty) box
  const loaded = useSession((s) => s.loaded)
  useEffect(() => {
    if (!x || run || !loaded || !takeRestoredExperiment()) return
    if (!useUi.getState().composerText.trim()) useUi.getState().fillDraft(x.message)
  }, [x, run, loaded])
  // Take focus once, after the message box has taken it for the draft, so the guess comes first
  useEffect(() => {
    if (!asking || useUi.getState().guess) return
    const id = requestAnimationFrame(() => first.current?.querySelector<HTMLElement>('button')?.focus())
    return () => cancelAnimationFrame(id)
  }, [asking, x?.id])
  if (!x || finishedRun(run)) return null
  return (
    <Callout tone="info" className="mb-2 space-y-1.5">
      {asking && x.predict && (
        <div data-testid="experiment-guess" className="space-y-1">
          <p className="font-medium">Before you send, guess: {x.predict.question}</p>
          <div ref={first}>
            {/* F430: the group carries the question (focus lands on its first choice), and the pick is confirmed
                out loud, since focus moves on to the message box */}
            <RadioRow label={`Your guess: ${x.predict.question}`} value={guess} options={x.predict.options.map((o) => [o, o])}
              className="gap-1.5 border-0 p-0"
              itemClass={(_, on) => chipClass({ selected: on, interactive: true })}
              onChange={(o) => {
                useUi.getState().setGuess(o)
                say(`Your guess: ${o}. Now send the message.`)
                document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus()
              }} />
          </div>
        </div>
      )}
      {run && guess && <p className="text-xs text-muted">Your guess: <b>{guess}</b></p>}
      <p><span className="font-medium">Look at:</span> {x.lookAt}</p>
    </Callout>
  )
}

// F428: the reveal in one sentence, read out with the reply ("" when there is none for the newest message)
export function revealWords(model: RunModel) {
  const x = findExperiment(useUi.getState().experimentId)
  const run = x ? experimentRun(model, x) : null
  if (!x || !finishedRun(run) || run !== model.runs[model.runs.length - 1]) return ''
  const guess = useUi.getState().guess
  const actual = x.predict?.actual(model, run)
  const result = !x.predict ? '' : guess ? ` You guessed ${guess}; it was ${actual}.${guess === actual ? ' Right!' : ''}` : ` It was ${actual}.`
  return `Experiment ${x.title}.${result} What it showed is under the reply.`
}

// Under the answer: the guess checked, what it showed, what to try next
export function ExperimentReveal({ model }: { model: RunModel }) {
  const { x, run, latest } = useExperiment(model)
  const guess = useUi((s) => s.guess)
  if (!x || !latest || !finishedRun(run)) return null
  return (
    <Callout tone="info" data-testid="experiment-reveal" className="mt-4 space-y-1.5">
      <h2 className="flex items-center gap-1.5 font-medium">
        <FlaskConical className="size-4 shrink-0 text-accent" aria-hidden /> {x.title}: what happened
      </h2>
      {x.predict && (
        <p className={cn('rounded-md px-2 py-1', guess ? (guess === x.predict.actual(model, run) ? 'bg-ok-soft' : 'bg-warn-soft') : 'bg-panel/70')}>
          {run.index > 1 && <b>Message {run.index}: </b>}<Result x={x} model={model} run={run} guess={guess} />{' '}
          <span className="text-muted">{x.predict.why}</span>
        </p>
      )}
      <LookAt x={x} model={model} run={run} />
      <p className="flex gap-1.5"><Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <span><span className="font-medium">What it showed:</span> {x.takeaway}</span></p>
      <p><span className="font-medium">Try next:</span> <TryNext x={x} /></p>
      <NextOne x={x} />
    </Callout>
  )
}

// F407: on to the next experiment not done yet, in a new conversation (as the Experiments dialog does)
function NextOne({ x }: { x: Experiment }) {
  const done = usePrefs((s) => s.experimentsDone)
  const provider = useCurrentProvider()
  const next = nextExperiment(done, x.id, provider)
  if (!next) return null
  return (
    <p className="pt-1">
      <button type="button" data-testid="experiment-next"
        onClick={() => void askThenPick(next, () => newConversation())}
        className="inline-flex items-center gap-1 rounded border border-accent/40 bg-panel px-2 py-0.5 font-medium text-accent hover:border-accent">
        Next: {next.title} <ArrowRight className="size-3.5" aria-hidden />
      </button>
    </p>
  )
}

const TAB_NAMES: Record<InspectorTab, string> = { summary: 'Summary', sent: 'Sent', received: 'Received', tools: 'Tools', raw: 'Raw' }

// F406: where to look stays on screen after the run, with a button that opens the Inspector there
// (on the first call that ran a tool, for Tools; on the last call otherwise, which carries everything)
function LookAt({ x, model, run }: { x: Experiment; model: RunModel; run: Run }) {
  const tab = x.inspect
  const callId = tab === 'tools' ? run.callIds.find((id) => model.calls[id]?.toolIds.length) : run.callIds.at(-1)
  return (
    <p>
      <span className="font-medium">Look at:</span> {x.lookAt}
      {tab && callId && (
        <>{' '}<button type="button"
          onClick={() => useUi.getState().inspect(callId, tab, { toolId: tab === 'tools' ? model.calls[callId].toolIds[0] : null, narrow: true })}
          className="rounded border border-accent/40 bg-panel px-1.5 py-0.5 text-accent hover:border-accent">
          Open Inspector → {TAB_NAMES[tab]}
        </button></>
      )}
    </p>
  )
}

// The suggestion, with its quoted message as a button that puts it in the message box
function TryNext({ x }: { x: Experiment }) {
  const kept = useServer((s) => s.settings?.apply === 'conversation')
  if (kept && x.tryNextKept) return <>{x.tryNextKept}</>
  const quoted = x.tryMessage ? `"${x.tryMessage}"` : ''
  const at = quoted ? x.tryNext.indexOf(quoted) : -1
  if (at < 0) return <>{x.tryNext}</>
  return (
    <>
      {x.tryNext.slice(0, at)}
      <button type="button" title="Put this in the message box" onClick={() => void askThenPick({ ...x, message: x.tryMessage! }, undefined, { fillOnly: true })}
        className="rounded border border-accent/40 bg-panel px-1.5 py-0.5 text-accent hover:border-accent">
        {x.tryMessage}
      </button>
      {x.tryNext.slice(at + quoted.length)}
    </>
  )
}

// Above the message box, in every conversation, while an experiment's changes are still on
export function ExperimentChanges() {
  const before = usePrefs((s) => s.experimentBefore)
  const running = useSession((s) => s.running)
  if (!before) return null
  return (
    <Callout tone="warn" size="sm" data-testid="experiment-changes" className="mb-2 flex items-center gap-2">
      <FlaskConical className="size-3.5 shrink-0 text-warn" aria-hidden />
      <span className="min-w-0 flex-1">Experiment changed: {before.changes.join(', ')}</span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <button type="button" onClick={() => void putBack()} disabled={running}
          title={running ? 'Available when the current reply finishes' : 'Put back what the experiment changed'}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-panel px-2 py-0.5 text-fg focus-ring hover:border-muted disabled:opacity-50">
          <Undo2 className="size-3.5" aria-hidden /> Undo
        </button>
        {/* F373: the reason in words (a disabled button rarely shows its title) */}
        {running && <span className="text-2xs text-muted">Available when the reply finishes</span>}
      </span>
    </Callout>
  )
}
