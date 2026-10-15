// Same message, different setups, side by side: what changed, what each did, and what it cost.
import { ArrowDown, ArrowLeftRight, ArrowUp, Ban, ChevronDown, Download, History, Info, Play, Plus, RotateCcw, Search, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { CompareSide, Effort, Rule, RunStats, Spread } from '../../api/types'
import { cn } from '../../lib/cn'
import { downloadJson } from '../../lib/download'
import { undoToast } from '../../lib/undoToast'
import { approx, cost as costText, dollars, ESTIMATE_TITLE, plural, seconds, shortArgs, timeAgo, tokens, tokensOut } from '../../lib/format'
import { configDiff, thinkingWords } from '../../model/configDiff'
import { isMcpTool, RULES } from '../../model/permission'
import { PRESETS, useCompare, type SideSpec } from '../../store/compare'
import { openConversation, switchProvider } from '../../store/selectors'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { toast, useUi } from '../../store/ui'
import { modelsOf, paidNote, providerName, toolsTag, unusable } from '../composer/providerWords'
import { ExplainIcon } from '../../learn/Explain'
import { Markdown } from '../Markdown'
import { Badge, Button, Callout, Chip, Disclosure, Field, IconButton, RunningBanner, SectionLabel, Select, Spinner, Stat, TextArea } from '../ui'

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
  // Where focus goes once the button you pressed is gone: a new side's name, or "Add a side" after a remove
  const [focusAfter, setFocusAfter] = useState<null | 'added' | 'removed'>(null)
  const lastSide = c.sides[c.sides.length - 1]?.id
  useEffect(() => {
    if (focusAfter === 'added') document.querySelector<HTMLInputElement>(`[data-side="${lastSide}"] input[data-side-name]`)?.focus()
    if (focusAfter === 'removed') addButton.current?.focus()
    if (focusAfter) setFocusAfter(null)
  }, [focusAfter, lastSide])

  useEffect(() => { void useCompare.getState().loadHistory() }, [])

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
    setAfterHistory(!!draft.afterHistory)
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
        {c.results && <Results previous={!!c.busy} onChange={() => form.current?.scrollIntoView({ block: 'start' })} />}

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
              {c.sides.map((s, i) => <SideConfig key={s.id} index={i} side={s} onRemove={() => setFocusAfter('removed')} />)}
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
                <Button ref={addButton} onClick={() => { c.addSide(); setFocusAfter('added') }} disabled={!!c.busy}><Plus className="size-4" /> Add a side</Button>
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

// While a comparison runs: how long so far, how far each side has got, and a Stop
function Waiting({ onStop }: { onStop?: () => void }) {
  const { busyText, progress, repeatRunning, startedAt } = useCompare()
  // With several runs per side, about how long is left (the slowest side sets the pace)
  const done = progress?.length ? Math.min(...progress.map((p) => p.done)) : 0
  const left = (so: number) => (repeatRunning > 1 && done > 0 && done < repeatRunning ? (so / done) * (repeatRunning - done) : null)
  return (
    <RunningBanner text={busyText} startedAt={startedAt ? startedAt / 1000 : null} left={left} onStop={onStop}
      stopTitle="Each run stops at its next step, and no side starts another">
      {progress && repeatRunning > 1 && (
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {progress.map((p) => <span key={p.label}>{p.label}: {p.done} of {repeatRunning} runs done</span>)}
        </div>
      )}
    </RunningBanner>
  )
}

function PastComparisons() {
  const history = useCompare((s) => s.history)
  const openPast = useCompare((s) => s.openPast)
  if (!history.length) return null
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold"><History className="size-4 text-muted" /> Past comparisons</h2>
      <ul className="divide-y divide-line rounded-lg border border-line bg-panel text-sm">
        {history.slice(0, 20).map((h) => (
          <li key={h.id} className="flex items-center gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">“{h.text}”</span>
            <span className="min-w-0 max-w-[45%] truncate text-xs text-muted" title={h.sides.join(' vs ')}>{h.sides.join(' vs ')}</span>
            <span className="shrink-0 text-xs text-muted">{h.repeat > 1 && `${h.repeat} runs · `}{timeAgo(h.time)}</span>
            <Button size="sm" variant="ghost" aria-label={`Open “${h.text}”`} onClick={() => void openPast(h.id)}>Open</Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const LETTERS = 'ABC'

// What a side changes, in words, for its folded card
function changesInWords(side: SideSpec): string[] {
  const out: string[] = []
  if (side.system.trim()) out.push('own system prompt')
  for (const [name, rule] of Object.entries(side.permissions)) out.push(`${name}: ${RULES[rule].label}`)
  if (side.thinking !== undefined) {
    out.push(side.thinking === 'off' ? 'thinking off' : 'effort' in side.thinking ? `thinking effort ${side.thinking.effort}` : `thinking ${side.thinking.budget / 1000}k`)
  }
  if (side.cache !== undefined) out.push(side.cache ? 'caching on' : 'caching off')
  return [...out, ...presetOnlyWords(side)]
}

// What only a preset can set: the side's panel has no control for these (F349g)
function presetOnlyWords(side: SideSpec): string[] {
  const out: string[] = []
  if (side.toolsAtOnce !== undefined) out.push(side.toolsAtOnce ? 'tools at once' : 'tools one by one')
  if (side.busy !== undefined) out.push(side.busy ? 'practice: busy service' : 'practice switch off')
  if (side.workflow !== undefined) out.push(side.workflow ? 'workflow' : 'one agent')
  if (side.runCode !== undefined) out.push(side.runCode ? 'run code on' : 'run code off')
  if (side.extraTools !== undefined) {
    out.push(side.extraTools === 'off' ? 'no extra tools' : side.extraTools === 'all' ? '40 tools, all sent' : '40 tools, found on demand')
  }
  if (side.skills !== undefined) out.push(!side.skills.enabled ? 'skills off' : side.skills.mode === 'all_in_prompt' ? 'skills all in the prompt' : 'skills on demand')
  return out
}

// A side's round letter, the name progress, deltas and toasts use for it
function SideLetter({ letter }: { letter: string }) {
  return <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{letter}</span>
}

function SideConfig({ index, side, onRemove }: { index: number; side: SideSpec; onRemove: () => void }) {
  const info = useServer((s) => s.info)
  const settings = useServer((s) => s.settings)
  const c = useCompare()
  const changes = changesInWords(side)
  // what the preset set that this panel has no control for (F349g)
  const fromPreset = presetOnlyWords(side)
  // On an empty setup, open side B: it is the one you would change
  const [open, setOpen] = useState(() => index === 1 && !c.preset && changes.length === 0)
  const style = info?.providers.find((p) => p.name === side.provider)?.thinking ?? 'budget'
  const savedThinking = !settings?.thinking.enabled ? 'off'
    : style === 'adaptive' ? `effort ${settings.thinking.effort ?? 'medium'}` : `${settings.thinking.budget / 1000}k tokens`
  const thinkingValue = side.thinking === undefined ? 'saved' : side.thinking === 'off' ? 'off'
    : 'effort' in side.thinking ? `e:${side.thinking.effort}` : `b:${side.thinking.budget}`
  const savedRule = (name: string) => settings?.tools.find((t) => t.name === name)?.permission ?? 'allow'

  return (
    <section data-side={side.id} className="space-y-3 rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <SideLetter letter={LETTERS[index]} />
        <Field data-side-name value={side.label} onChange={(e) => c.setSide(index, { label: e.target.value })} placeholder={`Side ${LETTERS[index]} (name it, optional)`}
          aria-label={`Name of side ${LETTERS[index]}`} className="min-w-0 flex-1 font-medium" />
        {c.sides.length > 2 && (
          <IconButton size="sm" label={`Remove side ${LETTERS[index]}`} onClick={() => {
            const gone = side
            c.removeSide(index)
            onRemove()
            undoToast(`Removed side ${LETTERS[index]}`, () => useCompare.getState().insertSide(index, gone))
          }}
            className="text-muted hover:text-fg"><X className="size-4" /></IconButton>
        )}
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Provider and model</span>
        <Select value={`${side.provider}/${side.model || info?.providers.find((p) => p.name === side.provider)?.model}`}
          onChange={(e) => {
            const [provider, ...rest] = e.target.value.split('/')
            c.setSide(index, { provider, model: rest.join('/') })
          }}
          className="w-full">
          {info?.providers.flatMap((p) => modelsOf(p).map((m) => (
            <option key={`${p.name}/${m}`} value={`${p.name}/${m}`} disabled={!!unusable(p)}>
              {providerName(info.providers, p.name)} · {m}{toolsTag(p, m)}{p.missing_key ? ` (needs ${p.missing_key})` : p.problem ? ' (not ready)' : ''}
            </option>
          )))}
        </Select>
      </label>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-start gap-1.5 text-left text-sm text-accent hover:underline">
        <ChevronDown className={cn('mt-0.5 size-4 shrink-0 transition-transform', !open && '-rotate-90')} />
        <span>
          Changes for this side only{' '}
          {changes.length > 0 ? <span className="text-warn">({changes.join(' · ')})</span> : <span className="text-muted">(none: your saved settings)</span>}
        </span>
      </button>
      {open && (
        <div className="space-y-3">
          {fromPreset.length > 0 && (
            <p className="text-2xs text-muted">Set by the preset: {fromPreset.join(', ')}. Pick another preset to clear it.</p>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-muted">System prompt (leave empty to use your saved one)</span>
            <TextArea value={side.system} onChange={(e) => c.setSide(index, { system: e.target.value })} rows={4}
              placeholder={settings?.system.slice(0, 200)} className="font-mono text-xs" />
          </label>
          <div className="space-y-1 text-sm">
            <span className="text-muted">Permissions</span>
            <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {settings?.tools.map((t) => {
                const rule = side.permissions[t.name] ?? savedRule(t.name)
                return (
                  <li key={t.name} className="flex items-center gap-2 px-2 py-1">
                    <code className="min-w-0 flex-1 truncate text-xs" title={t.name}>{t.name}</code>
                    <Select size="sm" value={rule} aria-label={`Permission for ${t.name} on side ${LETTERS[index]}${side.permissions[t.name] ? ' (changed)' : ''}`}
                      onChange={(e) => {
                        const next = { ...side.permissions }
                        if (e.target.value === savedRule(t.name)) delete next[t.name]
                        else next[t.name] = e.target.value as Rule
                        c.setSide(index, { permissions: next })
                      }}
                      className={cn('px-1 text-xs', side.permissions[t.name] && 'border-warn text-warn')}>
                      {(['allow', 'ask', 'block'] as Rule[]).map((r) => <option key={r} value={r}>{RULES[r].label}</option>)}
                    </Select>
                    {side.permissions[t.name] && <span className="text-xs text-warn">changed</span>}
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-muted">
              Nobody can be asked during a comparison, so a tool set to "Ask first" isn't run, unless you tick "Let Ask-first
              tools run" (shown below the sides when a tool is set to Ask first).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span className="text-muted">Thinking</span>
              <Select value={thinkingValue}
                onChange={(e) => {
                  const v = e.target.value
                  c.setSide(index, { thinking: v === 'saved' ? undefined : v === 'off' ? 'off'
                    : v.startsWith('e:') ? { effort: v.slice(2) as Effort } : { budget: Number(v.slice(2)) } })
                }}
                className={cn('w-full', side.thinking !== undefined && 'border-warn text-warn')}>
                <option value="saved">As saved ({savedThinking})</option>
                <option value="off">{style === 'adaptive' ? 'Default' : 'Off'}</option>
                {style === 'adaptive'
                  ? (['low', 'medium', 'high', 'xhigh', 'max'] as Effort[]).map((x) => <option key={x} value={`e:${x}`}>Effort {x}</option>)
                  : [2000, 4000, 8000, 12000].map((b) => <option key={b} value={`b:${b}`}>On, {b / 1000}k tokens</option>)}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-muted">Prompt caching</span>
              <Select value={side.cache === undefined ? 'saved' : side.cache ? 'on' : 'off'}
                onChange={(e) => c.setSide(index, { cache: e.target.value === 'saved' ? undefined : e.target.value === 'on' })}
                className={cn('w-full', side.cache !== undefined && 'border-warn text-warn')}>
                <option value="saved">As saved ({settings?.cache.enabled ? 'on' : 'off'})</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </Select>
            </label>
          </div>
        </div>
      )}
    </section>
  )
}

function Results({ previous, onChange }: { previous: boolean; onChange: () => void }) {
  const results = useCompare((s) => s.results)!
  const sides = results.sides
  const base = sides[0]
  const diffs = sides.slice(1).map((s) => configDiff(base.config, s.config))
  const heading = useRef<HTMLHeadingElement>(null)
  // New results: put them in front of you, unless you're typing somewhere (focus on the page itself,
  // the Run button or the results themselves is fair game)
  useEffect(() => {
    if (previous) return
    const at = document.activeElement
    const free = !at || at === document.body || (at as HTMLElement).dataset?.runButton !== undefined
      || !!heading.current?.closest('section')?.contains(at)
    if (free) heading.current?.focus()
  }, [results, previous])
  // Tools the new run of a re-run couldn't use: set to Ask first (nobody can be asked, but you can let them
  // run), or set to Block now (a setting to change, not something to retry)
  const rerun = results.kind === 'rerun'
  const ruleNow = (name: string) => sides[1]?.config?.tools?.find((t) => t.name === name)?.permission
  const refused = rerun ? [...new Set(sides[1].tools.filter((t) => t.blocked && ['blocked', 'unattended'].includes(t.outcome ?? 'blocked')).map((t) => t.name))] : []
  const askFirst = refused.filter((n) => ruleNow(n) === 'ask')
  const blockNow = refused.filter((n) => ruleNow(n) === 'block')
  const allowedBefore = askFirst.filter((n) => base.approved?.includes(n))
  // F389: the re-run lets through every tool set to Ask first that it offers, not only the ones refused last time
  const letThroughNow = rerun ? (sides[1]?.config?.tools ?? []).filter((t) => t.permission === 'ask').map((t) => t.name) : []
  const anyBlocked = sides.some((s) => s.tools.some((t) => t.blocked))
  const unrecorded = sides.some((s) => !s.config)
  const both = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]
  return (
    <section className={cn('space-y-4', previous && 'rounded-xl border border-dashed border-line-strong p-3')} aria-label="Results">
      {previous && <p className="text-xs text-muted">Previous results, while the new comparison runs</p>}
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
          {previous ? 'Previous results' : rerun ? 'Saved run vs current settings' : 'Results'}
        </h2>
        <span className="text-sm text-muted">for “{results.text}”</span>
        {results.kind === 'rerun' && !previous && (
          <Button size="sm" variant="ghost" onClick={() => useUi.getState().startCompare({ text: results.text, afterHistory: results.seq > 0 })}>
            <RotateCcw className="size-3.5" /> Use this question in a comparison
          </Button>
        )}
        {results.kind === 'compare' && !previous && (
          <Button size="sm" variant="ghost" onClick={onChange}>Change the setup <ArrowDown className="size-3.5" aria-hidden /></Button>
        )}
        {!previous && (
          <Button size="sm" variant="ghost" title="Every side's setup, answers, tools and figures, as a JSON file"
            onClick={() => downloadJson(`harness-${results.kind}-${results.id ?? 'results'}.json`, results)}>
            <Download className="size-3.5" /> Download as JSON
          </Button>
        )}
      </div>
      {sides.length > 1 && Math.max(...sides.map((s) => s.stats?.runs ?? 1)) < 3 && (
        <p className="text-sm text-muted">
          {sides.some((s) => s.stats) ? 'Fewer than 3 runs per side' : 'One run per side'}: a model answers differently from
          run to run, so the differences below may be chance, and none is called better or worse. Run each side 3 or 5
          times to see which differences hold.
        </p>
      )}
      {results.kind === 'compare' && results.lookFor && <p className="text-sm"><b>Look for:</b> {results.lookFor}</p>}
      {rerun && (
        <p className="flex items-start gap-1 text-sm text-muted">
          <span>
            Current settings: your model, prompt, tools and permissions, thinking, caching, limits and the facts about you, as
            they are now. The messages before it were sent again as they were.
          </span>
          <ExplainIcon concept="rerun" />
        </p>
      )}
      <div className="rounded-xl border border-line bg-panel p-4">
        <h3 className="mb-2 text-sm font-semibold">What's different</h3>
        {askFirst.length > 0 && results.kind === 'rerun' && (
          <Callout tone="warn" className="mb-2">
            {both(askFirst)} {askFirst.length === 1 ? 'is' : 'are'} set to Ask first, and nobody can be asked during a re-run, so{' '}
            {askFirst.length === 1 ? 'it was' : 'they were'} blocked
            {allowedBefore.length > 0 && ` (you allowed ${both(allowedBefore)} in the saved run)`}.
            <RerunLettingThrough tools={letThroughNow.length ? letThroughNow : askFirst}
              run={() => useCompare.getState().rerun(results.conversation, results.seq, results.text, true)} />
          </Callout>
        )}
        {blockNow.length > 0 && (
          <p className="mb-2 text-sm text-muted">
            {both(blockNow)} {blockNow.length === 1 ? 'is' : 'are'} set to Block now, so {blockNow.length === 1 ? 'it' : 'they'} didn't
            run. To let {blockNow.length === 1 ? 'it' : 'them'} run, change the setting in Settings → Tools.
          </p>
        )}
        {unrecorded ? (
          <p className="flex items-center gap-1.5 text-sm text-muted"><Info className="size-4" />
            The saved run didn't record its settings (it's older than that), so what changed can't be shown.
          </p>
        ) : diffs.every((d) => !d.length) ? (
          <p className="flex items-center gap-1.5 text-sm text-muted"><Info className="size-4" />
            The settings are the same: any difference below is the model's own variation, plus things that change by
            themselves (live weather, the time){anyBlocked && refused.length === 0 ? ', and tools that were blocked because nobody could be asked' : ''}.
          </p>
        ) : (
          // F349f: as in Evals, the table scrolls inside its card and long values wrap in their cell
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-3 align-top font-medium">Setting</th>
                {sides.map((s, i) => (
                  <th key={i} className="py-1 pr-3 align-top font-medium">
                    <span className="flex items-center gap-1.5"><SideLetter letter={LETTERS[i]} />{s.label}</span>
                    {!s.label.includes(s.model) && <code className="block font-normal">{s.model}</code>}
                  </th>
                ))}</tr></thead>
              <tbody>
                {[...new Set(diffs.flat().map((d) => d.what))].map((what) => (
                  <tr key={what} className="border-t border-line">
                    <td className="py-1 pr-3 align-top break-words text-muted">{what}</td>
                    <td className="py-1 pr-3 align-top break-words">{diffs.flat().find((d) => d.what === what)?.a}</td>
                    {diffs.map((d, i) => {
                      const b = d.find((x) => x.what === what)?.b
                      return <td key={i} className={cn('py-1 pr-3 align-top break-words', b !== undefined ? 'font-medium text-warn' : 'text-muted')}>{b ?? '(same)'}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className={cn('grid gap-4', sides.length === 3 ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2')}>
        {sides.map((s, i) => <ResultCard key={i} side={s} base={i > 0 ? base : null} letter={LETTERS[i]} rerun={rerun} />)}
      </div>
    </section>
  )
}

// A difference from side A. Coloured better/worse only when both sides did the same thing;
// otherwise "less" isn't "better" (a side whose tools were blocked is faster, not better)
// F349a, F441: and only when it is worth believing: three runs or more, a change of at least 10 %, and the two
// sides' ranges (fastest to slowest run) not overlapping. Anything less is shown plain, with no arrow
export function Delta({ value, base, unit, comparable, runs, format, range, baseRange, estimated }:
  { value: number; base: number | null; unit?: string; comparable: boolean; runs: number; format: (n: number) => string
    range?: Spread; baseRange?: Spread; estimated?: boolean }) {
  if (base == null || value === base) return null
  const d = value - base
  const big = runs >= 3 && Math.abs(d) / Math.max(Math.abs(base), 1e-9) >= 0.1
  const apart = !range || !baseRange || range.max < baseRange.min || range.min > baseRange.max
  const judged = comparable && big && apart
  const why = !comparable ? ' (the sides used different tools, so this is not better or worse)'
    : runs < 3 ? '. Too few runs to call better or worse: with fewer than 3, a difference may be chance.'
      : !big ? '. Too small a change to call better or worse.'
        : !apart ? "'s middle, but the two sides' runs overlap, so it isn't called better or worse." : ''
  return (
    <span className={cn('text-xs whitespace-nowrap', !judged ? 'text-muted' : d < 0 ? 'text-ok' : 'text-bad')}
      title={`${d < 0 ? 'less' : 'more'} than side A${why}`}>
      {judged && (d < 0 ? <ArrowDown aria-hidden className="inline size-3 align-[-0.125em]" /> : <ArrowUp aria-hidden className="inline size-3 align-[-0.125em]" />)}
      {estimated && '≈ '}{d > 0 ? '+' : '−'}{format(Math.abs(d))}{unit}
      {judged && <span className="sr-only">{d < 0 ? '(better)' : '(worse)'}</span>}
    </span>
  )
}

// Whether two sides did the same thing, so less time or fewer tokens can be called better: the same tools in
// every run (with several runs), or in the one run
function sameTools(a: CompareSide, b: CompareSide) {
  const paths = (s: CompareSide) => (s.stats?.tools?.length ? s.stats.tools : [s.tools.map((t) => t.name)]).map((p) => p.join(','))
  const all = new Set([...paths(a), ...paths(b)])
  return all.size === 1
}

const OUTCOME: Record<string, string> = {
  blocked: 'not run: blocked or needed an approval nobody could give', // (older saves counted both as blocked)
  unattended: 'not run: needs your OK, and nobody can be asked here',
  declined: 'not run: declined',
  hook_blocked: 'not run: blocked by your hook',
  not_run: "not run: it wasn't offered on that call, or the run stopped first",
  error: 'failed',
}

// The figures a card shows: the middle of several runs, or the one run
const figure = (side: CompareSide, key: 'seconds' | 'tokens_read' | 'tokens_written' | 'cost') => {
  const spread = side.stats?.[key]
  return spread ? spread.median : side[key]
}

function ResultCard({ side, base, letter, rerun }: { side: CompareSide; base: CompareSide | null; letter: string; rerun: boolean }) {
  const main = (side.calls ?? []).filter((c) => !c.sub)
  const helper = (side.calls ?? []).filter((c) => c.sub)
  const comparable = !!base && sameTools(base, side)
  const est = side.provider === 'mock'
  const info = useServer((s) => s.info)
  // Several runs: the tiles show the middle of the runs that answered; none answered, the first run's figures
  const answered = side.stats ? side.stats.answered ?? side.stats.runs - side.stats.errors : 0
  const runs = side.stats ? (answered ? ` (middle of ${answered})` : ' (first run)') : ''
  const cost = figure(side, 'cost')
  const runCount = side.stats?.runs ?? 1
  const offered = side.config?.tools ?? []
  const inspect = async () => {
    if (!side.conversation) return
    if (!(await openConversation(side.conversation))) return
    if (rerun) return // a re-run's cards are your conversation and your current settings: no model to switch to (F260)
    // Carry on with the model this side ran on, so a follow-up goes to the same model
    const s = useSession.getState()
    if (side.provider && side.model && (s.provider !== side.provider || s.model !== side.model)) {
      if (!(await switchProvider(side.provider, side.model))) return
      toast({ kind: 'info', title: `Switched to ${side.model}`, body: `Side ${letter} ran on it, so a follow-up goes to the same model.` })
    }
  }
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4">
      <header className="space-y-0.5">
        <h3 className="flex items-center gap-1.5 font-semibold"><SideLetter letter={letter} />{side.label}</h3>
        <div className="text-xs text-muted">{providerName(info?.providers, side.provider)} · <code>{side.model}</code></div>
        {!!side.waited && side.waited > 0 && (
          <div className="text-xs text-muted">It also waited {seconds(side.waited)} for your approval (not counted in its time).</div>
        )}
        {side.allow_ask && <div className="text-xs text-warn">Ask-first tools were let through for this run.</div>}
        {side.stopped && <div className="text-xs text-warn">Stopped early: Stop was pressed before every run finished.</div>}
        {side.conversation && (
          <span className="flex items-center gap-1 self-start">
            <Button size="sm" variant="ghost" className="-ml-2" onClick={() => void inspect()}
              title={rerun ? 'Open it as a conversation, to see every call in the Inspector (your model stays as it is)'
                : 'Open this side as a conversation, to see every call in the Inspector (Compare keeps these results)'}>
              <Search className="size-3.5" /> {rerun ? 'Open the conversation' : 'Inspect this side'}
            </Button>
            {!rerun && <ExplainIcon concept="inspect_side" />}
          </span>
        )}
      </header>
      <div className="grid grid-cols-2 gap-2">
        {side.stats && <RunsSummary stats={side.stats} />}
        <Stat label={`Time${runs}`}>{seconds(figure(side, 'seconds') ?? 0)}
          <Delta value={figure(side, 'seconds') ?? 0} base={base ? figure(base, 'seconds') : null} comparable={comparable} runs={runCount} format={(n) => seconds(n)}
            range={side.stats?.seconds} baseRange={base?.stats?.seconds} /></Stat>
        <Stat label={`Model calls${side.stats ? ' (first run)' : ''}`}>{main.length}{helper.length > 0 && <span className="text-xs font-normal text-muted">+{helper.length} helper</span>}</Stat>
        {side.tokens_read > 0 || (base && base.tokens_read > 0) ? (
          <>
            <Stat label={`Tokens in${runs}`}><span title={est ? ESTIMATE_TITLE : undefined}>{approx(tokens(figure(side, 'tokens_read') ?? 0), est)}</span>
              <Delta value={figure(side, 'tokens_read') ?? 0} base={base ? figure(base, 'tokens_read') : null} comparable={comparable} runs={runCount} format={tokens}
                range={side.stats?.tokens_read} baseRange={base?.stats?.tokens_read} estimated={est} /></Stat>
            <Stat label={`Tokens out${runs}`}><span title={est ? ESTIMATE_TITLE : undefined}>{tokensOut(figure(side, 'tokens_written') ?? 0, est)}</span>
              <Delta value={figure(side, 'tokens_written') ?? 0} base={base ? figure(base, 'tokens_written') : null} comparable={comparable} runs={runCount} format={tokens}
                range={side.stats?.tokens_written} baseRange={base?.stats?.tokens_written} estimated={est} /></Stat>
          </>
        ) : <div className="col-span-2 rounded-md bg-sunken px-2.5 py-1.5 text-xs text-muted">No token counts from this provider.</div>}
        {cost != null && (
          <Stat label={`Cost${runs}`}><span title={est ? ESTIMATE_TITLE : undefined}>{costText(cost, est)}</span>
            <Delta value={cost} base={base ? figure(base, 'cost') : null} comparable={comparable} runs={runCount} format={dollars}
              range={side.stats?.cost} baseRange={base?.stats?.cost} estimated /></Stat>
        )}
      </div>
      {main.length > 0 && main.some((c) => c.input_tokens + c.cache_read > 0) && <MiniChart calls={main} firstRun={!!side.stats} />}
      <div className="space-y-1">
        <SectionLabel>Tools used{side.stats && ' (first run)'}</SectionLabel>
        {side.tools.length ? (
          <ul className="space-y-0.5 text-sm">
            {side.tools.map((t, i) => {
              const why = t.outcome ? OUTCOME[t.outcome] : t.failed ? OUTCOME.error : t.blocked ? OUTCOME.blocked : null
              return (
                <li key={i} className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {(t.blocked || t.failed) && <Ban className="size-3.5 shrink-0 text-bad" aria-hidden />}
                  <code className={cn('truncate', t.blocked && 'text-bad line-through')}>{t.name}({shortArgs(t.input, 40)})</code>
                  {why && <span className="text-xs text-bad">{why}</span>}
                </li>
              )
            })}
          </ul>
        ) : <p className="text-sm text-muted">None.</p>}
      </div>
      <div className="space-y-1">
        <SectionLabel>Answer{side.stats && ' (first run)'}</SectionLabel>
        {side.error ? <Callout tone="bad" size="sm">{side.error}</Callout> : <Markdown text={side.answer ?? ''} className="text-sm" />}
      </div>
      {side.config && (
        <div className="mt-auto flex flex-wrap gap-1 border-t border-line pt-2">
          <span title={offered.map((t) => t.name).join(', ')}><Badge>{plural(offered.length, 'tool')} offered</Badge></span>
          {side.config.system_edited && <Badge tone="warn">prompt edited</Badge>}
          {Object.keys(side.config.permissions ?? {}).length > 0 && <Badge tone="warn">{plural(Object.keys(side.config.permissions ?? {}).length, 'permission')} changed</Badge>}
          {side.config.trim?.enabled && <Badge tone="warn">trimming on</Badge>}
          {side.config.thinking?.enabled && <Badge tone="warn">thinking {thinkingWords(side.config).replace(/^on /, '')}</Badge>}
          {side.config.cache?.enabled && <Badge tone="ok">caching on</Badge>}
          {(side.config.facts_shared ?? 0) > 0 && <Badge tone="ok">{plural(side.config.facts_shared!, 'fact')}</Badge>}
        </div>
      )}
    </article>
  )
}

export function MiniChart({ calls, firstRun }: { calls: NonNullable<CompareSide['calls']>; firstRun: boolean }) {
  const max = Math.max(...calls.map((c) => c.input_tokens + c.cache_read), 1)
  return (
    <figure>
      <div className="flex h-12 items-end gap-1" role="img"
        aria-label={`Tokens read by each call: ${calls.map((c) => `call ${c.turn} ${tokens(c.input_tokens + c.cache_read)}`).join(', ')}`}>
        {calls.map((c, i) => (
          <div key={i} title={`Call ${c.turn}: ${tokens(c.input_tokens + c.cache_read)} tokens in`}
            className="w-4 rounded-sm bg-accent/60" style={{ height: `${Math.max(6, ((c.input_tokens + c.cache_read) / max) * 100)}%` }} />
        ))}
      </div>
      <figcaption className="text-xs text-muted">tokens in, per call{firstRun && ' (first run)'}</figcaption>
    </figure>
  )
}

// Which tools would be blocked because nobody can be asked, and the switch to let them run
function AskFirstNote() {
  const c = useCompare()
  const settings = useServer((s) => s.settings)
  if (!settings) return null
  // Each tool set to Ask first, with the sides where it is
  const where = new Map<string, string[]>()
  c.sides.forEach((side, i) => settings.tools
    .filter((t) => (side.permissions[t.name] ?? t.permission) === 'ask')
    .filter((t) => t.name !== 'run_python' || (side.runCode ?? settings.run_code?.enabled)) // offered only with Run code on
    .forEach((t) => where.set(t.name, [...(where.get(t.name) ?? []), LETTERS[i]])))
  if (!where.size) return null
  const onSides = (letters: string[]) => letters.length === c.sides.length ? 'on every side'
    : `on side${letters.length > 1 ? 's' : ''} ${letters.join(' and ')}`
  const asking = [...where.keys()]
  // Tools that are set to Ask first on the same sides share one clause: "on every side: write_file and calculate"
  const sameSides = new Map<string, string[]>()
  for (const name of asking) sameSides.set(onSides(where.get(name)!), [...(sameSides.get(onSides(where.get(name)!)) ?? []), name])
  const names = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0])
  return (
    <Callout tone="warn" className="space-y-1.5">
      <p>
        {[...sameSides].map(([sides, tools], i) => `${i ? 'set' : 'Set'} to Ask first ${sides}: ${names(tools)}`).join('; ')}. Nobody can be asked
        during a comparison, so {asking.length === 1 ? 'it is' : 'they are'} {c.allowAsk ? 'let through' : 'blocked'} there.
      </p>
      {/* F389: names what it lets through, and what that means; unticked again after each comparison */}
      <label className="flex items-start gap-2 text-fg">
        <input type="checkbox" className="mt-1" checked={c.allowAsk} onChange={(e) => c.setAllowAsk(e.target.checked)} />
        <span>
          Let Ask-first tools run for this comparison: {andList(asking)}
          {letThroughWords(asking, (where.get('run_python')?.length ?? 0) * c.repeat).map((w) => (
            <span key={w} className={cn('block text-xs', w.startsWith('Code the model writes') ? 'font-medium text-warn' : 'text-muted')}>{w}</span>
          ))}
          <span className="block text-xs text-muted">It is unticked again after the comparison runs.</span>
        </span>
      </label>
    </Callout>
  )
}

const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '')
const FILE_TOOLS = ['read_file', 'list_files', 'write_file']

// F389: what letting Ask-first tools run means, tool by tool. `codeRuns`: how many runs can use run_python
// (the sides where it asks, times the runs per side); one run can run code more than once
export function letThroughWords(tools: string[], codeRuns: number): string[] {
  const out: string[] = []
  if (tools.includes('run_python')) {
    out.push(`Code the model writes will run as you, without you seeing it first, ${codeRuns > 1 ? `in up to ${plural(codeRuns, 'run')}` : 'in one run'}`
      + ' (and more than once in a run, if the model asks again). It can reach any of your files and the internet.')
  }
  if (tools.includes('remember_fact')) out.push('remember_fact: facts the model saves about you are shared in every future conversation.')
  const mcp = tools.filter(isMcpTool)
  if (mcp.length) out.push(`${andList(mcp)}: another program decides what ${mcp.length === 1 ? 'it does' : 'they do'}.`)
  const files = tools.filter((t) => FILE_TOOLS.includes(t))
  if (files.length) out.push(`${andList(files)}: writes really happen; paths outside the workspace are still refused.`)
  return out
}

// F389: the re-run that lets Ask-first tools through names them, and asks once more when that means
// running code you haven't seen
function RerunLettingThrough({ tools, run }: { tools: string[]; run: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const code = tools.includes('run_python')
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-xs font-medium">Let the model's code run without you seeing it first?</span>
          <Button size="sm" variant="danger" onClick={() => { setConfirming(false); run() }}>Yes, re-run and let it run</Button>
          {/* (the button you pressed is gone: focus lands on the safe choice) */}
          <Button size="sm" variant="ghost" autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
        </>
      ) : (
        <Button size="sm" onClick={() => (code ? setConfirming(true) : run())}>
          Re-run letting Ask-first tools run: {andList(tools)}
        </Button>
      )}
      {letThroughWords(tools, 1).map((w) => <span key={w} className="basis-full text-xs">{w}</span>)}
    </span>
  )
}

// Several runs of one side: the typical (middle) figure, its range, and how often runs agreed
function RunsSummary({ stats }: { stats: RunStats }) {
  const range = (sp: Spread, f: (n: number) => string) =>
    sp ? <>{f(sp.median)} <span className="font-normal text-muted">({f(sp.min)}–{f(sp.max)})</span></> : '—'
  const answered = stats.answered ?? stats.runs - stats.errors
  const sequences = [...new Set(stats.tools.map((t) => t.join(' → ') || 'no tools'))]
  // Each different error once, with how many runs ended with it
  const failures = new Map<string, number>()
  for (const f of stats.failures ?? []) failures.set(f, (failures.get(f) ?? 0) + 1)
  const notAnswered = [stats.errors ? `${plural(stats.errors, 'run')} failed` : '', stats.stopped ? `${stats.stopped} stopped` : '']
    .filter(Boolean).join(' · ')
  return (
    <div className="col-span-2 rounded-md border border-line px-2.5 py-1.5 text-xs">
      <div className="font-medium">
        Over {plural(stats.runs, 'run')} (middle, range{answered < stats.runs ? ` of the ${answered} that answered` : ''}) <ExplainIcon concept="middle_range" />
      </div>
      <div>Time: {range(stats.seconds, seconds)} · Tokens in: {range(stats.tokens_read, tokens)}</div>
      {stats.cost && <div>Cost: {range(stats.cost, dollars)}</div>}
      <div className={answered && stats.same_answer === answered ? 'text-ok' : 'text-muted'}>
        Same answer in {stats.same_answer} of {answered}
        <span className="text-muted" title="Compared word for word, ignoring case and punctuation"> (word for word)</span>
        {notAnswered && ` · ${notAnswered}`}
      </div>
      {stats.same_tools !== undefined && (
        <div className={answered && stats.same_tools === answered ? 'text-ok' : 'text-muted'}>
          Same tools in {stats.same_tools} of {answered}{sequences.length === 1 ? ` (${sequences[0]})` : ''}
        </div>
      )}
      {[...failures].map(([f, n]) => <div key={f} className="text-bad">Failed: {f} ({plural(n, 'run')})</div>)}
      {sequences.length > 1 && <div className="text-muted">Tool sequences: {sequences.join(' · ')}</div>}
      {stats.answers && stats.answers.length > 1 && (
        <Disclosure className="mt-1" summaryClassName="text-accent" summary={<>Read all {stats.answers.length} answers</>}>
          <p className="mt-1 text-muted">Wording almost always varies; check whether the facts agree.</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            {stats.answers.map((a, i) => <li key={i}><Markdown text={a || '(no answer)'} /></li>)}
          </ol>
        </Disclosure>
      )}
    </div>
  )
}
