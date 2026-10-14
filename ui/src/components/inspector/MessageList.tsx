// The messages a call sent, one card each. Each card folds to a one-line preview; new messages
// (since the previous call) start open, the rest start folded, so the change stands out.
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Scissors } from 'lucide-react'
import { useState } from 'react'
import type { Block, Message } from '../../api/types'
import type { MessageView } from '../../model/inspector'
import { cn } from '../../lib/cn'
import { count, shortArgs } from '../../lib/format'
import { Badge, Button } from '../ui'
import { MessageBody } from './ContentBlock'

const oneLine = (s: string, n = 90) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

// What a folded message shows: its text, or what tools it asked for / answered
export function preview(message: Message): string {
  if (typeof message.content === 'string') return oneLine(message.content)
  const parts = message.content.map((b: Block) => {
    if (b.type === 'text') return oneLine((b as { text: string }).text, 60)
    if (b.type === 'tool_use') {
      const u = b as { name: string; input: Record<string, unknown> }
      return `→ ${u.name}(${shortArgs(u.input, 40)})`
    }
    if (b.type === 'tool_result') {
      const r = b as { tool_use_id: string; content: unknown; is_error?: boolean }
      const text = typeof r.content === 'string' ? r.content : JSON.stringify(r.content)
      return `← ${r.is_error ? 'error' : 'result'}: ${oneLine(text, 50)}`
    }
    return `[${b.type}]`
  })
  return parts.filter(Boolean).join('  ·  ')
}

export const sizeOf = (message: Message) =>
  typeof message.content === 'string' ? message.content.length : JSON.stringify(message.content).length

// wash: colour the new messages green (not on a first call, where everything is new)
export function MessageList({ messages, wash = true }: { messages: MessageView[]; wash?: boolean }) {
  const [open, setOpen] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(messages.map((m) => [m.index, m.isNew])))
  const isOpen = (m: MessageView) => open[m.index] ?? m.isNew
  const setAll = (value: boolean) => setOpen(Object.fromEntries(messages.map((m) => [m.index, value])))
  const allOpen = messages.every(isOpen)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setAll(!allOpen)}>
          {allOpen ? <><ChevronsDownUp className="size-3.5" /> Fold all</> : <><ChevronsUpDown className="size-3.5" /> Open all</>}
        </Button>
      </div>
      <ol className="space-y-1.5">
        {messages.map((m) => {
          const expanded = isOpen(m)
          return (
            <li key={m.index} className={cn('rounded-md border border-line', wash && m.isNew && 'added')}>
              <button type="button" aria-expanded={expanded} onClick={() => setOpen({ ...open, [m.index]: !expanded })}
                className="flex w-full min-w-0 items-start gap-1.5 px-2.5 py-1.5 text-left text-xs hover:bg-sunken/60">
                <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 text-muted transition-transform', expanded && 'rotate-90')} aria-hidden />
                <span className="shrink-0 font-semibold" title={`Entry ${m.index + 1} of the messages list`}>#{m.index + 1} {m.message.role}</span>
                <span className="flex shrink-0 flex-wrap gap-1">
                  {wash && m.isNew && <Badge tone="ok">new</Badge>}
                  {m.sentTimes > 1 && <Badge title="How many calls have sent this same message, this one included">in {m.sentTimes} calls</Badge>}
                  {m.trimmed && <Badge tone="warn"><Scissors aria-hidden className="size-3" />trimmed</Badge>}
                  {m.summary && <Badge tone="warn">summary</Badge>}
                </span>
                {!expanded && <span className="min-w-0 flex-1 truncate text-muted">{preview(m.message)}</span>}
                <span className="ml-auto shrink-0 pl-2 text-muted tabular-nums">{count(sizeOf(m.message))} characters</span>
              </button>
              {expanded && (
                <div className="border-t border-line px-2.5 py-2">
                  <MessageBody message={m.message} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
