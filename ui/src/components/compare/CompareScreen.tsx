// Same message, different setups, side by side: what changed, what each did, and what it cost.
import { ArrowLeftRight, Play, Plus } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { plural } from '../../lib/format'
import { PRESETS, useCompare } from '../../store/compare'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { paidNote } from '../composer/providerWords'
import { ExplainIcon } from '../../learn/Explain'
import { Button, Chip, Select, Spinner, TextArea } from '../ui'
import { AskFirstNote } from './AskFirstNote'
import { PastComparisons } from './PastComparisons'
import { Results } from './Results'
import { SideConfig } from './SideConfig'
import { Waiting } from './Waiting'

export function CompareScreen() {
  const draft = useUi((s) => s.compareDraft)
  const c = useCompare()
  const info = useServer((s) => s.info)
  const current = useSession((s) => s.provider) ?? info?.provider ?? 'mock'
  const currentModel = useSession((s) => s.model) || info?.model || ''
  const form = useRef<HTMLDivElement>(null)
  const question = useRef<HTMLTextAreaElement>(null)
  // The question came from a conversation: the messages before it won't be sent (F269)
  const [afterHistory, setAfterHistory] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  // Where focus goes once the button you pressed is gone: a new side's name, or "Add a side" after a remove.
  // A new object per press, so the effect runs once for each press and nothing has to be reset
  const [focusAfter, setFocusAfter] = useState<null | { to: 'added' | 'removed' }>(null)
  useEffect(() => {
    if (focusAfter?.to === 'added') {
      const sides = useCompare.getState().sides
      document.querySelector<HTMLInputElement>(`[data-side="${sides[sides.length - 1]?.id}"] input[data-side-name]`)?.focus()
    }
    if (focusAfter?.to === 'removed') addButton.current?.focus()
  }, [focusAfter])

  useEffect(() => { void useCompare.getState().loadHistory() }, [])

  // A question from the chat says whether messages came before it
  const [seenDraft, setSeenDraft] = useState<typeof draft>(null)
  if (draft?.text && draft !== seenDraft) {
    setSeenDraft(draft)
    setAfterHistory(!!draft.afterHistory)
  }

  // "Compare this question" from the chat: side A is the model you were using, side B one change away
  useEffect(() => {
    if (!draft?.text) return
    const p = info?.providers.find((x) => x.name === current)
    const models = p?.models ?? [p?.model ?? currentModel]
    const other = models.find((m) => m !== currentModel)
    // A fresh comparison of two sides: an older third side or per-side changes don't carry over (F257)
    useCompare.getState().startFromChat(draft.text, { provider: current, model: currentModel }, other
      ? { provider: current, model: other }
      : { provider: current, model: currentModel, thinking: p?.thinking === 'adaptive' ? { effort: 'high' } : { budget: 4000 } })
    useUi.setState({ compareDraft: null })
    form.current?.scrollIntoView?.({ block: 'start' })
    question.current?.focus()
  }, [draft, info, current, currentModel])

  // Start both sides on the provider in use
  useEffect(() => {
    const st = useCompare.getState()
    if (!st.results && st.sides.every((s) => s.provider === 'mock') && current !== 'mock') {
      st.sides.forEach((_, i) => st.setSide(i, { provider: current }))
    }
  }, [current])

  const conversations = c.sides.length * c.repeat
  const paid = paidNote([...new Set(c.sides.map((s) => s.provider))].map((name) => ({
    name, conversations: c.sides.filter((s) => s.provider === name).length * c.repeat })), info?.providers)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><ArrowLeftRight className="size-5 text-accent" /> Compare <ExplainIcon concept="compare_side" /></h1>
          <p className="text-sm text-muted">
            Ask the same question with two or three setups at once, each in a fresh conversation, and see what changes.
            Your saved settings stay as they are. To send a past message again with your current settings, use
            <b> Re-run with current settings</b> under it in the chat. To score a setup on a fixed set of questions, use{' '}
            <button type="button" className="text-accent underline" onClick={() => useUi.getState().setScreen('evals')}>Evals</button>.
          </p>
        </div>

        {c.busy && <Waiting onStop={() => void c.stop()} />}
        {c.results && <Results previous={!!c.busy} onChange={() => form.current?.scrollIntoView?.({ block: 'start' })} />}

        {c.busy !== 'rerun' && (
          <div ref={form} className="space-y-6">
            <section className="space-y-2">
              <div className="text-sm font-medium">Start from a ready-made comparison</div>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => {
                  const unusable = !!p.needs && current === 'mock'
                  // F373: reachable with Tab, the reason as its description, and a click does nothing
                  const why = unusable ? `Needs ${p.needs}: the mock can't show this` : c.busy ? 'Available when the comparison finishes' : null
                  return (
                    <Fragment key={p.id}>
                    <Chip as="button" aria-disabled={why ? true : undefined} aria-describedby={why ? `why-preset-${p.id}` : undefined}
                      onClick={() => { if (!why) c.applyPreset(p, current) }}
                      title={why ?? p.lookFor} selected={c.preset?.id === p.id}
                      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-line aria-disabled:hover:text-fg">
                      {p.title}{p.needs && <span className="text-2xs text-muted">(not on the mock)</span>}
                    </Chip>
                    {why && <span id={`why-preset-${p.id}`} className="sr-only">{why}</span>}
                    </Fragment>
                  )
                })}
              </div>
              {c.lookFor && <p className="text-sm text-muted"><b className="text-fg">Look for:</b> {c.lookFor}</p>}
            </section>
            <section className="space-y-2 rounded-xl border border-line bg-panel p-4">
              <label className="block space-y-1">
                <span className="text-sm font-medium">Question</span>
                <TextArea ref={question} value={c.text} onChange={(e) => { c.setText(e.target.value); setAfterHistory(false) }} rows={2} aria-label="Question"
                  placeholder="e.g. What's the weather in Paris, in Fahrenheit?" className="text-base" />
              </label>
              {afterHistory && (
                <p className="text-xs text-muted">
                  Each side starts a fresh conversation with this question: the messages before it in the conversation aren't sent.
                </p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.includeProfile} onChange={(e) => c.setIncludeProfile(e.target.checked)} />
                Include the facts about you that are ticked in Settings → Memory
              </label>
            </section>
            <div className={cn('grid gap-4', c.sides.length === 3 ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2')}>
              {c.sides.map((s, i) => <SideConfig key={s.id} index={i} side={s} onRemove={() => setFocusAfter({ to: 'removed' })} />)}
            </div>
            <AskFirstNote />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm" title="Models vary from run to run: several runs show the typical result and how much it varies">
                Runs per side
                <Select value={c.repeat} onChange={(e) => c.setRepeat(Number(e.target.value))} disabled={!!c.busy} aria-label="Runs per side">
                  {[1, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </label>
              <Button variant="primary" data-run-button onClick={() => c.run()} disabled={!c.text.trim() || !!c.busy}>
                {c.busy ? <Spinner /> : <Play className="size-4" />} {c.busy ? 'Running…' : c.sides.length === 2 ? 'Run both' : `Run all ${c.sides.length}`}
              </Button>
              {c.sides.length < 3 && (
                <Button ref={addButton} onClick={() => { c.addSide(); setFocusAfter({ to: 'added' }) }} disabled={!!c.busy}><Plus className="size-4" /> Add a side</Button>
              )}
              <span className="text-xs text-muted">
                {plural(c.sides.length, 'side')} × {plural(c.repeat, 'run')} = {plural(conversations, 'conversation')}, each with real
                model calls.
              </span>
              {paid && <span className="text-xs text-warn">{paid}</span>}
            </div>
          </div>
        )}

        <PastComparisons />
      </div>
    </div>
  )
}
