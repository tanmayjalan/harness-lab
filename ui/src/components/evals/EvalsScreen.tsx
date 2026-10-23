// Evals: the same fixed questions, run the same way, to tell whether a change made things
// better or worse. Pass rates over several runs, and a score over time.
import { CheckCircle2, ClipboardCheck, CircleDashed, Download, Play, Search, TriangleAlert, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { EvalCase, EvalRun } from '../../api/types'
import { cn } from '../../lib/cn'
import { downloadJson } from '../../lib/download'
import { approx, ESTIMATE_TITLE, plural, roughly, seconds, tokens } from '../../lib/format'
import { ExplainIcon } from '../../learn/Explain'
import { useEvals } from '../../store/evals'
import { openConversation } from '../../store/selectors'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { modelsOf, paidNote, toolsTag, unusable } from '../composer/providerWords'
import { Badge, Button, Callout, Disclosure, Field, RunningBanner, Select, Skeleton, Spinner } from '../ui'
import { Markdown } from '../Markdown'

// About 25 seconds per conversation on the mock, a little less elsewhere; three run at a time
const perRun = (provider: string) => (provider === 'mock' ? 25 : 12)

export function EvalsScreen() {
  const e = useEvals()
  const info = useServer((s) => s.info)
  const changed = useServer((s) => s.settings?.changed) ?? [] // (a selector must not build a new array: React would loop)
  const current = useSession((s) => s.provider) ?? info?.provider ?? 'mock'

  useEffect(() => {
    void useEvals.getState().refresh()
    void useEvals.getState().loadCases()
    if (useEvals.getState().provider === 'mock' && current !== 'mock') useEvals.getState().set({ provider: current })
  }, [current])

  const provider = info?.providers.find((p) => p.name === e.provider)
  const running = e.status.running
  // F322: a round seen running on this visit: its failure is read out at once; an older one is only shown
  const [sawRunning, setSawRunning] = useState(false)
  if (running && !sawRunning) setSawRunning(true)
  const known = e.cases !== null
  const stopRef = useRef<HTMLButtonElement>(null)
  // Run disables itself: focus goes to Stop, so it isn't dropped on the page
  useEffect(() => { if (running) stopRef.current?.focus() }, [running])
  const total = (e.cases?.length ?? 0) * e.repeat
  const estimate = Math.ceil((total * perRun(e.provider)) / 3)
  // The judge is always the mock's default model
  const judgeModel = info?.providers.find((p) => p.name === 'mock')?.model ?? ''
  const tested = e.model || provider?.model || ''
  const paid = paidNote([{ name: e.provider, conversations: total }], info?.providers)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><ClipboardCheck className="size-5 text-accent" /> Evals <ExplainIcon concept="eval" /></h1>
          <p className="text-sm text-muted">
            A fixed set of questions, each checked for the right tools and answer. Run them before and after a change to
            the prompt, a tool or the model, and compare the pass rates. Models vary from run to run, so a drop of one or two
            runs can be chance, above all with one run per question: run each question 3 or 5 times, and run the same setup
            twice to see how far the score moves with no change at all. Only a drop bigger than that says the change made
            things worse. Tools set to Ask first don't run (nobody can be asked); tools set to Block are refused.
          </p>
        </div>

        <Questions />

        <section className="grid gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Provider and model</span>
            <Select value={`${e.provider}/${e.model || provider?.model || ''}`} disabled={running}
              onChange={(ev) => { const [p, ...m] = ev.target.value.split('/'); e.set({ provider: p, model: m.join('/') }) }}
              className="w-full">
              {info?.providers.flatMap((p) => modelsOf(p).map((m) => (
                <option key={`${p.name}/${m}`} value={`${p.name}/${m}`} disabled={!!unusable(p)}>{p.label} · {m}{toolsTag(p, m)}{p.missing_key ? ` (needs ${p.missing_key})` : p.problem ? ' (not ready)' : ''}</option>
              )))}
            </Select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Runs per question</span>
            <Select value={e.repeat} disabled={running} onChange={(ev) => e.set({ repeat: Number(ev.target.value) })} className="w-full">
              {[1, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Only questions containing (optional)</span>
            <Field value={e.only} disabled={running} onChange={(ev) => e.set({ only: ev.target.value })} placeholder="e.g. weather"
              className="w-full" />
          </label>
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={e.useMySettings} disabled={running} onChange={(ev) => e.set({ useMySettings: ev.target.checked })} />
              Use my settings instead of the defaults
            </label>
            <p className="pl-6 text-xs text-muted">
              {changed.length ? `Different from the defaults now: ${changed.join(', ')}.` : 'Nothing differs from the defaults now.'}
              {' '}Every setting applies, and your hooks run, as in Compare. (The model is picked above.)
            </p>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={e.judge} disabled={running} onChange={(ev) => e.set({ judge: ev.target.checked })} />
                Judge the open-ended questions with the mock{judgeModel && ` (${judgeModel})`}
              </label>
              <ExplainIcon concept="judge" />
            </div>
            <p className="pl-6 text-xs text-muted">Off: they pass on tool use alone.</p>
            <p className="pl-6 text-xs text-muted">
              The judge sees only the question, its criteria and the final answer (not the tools or what they returned),
              grades each answer once, and is always the mock. Checks of the answer's text match a whole word or number.
            </p>
            {e.judge && tested === judgeModel && (
              <p className="pl-6 text-xs text-muted">The judge is the same model as the one being tested: it may go easy on its own answers.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => e.start()} disabled={running || (known && !e.cases!.length)}>
              {running ? <Spinner /> : <Play className="size-4" />} {running ? 'Running…' : 'Run evals'}
            </Button>
            <span className="text-xs text-muted">
              {!known ? (e.casesFailed ? "Couldn't read the questions; the run still checks your filter." : 'Reading the questions…')
                : e.cases!.length
                ? `${plural(e.cases!.length, 'question')} × ${plural(e.repeat, 'run')} = ${plural(total, 'conversation')}, ${roughly(estimate)}`
                : 'No question matches the filter.'}
            </span>
            {paid && <span className="text-xs text-warn">{paid}</span>}
          </div>
        </section>

        {running && <Progress stopRef={stopRef} onStop={() => e.stop()} />}
        {!running && e.status.error && (
          <Callout tone="bad" live={sawRunning} icon={<TriangleAlert className="size-4" />}>The last eval round failed: {e.status.error}</Callout>
        )}

        {e.history.length === 0 && !running && (
          <p className="text-sm text-muted">
            No eval rounds yet. A first try: type "dice" under "Only questions containing" and pick 3 runs.
          </p>
        )}
        {e.history.length > 0 && <ScoreChart runs={e.history} selected={e.viewing?.id} onPick={(id) => e.view(id)} />}
        {e.viewing && <Results />}
      </div>
    </div>
  )
}

// While a round runs: how many are done, the time so far and about how long is left, and Stop (F330h)
function Progress({ stopRef, onStop }: { stopRef: React.Ref<HTMLButtonElement>; onStop: () => void }) {
  const status = useEvals((s) => s.status)
  const done = status.done ?? 0
  const total = status.total ?? 0
  return (
    <RunningBanner text={`${done} of ${total ? plural(total, 'conversation') : '…'} done`} startedAt={status.started ?? null}
      left={(so) => (done ? (so / done) * (total - done) : null)} onStop={onStop} stopRef={stopRef}
      progress={{ done, total, label: 'Eval progress' }} />
  )
}

// The questions themselves: what each checks, and where to change them
function Questions() {
  const cases = useEvals((s) => s.cases)
  const judgeOn = useEvals((s) => s.judge)
  return (
    <Disclosure className="rounded-xl border border-line bg-panel px-4 py-2 text-sm" summaryClassName="font-medium"
      summary={<>The questions ({cases ? cases.length : '…'})</>}>
      <p className="mt-1 text-xs text-muted">To add or change questions, edit <code>config/evals.json</code>; it is read fresh on each run.</p>
      {!cases && <Skeleton className="mt-2 h-10" />}
      <ul className="mt-2 divide-y divide-line">
        {(cases ?? []).map((c) => (
          <li key={c.question} className="py-1.5">
            <div>{c.question}</div>
            <div className="text-xs text-muted">
              {c.tools.length ? `should use ${c.tools.join(', ')}` : 'should use no tools'}
              {c.answer_has && ` · answer mentions ${c.answer_has.map((a) => `"${a}"`).join(' or ')}`}
              {c.judge && (judgeOn ? ` · judged: ${c.judge}` : ` · judged when the judge is on: ${c.judge}`)}
              {c.tool_may_not_work && ' · trying the tool counts'}
            </div>
          </li>
        ))}
      </ul>
    </Disclosure>
  )
}

// What a run was, for the chart's tooltip and the grouping of comparable runs: the same model, the same questions
// checked the same way (their fingerprint; older rounds only have the filter), the same judge and as many runs per
// question. The settings aren't part of it: before and after a settings change is the comparison to make
const kindOf = (r: EvalRun) =>
  `${r.provider}|${r.model}|${r.questions_hash ?? `only:${r.only ?? ''}`}|${r.judge ?? ''}|${r.repeat}|${r.incomplete ? 'stopped' : ''}`
const describe = (r: EvalRun) => [
  new Date(r.time * 1000).toLocaleString(), `${r.label} · ${r.model}`, `${r.passed} of ${plural(r.total, 'run')} passed`,
  `${plural(r.repeat, 'run')} per question`,
  r.only ? `questions containing "${r.only}"` : 'all questions',
  r.judge ? 'judge on' : 'judge off',
  ...(r.unjudged ? [`${plural(r.unjudged, 'run')} couldn't be judged (left out)`] : []),
  r.setup.length ? r.setup.join(', ') : 'defaults',
  ...(r.incomplete ? ['incomplete'] : []),
].join(' · ')
// A point's visible label: the score, and the runs per question when there were several (in words: × counts calls)
const pointLabel = (r: EvalRun) => `${r.passed}/${r.total}${r.repeat > 1 ? ` · ${plural(r.repeat, 'run')} each` : ''}`
const labelWidth = (s: string) => s.length * 6 // about 6 units a character at the chart-text size (11)

export function ScoreChart({ runs, selected, onPick }: { runs: EvalRun[]; selected?: string; onPick: (id: string) => void }) {
  // F349n (ruling R2): the chart is as wide as its card: the drawing's width is the measured width, so nothing
  // is stretched (a stretched drawing would distort its labels)
  const [W, setW] = useState(640)
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const el = svgRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      if (w >= 240) setW(w)
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const H = 160
  const pad = 28
  const left = 52 // room for the % labels
  const xs = (i: number) => left + (runs.length === 1 ? (W - left - pad) / 2 : (i * (W - left - pad)) / (runs.length - 1))
  const ys = (r: EvalRun) => H - pad - ((r.total ? r.passed / r.total : 0) * (H - 2 * pad))
  // Only runs like the latest (same provider and model, filter, judge and settings choice) are joined by the line
  const latest = runs[runs.length - 1]
  const comparable = (r: EvalRun) => kindOf(r) === kindOf(latest)
  // Where each point's label goes. A wide label at either end is anchored inside the chart. Labels are placed
  // from the newest point back, so the newest always has one; a label that would touch the next one is left out.
  const labels = runs.map((r, i) => {
    const x = xs(i)
    const words = pointLabel(r)
    const w = labelWidth(words)
    const anchor: 'start' | 'middle' | 'end' = x + w / 2 > W ? 'end' : x - w / 2 < 0 ? 'start' : 'middle'
    const from = anchor === 'end' ? x - w : anchor === 'start' ? x : x - w / 2
    return { words, anchor, from, to: from + w, shown: false }
  })
  let nextFrom = Infinity
  for (const l of [...labels].reverse()) {
    if (l.to + 9 <= nextFrom) { l.shown = true; nextFrom = l.from }
  }
  return (
    <section className="space-y-1 rounded-xl border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold">Pass rate over time <span className="font-normal text-muted">· click a point to see that round</span></h2>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="group" aria-label="Pass rate of each past eval round">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={left - 12} x2={W - pad} y1={H - pad - (v / 100) * (H - 2 * pad)} y2={H - pad - (v / 100) * (H - 2 * pad)} stroke="var(--line)" />
            <text x={4} y={H - pad - (v / 100) * (H - 2 * pad) + 3} className="chart-text" fill="var(--muted)">{v}%</text>
          </g>
        ))}
        <text x={xs(0)} y={H - 6} className="chart-text" fill="var(--muted)" textAnchor="start">{new Date(runs[0].time * 1000).toLocaleDateString()}</text>
        {runs.length > 1 && (
          <text x={xs(runs.length - 1)} y={H - 6} className="chart-text" fill="var(--muted)" textAnchor="end">{new Date(latest.time * 1000).toLocaleDateString()}</text>
        )}
        <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5"
          points={runs.map((r, i) => (comparable(r) ? `${xs(i)},${ys(r)}` : null)).filter(Boolean).join(' ')} />
        {runs.map((r, i) => {
          const x = xs(i)
          const label = labels[i]
          const same = comparable(r)
          return (
            <g key={r.id} role="button" data-run={r.id} tabIndex={r.id === (selected ?? latest.id) ? 0 : -1}
              className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[3px]"
              aria-label={`${describe(r)}${same ? '' : ' (a different kind of run: not joined to the line)'}`}
              onClick={() => onPick(r.id)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(r.id) }
                const next = ev.key === 'ArrowRight' ? runs[i + 1] : ev.key === 'ArrowLeft' ? runs[i - 1] : null
                if (next) {
                  ev.preventDefault()
                  onPick(next.id)
                  const svg = ev.currentTarget.ownerSVGElement
                  requestAnimationFrame(() => (svg?.querySelector(`[data-run="${next.id}"]`) as SVGElement | null)?.focus())
                }
              }}>
              <title>{describe(r)}</title>
              <circle cx={x} cy={ys(r)} r="12" fill="transparent" />
              {r.use_my_settings ? (
                // your settings: a square, so before and after a settings change can be told apart on one line
                <rect x={x - (r.id === selected ? 6 : 4)} y={ys(r) - (r.id === selected ? 6 : 4)} width={r.id === selected ? 12 : 8}
                  height={r.id === selected ? 12 : 8} data-mark="mine" fill={r.id === selected ? 'var(--accent)' : 'var(--panel)'}
                  stroke={same ? 'var(--accent)' : 'var(--muted)'} strokeWidth="1.5" strokeDasharray={same ? undefined : '2 2'} />
              ) : (
                <circle cx={x} cy={ys(r)} r={r.id === selected ? 6 : 4} fill={r.id === selected ? 'var(--accent)' : 'var(--panel)'}
                  stroke={same ? 'var(--accent)' : 'var(--muted)'} strokeWidth="1.5" strokeDasharray={same ? undefined : '2 2'} />
              )}
              {label.shown && (
                <text x={x} y={ys(r) + (ys(r) < pad + 10 ? 18 : -10)} textAnchor={label.anchor} className="chart-text" fill="var(--muted)">
                  {label.words}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <p className="text-xs text-muted">
        The line joins rounds like the latest one: the same provider and model, the same questions checked the same way,
        the same judge and as many runs per question. Circles are the default settings, squares your settings. Dashed
        points are other kinds of round, so their scores aren't comparable. One run per question is the noisiest.
      </p>
    </section>
  )
}

const VERDICT = {
  PASS: { icon: <CheckCircle2 className="size-4 text-ok" />, tone: 'ok' as const },
  MIXED: { icon: <CircleDashed className="size-4 text-warn" />, tone: 'warn' as const },
  FAIL: { icon: <XCircle className="size-4 text-bad" />, tone: 'bad' as const },
  'NOT JUDGED': { icon: <CircleDashed className="size-4 text-muted" />, tone: 'neutral' as const },
}

export function Results() {
  const r = useEvals((s) => s.viewing)!
  const pct = r.total ? Math.round((r.passed / r.total) * 100) : 0
  const heading = useRef<HTMLHeadingElement>(null)
  const focusResults = useEvals((s) => s.focusResults)
  // A round you were waiting for has finished, or you came back to it from one of its conversations:
  // focus moves to its result, once
  useEffect(() => {
    if (!focusResults) return
    heading.current?.focus()
    useEvals.setState({ focusResults: false })
  }, [focusResults])
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
          {r.passed} of {plural(r.total, 'run')} passed
          ({r.incomplete ? 'stopped early' : `${plural(r.cases.length, 'question')} × ${plural(r.repeat, 'run')}`}, {pct}%)
        </h2>
        <span className="text-sm text-muted">
          {r.label} · <code>{r.model}</code> · {r.only ? `questions containing "${r.only}"` : 'all questions'} · judge {r.judge ? 'on' : 'off'}
          {' '}· {r.use_my_settings ? (r.setup.length ? `your settings: ${r.setup.join(', ')}` : 'your settings (all default)') : 'default settings'}
          {r.time ? ` · ${new Date(r.time * 1000).toLocaleString()}` : ''}
        </span>
        <Button size="sm" variant="ghost" title="The round's questions, answers, checks, setup and judge, as a JSON file"
          onClick={() => downloadJson(`harness-eval-${r.id ?? 'round'}.json`, r)}>
          <Download className="size-3.5" /> Download as JSON
        </Button>
      </div>
      {r.incomplete && <p className="text-sm text-warn">This round is incomplete: stopped before every question ran.</p>}
      {!!r.unjudged && (
        <p className="text-sm text-muted">
          {plural(r.unjudged, 'run')} couldn't be judged (the judge itself failed), so {r.unjudged === 1 ? "it's" : "they're"} left
          out of the pass rate: {r.unjudged === 1 ? 'it says' : 'they say'} nothing about the model.
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="px-3 py-2 font-medium">Question</th><th className="px-3 py-2 font-medium">Result</th>
              <th className="px-3 py-2 font-medium">Tools used</th><th className="px-3 py-2 text-right font-medium tabular-nums">Average time per run</th>
              <th className="px-3 py-2 text-right font-medium tabular-nums" title={r.estimated ? ESTIMATE_TITLE : undefined}>Average tokens per run</th></tr>
          </thead>
          <tbody>{r.cases.map((c) => <CaseRow key={c.question} c={c} repeat={r.repeat} estimated={r.estimated} />)}</tbody>
        </table>
      </div>
      {r.cases.some((c) => c.verdict === 'FAIL') && (
        <p className="text-xs text-muted">
          Open a run with Inspect to see which call went wrong. If a tool was not run, check its rule in Settings → Tools; if the
          answer was wrong, try the prompt or the model.
        </p>
      )}
      {r.cases.some((c) => c.verdict === 'MIXED') && (
        <p className="text-xs text-muted">
          MIXED: the same question passed some runs and failed others. Open its answers to see which run failed and why:
          models vary from run to run, and live data (weather, time) can change answers too.
        </p>
      )}
    </section>
  )
}

// One run's tool calls in short: "roll_dice (failed) ×14 → roll_dice" rather than the name 15 times (as Compare writes them)
export function toolList(calls: string[]) {
  const parts: [string, number][] = []
  for (const name of calls) {
    const last = parts[parts.length - 1]
    if (last && last[0] === name) last[1]++
    else parts.push([name, 1])
  }
  return parts.map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(' → ') || 'no tools'
}

// What one run got, in a word (null for results saved before runs were kept apart)
function runVerdict(c: EvalCase, i: number) {
  if (!c.run_problems) return null
  if (c.judge_verdicts?.[i] === 'UNJUDGED') return "couldn't judge"
  return c.run_problems[i]?.length ? 'FAIL' : 'PASS'
}

// A problem with the runs that had it: "didn't use: calculate (runs 2, 3)"
function withRuns(c: EvalCase, p: string) {
  if (!c.run_problems || c.run_problems.length < 2) return p
  const runs = c.run_problems.flatMap((ps, i) => (ps.includes(p) ? [i + 1] : []))
  if (runs.length === c.run_problems.length) return `${p} (every run)`
  return `${p} (run${runs.length > 1 ? 's' : ''} ${runs.join(', ')})`
}

const TOOL_TIPS = {
  'not run': '(not run): it needed an approval nobody could give',
  blocked: '(blocked): your settings block it (rounds saved before 7 October 2026 also counted tools that needed an approval as blocked)',
  failed: '(failed): the tool ran but returned an error',
}

function CaseRow({ c, repeat, estimated }: { c: EvalCase; repeat: number; estimated?: boolean }) {
  const v = VERDICT[c.verdict]
  const perRun = !!c.run_problems
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  // Each distinct tool path once, with how many runs took it
  const paths = new Map<string, number>()
  for (const t of c.tools.map(toolList)) paths.set(t, (paths.get(t) ?? 0) + 1)
  return (
    <tr className="border-t border-line align-top">
      <td className="space-y-1 px-3 py-2">
        <div>{c.question}</div>
        {c.problems.length > 0 && <ul className="list-disc pl-4 text-xs text-bad">{c.problems.map((p) => <li key={p}>{withRuns(c, p)}</li>)}</ul>}
        {!!c.unjudged && <div className="text-xs text-muted">{plural(c.unjudged, 'run')} couldn't be judged: left out of {c.verdict === 'NOT JUDGED' ? 'the count' : `the ${c.passed}/${c.runs}`}.</div>}
        {c.ran != null && c.ran < repeat && (
          <div className="text-xs text-warn">Only {c.ran} of {plural(repeat, 'run')} ran before Stop.</div>
        )}
        {c.checked && (
          <Disclosure className="text-xs" summaryClassName="text-muted" summary="What was checked">
            <ul className="mt-1 list-disc pl-4 text-muted">
              {c.checked.map((x) => <li key={x}>{x}</li>)}
              {!perRun && (c.judge_notes ?? []).map((n, i) => n && <li key={`j${i}`}>judge, run {i + 1}: {n}</li>)}
            </ul>
          </Disclosure>
        )}
        {c.answers.length > 0 && (
          <Disclosure className="text-xs" summaryClassName="text-accent" summary={<>Show the {plural(c.answers.length, 'answer')}</>}>
            <ol className="mt-1 space-y-1.5">
              {c.answers.map((a, i) => {
                const rv = runVerdict(c, i)
                const judged = c.judge_verdicts?.[i]
                return (
                <li key={i} className="rounded border border-line p-1.5">
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-2 text-muted">
                    <span>
                      Run {i + 1}
                      {rv && <> · <b className={cn(rv === 'PASS' ? 'text-ok' : rv === 'FAIL' ? 'text-bad' : 'text-muted')}>{rv}</b></>}
                      {' '}· tools: {toolList(c.tools[i] ?? [])}
                    </span>
                    {c.conversations?.[i] && (
                      <Button size="sm" variant="ghost" aria-label={`Inspect run ${i + 1}`} onClick={() => void openConversation(c.conversations![i]!)}>
                        <Search className="size-3" /> Inspect
                      </Button>
                    )}
                  </div>
                  {perRun && c.run_problems![i].filter((p) => !p.startsWith('judge: ')).length > 0 && (
                    <ul className="mb-1 list-disc pl-4 text-bad">
                      {c.run_problems![i].filter((p) => !p.startsWith('judge: ')).map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  )}
                  {perRun && judged && c.judge_notes?.[i] && (
                    <div className={cn('mb-1', judged === 'FAIL' ? 'text-bad' : 'text-muted')}>
                      judge: {judged === 'UNJUDGED' ? "couldn't grade it" : judged} · {c.judge_notes[i]}
                    </div>
                  )}
                  {c.errors?.[i] ? <div className="text-bad">Ended with an error: {c.errors[i]}</div> : <Markdown text={a || '(no answer)'} />}
                </li>
                )
              })}
            </ol>
          </Disclosure>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-1">{v.icon}<Badge tone={v.tone}>{c.verdict} {c.passed}/{c.runs}</Badge></span>
      </td>
      <td className="px-3 py-2 text-xs">
        {[...paths.entries()].map(([t, n]) => (
          <div key={t}>
            <code className={cn((t.includes('(blocked)') || t.includes('(not run)') || t.includes('(failed)')) && 'text-bad')}
              title={[t.includes('(not run)') && TOOL_TIPS['not run'], t.includes('(blocked)') && TOOL_TIPS.blocked, t.includes('(failed)') && TOOL_TIPS.failed].filter(Boolean).join('\n') || undefined}>
              {t}
            </code>
            {c.tools.length > 1 && <span className="text-muted"> · in {plural(n, 'run')}</span>}
          </div>
        ))}
      </td>
      <td className="px-3 py-2 text-right text-xs whitespace-nowrap tabular-nums">{seconds(avg(c.seconds))}</td>
      <td className="px-3 py-2 text-right text-xs whitespace-nowrap tabular-nums" title={estimated ? ESTIMATE_TITLE : undefined}>{approx(tokens(avg(c.tokens)), estimated)}</td>
    </tr>
  )
}
