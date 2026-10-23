// The Inspector's Received tab: what the model sent back
import type { Call } from '../../model/derive'
import { count } from '../../lib/format'
import { MessageBody } from './ContentBlock'
import { InCode } from './InCode'

export function ReceivedTab({ call }: { call: Call }) {
  if (!call.response) return <p className="text-sm text-muted">The model hasn't replied yet.</p>
  const u = call.response.usage
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">What the model sent back, block by block.</p>
      <InCode><code>agent()</code> in harness/core/loop.py gets this reply and reads <code>stop_reason</code> to decide what happens next.</InCode>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">stop_reason</span><code className="rounded bg-code px-1">{call.stopReason}</code>
        {u && <span className="text-muted">· usage: {count(u.input_tokens ?? 0)} in, {count(u.cache_read_input_tokens ?? 0)} cached, {count(u.output_tokens ?? 0)} out{(u.cache_creation_input_tokens ?? 0) > 0 && ` · ${count(u.cache_creation_input_tokens ?? 0)} written to cache`}</span>}
      </div>
      <MessageBody message={{ role: 'assistant', content: call.response.content }} />
      <p className="text-xs text-muted">The harness adds this reply to the history, tool requests and all, before running any tools.</p>
    </div>
  )
}
