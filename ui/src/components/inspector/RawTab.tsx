// The Inspector's Raw tab: the call as JSON
import { ChevronsDownUp, ChevronsUpDown, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Call } from '../../model/derive'
import { sentBody, sentChars } from '../../model/inspector'
import { count, pretty } from '../../lib/format'
import { toast } from '../../store/ui'
import { Button } from '../ui'
import { JsonTree } from './JsonTree'

export function RawTab({ call }: { call: Call }) {
  const [command, setCommand] = useState({ n: 0, open: false })
  const [copied, setCopied] = useState('')
  const copy = async (what: string, value: unknown) => {
    try {
      await navigator.clipboard.writeText(pretty(value))
      setCopied(what)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      toast({ kind: 'error', title: "Couldn't copy", body: 'Your browser refused clipboard access.' })
    }
  }
  // Exactly the body the loop sent (harness/core/loop.py records it with the request): tool definitions,
  // "strict" and cache marks as they went. Conversations saved before it was recorded don't have it
  const apiRequest = sentBody(call)
  const apiResponse = call.response
    ? { stop_reason: call.response.stop_reason, content: call.response.content, usage: call.response.usage }
    : null
  const onMock = call.request.config?.provider === 'mock' || call.estimated
  const sentHelp = apiRequest ? <>
    The request body exactly as the harness sent it{call.request.streamed && <>, plus <code>"stream": true</code></>}: the <b>whole
    conversation</b> goes every call, with the system prompt and every tool's full definition.
    {onMock && <> On the mock, the model doesn't get it in this form: the mock turns it into one text prompt for{' '}
      <code>claude -p</code> (system prompt and tools written out as text, the reply forced into a fixed shape, and tool
      ids made up). See Help → what the mock can't show.</>}
  </> : "This conversation was saved before the harness kept the exact request, so it can't be shown. The Sent tab shows what was recorded: the system prompt, the tool names and descriptions, and the messages."
  const parts: [string, string, ReactNode, unknown, number, number | null][] = [
    ['api-request', 'Sent to the model', sentHelp, apiRequest, 1, apiRequest ? sentChars(call) : null],
    // The loop records only these three fields of the reply (its "response" event), so this isn't the whole reply
    ['api-response', 'Came back from the model', <>The parts of the API reply the harness reads: why it stopped (<code>stop_reason</code>), what it wrote or asked for (<code>content</code>) and how many tokens it used (<code>usage</code>).</>, apiResponse, 1, null],
    ['events', "The harness's own record (not sent)", <>The events the harness logged for this call. Fields like <code>seq</code>, <code>time</code>, <code>msg</code>, <code>config</code> and <code>provider</code> are its bookkeeping, for this page: the model never sees them.</>, { request: call.request, response: call.response ?? null }, 0, null],
  ]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <span className="mr-auto">This call as JSON. Click any line to open or fold it.</span>
        <Button size="sm" variant="ghost" onClick={() => setCommand({ n: command.n + 1, open: true })}><ChevronsUpDown className="size-3.5" /> Open all</Button>
        <Button size="sm" variant="ghost" onClick={() => setCommand({ n: command.n + 1, open: false })}><ChevronsDownUp className="size-3.5" /> Fold all</Button>
      </div>
      {parts.map(([key, label, help, value, depth, size]) => (
        <section key={key} className="space-y-1 rounded-md border border-line p-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">{label} {size !== null && <span className="font-normal text-muted">· {count(size)} characters of system prompt, tools and messages (counted as in the Summary)</span>}</span>
            {value !== null && (
              <Button size="sm" variant="ghost" onClick={() => copy(key, value)}>
                <Copy className="size-3.5" /> <span role="status">{copied === key ? 'Copied' : 'Copy'}</span>
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">{help}</p>
          {value === null ? (key === 'api-request' ? null : <p className="text-xs text-muted">Nothing yet.</p>)
            : <JsonTree key={`${call.id}-${key}`} value={value} command={command} openDepth={depth} label={label} />}
        </section>
      ))}
    </div>
  )
}
