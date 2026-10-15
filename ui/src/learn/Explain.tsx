// Explains a concept in full the first time it's on screen; after that, an (i) to open it again.
// Only one is in full at a time: the others new on the page wait as an (i) with their name until it is closed.
// Being seen is recorded after a moment on screen, but the full text stays put while you read:
// it shrinks the next time it appears (another conversation, a reload), or when you click ✕.
import * as Popover from '@radix-ui/react-popover'
import { Info, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { cn } from '../lib/cn'
import { usePrefs, useUi } from '../store/ui'
import { useSession } from '../store/session'
import { CONCEPTS, type ConceptKey } from './concepts'
import { Callout, IconButton } from '../components/ui'

// The explanations on the page that are new to you, each with an id in the order they appeared. Only the
// earliest is shown in full; the others wait as an ⓘ with their name, and the next one opens when it is closed.
// `handOff`: the one you just closed with "Got it" (its id): the next one to open takes focus (F427)
const useWaiting = create<{ ids: number[]; handOff: number | null }>(() => ({ ids: [], handOff: null }))
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
  // F427: after "Got it", focus goes to the next explanation that opens; with none waiting, to the ⓘ left here
  const icon = useRef<HTMLButtonElement>(null)
  const [closedHere, setClosedHere] = useState(false)
  useEffect(() => {
    if (!closedHere) return
    const frame = requestAnimationFrame(() => {
      if (useWaiting.getState().handOff !== id) return // the next one took it (or another was closed since)
      useWaiting.setState({ handOff: null })
      icon.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [closedHere, id])
  if (learning || (isNew && turn)) {
    return <ExplainFull concept={concept} className={className} onDismiss={() => {
      useWaiting.setState({ handOff: id })
      setClosedHere(true)
      setDismissed(true)
    }} />
  }
  // waiting its turn: named, so you can see there is something new to read
  // (a gap after it: two waiting side by side would read as one name; and it says so to a screen reader)
  if (isNew) return <ExplainIcon ref={icon} concept={concept} className={cn('mr-4', className)} label={c.term} waiting />
  if (quiet) return <ExplainIcon ref={icon} concept={concept} className={className} />
  return <ExplainIcon ref={icon} concept={concept} className={className} label={inline ? undefined : c.term} />
}

// About how long reading an explanation takes (200 words a minute), and never less than 3 seconds
export function readingTime(concept: ConceptKey) {
  const c = CONCEPTS[concept]
  const words = [c.plain, ...c.long].join(' ').split(/\s+/).filter(Boolean).length
  return Math.max(3000, words * 300)
}

function ExplainFull({ concept, className, onDismiss }: { concept: ConceptKey; className?: string; onDismiss: () => void }) {
  const c = CONCEPTS[concept]
  const ref = useRef<HTMLDivElement>(null)
  const mark = usePrefs((s) => s.markExplained)
  const learning = usePrefs((s) => s.learningMode)
  const running = useSession((s) => s.running)

  // F427: opened because you closed the one before it: take focus, so it is read out where it is
  useEffect(() => {
    if (useWaiting.getState().handOff === null) return
    useWaiting.setState({ handOff: null })
    ref.current?.focus()
  }, [])

  // Counts as explained once it has been on screen long enough to read it (F427: not a flat 3 seconds), and
  // not while a reply is running (the view scrolls by itself then, so being on screen doesn't mean it was read)
  useEffect(() => {
    const node = ref.current
    if (!node || learning || running || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) timer = setTimeout(() => mark(concept), readingTime(concept))
      else clearTimeout(timer)
    })
    io.observe(node)
    return () => {
      io.disconnect()
      clearTimeout(timer)
    }
  }, [concept, learning, mark, running])

  return (
    <Callout ref={ref} tone="info" role="region" aria-label={`Explanation: ${c.plain}`} tabIndex={-1}
      className={cn('relative space-y-1.5 pr-8 outline-none focus-visible:ring-2 focus-visible:ring-accent', className)}>
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

// `waiting`: new to you, waiting until the explanation open above it is closed
export const ExplainIcon = forwardRef<HTMLButtonElement, { concept: ConceptKey; className?: string; label?: string; waiting?: boolean }>(
  function ExplainIcon({ concept, className, label, waiting = false }, ref) {
  const c = CONCEPTS[concept]
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  useImperativeHandle(ref, () => trigger.current!, [])
  // F433: "See it in the glossary" goes away with this popover: Help gives focus back to the ⓘ when it closes
  const toGlossary = useRef(false)
  const glossary = () => {
    toGlossary.current = true
    trigger.current?.focus() // where Help returns focus (it remembers what had focus as it opens)
    useUi.getState().setHelp(true, `term-${concept}`)
    setOpen(false)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button ref={trigger} type="button" aria-label={waiting ? `New, not read yet: what does "${c.term}" mean?` : `What does "${c.term}" mean?`}
          className={cn('-m-[5px] inline-flex items-center gap-1 rounded p-[5px] text-xs text-muted hover:text-accent', className)}>
          <Info className="size-3.5" aria-hidden />
          {label && <span>{label}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} collisionPadding={12}
          // (closing for the glossary: Help has focus now, so don't pull it back to the ⓘ)
          onCloseAutoFocus={(e) => { if (toGlossary.current) { toGlossary.current = false; e.preventDefault() } }}
          className="pop-in z-50 w-80 space-y-1.5 rounded-lg border border-line bg-panel p-3 text-sm shadow-xl">
          <div className="font-medium">{c.plain} <span className="font-normal text-muted">({c.term})</span></div>
          {c.long.map((p, i) => <p key={i}>{p}</p>)}
          <button type="button" className="text-xs text-accent hover:underline" onClick={glossary}>
            See it in the glossary
          </button>
          <Popover.Arrow className="fill-panel" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
})
