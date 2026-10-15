import { CircleHelp, FlaskConical, PanelLeft, PanelRight, Settings, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { useCompare } from '../../store/compare'
import { useEvals } from '../../store/evals'
import { useSession } from '../../store/session'
import { usePrefs, useUi, type Screen } from '../../store/ui'
import type { Status } from '../../model/derive'
import { Button, IconButton, SEGMENT_TRACK, segmentItem, Spinner, Tip } from '../ui'

// `short`: the word shown on narrow screens, so the status is never colour alone
const STATUS: Record<Status, { label: string; short: string; tone: string }> = {
  idle: { label: 'Ready', short: 'Ready', tone: 'text-muted' },
  waiting_model: { label: 'Waiting for the model', short: 'Model', tone: 'text-accent' },
  running_tools: { label: 'Running tools', short: 'Tools', tone: 'text-accent' },
  awaiting_you: { label: 'Waiting for you', short: 'Your turn', tone: 'text-warn' },
  stopping: { label: 'Stopping…', short: 'Stopping', tone: 'text-warn' },
  summarising: { label: 'Summarising history', short: 'Summarising', tone: 'text-accent' },
}

export function TopBar({ narrow }: { narrow: boolean }) {
  const screen = useUi((s) => s.screen)
  const setScreen = useUi((s) => s.setScreen)
  const status = useSession((s) => s.derived.status)
  const running = useSession((s) => s.running)
  const toggleSidebar = usePrefs((s) => s.toggleSidebar)
  const sidebarCollapsed = usePrefs((s) => s.sidebarCollapsed)
  const sidebarSheet = useUi((s) => s.sidebarSheet)
  const hasCalls = useSession((s) => s.derived.callOrder.length > 0)
  const inspectorOpen = usePrefs((s) => s.inspectorOpen) && hasCalls // shown only once there is a call
  const setInspectorOpen = usePrefs((s) => s.setInspectorOpen)
  const comparing = useCompare((s) => s.busy)
  const evals = useEvals((s) => s.status)
  const busy = comparing || evals.running
  const st = comparing && !running ? { label: comparing === 'rerun' ? 'Re-running…' : 'Comparing…', short: 'Comparing', tone: 'text-accent' }
    : evals.running && !running ? { label: `Evaluating ${evals.done ?? 0}/${evals.total ?? '…'}`, short: `Evaluating ${evals.done ?? 0}/${evals.total ?? '…'}`, tone: 'text-accent' }
      : STATUS[running ? status : 'idle'] ?? STATUS.idle

  // F310, R9: what a screen reader hears. The visible status flips on every call ("Waiting for the model",
  // "Running tools"), so only this is read out: an eval round at every quarter, and "Ready" when a comparison,
  // a re-run or an eval round finishes. Not when a chat reply finishes (RunView says "Reply received") or fails
  // (its alert says so), and not "Waiting for you" (the approval panel speaks up).
  // (A marker at the end toggles, so "Ready" twice in a row is read both times.)
  // "Ready" only for a normal finish: not when it failed or was stopped (its toast has said so). A failed
  // comparison or re-run leaves the results as they were; a stopped one marks its sides; an eval round that
  // failed carries an error, and a stopped one is incomplete.
  const [said, setSaid] = useState('')
  const say = (text: string) => setSaid((a) => `${text}${a.endsWith('\u200b') ? '' : '\u200b'}`)
  const quarter = useRef<number | null>(null)
  const wasBusy = useRef(!!busy)
  const compared = useRef<{ before: unknown } | null>(null) // a comparison or re-run ran, and the results it started from
  const evaluated = useRef(false) // an eval round ran
  const evalDone = evals.done ?? 0
  const evalTotal = evals.total
  useEffect(() => {
    const was = wasBusy.current
    wasBusy.current = !!busy
    if (comparing && !compared.current) compared.current = { before: useCompare.getState().results }
    if (evals.running) evaluated.current = true
    if (was && !busy) {
      quarter.current = null
      const results = useCompare.getState().results
      const status = useEvals.getState().status
      const failedOrStopped = (compared.current && (results === compared.current.before || results?.sides.some((s) => s.stopped)))
        || (evaluated.current && (!!status.error || !!status.result?.incomplete))
      compared.current = null
      evaluated.current = false
      if (!failedOrStopped) say('Ready')
    } else if (evals.running && !running && evalTotal) {
      const q = Math.floor((evalDone * 4) / evalTotal)
      if (q !== quarter.current) {
        quarter.current = q
        say(st.label)
      }
    }
  }, [busy, comparing, st.label, evals.running, running, evalDone, evalTotal])

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <IconButton label="Conversations" aria-expanded={narrow ? sidebarSheet : !sidebarCollapsed} aria-controls="sidebar"
        onClick={() => (narrow ? useUi.getState().setSidebarSheet(true) : toggleSidebar())}>
        <PanelLeft className="size-4" />
      </IconButton>
      <div className="flex items-center gap-1.5 pr-2 font-semibold">
        <FlaskConical className="size-4 text-accent" /> <span className="hidden sm:inline">Harness lab</span>
      </div>
      <nav aria-label="Screens" className={SEGMENT_TRACK}>
        {([['run', 'Chat'], ['compare', 'Compare'], ['evals', 'Evals']] as [Screen, string][]).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setScreen(v)} aria-current={screen === v ? 'page' : undefined}
            className={segmentItem(screen === v)}>
            {l}
          </button>
        ))}
      </nav>
      <div className={cn('ml-2 flex items-center gap-1.5 text-sm', st.tone)} title={st.label}>
        {(running && status !== 'awaiting_you') || busy ? <Spinner quiet /> : <span className={cn('size-2 rounded-full forced-color-adjust-none', running ? 'bg-warn' : 'bg-ok')} aria-hidden />}
        <span>{narrow ? st.short : st.label}</span>
      </div>
      <span className="sr-only" aria-live="polite">{said}</span>
      <div className="ml-auto flex items-center gap-0.5">
        <Tip text="Guided experiments, in the order they teach">
          <Button size="sm" variant="ghost" onClick={() => useUi.getState().setExperimentsOpen(true)} aria-label="Experiments">
            <Sparkles className="size-4 text-accent" aria-hidden /> <span className="hidden md:inline">Experiments</span>
          </Button>
        </Tip>
        <IconButton label="Help, glossary and quiz" shortcut="?" onClick={() => useUi.getState().setHelp(true)}>
          <CircleHelp className="size-4" />
        </IconButton>
        <IconButton label="Settings" shortcut="Ctrl+," onClick={() => useUi.getState().openSettings()}>
          <Settings className="size-4" />
        </IconButton>
        {!narrow && (
          <IconButton label="Inspector" aria-pressed={inspectorOpen}
            tip={screen !== 'run' ? 'The inspector shows model calls in a conversation'
              : !hasCalls ? 'The inspector shows model calls once you send a message'
              : inspectorOpen ? 'Hide the inspector' : 'Show the inspector'}
            disabled={screen !== 'run' || !hasCalls} onClick={() => setInspectorOpen(!inspectorOpen)}>
            <PanelRight className="size-4" />
          </IconButton>
        )}
      </div>
    </header>
  )
}
