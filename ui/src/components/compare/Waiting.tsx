// The progress banner while a comparison runs
import { useCompare } from '../../store/compare'
import { RunningBanner } from '../ui'

// While a comparison runs: how long so far, how far each side has got, and a Stop
export function Waiting({ onStop }: { onStop?: () => void }) {
  const { busyText, progress, repeatRunning, startedAt } = useCompare()
  // With several runs per side, about how long is left (the slowest side sets the pace)
  const done = progress?.length ? Math.min(...progress.map((p) => p.done)) : 0
  const left = (so: number) => (repeatRunning > 1 && done > 0 && done < repeatRunning ? (so / done) * (repeatRunning - done) : null)
  return (
    <RunningBanner text={busyText} startedAt={startedAt ? startedAt / 1000 : null} left={left} onStop={onStop}
      stopTitle="Each run stops at its next step, and no side starts another">
      {progress && repeatRunning > 1 && (
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {progress.map((p) => <span key={p.label}>{p.label}: {p.done} of {repeatRunning} runs done</span>)}
        </div>
      )}
    </RunningBanner>
  )
}
