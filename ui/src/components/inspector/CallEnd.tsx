// The foot of every Inspector tab: the next and previous calls
import { ChevronRight } from 'lucide-react'
import type { Call, RunModel } from '../../model/derive'
import { stopWords } from '../../lib/stopWords'
import { useUi } from '../../store/ui'
import { Kbd } from '../ui'
import { callRef } from './callNames'

// What a call did, in the words of the Summary badge
function outcome(c: Call) {
  if (c.failed) return 'failed: no reply'
  if (!c.stopReason) return 'waiting for the reply…'
  return stopWords(c.stopReason, (c.response?.content ?? []).filter((b) => b.type === 'tool_use').length)
}

// The foot of every tab: this call is over, and here is the next one (a long tab otherwise just stops)
export function CallEnd({ model, current }: { model: RunModel; current: Call }) {
  const i = model.callOrder.indexOf(current.id)
  const prevId = model.callOrder[i - 1]
  const nextId = model.callOrder[i + 1]
  const next = nextId ? model.calls[nextId] : null
  const nextRun = next && next.runIndex !== current.runIndex ? model.runs.find((r) => r.index === next.runIndex) : null
  const select = (id: string) => useUi.getState().selectCall(id)
  return (
    <nav aria-label="Other calls" className="mt-6 space-y-2 border-t border-line pt-4">
      <p className="text-xs text-muted">End of message {current.runIndex} · call {current.turn}</p>
      {next ? (
        <button type="button" onClick={() => select(next.id)}
          className="focus-ring flex w-full items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-left hover:border-accent hover:bg-sunken">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Next: {callRef(next, current)}</span>
            <span className="block truncate text-xs text-muted">
              {nextRun ? `A new message: “${nextRun.text.slice(0, 60)}${nextRun.text.length > 60 ? '…' : ''}”` : outcome(next)}
            </span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-accent" />
        </button>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted">
          This is the newest call. A new one shows up here when the model is called again.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {prevId && (
          <button type="button" onClick={() => select(prevId)} className="focus-ring rounded text-accent hover:underline">
            ← Previous: {callRef(model.calls[prevId], current)}
          </button>
        )}
        <span className="ml-auto"><Kbd>[</Kbd> and <Kbd>]</Kbd> step through calls</span>
      </div>
    </nav>
  )
}
