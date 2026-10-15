// The loop as a small diagram; the step the selected call is at lights up.
// The boxes and arrows are drawn (SVG) and shrink with the panel; the words are page text placed over
// them, so they keep a readable size however narrow the panel gets (F331).
import { cn } from '../../lib/cn'

export type LoopNode = 'you' | 'call' | 'reply' | 'tools' | 'answer'

const NODES: { id: LoopNode; x: number; y: number; title: string; sub: string }[] = [
  { id: 'you', x: 10, y: 50, title: '1. You', sub: 'type a message' },
  { id: 'call', x: 172, y: 50, title: '2. Call the model', sub: 'send the whole history' },
  { id: 'reply', x: 334, y: 50, title: '3. Model replies', sub: 'why did it stop?' },
  { id: 'tools', x: 496, y: 50, title: '4. Run tools', sub: 'on this computer' },
  { id: 'answer', x: 334, y: 136, title: '5. Show answer', sub: 'the loop ends' },
]

const EDGES: { from: LoopNode; to: LoopNode; d: string }[] = [
  { from: 'you', to: 'call', d: 'M140,74 L172,74' },
  { from: 'call', to: 'reply', d: 'M302,74 L334,74' },
  { from: 'reply', to: 'tools', d: 'M464,74 L496,74' },
  { from: 'tools', to: 'call', d: 'M561,50 L561,24 L237,24 L237,48' },
  { from: 'reply', to: 'answer', d: 'M399,98 L399,136' },
]

// The drawing's size in its own units: the labels are placed by percentages of it
const W = 640
const H = 190
const BOX_W = 130
const BOX_H = 48
const x = (v: number) => `${(v / W) * 100}%`
const y = (v: number) => `${(v / H) * 100}%`

// Below this width the second lines and edge notes can't fit their places, so they give way to the
// one-line legend, as in `compact` (a container query: it follows the diagram's width, not the window's)
const ROOMY = '@max-[34rem]:hidden'

// A title is 12 px (text-xs), but never more than two lines can fit its box: the box is 7.5 % of the
// drawing's width tall, so at most 3.75 % of it a line (cqi: a percent of the diagram's width). Where the
// title may wrap (compact, or below 34rem) its lines close up (leading-none). At 1024 px with the sidebar
// open that is 12 px at Medium text, and at Large text it stays 12 px instead of growing past the box.
const TITLE = 'text-[length:min(0.75rem,3.75cqi)] font-semibold'

