// The summary of several runs of one side
import type { RunStats, Spread } from '../../api/types'
import { dollars, plural, seconds, tokens } from '../../lib/format'
import { ExplainIcon } from '../../learn/Explain'
import { Markdown } from '../Markdown'
import { Disclosure } from '../ui'

// Several runs of one side: the typical (middle) figure, its range, and how often runs agreed
export function RunsSummary({ stats }: { stats: RunStats }) {
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
