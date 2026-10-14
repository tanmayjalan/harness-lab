// The size of every call in this conversation, one bar each. It grows as the history grows,
// and drops where trimming or summarising cut it. Click a bar to inspect that call.
import { Scissors } from 'lucide-react'
import type { SeriesPoint } from '../../model/inspector'
import { approx, count, tokens } from '../../lib/format'

export function TokenChart({ points, selected, onSelect, useTokens, estimated = false }:
  { points: SeriesPoint[]; selected: string | null; onSelect: (id: string) => void; useTokens: boolean; estimated?: boolean }) {
  if (!points.length) return null
  const value = (p: SeriesPoint) => (useTokens ? p.read : p.chars)
  // In characters, a trimmed call also shows how big it would have been untrimmed (dashed)
  // (in tokens, the trimmed characters are counted at about 4 per token)
  const full = (p: SeriesPoint) => (useTokens ? value(p) + p.trimmedChars / 4 : p.chars + p.trimmedChars)
  const max = Math.max(...points.map(full), 1)
  const W = 400
  const H = 120
  const top = 16
  const bottom = 18
  const gap = 4
  const runGap = 10
  const runs = new Set(points.map((p) => p.runIndex)).size
  const bar = Math.max(4, Math.min(28, (W - gap * points.length - runGap * (runs - 1)) / points.length))
  let x = 0
  let lastRun = points[0].runIndex
  const placed = points.map((p) => {
    if (p.runIndex !== lastRun) {
      x += runGap
      lastRun = p.runIndex
    }
    const at = x
    x += bar + gap
    return { p, x: at, h: Math.max(2, ((H - top - bottom) * value(p)) / max), hFull: ((H - top - bottom) * full(p)) / max }
  })
  const width = Math.max(x, 60)
  // "msg N" labels are about 30 units wide: with narrow bars, label every few messages only
  const runIndexes = [...new Set(points.map((p) => p.runIndex))]
  const stride = Math.max(1, Math.ceil(30 / Math.max(1, (x / Math.max(1, runIndexes.length)))))

  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${width} ${H}`} className="h-32 w-full" preserveAspectRatio="xMinYMax meet"
        role="group" aria-label="Size of each call in this conversation. Use the arrow keys to move between calls."
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
        {placed.map(({ p, x, h, hFull }, i) => {
          const y = H - bottom - h
          const on = p.callId === selected
          const runStart = i === 0 || placed[i - 1].p.runIndex !== p.runIndex
          return (
            <g key={p.callId} onClick={() => onSelect(p.callId)} className="cursor-pointer outline-none focus-visible:[&>rect:first-of-type]:stroke-accent"
              role="button" tabIndex={on || (!selected && i === placed.length - 1) ? 0 : -1} data-call={p.callId} aria-pressed={on}
              aria-label={`Message ${p.runIndex}, call ${p.turn}: ${useTokens ? `${approx(count(p.read), estimated)} tokens` : `${count(p.chars)} characters`}`
                + (p.trimmedChars ? `, trimmed ${count(p.trimmedChars)} characters` : '') + (p.summarisedBefore ? ', summarised before' : '')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.callId) } }}>
              <title>
                {`Message ${p.runIndex}, call ${p.turn}: ${useTokens ? `${approx(count(p.read), estimated)} tokens read` : `${count(p.chars)} characters sent`}` +
                  (p.trimmedChars ? ` · trimming removed ${count(p.trimmedChars)} characters` : '') +
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
      <figcaption className="flex flex-wrap gap-x-3 text-xs text-muted">
        <span>Bar = {useTokens ? 'tokens read by the call' : 'characters sent (this provider reports no tokens)'}</span>
        {useTokens && <span>hatched = read from the cache</span>}
        {points.some((p) => p.trimmedChars) && (
          <span className="inline-flex items-center gap-1 text-warn"><Scissors aria-hidden className="size-3" />trimmed (dashed: about the size it would have been)</span>
        )}
        {points.some((p) => p.summarisedBefore) && <span className="inline-flex items-center gap-1 text-warn"><span aria-hidden className="inline-block h-3 border-l border-dashed border-warn" />summarised before</span>}
        <span>top of chart = {useTokens ? `${approx(tokens(max), estimated)} tokens` : `${count(max)} characters`}</span>
        <span>click a bar, or use ← → once one is focused, to inspect that call</span>
      </figcaption>
    </figure>
  )
}
