// The Inspector's Tools tab: each tool's round trip
import type { Call, RunModel } from '../../model/derive'
import { HooksCard } from './HooksCard'
import { RoundTrips } from './RoundTrip'
import { InCode } from './InCode'

// One tool's whole journey: asked for, run here, sent back (the plain-words walkthrough)
export function ToolsTab({ call, model }: { call: Call; model: RunModel }) {
  const any = call.toolIds.length > 0 || (call.request.messages ?? []).some((m) =>
    Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'))
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">How each tool this call touched went: the model asks, the harness decides and runs it here, and the result goes back in the next call.</p>
      <InCode>
        <code>_before</code> (checks), <code>_run_one</code> (runs) and <code>_after</code> (your after_tool hook) in harness/core/loop.py;
        {' '}your hooks file is loaded by harness/features/hooks.py.
      </InCode>
      <HooksCard model={model} call={call} />
      <RoundTrips model={model} callId={call.id} />
      {!any && <p className="text-sm text-muted">This call asked for no tools and carried no tool results.</p>}
    </div>
  )
}
