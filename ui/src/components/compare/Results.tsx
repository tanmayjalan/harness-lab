// A comparison's results: what was different between the sides, then a card for each side
import { ArrowDown, Download, Info, RotateCcw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn } from '../../lib/cn'
import { downloadJson } from '../../lib/download'
import { configDiff } from '../../model/configDiff'
import { useCompare } from '../../store/compare'
import { useUi } from '../../store/ui'
import { ExplainIcon } from '../../learn/Explain'
import { Button, Callout } from '../ui'
import { RerunLettingThrough } from './RerunLettingThrough'
import { ResultCard } from './ResultCard'
import { LETTERS, SideLetter } from './SideLetter'

export function Results({ previous, onChange }: { previous: boolean; onChange: () => void }) {
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