// `compact`: leave out the small second lines and edge notes (too small to read in a narrow panel)
// `early`: the reply stopped for another reason (the length limit, say): marked under the reply box
// `hooks`: what your hooks did in this call ("1 blocked, 1 rewrote"), marked under the tools box
export function LoopDiagram({ active, path = [], className, compact = false, early = false, hooks = '' }:
  { active: LoopNode | null; path?: LoopNode[]; className?: string; compact?: boolean; early?: boolean; hooks?: string }) {
  const lit = (from: LoopNode, to: LoopNode) => path.some((n, i) => n === from && path[i + 1] === to)
  const name = (id: LoopNode) => NODES.find((n) => n.id === id)!.title.replace(/^\d\. /, '')
  const label = path.length && active
    ? `Harness loop: this call went ${path.map(name).join(' → ')}; now at ${name(active)}${early ? ' (stopped early)' : ''}${hooks ? `; your hooks: ${hooks}` : ''}`
    : `Diagram of the harness loop: ${NODES.map((n) => n.title).join(', ')}; asking for tools loops back to Call the model; a finished reply ends it`
  const reply = NODES.find((n) => n.id === 'reply')!
  const tools = NODES.find((n) => n.id === 'tools')!
  return (
    <div className={cn('@container', className)}>
      <div role="img" aria-label={label} className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden className="block h-auto w-full">
          <defs>
            <marker id="loop-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--line-strong)" />
            </marker>
            <marker id="loop-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
            </marker>
          </defs>
          {EDGES.map((e) => {
            const on = lit(e.from, e.to)
            return (
              <path key={e.d} d={e.d} fill="none" strokeWidth={on ? 2.5 : 1.5}
                stroke={on ? 'var(--accent)' : 'var(--line-strong)'} markerEnd={`url(#${on ? 'loop-arrow-on' : 'loop-arrow'})`} />
            )
          })}
          {NODES.map((n) => {
            const on = active === n.id
            return (
              <rect key={n.id} x={n.x} y={n.y} width={BOX_W} height={BOX_H} rx="8" strokeWidth={on ? 2 : 1}
                fill={on ? 'var(--accent-soft)' : 'var(--panel)'} stroke={on ? 'var(--accent)' : 'var(--line-strong)'} />
            )
          })}
        </svg>
        {NODES.map((n) => (
          <div key={n.id} className="absolute flex flex-col items-center justify-center px-0.5 text-center"
            style={{ left: x(n.x), top: y(n.y), width: x(BOX_W), height: y(BOX_H) }}>
            <div className={cn(TITLE, compact ? 'leading-none' : 'leading-tight @max-[34rem]:leading-none', active === n.id ? 'text-accent' : 'text-fg')}>
              {n.title}
            </div>
            {!compact && <div className={cn('text-2xs leading-tight text-muted', ROOMY)}>{n.sub}</div>}
          </div>
        ))}
        {!compact && (
          <>
            <div className={cn('absolute -translate-x-1/2 text-2xs leading-tight whitespace-nowrap text-muted', ROOMY)}
              style={{ left: x(399), top: y(3) }}>
              asked for tools: run them, send the results, call again
            </div>
            {/* to the right of the down arrow, so it clears "stopped early" on the left */}
            <div className={cn('absolute text-2xs leading-tight whitespace-nowrap text-muted', ROOMY)}
              style={{ left: x(405), top: y(100) }}>
              finished
            </div>
            {/* what your hooks did around the tools in this call; ends at the box's right edge. F414: only when
                they did something (on the welcome page hooks are not taught yet) */}
            {hooks && (
              <div className={cn('absolute text-right text-2xs leading-tight font-semibold whitespace-nowrap text-warn', ROOMY)}
                style={{ right: x(W - tools.x - BOX_W), top: y(tools.y + BOX_H + 2) }}>
                <div>your hooks:</div>
                <div>{hooks}</div>
              </div>
            )}
          </>
        )}
        {/* to the left of the down arrow */}
        {early && (
          <div className="absolute text-right text-xs leading-tight font-semibold whitespace-nowrap text-bad"
            style={{ right: x(W - 393), top: y(reply.y + BOX_H + 2) }}>
            stopped early
          </div>
        )}
      </div>
      {/* outside the image, so it is read; in a roomy diagram it shows only when the notes above can't fit */}
      <p className={cn('text-center text-xs text-muted', !compact && 'hidden @max-[34rem]:block')}>
        asked for tools: run them, call again · finished: show the answer
        {hooks && <span className="font-semibold text-warn"> · your hooks: {hooks}</span>}
      </p>
    </div>
  )
}

// The same loop as one line, for the top of the Inspector: the full drawing is on the new-conversation page.
// The steps this call went through are in plain text, the one it is at is marked; the rest stay faint.
const STRIP: { id: LoopNode; label: string }[] = [
  { id: 'you', label: 'You' }, { id: 'call', label: 'Call' }, { id: 'reply', label: 'Reply' },
  { id: 'tools', label: 'Tools' }, { id: 'answer', label: 'Answer' },
]

export function LoopStrip({ active, path = [], className, early = false, hooks = '' }:
  { active: LoopNode | null; path?: LoopNode[]; className?: string; early?: boolean; hooks?: string }) {
  const name = (id: LoopNode) => NODES.find((n) => n.id === id)!.title.replace(/^\d\. /, '')
  const label = path.length && active
    ? `Harness loop: this call went ${path.map(name).join(' → ')}; now at ${name(active)}${early ? ' (stopped early)' : ''}${hooks ? `; your hooks: ${hooks}` : ''}`
    : `The harness loop: ${STRIP.map((s) => s.label).join(', ')}`
  return (
    <div role="img" aria-label={label} className={cn('flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs', className)}>
      {STRIP.map((s, i) => (
        <span key={s.id} aria-hidden className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-muted">→</span>}
          <span className={cn('rounded border px-1.5',
            active === s.id ? 'border-accent bg-accent-soft font-medium text-accent'
              : path.includes(s.id) ? 'border-line text-fg' : 'border-transparent text-muted')}>
            {s.label}
          </span>
        </span>
      ))}
      {early && <span aria-hidden className="ml-1 font-semibold text-bad">stopped early</span>}
      {hooks && <span aria-hidden className="ml-1 font-semibold text-warn">your hooks: {hooks}</span>}
    </div>
  )
}
