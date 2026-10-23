// The Inspector's Sent tab: what the harness sent
import { useState } from 'react'
import type { Settings } from '../../api/types'
import type { Call } from '../../model/derive'
import type { CallView } from '../../model/inspector'
import { ruleBadge } from '../../model/permission'
import { cn } from '../../lib/cn'
import { count, plural } from '../../lib/format'
import { ExplainIcon } from '../../learn/Explain'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { Badge, Disclosure, Section } from '../ui'
import { MessageList } from './MessageList'
import { callRef } from './callNames'
import { InCode } from './InCode'

// F446: tools whose description you edited in Settings and this call sent (older saves don't record it), and
// tools whose description you have changed since, while this conversation keeps the start it began with
function toolEdits(call: Call, settings: Settings | null, keepsStart: boolean) {
  const edited = new Set(call.request.config?.descriptions ?? [])
  const waiting = settings && keepsStart && settings.apply === 'conversation'
    ? (call.request.tools ?? []).filter((t) => {
      const now = settings.tools.find((s) => s.name === t.name)
      return !!now && now.description.trim() !== t.description.trim()
    }).map((t) => t.name)
    : []
  return { edited, waiting }
}

export function SentTab({ view }: { view: CallView }) {
  const { call } = view
  const [onlyNew, setOnlyNew] = useState(false)
  const shown = onlyNew ? view.messages.filter((m) => m.isNew) : view.messages
  // Tools not offered on the previous call (find_tool loaded them): green, as new messages are
  const before = new Set((view.previous?.request.tools ?? []).map((t) => t.name))
  const newTools = view.previous?.request.tools ? (call.request.tools ?? []).map((t) => t.name).filter((n) => !before.has(n)) : []
  const settings = useServer((s) => s.settings)
  const keepsStart = useSession((s) => s.frozen)
  const { edited, waiting } = toolEdits(call, settings, keepsStart)
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">What the harness sent: the system prompt, the tools offered and the messages list; green is new since the previous call. The Raw tab has the exact request body.</p>
      <InCode><code>agent()</code> in harness/core/loop.py builds this request and sends it.</InCode>
      <Section title="System prompt" aside={<span className="flex gap-2">
        {call.request.facts > 0 && <ExplainIcon concept="facts" />}<ExplainIcon concept="system_prompt" />
      </span>}>
        <Disclosure className="rounded-md border border-line" summaryClassName="px-2.5 py-1.5 text-sm" summary={<>
          {count(call.request.system.length)} characters
          {call.request.facts > 0 && <span className="text-ok"> · includes {plural(call.request.facts, 'fact')} about you</span>}
        </>}>
          <pre className="code-block rounded-t-none">
            <SystemText text={call.request.system} withFacts={call.request.facts > 0} />
          </pre>
        </Disclosure>
      </Section>

      <Section title={`Tools offered (${call.request.tools?.length ?? 0})`}>
        <Disclosure className="rounded-md border border-line" summaryClassName="px-2.5 py-1.5 text-sm"
          summary={<>
            {(call.request.tools ?? []).map((t) => t.name).join(', ') || 'none'}
            {newTools.length > 0 && <span className="text-ok"> · new since {callRef(view.previous!, call)}: {newTools.join(', ')}</span>}
            {edited.size > 0 && <span className="text-warn"> · your edits: {[...edited].join(', ')}</span>}
          </>}>
          <ul className="divide-y divide-line">
            {(call.request.tools ?? []).map((t) => {
              const rule = ruleBadge({ permission: t.permission, outside: false, status: 'ran' })
              return (
                <li key={t.name} className={cn('space-y-0.5 px-2.5 py-1.5 text-sm', newTools.includes(t.name) && 'added')}>
                  <div className="flex items-center gap-2">
                    <code className="font-semibold">{t.name}</code>
                    {rule && <Badge tone={rule.tone}>{rule.label}</Badge>}
                    {t.source !== 'built in' && <Badge>{t.source}</Badge>}
                    {edited.has(t.name) && <Badge tone="warn" title="Its description was edited in Settings → Tools">edited</Badge>}
                  </div>
                  <p className="text-xs text-muted">{t.description}</p>
                  {waiting.includes(t.name) && (
                    <p className="text-xs text-muted">Your newer edit to this description waits for your next conversation.</p>
                  )}
                </li>
              )
            })}
          </ul>
        </Disclosure>
        {waiting.length > 0 && (
          <p className="text-xs text-muted">
            Your edits to {waiting.join(', ')} wait for your next conversation: this one keeps the descriptions it began
            with (Settings → Model → "From your next conversation").
          </p>
        )}
      </Section>

      <Section title={`Messages list (${plural(view.messages.length, 'entry', 'entries')})`}
        aside={
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> only new
          </label>
        }>
        {view.previous ? (
          <p className="text-xs text-muted">
            The whole history goes every call. <span className="added rounded px-1">Green</span> = new since {callRef(view.previous, call)}
            (open); older entries start folded. Click any entry to open or fold it.
          </p>
        ) : (
          <p className="text-xs text-muted">First call: everything here is new. From the next call on, new entries show in green.</p>
        )}
        <MessageList key={`${call.id}-${onlyNew}`} messages={shown} wash={!!view.previous} />
      </Section>
    </div>
  )
}

// The facts about you go at the end of the prompt under this heading (harness/features/memory.py),
// so the part to highlight is read from what this call actually sent
const FACTS_HEADING = '\n\nAbout the user ('

function SystemText({ text, withFacts }: { text: string; withFacts: boolean }) {
  const at = withFacts ? text.lastIndexOf(FACTS_HEADING) : -1
  if (at < 0) return <>{text}</>
  return <>{text.slice(0, at + 2)}<mark className="added-text" title="Added from Settings → Memory">{text.slice(at + 2)}</mark></>
}
