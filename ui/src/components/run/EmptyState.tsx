import { ArrowRight, CheckCircle2, FlaskConical } from 'lucide-react'
import { cn } from '../../lib/cn'
import { cannotShow, EXPERIMENTS, type Experiment } from '../../learn/experiments'
import { CONCEPTS, GROUPS } from '../../learn/concepts'
import { QUIZ } from '../../learn/quiz'
import { Explain } from '../../learn/Explain'
import { toast, usePrefs, useUi } from '../../store/ui'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { LoopDiagram } from '../inspector/LoopDiagram'
import { setUpExperiment } from '../../learn/setup'
import { Chip } from '../ui'

// The provider in use: the session's, else the server's default (both hooks are always called)
export function useCurrentProvider() {
  const chosen = useSession((s) => s.provider)
  const standard = useServer((s) => s.info?.provider)
  return chosen ?? standard ?? null
}

// Pick an experiment: remember it for the banner, and put its message in the box
export function pickExperiment(x: Experiment) {
  void askThenPick(x)
}

// Asks before replacing what you typed, and does nothing (not even `before`, e.g. a new
// conversation) until you agree; checks again that no reply is running at that moment
export async function askThenPick(x: Experiment, before?: () => Promise<void>, opts?: { fillOnly?: boolean }) {
  const go = async () => {
    if (useSession.getState().running) {
      toast({ kind: 'info', title: 'Wait for the reply to finish, then pick the experiment' })
      return
    }
    if (before) await before() // (without one, start at once)
    if (opts?.fillOnly) useUi.getState().fillDraft(x.message)
    else start(x)
  }
  if (useSession.getState().running) return go() // (says to wait)
  const typed = useUi.getState().composerText.trim()
  if (typed && typed !== x.message.trim()) {
    toast({ kind: 'info', title: "Replace what you typed with the experiment's message?", body: `"${x.title}" puts its own message in the box.`,
      action: { label: 'Replace', run: () => void go() } })
    // you were typing in the box, so the toast does not take focus by itself: ask for it here
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-toaster] button[data-action]')?.focus())
    return
  }
  await go()
}

function start(x: Experiment) {
  useUi.getState().setExperiment(x.id)
  useUi.getState().fillDraft(x.message)
  setUpExperiment(x)
}

// What a card will do besides send its message
function CardTags({ x }: { x: Experiment }) {
  const tags = [
    x.predict && 'guess first',
    x.apply && 'changes a setting (undoable)',
    x.switchTo && 'switches model (undoable)',
    x.needs && `needs ${x.needs}`,
  ].filter(Boolean) as string[]
  if (!tags.length) return null
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => <Chip key={t} tone={t.startsWith('needs') ? 'warn' : 'neutral'} className={cn('whitespace-normal', !t.startsWith('needs') && 'text-muted')}>{t}</Chip>)}
    </span>
  )
}

// One experiment as a card you click to start it
function ExperimentCard({ x, done, provider, disabled, onPick }:
  { x: Experiment; done: boolean; provider: string | null; disabled: boolean; onPick: (x: Experiment) => void }) {
  const unusable = cannotShow(x, provider)
  // F373: not `disabled` (a disabled button is skipped by Tab and rarely shows its title): it stays
  // reachable, says why (aria-describedby), and a click does nothing
  const why = unusable ? `Needs ${x.needs}: switch provider first (the pill above the message box)`
    : disabled ? 'Available when the current reply finishes' : null
  return (
    <>
      <button type="button" aria-disabled={why ? true : undefined} aria-describedby={why ? `why-${x.id}` : undefined}
        onClick={() => { if (!why) onPick(x) }} title={why ?? undefined}
        className="group flex flex-col gap-1.5 rounded-lg border border-line bg-panel p-3 text-left transition
          focus-ring hover:border-accent hover:shadow-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-line aria-disabled:hover:shadow-none">
        <span className="flex items-center justify-between gap-2 text-sm font-semibold">
          <span className="flex items-center gap-1.5">
            {done && <span title="You ran this" className="inline-flex"><CheckCircle2 className="size-3.5 text-ok" aria-label="done" /></span>}{x.title}
          </span>
          <ArrowRight className="size-3.5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-accent" />
        </span>
        <span className="text-sm text-fg/90">“{x.message}”</span>
        <span className="mt-auto text-xs text-muted">
          Idea: <b className="font-medium">{CONCEPTS[x.concept].plain}</b> <span>({CONCEPTS[x.concept].term})</span>.
          <span className="block">{x.teaches}</span>
        </span>
        <CardTags x={x} />
      </button>
      {/* outside the button, so it is the card's description and not part of its name */}
      {why && <span id={`why-${x.id}`} className="sr-only">{why}</span>}
    </>
  )
}

