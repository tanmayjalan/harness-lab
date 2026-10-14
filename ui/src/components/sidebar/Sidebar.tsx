// Past conversations: newest first, grouped by day, with the setup each one last used.
import { MessageSquare, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ConversationItem } from '../../api/types'
import { cn } from '../../lib/cn'
import { plural, timeAgo } from '../../lib/format'
import { deleteConversation, newConversation, openConversation } from '../../store/selectors'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { usePrefs } from '../../store/ui'
import { Badge, Button, Disclosure, Field, Skeleton, Tip } from '../ui'

const BUSY = 'Available when the current reply finishes (Esc stops it)'

function groupOf(updated: number) {
  const day = new Date(updated * 1000)
  const today = new Date()
  if (day.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return 'Earlier'
}

export function Sidebar({ onPicked }: { onPicked?: () => void }) {
  const conversations = useServer((s) => s.conversations)
  const running = useSession((s) => s.running)
  const [filter, setFilter] = useState('')
  const comparisonsOpen = usePrefs((s) => s.sidebarComparisonsOpen)

  const groups = useMemo(() => {
    const items = (conversations?.items ?? [])
      .filter((c) => c.kind !== 'eval') // eval runs are opened from the Evals screen
      .filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase()))
      .sort((a, b) => b.updated - a.updated)
    const out = new Map<string, ConversationItem[]>()
    for (const c of items.filter((x) => x.kind !== 'compare')) out.set(groupOf(c.updated), [...(out.get(groupOf(c.updated)) ?? []), c])
    return [...out.entries()]
  }, [conversations, filter])
  // F349b: the sides of comparisons fold into one group, so a few comparisons don't bury your own conversations
  const comparisons = useMemo(() => (conversations?.items ?? [])
    .filter((c) => c.kind === 'compare' && c.title.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => b.updated - a.updated), [conversations, filter])

  return (
    <nav aria-label="Conversations" className="flex h-full min-h-0 flex-col bg-sunken">
      <div className="space-y-2 p-2">
        <span className="block" title={running ? 'Available when the current reply finishes (Esc stops it)' : undefined}>
          <Button variant="secondary" className="w-full justify-start" disabled={running}
            onClick={() => { newConversation(); onPicked?.() }}>
            <Plus className="size-4" /> New conversation
          </Button>
        </span>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <Field value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title" aria-label="Filter conversations"
            className="w-full pl-7" />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3">
        {!conversations && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
        {conversations && !groups.length && !comparisons.length && (
          <p className="px-2 text-sm text-muted">{filter ? 'No titles match.' : 'Nothing saved yet. Conversations are saved after each message.'}</p>
        )}
        {groups.map(([label, items]) => (
          <div key={label}>
            <h2 className="px-2 pb-1 text-xs font-semibold text-muted">{label}</h2>
            <ul className="space-y-0.5">
              {items.map((c) => (
                <Item key={c.id} item={c} current={c.id === conversations?.current} disabled={running}
                  onOpen={() => { openConversation(c.id); onPicked?.() }} />
              ))}
            </ul>
          </div>
        ))}
        {comparisons.length > 0 && (
          <Disclosure open={comparisonsOpen} onToggle={(e) => usePrefs.setState({ sidebarComparisonsOpen: e.currentTarget.open })}
            summaryClassName="px-2 pb-1 text-xs font-semibold text-muted" summary={`Comparisons (${comparisons.length})`}>
            <ul className="space-y-0.5">
              {comparisons.map((c) => (
                <Item key={c.id} item={c} current={c.id === conversations?.current} disabled={running}
                  onOpen={() => { openConversation(c.id); onPicked?.() }} />
              ))}
            </ul>
          </Disclosure>
        )}
      </div>
    </nav>
  )
}

function Item({ item, current, disabled, onOpen }: { item: ConversationItem; current: boolean; disabled: boolean; onOpen: () => void }) {
  const [confirm, setConfirm] = useState(false)
  // Armed until you act or leave the button (blur, Esc): a timer is too short for keyboard and screen-reader users

  return (
    <li className={cn('group relative rounded-md', current ? 'bg-panel shadow-sm' : 'hover:bg-panel/60')}>
      <button type="button" disabled={disabled && !current} onClick={() => !current && onOpen()} aria-current={current ? 'true' : undefined}
        title={current ? 'This is the conversation you have open' : disabled ? 'Available when the current reply finishes (Esc stops it)' : undefined}
        className={cn('w-full space-y-0.5 rounded-md border-l-2 border-transparent px-2 py-1.5 pr-8 text-left focus-ring disabled:opacity-60', current && 'cursor-default border-accent')}>
        <div className="flex items-center gap-1.5 text-sm">
          <MessageSquare className={cn('size-3.5 shrink-0', current ? 'text-accent' : 'text-muted')} />
          <span className={cn('truncate', current && 'font-medium')} title={item.title}>{item.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 pl-5 text-xs text-muted">
          <span>{timeAgo(item.updated)}</span>
          <span>· {plural(item.runs ?? Math.ceil(item.messages / 2), 'message')}</span>
          {item.kind === 'compare' && <Badge tone="accent">compare</Badge>}
        </div>
        {item.badge && item.badge.length > 0 && (
          <div className="-mr-6 flex flex-wrap gap-1 pl-5" title={`Settings this conversation last used: ${item.badge.join(', ')}`}>
            {item.badge.map((b) => <Badge key={b} className="px-1.5">{b}</Badge>)}
          </div>
        )}
      </button>
      {/* The reason sits on a wrapper: a disabled button gets no pointer events, so its own tooltip never shows.
          Armed, the bin stays where you clicked it; "Delete? Click again" hangs under it (part of the button, so a
          click on it counts), over the row's second line, so it never covers the title */}
      <Tip text={disabled ? BUSY : confirm ? 'Click again to delete it (Undo comes up afterwards)' : 'Delete'}>
        <span className="absolute top-1 right-1" title={disabled ? BUSY : undefined}>
          <span className="sr-only" role="status">{confirm ? 'Press again to delete' : ''}</span>
          <button type="button" disabled={disabled} onBlur={() => setConfirm(false)}
            onKeyDown={(e) => { if (e.key === 'Escape' && confirm) { e.stopPropagation(); setConfirm(false) } }}
            aria-label={confirm ? `Confirm delete ${item.title}` : `Delete ${item.title}`}
            onClick={() => (confirm
              // the row is gone afterwards: keyboard focus goes to the top of the list, not to the page
              ? void deleteConversation(item.id).then(() => document.querySelector<HTMLButtonElement>('nav[aria-label="Conversations"] button')?.focus())
              : setConfirm(true))}
            className={cn('relative flex items-center gap-1 rounded p-1.5 text-xs transition focus-ring disabled:pointer-events-none',
              confirm ? 'bg-bad text-on-accent' : 'text-muted hover:bg-bad-soft hover:text-bad')}>
            <Trash2 className="size-3.5" />
            {confirm && <span className="absolute top-full right-0 z-10 mt-0.5 rounded bg-bad px-1.5 whitespace-nowrap text-on-accent">Delete? Click again</span>}
          </button>
        </span>
      </Tip>
    </li>
  )
}
