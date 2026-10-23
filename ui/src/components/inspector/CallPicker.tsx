// The call picker at the top of the Inspector, with previous and next
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Call, RunModel } from '../../model/derive'
import { useUi } from '../../store/ui'
import { IconButton, Select } from '../ui'
import { callName } from './callNames'

export function CallPicker({ model, current }: { model: RunModel; current: Call }) {
  const i = model.callOrder.indexOf(current.id)
  const go = (d: number) => {
    const id = model.callOrder[i + d]
    if (id) useUi.getState().selectCall(id)
  }
  // The buttons say where they go: the next call can be in another message
  const target = (d: number) => {
    const id = model.callOrder[i + d]
    return id ? `: ${callName(model.calls[id])}` : ''
  }
  const newestId = model.callOrder[model.callOrder.length - 1]
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <IconButton label={`Previous call${target(-1)}`} shortcut="[" size="sm" disabled={i <= 0} onClick={() => go(-1)}>
        <ChevronLeft className="size-4" />
      </IconButton>
      <Select size="sm" aria-label="Call to inspect" value={current.id}
        onChange={(e) => useUi.getState().selectCall(e.target.value)}
        className="min-w-0 px-1.5">
        {model.runs.map((run) => (
          <optgroup key={run.index} label={`Message ${run.index}: ${run.text.slice(0, 40)}`}>
            {run.callIds.map((id) => (
              <option key={id} value={id}>{`Message ${run.index} · call ${model.calls[id].turn}${model.calls[id].stepLabel ? ` (${model.calls[id].stepLabel})` : ''}${id === newestId ? ' (newest)' : ''}`}</option>
            ))}
          </optgroup>
        ))}
      </Select>
      <IconButton label={`Next call${target(1)}`} shortcut="]" size="sm" disabled={i >= model.callOrder.length - 1} onClick={() => go(1)}>
        <ChevronRight className="size-4" />
      </IconButton>
    </div>
  )
}