// The new-conversation page shows only the next few you haven't done; the whole list is under Experiments
const NEXT = 3
function NextExperiments({ disabled }: { disabled: boolean }) {
  const done = usePrefs((s) => s.experimentsDone)
  const provider = useCurrentProvider()
  const next = EXPERIMENTS.filter((x) => !done.includes(x.id)).slice(0, NEXT) // (in teaching order: F408)
  return (
    <div className="space-y-2">
      {next.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {next.map((x) => <ExperimentCard key={x.id} x={x} done={false} provider={provider} disabled={disabled} onPick={pickExperiment} />)}
        </div>
      )}
      <button type="button" className="text-sm text-accent hover:underline" onClick={() => useUi.getState().setExperimentsOpen(true)}>
        All {EXPERIMENTS.length} experiments ({done.length} done) →
      </button>
    </div>
  )
}

// The experiments, grouped in the order they teach
export function ExperimentGrid({ onPick, disabled }: { onPick: (x: Experiment) => void; disabled: boolean }) {
  const done = usePrefs((s) => s.experimentsDone)
  const provider = useCurrentProvider()
  const learning = usePrefs((s) => s.learningMode)
  const setLearning = usePrefs((s) => s.setLearningMode)
  return (
    <div className="space-y-5">
      {GROUPS.filter((g) => EXPERIMENTS.some((x) => x.tier === g)).map((g, i) => (
        <section key={g}>
          <h3 className="mb-2 flex items-baseline gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
            {i + 1}. {g}
            <span className="font-normal tracking-normal normal-case">
              {(() => { const xs = EXPERIMENTS.filter((x) => x.tier === g); return `${xs.filter((x) => done.includes(x.id)).length} of ${xs.length} done` })()}
            </span>
          </h3>
          {/* F374b: two columns from 640 px up, so titles don't wrap in narrow cards */}
          <div className="grid gap-2 sm:grid-cols-2">
            {EXPERIMENTS.filter((x) => x.tier === g).map((x) =>
              <ExperimentCard key={x.id} x={x} done={done.includes(x.id)} provider={provider} disabled={disabled} onPick={onPick} />)}
          </div>
        </section>
      ))}
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={learning} onChange={(e) => setLearning(e.target.checked)} />
        Learning mode: always show every explanation in full
      </label>
    </div>
  )
}

// What a new conversation shows: what this lab is, and the experiments to start from
export function EmptyState({ disabled }: { disabled: boolean }) {
  const provider = useCurrentProvider()
  const doneCount = usePrefs((s) => s.experimentsDone.length)
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <div className="space-y-2 text-center">
        <h1 className="text-lg font-semibold">See how an AI agent harness works</h1>
        <p className="mx-auto max-w-xl text-sm text-muted">
          Send a message and watch the loop: the harness calls the model, runs the tools it asks for, and
          calls it again until it answers. Click any call to look inside it on the right.
        </p>
        {provider === 'mock' && (
          <p className="mx-auto max-w-xl text-sm text-muted">
            You're on the mock (Claude Code's <code>claude -p</code>): free, but each model call takes 20 to 60 s.
          </p>
        )}
      </div>
      <Explain concept="harness" />
      <div className="mx-auto max-w-xl rounded-lg border border-line bg-panel p-3">
        <LoopDiagram active={null} />
      </div>
      <div>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <FlaskConical className="size-4 text-muted" /> {doneCount ? 'Next experiments' : 'Start with an experiment'}
        </h2>
        <NextExperiments disabled={disabled} />
        <QuizLink />
      </div>
    </div>
  )
}

// After a few experiments, the quiz checks what stuck
function QuizLink() {
  const done = usePrefs((s) => s.experimentsDone.length)
  if (done < 3) return null
  return (
    <p className="mt-4 text-sm text-muted">
      {done} experiments done.{' '}
      <button type="button" className="text-accent hover:underline" onClick={() => useUi.getState().setHelp(true, 'quiz')}>
        Quiz me ({QUIZ.length} questions)
      </button>{' '}to check what stuck.
    </p>
  )
}
