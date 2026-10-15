// Explains a concept in full the first time it's on screen; after that, an (i) to open it again.
// Only one is in full at a time: the others new on the page wait as an (i) with their name until it is closed.
// Being seen is recorded after a moment on screen, but the full text stays put while you read:
// it shrinks the next time it appears (another conversation, a reload), or when you click ✕.
import * as Popover from '@radix-ui/react-popover'
import { Info, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { cn } from '../lib/cn'
import { usePrefs, useUi } from '../store/ui'
import { useSession } from '../store/session'
import { CONCEPTS, type ConceptKey } from './concepts'
import { Callout, IconButton } from '../components/ui'

// The explanations on the page that are new to you, each with an id in the order they appeared. Only the
// earliest is shown in full; the others wait as an ⓘ with their name, and the next one opens when it is closed.
const useWaiting = create<{ ids: number[] }>(() => ({ ids: [] }))
let nextId = 1

// `quiet`: once explained, leave only a small ⓘ here (for places that repeat, like the timeline)
export function Explain({ concept, className, inline = false, quiet = false }:
  { concept: ConceptKey; className?: string; inline?: boolean; quiet?: boolean }) {
  const learning = usePrefs((s) => s.learningMode)
  const [seenWhenShown] = useState(() => usePrefs.getState().explained.includes(concept))
  const [dismissed, setDismissed] = useState(false)
  const [id] = useState(() => nextId++)
  const isNew = !seenWhenShown && !dismissed
  // Before paint, so a waiting one never flashes in full
  useLayoutEffect(() => {
    if (learning || !isNew) return
    useWaiting.setState((s) => ({ ids: [...s.ids, id].sort((a, b) => a - b) }))
    return () => useWaiting.setState((s) => ({ ids: s.ids.filter((x) => x !== id) }))
  }, [id, isNew, learning])
  const turn = useWaiting((s) => s.ids[0] === id)
  const c = CONCEPTS[concept]
  if (learning || (isNew && turn)) {
    return <ExplainFull concept={concept} className={className} onDismiss={() => setDismissed(true)} />
  }
  // waiting its turn: named, so you can see there is something new to read
  // (a gap after it: two waiting side by side would read as one name)
  if (isNew) return <ExplainIcon concept={concept} className={cn('mr-4', className)} label={c.term} />
  if (quiet) return <ExplainIcon concept={concept} className={className} />
  return <ExplainIcon concept={concept} className={className} label={inline ? undefined : c.term} />
}

function ExplainFull({ concept, className, onDismiss }: { concept: ConceptKey; className?: string; onDismiss: () => void }) {
  const c = CONCEPTS[concept]
  const ref = useRef<HTMLDivElement>(null)
  const mark = usePrefs((s) => s.markExplained)
  const learning = usePrefs((s) => s.learningMode)
  const running = useSession((s) => s.running)

  // Counts as explained once it has been on screen for a few seconds, and not while a reply is
  // running (the view scrolls by itself then, so being on screen doesn't mean it was read)
  useEffect(() => {
    const node = ref.current
    if (!node || learning || running || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) timer = setTimeout(() => mark(concept), 3000)
      else clearTimeout(timer)
    })
    io.observe(node)
    return () => {
      io.disconnect()
      clearTimeout(timer)
    }
  }, [concept, learning, mark, running])

  return (
    <Callout ref={ref} tone="info" className={cn('relative space-y-1.5 pr-8', className)}>
      <div className="flex items-center gap-1 font-medium">
        <Info className="size-3.5 text-muted" aria-hidden /> {c.plain} <span className="font-normal text-muted">({c.term})</span>
      </div>
      {c.long.map((p, i) => <p key={i} className="text-fg/90">{p}</p>)}
      {!learning && (
        <IconButton size="sm" onClick={() => { mark(concept); onDismiss() }} label="Got it, shorten this next time"
          tip="Got it. Next time this is an ⓘ (Help → Show all explanations again brings it back)"
          className="absolute top-0.5 right-0.5 text-muted hover:bg-panel hover:text-fg">
          <X className="size-3.5" />
        </IconButton>
      )}
    </Callout>
  )
}

export function ExplainIcon({ concept, className, label }: { concept: ConceptKey; className?: string; label?: string }) {
  const c = CONCEPTS[concept]
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`What does "${c.term}" mean?`}
          className={cn('-m-[5px] inline-flex items-center gap-1 rounded p-[5px] text-xs text-muted hover:text-accent', className)}>
          <Info className="size-3.5" aria-hidden />
          {label && <span>{label}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} collisionPadding={12}
          className="pop-in z-50 w-80 space-y-1.5 rounded-lg border border-line bg-panel p-3 text-sm shadow-xl">
          <div className="font-medium">{c.plain} <span className="font-normal text-muted">({c.term})</span></div>
          {c.long.map((p, i) => <p key={i}>{p}</p>)}
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => useUi.getState().setHelp(true, `term-${concept}`)}>
            See it in the glossary
          </button>
          <Popover.Arrow className="fill-panel" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
