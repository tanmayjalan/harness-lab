// The whole conversation in numbers
import { Download } from 'lucide-react'
import type { RunModel } from '../../model/derive'
import { callsCsv, conversationReport } from '../../model/report'
import { approx, cost, plural, seconds, tokens, tokensOut } from '../../lib/format'
import { Button, Disclosure } from '../ui'

const OUTCOME_WORDS: Record<string, string> = {
  ran: 'ran', error: 'failed', declined: 'declined', blocked: 'blocked', unattended: 'not run (nobody to ask)',
  hook_blocked: 'hook-blocked', not_run: 'not run',
  running: 'running', awaiting: 'waiting',
}

// The whole conversation in numbers, and a CSV of every call
export function ConversationCard({ model }: { model: RunModel }) {
  const r = conversationReport(model)
  const download = () => {
    const url = URL.createObjectURL(new Blob([callsCsv(model)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'harness-conversation-calls.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-1">
    <Disclosure className="rounded-lg border border-line bg-sunken/60 px-3 py-2 text-sm" summaryClassName="font-medium" summary={<>
      This conversation <span className="font-normal text-muted">· {plural(r.messages, 'message')}, {plural(r.calls, 'model call')}
        {r.tokensIn > 0 && `, ${approx(tokens(r.tokensIn), r.estimated)} tokens in`}{r.cost != null && `, ${cost(r.cost, r.estimated)}`}</span>
    </>}>
      <ul className="mt-2 space-y-0.5 text-xs">
        <li>{plural(r.calls, 'model call')}{r.helperCalls > 0 && ` + ${plural(r.helperCalls, 'helper call')}`}</li>
        <li>Tools: {Object.entries(r.toolRuns).map(([k, n]) => `${n} ${OUTCOME_WORDS[k] ?? k}`).join(', ') || 'none'}</li>
        <li>Time: {seconds(r.modelSeconds)} waiting for replies, {seconds(r.toolSeconds)} tools{r.waitedSeconds > 0 && `, ${seconds(r.waitedSeconds)} waiting for you`}</li>
        {r.tokensIn > 0 && <li>Tokens: {approx(tokens(r.tokensIn), r.estimated)} in, {tokensOut(r.tokensOut, r.estimated)} out{r.cost != null && ` · ${cost(r.cost, r.estimated)}`}</li>}
        {r.nextCallAtLeast > 0 && (
          <li className="text-muted">Your next message's first call will send at least {tokens(r.nextCallAtLeast)} tokens: everything so far goes again.</li>
        )}
      </ul>
    </Disclosure>
    <Button size="sm" variant="ghost" className="-ml-2" onClick={download} disabled={!r.calls}
      title="One row per model call: tokens, cache, cost, tools and outcomes">
      <Download className="size-3.5" /> Export every call as CSV
    </Button>
    </div>
  )
}
