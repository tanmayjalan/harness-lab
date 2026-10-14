// Explains a concept in full the first time it's on screen; after that, an (i) to open it again.
// Being seen is recorded after a moment on screen, but the full text stays put while you read:
// it shrinks the next time it appears (another conversation, a reload), or when you click ✕.
import * as Popover from '@radix-ui/react-popover'
import { Info, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { cn } from '../lib/cn'
import { usePrefs, useUi } from '../store/ui'
import { useSession } from '../store/session'
import { CONCEPTS, type ConceptKey } from './concepts'
import { Button, Callout, IconButton } from '../components/ui'

// The full explanations on the page now (an id for each, so the same idea twice counts twice), and a counter
// that "Shrink all explanations" bumps: every full one on the page at that moment shrinks (F326b)
const useShown = create<{ full: Record<number, ConceptKey>; shrink: number }>(() => ({ full: {}, shrink: 0 }))
let nextShown = 1

// `quiet`: once explained, leave only a small ⓘ here (for places that repeat, like the timeline)
export function Explain({ concept, className, inline = false, quiet = false }:
  { concept: ConceptKey; className?: string; inline?: boolean; quiet?: boolean }) {
  const learning = usePrefs((s) => s.learningMode)
  const [seenWhenShown] = useState(() => usePrefs.getState().explained.includes(concept))
  const [dismissed, setDismissed] = useState(false)
  const c = CONCEPTS[concept]
  if (learning || (!seenWhenShown && !dismissed)) {
    return <ExplainFull concept={concept} className={className} onDismiss={() => setDismissed(true)} />
  }
  if (quiet) return <ExplainIcon concept={concept} className={className} />
  return <ExplainIcon concept={concept} className={className} label={inline ? undefined : c.term} />
}

function ExplainFull({ concept, className, onDismiss }: { concept: ConceptKey; className?: string; onDismiss: () => void }) {
  const c = CONCEPTS[concept]
  const ref = useRef<HTMLDivElement>(null)
  const mark = usePrefs((s) => s.markExplained)
  const learning = usePrefs((s) => s.learningMode)
  const running = useSession((s) => s.running)

  // On the page as a full explanation (not in learning mode, where nothing shrinks)
  useEffect(() => {
    if (learning) return
    const id = nextShown++
    useShown.setState((s) => ({ full: { ...s.full, [id]: concept } }))
    return () => useShown.setState((s) => {
      const full = { ...s.full }
      delete full[id]
      return { full }
    })
  }, [concept, learning])
  const shrink = useShown((s) => s.shrink)
  const shrinkWhenShown = useRef(shrink)
  useEffect(() => {
    if (shrink !== shrinkWhenShown.current) onDismiss()
  }, [shrink, onDismiss])

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
      <div className="flex items-center gap-1 font-medium text-accent">
        <Info className="size-3.5" aria-hidden /> {c.plain} <span className="font-normal text-muted">({c.term})</span>
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

// At the top of a conversation with two or more full explanations: shrink them all at once, the opposite of
// "Show all explanations again once" (F326b). The ideas count as explained, so they come back as ⓘ next time too.
export function ShrinkAllExplanations() {
  const learning = usePrefs((s) => s.learningMode)
  const shown = useShown((s) => Object.keys(s.full).length)
  if (learning || shown < 2) return null
  return (
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" className="text-muted" onClick={() => {
        const mark = usePrefs.getState().markExplained
        new Set(Object.values(useShown.getState().full)).forEach((c) => mark(c))
        useShown.setState((s) => ({ shrink: s.shrink + 1 }))
      }}>
        Shrink all explanations
      </Button>
    </div>
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
