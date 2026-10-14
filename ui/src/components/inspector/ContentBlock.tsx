// One block of a message, as sent or received: text, a tool request, a tool result, thinking.
import { useState } from 'react'
import type { Block, Message } from '../../api/types'
import { cn } from '../../lib/cn'
import { count, pretty } from '../../lib/format'
import { Badge, Disclosure } from '../ui'

const LIMIT = 600

// Long text shown in part, with a button for the rest (tool results, messages)
export function Clipped({ text, className }: { text: string; className?: string }) {
  const [all, setAll] = useState(false)
  const long = text.length > LIMIT
  return (
    <div>
      <pre className={cn('code-block', className)}>{long && !all ? `${text.slice(0, LIMIT)}…` : text}</pre>
      {long && (
        <button type="button" onClick={() => setAll(!all)} className="mt-0.5 text-xs text-accent hover:underline">
          {all ? 'Show less' : `Show all ${count(text.length)} characters`}
        </button>
      )}
    </div>
  )
}

export function ContentBlock({ block }: { block: Block }) {
  switch (block.type) {
    case 'text':
      return <Clipped text={(block as { text: string }).text} className="bg-transparent px-0 py-0 text-sm font-sans" />
    case 'tool_use': {
      const b = block as { id: string; name: string; input: unknown }
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge tone="accent">tool request</Badge><code className="font-semibold">{b.name}</code>
            <span className="text-muted">id <code>{b.id}</code></span>
          </div>
          <Clipped text={pretty(b.input)} />
        </div>
      )
    }
    case 'tool_result': {
      const b = block as { tool_use_id: string; content: string | Block[]; is_error?: boolean }
      const text = typeof b.content === 'string' ? b.content : pretty(b.content)
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge tone={b.is_error ? 'bad' : 'ok'}>{b.is_error ? 'tool error' : 'tool result'}</Badge>
            <span className="text-muted">for <code>{b.tool_use_id}</code> · {count(text.length)} characters</span>
          </div>
          <Clipped text={text} />
        </div>
      )
    }
    case 'thinking':
      return (
        <Disclosure className="text-xs" summaryClassName="text-muted" summary="thinking">
          <Clipped text={String((block as { thinking?: string }).thinking ?? '')} />
        </Disclosure>
      )
    default:
      return <Clipped text={pretty(block)} />
  }
}

export function MessageBody({ message }: { message: Message }) {
  if (typeof message.content === 'string') return <ContentBlock block={{ type: 'text', text: message.content }} />
  return <div className="space-y-2">{message.content.map((b, i) => <ContentBlock key={i} block={b} />)}</div>
}
