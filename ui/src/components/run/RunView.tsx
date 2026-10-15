// The centre: the conversation as a timeline, and the composer (or the approval) at the bottom.
import { ArrowDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Run } from '../../model/derive'
import { useInspectedCallId } from '../../store/selectors'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { say, useUi } from '../../store/ui'
import { useCompare } from '../../store/compare'
import { useEvals } from '../../store/evals'
import { Composer, type ComposerHandle } from '../composer/Composer'
import { ApprovalDock } from '../composer/ApprovalDock'
import { Button, Callout, Skeleton } from '../ui'
import { EmptyState } from './EmptyState'
import { ExperimentChanges, ExperimentHeader, ExperimentNow, ExperimentReveal, revealWords } from './ExperimentPanels'
import { stopWords } from '../../lib/stopWords'
import { Timeline } from './Timeline'

const nearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 120

export function RunView({ composerRef, onRerun, onRewind }:
  { composerRef: React.RefObject<ComposerHandle | null>; onRerun?: (run: Run) => void; onRewind?: (run: Run) => void }) {
  const model = useSession((s) => s.derived)
  const live = useSession((s) => s.live)
  const running = useSession((s) => s.running)
  const loaded = useSession((s) => s.loaded)
  const conversation = useSession((s) => s.conversation)
  const frozen = useSession((s) => s.frozen)
  // (the server keeps the start until the next message; once you switch back, it no longer applies)
  const keepsStart = useServer((s) => s.settings?.apply === 'conversation')
  const origin = useSession((s) => s.origin)
  const inspected = useInspectedCallId()
  const scroller = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const stick = useRef(true)
  // F405: an empty conversation (or one still loading) never sticks to the bottom: its page grows as it
  // loads, and following that growth would hide the heading
  const hasRuns = useRef(false)
  hasRuns.current = loaded && model.runs.length > 0

  // Is there anything below what you can see? Checked after every change, not only when you
  // scroll: content can shrink (the empty screen giving way to a short reply) without a scroll
  const measure = () => {
    const el = scroller.current
    if (!el) return
    const b = nearBottom(el)
    if (b && hasRuns.current) stick.current = true
    setAtBottom(b)
  }

  // Follow new content while you're at the bottom; leave you alone if you scrolled up to read
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current && hasRuns.current) el.scrollTop = el.scrollHeight
    measure()
  }, [model, live])

  // Sending a message, or opening another conversation, goes to the newest message
  // (an empty conversation starts at the top, so you see the heading and the experiments)
  const runs = model.runs.length
  useLayoutEffect(() => {
    stick.current = runs > 0
    const el = scroller.current
    if (el) el.scrollTop = runs > 0 ? el.scrollHeight : 0
    measure()
  }, [conversation, runs, loaded])

  // Content can also change size by itself (an explanation closing, a tool row opening)
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      // Opening a tool row makes the chat taller: stay where you are rather than jump to the bottom
      if (useUi.getState().keepScroll) {
        useUi.getState().setKeepScroll(false)
        stick.current = false
      }
      if (stick.current && hasRuns.current) el.scrollTop = el.scrollHeight
      measure()
    })
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [])

  const pending = model.pendingApproval
  const pendingRow = pending?.toolId ? model.tools[pending.toolId] : undefined
  // When the approval panel goes, put focus back in the message box and say what happened
  const lastPending = useRef<string | null>(null)
  useEffect(() => {
    if (pending) {
      lastPending.current = pending.id
      return
    }
    const was = lastPending.current
    if (!was) return
    lastPending.current = null
    const decision = Object.values(model.tools).find((r) => r.approval?.id === was)?.approval?.decision
    if (decision === undefined) return // gone without an answer (lost contact, another conversation): say nothing
    say(decision ? 'Allowed. The harness runs the tool.' : 'Declined. The harness carries on.')
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus()
  }, [pending, model])
  // F324: a reply that arrives while you watch is read out, with how many calls it took. Only for a message
  // seen running in this visit: opening a conversation full of answers says nothing
  const watched = useRef(new Set<string>())
  const last = model.runs[model.runs.length - 1]
  if (running) watched.current.add(`${conversation}:${last && last.outcome === 'running' ? last.index : model.runs.length + 1}`)
  // F428: and so is a message that stops (Stop, or the call limit), with an experiment's reveal in the same
  // sentence (two in a row would cut each other off). A failure only while the chat is hidden under the narrow
  // Inspect view; otherwise its own alert reads it out. All of it through the page's Announcer (say()), which
  // is outside the chat, so it is heard while the chat is hidden too
  const said = useRef(new Set<string>())
  useEffect(() => {
    if (!last || last.outcome === 'running') return
    const key = `${conversation}:${last.index}`
    if (!watched.current.has(key) || said.current.has(key)) return
    said.current.add(key)
    const n = last.callIds.length
    const limit = (last.errorDetail ?? last.error ?? '').match(/hit max_turns \((\d+)\)/)
    const what = last.answer ? `Reply received (${n} ${n === 1 ? 'call' : 'calls'}).`
      : last.outcome === 'stopped' ? 'Stopped. The conversation so far is kept.'
        : limit ? `Stopped: this message reached the limit of ${limit[1]} model calls. The conversation so far is kept.`
          : scroller.current?.closest('[inert]') ? `The model call failed. ${last.error ?? ''}` : ''
    const text = `${what} ${revealWords(model)}`.trim()
    if (text) say(text)
  }, [last, conversation])
  // F428: while it runs, say each call as it comes back ("Call 1: asked for 2 tools"), so the wait isn't silent.
  // Not the one that finishes: "Reply received" says that
  const callsBack = useRef(new Set<string>())
  useEffect(() => {
    if (!running || !last || last.outcome !== 'running') return
    if (!watched.current.has(`${conversation}:${last.index}`)) return
    for (const id of last.callIds) {
      const c = model.calls[id]
      const seen = `${conversation}:${id}` // (call ids start again in each conversation)
      if (!c || callsBack.current.has(seen) || (!c.stopReason && !c.failed)) continue
      callsBack.current.add(seen)
      const asked = (c.response?.content ?? []).filter((b) => b.type === 'tool_use').length
      if (c.stopReason === 'tool_use') say(`Call ${c.turn}: ${stopWords(c.stopReason, Math.max(asked, c.toolIds.length))}.`)
    }
    // the reply starting to stream in (once per message: the text itself isn't read out as it grows)
    const writing = `${conversation}:${last.index}:writing`
    if (live && !callsBack.current.has(writing)) {
      callsBack.current.add(writing)
      say('The model is writing its reply.')
    }
  }, [model, running, last, conversation, live])
  const empty = loaded && model.runs.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const b = nearBottom(e.currentTarget)
          stick.current = b && hasRuns.current
          setAtBottom(b)
        }}>
        <div className="mx-auto max-w-3xl px-4 py-6">
          {!loaded ? (
            <div className="space-y-4">
              <Skeleton className="ml-auto h-10 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-24 w-5/6" />
            </div>
          ) : empty ? (
            <><ExperimentHeader model={model} /><EmptyState disabled={running} /></>
          ) : (
            <>
            <h1 className="sr-only">Conversation</h1>
            <ExperimentHeader model={model} />
            {origin && (
              <Callout tone="info" className="mb-3 flex items-center gap-2 py-1.5">
                <span className="flex-1">
                  {origin.kind === 'eval'
                    ? `Run ${origin.attempt} of the eval question “${origin.question}”`
                    : origin.kind === 'rerun' ? 'The re-run with your current settings' : `Side ${origin.side} of a comparison`}, opened so you can inspect every call.
                </span>
                {origin.kind === 'eval' ? (
                  <button type="button" className="text-accent hover:underline" onClick={() => {
                    useUi.getState().setScreen('evals')
                    // this button is gone once Evals shows: focus goes to the round's result, not the page
                    void useEvals.getState().view(origin.round).then(() => useEvals.setState({ focusResults: true }))
                  }}>Back to Evals</button>
                ) : (
                  <button type="button" className="text-accent hover:underline" onClick={() => {
                    useUi.getState().setScreen('compare')
                    const shown = useCompare.getState().results
                    if (shown?.id !== origin.comparison) void useCompare.getState().openPast(origin.comparison)
                  }}>Back to Compare</button>
                )}
              </Callout>
            )}
            {frozen && keepsStart && (
              <p className="mb-3 rounded-md border border-line bg-sunken px-3 py-1.5 text-xs text-muted">
                This conversation keeps the prompt, the tool descriptions and the facts about you it began with (Settings → Model →
                "From your next conversation"). Edits you have made since apply to new conversations.
              </p>
            )}
            <Timeline model={model} inspectedCallId={inspected} live={live} running={running} onRerun={onRerun} onRewind={onRewind}
              onCompare={(run) => useUi.getState().startCompare({ text: run.text, afterHistory: run.index > 1 })} />
            <ExperimentReveal model={model} />
            </>
          )}
        </div>
      </div>
      {/* F429: at 200% zoom the guess, the hints and the box could leave the chat a sliver: this area takes at most
          a little over half the height and scrolls itself beyond that ("Jump to latest" sits above it, unclipped) */}
      <div className="relative flex max-h-[55%] shrink-0 flex-col px-4 pt-2 pb-3">
        {!atBottom && !empty && (
          <Button size="sm" className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full shadow-md"
            onClick={() => {
              const el = scroller.current
              // a jump, not a glide, when you asked for less motion (CSS can't reach a scroll started here)
              const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: still ? 'auto' : 'smooth' })
              stick.current = true
            }}>
            <ArrowDown className="size-3.5" /> Jump to latest
          </Button>
        )}
        <div className="mx-auto min-h-0 w-full max-w-3xl overflow-y-auto px-1 py-0.5">
          {!pending && <><ExperimentChanges /><ExperimentNow model={model} /></>}
          {pending && <ApprovalDock key={pending.id} approval={pending} row={pendingRow} />}
          {/* kept mounted under the approval so a half-typed message survives */}
          <div hidden={!!pending}><Composer ref={composerRef} /></div>
        </div>
      </div>
    </div>
  )
}
