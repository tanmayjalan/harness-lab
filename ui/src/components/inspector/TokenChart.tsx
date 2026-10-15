// The size of every call in this conversation, one bar each. It grows as the history grows,
// and drops where trimming or summarising cut it. Click a bar to inspect that call.
// Scale: the top is the largest call so far (default), or the model's context window, so a small
// conversation looks small next to what the model could take (VIZ-1).
import { useEffect, useRef, useState } from 'react'
import { Scissors } from 'lucide-react'
import type { SeriesPoint } from '../../model/inspector'
import { CHARS_PER_TOKEN, callWindow } from '../../model/context'
import { approx, count, tokens } from '../../lib/format'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { RadioRow } from '../ui'

type Scale = 'conversation' | 'window'

// `contextWindow`: the model's window in tokens. Left out, it is looked up for the selected call (or the
// last one) from the server's model list; null or unknown hides the scale switch.
export function TokenChart({ points, selected, onSelect, useTokens, estimated = false, contextWindow }:
  { points: SeriesPoint[]; selected: string | null; onSelect: (id: string) => void; useTokens: boolean; estimated?: boolean
    contextWindow?: number | null }) {
  const [scale, setScale] = useState<Scale>('conversation')
  const scroller = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const lookupId = selected ?? points[points.length - 1]?.callId ?? null
  const call = useSession((s) => (lookupId ? s.derived.calls[lookupId] : undefined))
  const looked = useServer((s) => callWindow(s.info, call))
  const ctxWindow = contextWindow === undefined ? looked : contextWindow

  const value = (p: SeriesPoint) => (useTokens ? p.read : p.chars)
  // In characters, a trimmed call also shows how big it would have been untrimmed (dashed)
  // (in tokens, the trimmed characters are counted at about 4 per token: a guess added to a measured count)
  const full = (p: SeriesPoint) => (useTokens ? value(p) + p.trimmedChars / CHARS_PER_TOKEN : p.chars + p.trimmedChars)
  const largest = Math.max(...points.map(full), 1)
  // The window in the chart's unit (characters: about 4 per token, so a guess)
  const windowUnits = ctxWindow ? (useTokens ? ctxWindow : ctxWindow * CHARS_PER_TOKEN) : 0
  const byWindow = scale === 'window' && windowUnits > 0
  const max = byWindow ? Math.max(windowUnits, largest) : largest
  // VIZ-4: the top is a measured count plus a characters/4 guess when a trimmed call sets it (tokens only)
  const topGuessed = !byWindow && useTokens && points.some((p) => p.trimmedChars > 0 && full(p) === largest)

  const W = 400
  const H = 120
  const top = 16
  const bottom = 18
  const gap = 4
  const runGap = 10
  const runs = new Set(points.map((p) => p.runIndex)).size
  // the width each bar would need for all of them to fit the drawing
  const fit = points.length ? (W - gap * points.length - runGap * (runs - 1)) / points.length : 0
  const bar = points.length ? Math.max(4, Math.min(28, fit)) : 0
  let x = 0
  let lastRun = points[0]?.runIndex
  const placed = points.map((p) => {
    if (p.runIndex !== lastRun) {
      x += runGap
      lastRun = p.runIndex
    }
    const at = x
    x += bar + gap
    return { p, x: at, h: Math.max(2, ((H - top - bottom) * value(p)) / max), hFull: ((H - top - bottom) * full(p)) / max }
  })
  // The ceiling's label needs room even when there are only a few bars
  const width = Math.max(x, byWindow ? 190 : 60)
  // VIZ-5: past about 50 calls the bars are at their narrowest; then the chart keeps its size and scrolls
  // sideways, instead of shrinking the whole drawing (and its labels) to fit
  const scrolls = points.length > 0 && fit < 4 // (not "x > W": adding up fractional bars can overshoot 400 by a hair)
  // "msg N" labels are about 30 units wide: with narrow bars, label every few messages only
  const runIndexes = [...new Set(points.map((p) => p.runIndex))]
  const stride = Math.max(1, Math.ceil(30 / Math.max(1, (x / Math.max(1, runIndexes.length)))))
  const ceilingY = byWindow ? top + (H - top - bottom) * (1 - windowUnits / max) : 0

  // Keep the selected bar in view when the chart scrolls
  const selectedX = placed.find((d) => d.p.callId === selected)?.x ?? null
  useEffect(() => {
    const box = scroller.current
    const svg = svgRef.current
    if (!scrolls || !box || !svg || selectedX === null) return
    const perUnit = svg.getBoundingClientRect().height / H
    if (!perUnit) return
    const left = selectedX * perUnit
    const right = (selectedX + bar) * perUnit
    if (left < box.scrollLeft) box.scrollLeft = Math.max(0, left - 24)
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + 24
  }, [scrolls, selectedX, bar])

  if (!points.length) return null

  const windowLabel = useTokens ? `${tokens(windowUnits)} tokens` : `${approx(tokens(windowUnits), true)} characters (${tokens(ctxWindow ?? 0)} tokens)`

  const chart = (
    <svg ref={svgRef} viewBox={`0 0 ${width} ${H}`} className={scrolls ? 'block h-32 max-w-none' : 'h-32 w-full'}
      style={scrolls ? { width: `calc(${(width / H).toFixed(4)} * 8rem)` } : undefined}
      preserveAspectRatio="xMinYMax meet"
      role="group" aria-label={`Size of each call in this conversation${byWindow ? ", against the model's context window" : ''}. Use the arrow keys to move between calls.`}
      onKeyDown={(e) => {
        // arrow keys move the selection; each bar is also a button (Tab, Enter)
        const i = points.findIndex((p) => p.callId === selected)
        const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
        if (next === null || !points[next]) return
        e.preventDefault()
        onSelect(points[next].callId)
        const svg = e.currentTarget // (React clears currentTarget once this handler returns)
        requestAnimationFrame(() => (svg.querySelector(`[data-call="${points[next].callId}"]`) as SVGElement | null)?.focus())
      }}>
      <defs>
        <pattern id="cached-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="var(--panel)" opacity="0.15" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--ok)" strokeWidth="2" />
        </pattern>
      </defs>
      {byWindow && (
        <g data-ceiling aria-hidden>
          <line x1={0} x2={width} y1={ceilingY} y2={ceilingY} stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
          <text x={1} y={Math.max(9, ceilingY - 3)} className="chart-text" fill="var(--muted)">
            context window: {windowLabel}
          </text>
        </g>
      )}
      {placed.map(({ p, x, h, hFull }, i) => {
        const y = H - bottom - h
        const on = p.callId === selected
        const runStart = i === 0 || placed[i - 1].p.runIndex !== p.runIndex
        // in tokens, the trimmed part is characters counted at about 4 per token
        const trimmedTokens = Math.round(p.trimmedChars / CHARS_PER_TOKEN)
        return (
          <g key={p.callId} onClick={() => onSelect(p.callId)} className="cursor-pointer outline-none focus-visible:[&>rect:first-of-type]:stroke-accent"
            role="button" tabIndex={on || (!selected && i === placed.length - 1) ? 0 : -1} data-call={p.callId} aria-pressed={on}
            aria-label={`Message ${p.runIndex}, call ${p.turn}: ${useTokens ? `${approx(count(p.read), estimated)} tokens` : `${count(p.chars)} characters`}`
              + (p.trimmedChars ? `, trimmed ${count(p.trimmedChars)} characters${useTokens ? ` (about ${count(trimmedTokens)} tokens)` : ''}` : '')
              + (p.summarisedBefore ? ', summarised before' : '')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.callId) } }}>
            <title>
              {`Message ${p.runIndex}, call ${p.turn}: ${useTokens ? `${approx(count(p.read), estimated)} tokens read` : `${count(p.chars)} characters sent`}` +
                (p.trimmedChars
                  ? useTokens
                    ? ` · about ${count(trimmedTokens)} tokens trimmed (${count(p.trimmedChars)} characters, at about ${CHARS_PER_TOKEN} per token)`
                    : ` · trimming removed ${count(p.trimmedChars)} characters`
                  : '') +
                (p.summarisedBefore ? ' · history summarised just before' : '')}
            </title>
            <rect x={x} y={top} width={bar} height={H - top - bottom} fill="transparent" strokeWidth="1.5" />
            {/* picked: keeps its colour in Windows high contrast, with an outline there too (.chart-selected, F335) */}
            <rect x={x} y={y} width={bar} height={h} rx="2" className={on ? 'chart-selected' : undefined}
              style={on ? { forcedColorAdjust: 'none' } : undefined}
              fill={on ? 'var(--accent)' : 'var(--line-strong)'} />
            {on && (
              <text x={x + bar / 2} y={Math.max(9, y - (p.trimmedChars ? 14 : 3))} textAnchor="middle" className="chart-text" fill="var(--accent)">
                {useTokens ? approx(tokens(p.read), estimated) : count(p.chars)}
              </text>
            )}
            {useTokens && p.cached > 0 && (
              <rect x={x} y={H - bottom - (h * p.cached) / Math.max(p.read, 1)} width={bar}
                height={(h * p.cached) / Math.max(p.read, 1)} rx="2" fill="url(#cached-hatch)" />
            )}
            {p.trimmedChars > 0 && (
              <rect x={x + 0.5} y={H - bottom - hFull} width={bar - 1} height={hFull - h} rx="2"
                fill="none" stroke="var(--warn)" strokeDasharray="3 2" />
            )}
            {p.trimmedChars > 0 && (
              <Scissors aria-hidden x={x + bar / 2 - 4.5} y={H - bottom - hFull - 12} width={9} height={9} color="var(--warn)" />
            )}
            {p.summarisedBefore && (
              <line x1={x - runGap / 2} x2={x - runGap / 2} y1={top - 6} y2={H - bottom} stroke="var(--warn)" strokeDasharray="3 2" />
            )}
            {runStart && runIndexes.indexOf(p.runIndex) % stride === 0 && (
              <text x={x} y={H - 4} className="chart-text" fill="var(--muted)">msg {p.runIndex}</text>
            )}
          </g>
        )
      })}
    </svg>
  )

  return (
    <figure className="space-y-1">
      {windowUnits > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span aria-hidden>Scale:</span>
          <RadioRow<Scale> label="Scale of the chart" value={scale} onChange={setScale} className="text-xs"
            itemClass={(_, on) => (on ? 'px-2 py-0.5 bg-accent-soft font-medium text-accent' : 'px-2 py-0.5 text-muted hover:text-fg')}
            options={[
              ['conversation', 'this conversation', 'The top of the chart is the largest call so far'],
              ['window', "the model's context window", 'The top of the chart is the most this model can take in on one call'],
            ]} />
        </div>
      )}
      {scrolls
        ? <div ref={scroller} className="overflow-x-auto pb-1">{chart}</div>
        : chart}
      <figcaption className="flex flex-wrap gap-x-3 text-xs text-muted">
        <span>Bar = {useTokens ? 'tokens read by the call' : 'characters sent (this provider reports no tokens)'}</span>
        {useTokens && <span>hatched = read from the cache</span>}
        {points.some((p) => p.trimmedChars) && (
          <span className="inline-flex items-center gap-1 text-warn"><Scissors aria-hidden className="size-3" />trimmed (dashed: about the size it would have been)</span>
        )}
        {points.some((p) => p.summarisedBefore) && <span className="inline-flex items-center gap-1 text-warn"><span aria-hidden className="inline-block h-3 border-l border-dashed border-warn" />summarised before</span>}
        <span>
          top of chart = {byWindow
            ? <>the model&apos;s context window, {windowLabel}{max > windowUnits ? ' (a call went past it)' : ''}</>
            : useTokens ? `${approx(tokens(max), estimated || topGuessed)} tokens${topGuessed ? ' (includes trimmed text counted at about 4 characters per token)' : ''}` : `${count(max)} characters`}
        </span>
        {scrolls && <span>scroll sideways to see every call</span>}
        <span>click a bar, or use ← → once one is focused, to inspect that call</span>
      </figcaption>
    </figure>
  )
}
