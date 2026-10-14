import { ArrowRight, Bot } from 'lucide-react'
import type { Helper, HookRecord } from '../../model/derive'
import { VERDICT_WORDS } from '../inspector/HooksCard'
import { took } from './AccessChecks'
import { statusLabel } from '../../model/permission'
import { cn } from '../../lib/cn'
import { count, dollars, plural, seconds, shortArgs, tokens } from '../../lib/format'
import { Explain } from '../../learn/Explain'
import { Spinner } from '../ui'
import { stopWords } from '../../lib/stopWords'

// A helper agent: its own loop, shown as a nested card with what it read and what it returned
export function HelperCard({ helper: h, report }: { helper: Helper; report?: string }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Bot className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="shrink-0 font-medium whitespace-nowrap">Helper agent <span className="font-normal text-muted">(the delegate tool)</span></span>
        {/* quiet: its tool row already says "running" (F323) */}
        {h.running && <Spinner quiet className="shrink-0 text-accent" />}
        <span className="min-w-0 truncate text-muted" title={h.task}>“{h.task}”</span>
      </div>
      <Funnel helper={h} />
      {report && !h.running && (
        <blockquote data-testid="helper-report" className="border-l-2 border-accent/40 pl-2 text-xs text-muted italic">
          “{report.length > 200 ? `${report.slice(0, 200)}…` : report}”
          {report.length > 200 && <span className="not-italic"> (open the row for the full report)</span>}
        </blockquote>
      )}
      {h.calls.length > 0 && (
        <ol className="space-y-1 border-l-2 border-line pl-3 text-xs">
          {h.calls.map((c) => (
            <li key={c.n} className="space-y-0.5">
              <div className="text-muted">
                <b className="font-semibold text-fg">helper call {c.n}</b> · {stopWords(c.stopReason, h.tools.filter((t) => t.call === c.n).length)}
                {!!c.retries?.length && (
                  <span className="text-warn" title={`The service was busy or briefly down: the harness waited ${seconds(c.retries.reduce((n, r) => n + r.wait, 0))} and sent the same request again${c.retries.some((r) => r.simulated) ? ' (the practice switch)' : ''}`}>
                    {' '}· tried again ×{c.retries.length}
                  </span>
                )}
                {c.seconds != null && ` · ${seconds(c.seconds)}`}
                {c.tokens.read > 0 && ` · ${tokens(c.tokens.read)} in / ${tokens(c.tokens.wrote)} out`}
              </div>
              {h.tools.filter((t) => t.call === c.n).map((t) => {
                const st = statusLabel(t.status)
                return (
                  <div key={t.id} className="pl-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <code className="min-w-0 truncate">{t.name}({shortArgs(t.input, 40)})</code>
                      <span className={cn('shrink-0', st.tone === 'bad' ? 'text-bad' : 'text-muted')}>
                        · {st.label}{t.chars != null && ` · ${count(t.chars)} characters`}
                      </span>
                    </div>
                    {/* your hooks run around a helper's tools too */}
                    {t.hooks?.length ? <HookLine hooks={t.hooks} /> : null}
                  </div>
                )
              })}
            </li>
          ))}
        </ol>
      )}
      <Explain concept="helper" quiet />
    </div>
  )
}

// What each of your hooks did for one of the helper's tools, in the order they ran
function HookLine({ hooks }: { hooks: HookRecord[] }) {
  return (
    <div className="pl-3 text-muted">
      your hooks:{' '}
      {hooks.map((h, i) => (
        <span key={`${h.hook}-${i}`}>
          {i > 0 && ' · '}<code>{h.hook}</code>{' '}
          <span className={h.verdict === 'blocked' || h.verdict === 'failed' ? 'text-bad' : h.verdict === 'replaced' ? 'text-warn' : undefined}>
            {VERDICT_WORDS[h.verdict]}
          </span>
          {h.reason && <>: “{h.reason}”</>}
          {h.error && <>: {h.error}</>}
          {' '}({took(h.ms)})
        </span>
      ))}
    </div>
  )
}

function Funnel({ helper: h }: { helper: Helper }) {
  const charsRead = h.tools.reduce((n, t) => n + (t.status === 'ran' ? t.chars ?? 0 : 0), 0)
  const used = h.tools.filter((t) => t.status === 'ran').length
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-sunken px-3 py-2 text-xs">
      <span>
        {h.tokens.read > 0
          ? <>read <b>{h.estimated && '≈ '}{tokens(h.tokens.read)}</b> tokens over {plural(h.calls.length, 'call')}</>
          : <>made {plural(h.calls.length, 'call')} and took in <b>{count(charsRead)}</b> characters from {plural(used, 'tool result')}</>}
        {h.cost > 0 && <span className="text-muted"> ({dollars(h.cost)})</span>}
      </span>
      <ArrowRight className="size-3.5 text-muted" aria-hidden />
      <span>
        {h.reportChars != null
          ? <>returned <b>{count(h.reportChars)}</b> characters to the main conversation</>
          : h.running ? 'working…' : 'returned nothing'}
      </span>
    </div>
  )
}
