// One side's result: its figures, the tools it used and its answer
import { Ban, Search } from 'lucide-react'
import type { CompareSide } from '../../api/types'
import { cn } from '../../lib/cn'
import { approx, cost as costText, dollars, ESTIMATE_TITLE, plural, seconds, shortArgs, tokens, tokensOut } from '../../lib/format'
import { thinkingWords } from '../../model/configDiff'
import { openConversation, switchProvider } from '../../store/selectors'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { toast } from '../../store/ui'
import { providerName } from '../composer/providerWords'
import { ExplainIcon } from '../../learn/Explain'
import { Markdown } from '../Markdown'
import { Badge, Button, Callout, SectionLabel, Stat } from '../ui'
import { Delta } from './Delta'
import { MiniChart } from './MiniChart'
import { RunsSummary } from './RunsSummary'
import { SideLetter } from './SideLetter'

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

export function ResultCard({ side, base, letter, rerun }: { side: CompareSide; base: CompareSide | null; letter: string; rerun: boolean }) {
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
