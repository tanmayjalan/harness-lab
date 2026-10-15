// A workflow as a diagram: two loops, one inside the other.
//   the outer chain   the steps, in an order your code fixes (gather → write → check, and fix → check again)
//   the inner loop    inside each step, the model calls tools until it decides it's done
// With `steps` (a message that ran), the steps it went through light up and the running one is marked.
// As in the loop diagram (LoopDiagram.tsx, F331): the boxes and arrows are drawn (SVG) and scale with the
// column; the words are page text placed over them by percentages, so they keep the page's size and follow
// the Large text setting (VIZ-2). The headings above and below are ordinary text that wraps.
import type { WorkflowStep } from '../../model/derive'
import type { WorkflowStepName } from '../../api/types'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Box = { id: WorkflowStepName | 'answer'; x: number; y: number; w: number; h: number; title: string; tools: boolean }

const W = 108 // a step's width
const H = 86 // a step's height
const TOP = 44 // where the step boxes start
const BOXES: Box[] = [
  { id: 'gather', x: 4, y: TOP, w: W, h: H, title: '1. Gather facts', tools: true },
  { id: 'write', x: 132, y: TOP, w: W, h: H, title: '2. Write', tools: false },
  { id: 'check', x: 260, y: TOP, w: W, h: H, title: '3. Check', tools: false },
  { id: 'fix', x: 260, y: 176, w: W, h: H, title: 'Fix', tools: false },
  { id: 'answer', x: 390, y: TOP + 20, w: 66, h: 46, title: 'Answer', tools: false },
]

const MID = TOP + H / 2
// `label`: where its words go. `x` is the middle ('middle'), the left edge ('start') or the right edge ('end');
// `y` is the top of the words
type Edge = { from: Box['id']; to: Box['id']; d: string; label?: { x: number; y: number; text: string; anchor?: 'start' | 'end' | 'middle' } }
const EDGES: Edge[] = [
  { from: 'gather', to: 'write', d: `M112,${MID} L130,${MID}` },
  { from: 'write', to: 'check', d: `M240,${MID} L258,${MID}` },
  { from: 'check', to: 'answer', d: `M368,${MID} L388,${MID}`, label: { x: 379, y: MID - 19, text: 'PASS' } },
  { from: 'check', to: 'fix', d: `M286,${TOP + H} L286,174`, label: { x: 280, y: 146, text: 'problems', anchor: 'end' } },
  { from: 'fix', to: 'check', d: `M342,176 L342,${TOP + H + 2}`, label: { x: 348, y: 146, text: 'check again', anchor: 'start' } },
]

// The drawing's area in its own units (the frame, with a little room around it): the words are placed by
// percentages of it
const VX = 460
const VY0 = 26
const VH = 248
const px = (v: number) => `${(v / VX) * 100}%`
const py = (v: number) => `${((v - VY0) / VH) * 100}%`
const pw = (v: number) => `${(v / VX) * 100}%`
const ph = (v: number) => `${(v / VH) * 100}%`

// Text keeps the page's size (12 px titles, 11 px notes at Medium text) until the boxes are too small for
// it: then it shrinks with the drawing (cqi: a percent of the drawing's width), as in the loop diagram.
// A title's strip is 26 units tall (5.65 % of the width), so two lines of 2.8 % fit when it wraps.
const TITLE = 'text-[length:min(0.75rem,2.8cqi)] font-semibold leading-none'
const NOTE = 'text-[length:min(0.6875rem,2.4cqi)] leading-tight'

const name = (id: Box['id']) => BOXES.find((b) => b.id === id)!.title.replace(/^\d\. /, '')

// The steps a message went through, as box ids in order (ending at the answer when it finished)
function pathOf(steps: WorkflowStep[], answered: boolean): Box['id'][] {
  const ids: Box['id'][] = steps.map((s) => s.name)
  return answered ? [...ids, 'answer'] : ids
}

// Words placed over the drawing: a box (in the drawing's units) the text is centred in
function Place({ x, y, w, h, className, children }: { x: number; y: number; w: number; h: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn('absolute flex items-center justify-center px-0.5 text-center', className)}
      style={{ left: px(x), top: py(y), width: pw(w), height: ph(h) }}>
      {children}
    </div>
  )
}

export function WorkflowDiagram({ steps, answered = false, fixes = 2, className }:
  { steps?: WorkflowStep[]; answered?: boolean; fixes?: number; className?: string }) {
  const path = steps ? pathOf(steps, answered) : []
  const running = steps?.find((s) => s.running)?.name ?? null
  const visited = new Set(path)
  const lit = (from: Box['id'], to: Box['id']) => path.some((n, i) => n === from && path[i + 1] === to)
  const fixed = steps?.filter((s) => s.name === 'fix').length ?? 0
  const callsIn = (id: Box['id']) => steps?.filter((s) => s.name === id).reduce((n, s) => n + s.callIds.length, 0) ?? 0
  const label = path.length
    ? `Workflow diagram: this message went ${path.map(name).join(' → ')}${running ? `; now at ${name(running)}` : ''}`
    : 'Workflow diagram: an outer chain of steps your code runs in order (gather facts, write, check, then fix and check again if needed, then the answer); inside each step, an inner loop where the model calls tools until it decides it is done'
  return (
    // The drawing takes its height from its width (its text no longer shrinks to fit a height), so a
    // caller's max-height is lifted; its width is capped instead, in rem so it grows with Large text
    <div className={cn(className, 'max-h-none')}>
      <div role="img" aria-label={label} className="mx-auto max-w-[30rem] space-y-1">
        <p aria-hidden className="text-xs">
          <span className="font-semibold text-fg">Outer chain</span> <span className="text-muted">· your code runs these steps in order</span>
        </p>
        <div className="@container relative">
          <svg viewBox={`0 ${VY0} ${VX} ${VH}`} aria-hidden className="block h-auto w-full">
            <defs>
              <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--line-strong)" />
              </marker>
              <marker id="flow-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
              </marker>
            </defs>

            {/* The outer chain: a frame around it */}
            <rect x="0.5" y="28" width="459" height="242" rx="10" fill="none" stroke="var(--line-strong)" strokeDasharray="5 4" />

            {EDGES.map((e) => {
              const on = lit(e.from, e.to)
              return (
                <path key={e.d} d={e.d} fill="none" strokeWidth={on ? 2.5 : 1.5} stroke={on ? 'var(--accent)' : 'var(--line-strong)'}
                  markerEnd={`url(#${on ? 'flow-arrow-on' : 'flow-arrow'})`} />
              )
            })}

            {BOXES.map((b) => {
              const on = running === b.id
              const seen = visited.has(b.id)
              return (
                <g key={b.id}>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="8" strokeWidth={on || seen ? 2 : 1}
                    fill={on ? 'var(--accent-soft)' : 'var(--panel)'} stroke={on || seen ? 'var(--accent)' : 'var(--line-strong)'} />
                  {b.id !== 'answer' && <InnerLoop x={b.x + 8} y={b.y + 28} w={b.w - 16} tools={b.tools} />}
                </g>
              )
            })}
          </svg>

          {BOXES.map((b) => {
            const on = running === b.id
            const seen = visited.has(b.id)
            const calls = callsIn(b.id)
            const ix = b.x + 8 // the inner loop's box
            const iw = b.w - 16
            const iy = b.y + 28
            return (
              <div key={b.id} aria-hidden>
                {/* the title: across the box's top (or the whole box, for the answer) */}
                <Place x={b.x} y={b.id === 'answer' ? b.y : b.y + 2} w={b.w} h={b.id === 'answer' ? b.h : 26}
                  className={cn(TITLE, on || seen ? 'text-accent' : 'text-fg')}>
                  {b.title}{seen && !on && b.id !== 'answer' ? ' ✓' : ''}
                </Place>
                {b.id !== 'answer' && (b.tools
                  ? <>
                    <Place x={ix} y={iy} w={iw / 2 - 8} h={32} className={cn(NOTE, 'text-fg')}>model</Place>
                    <Place x={ix + iw / 2 + 8} y={iy} w={iw / 2 - 8} h={32} className={cn(NOTE, 'text-fg')}>tools</Place>
                  </>
                  : <Place x={ix} y={iy} w={iw} h={32} className={cn(NOTE, 'text-fg')}>model → reply</Place>)}
                {/* how many calls it made, or what it may do */}
                {b.id !== 'answer' && (
                  <Place x={b.x} y={b.y + 60} w={b.w} h={26} className={cn(NOTE, on ? 'font-semibold text-accent' : 'text-muted')}>
                    {on ? 'running…' : calls ? `${calls} call${calls === 1 ? '' : 's'}` : b.tools ? 'read-only tools' : 'no tools: 1 call'}
                  </Place>
                )}
              </div>
            )
          })}

          {EDGES.filter((e) => e.label).map((e) => {
            const on = lit(e.from, e.to)
            const l = e.label!
            const anchor = l.anchor ?? 'middle'
            return (
              <div key={e.d} aria-hidden
                className={cn('absolute whitespace-nowrap', NOTE, anchor === 'middle' && '-translate-x-1/2', anchor === 'end' && 'text-right',
                  on ? 'font-semibold text-accent' : 'text-muted')}
                style={{ top: py(l.y), ...(anchor === 'end' ? { right: px(VX - l.x) } : { left: px(l.x) }) }}>
                {l.text}
              </div>
            )
          })}

          {/* the limit on fixes, in the empty space beside the Fix box */}
          <div aria-hidden className={cn('absolute text-right whitespace-nowrap text-muted', NOTE)}
            style={{ right: px(VX - 250), top: py(198) }}>
            <div>at most {fixes} fixes,</div>
            <div>then the last draft</div>
            {fixed > 0 && <div className="font-semibold text-accent">fixed {fixed}×</div>}
          </div>
        </div>
        <p aria-hidden className="text-xs text-muted">
          <span className="font-semibold text-fg">Inner loop</span> · in each box, a fresh conversation: the model decides
          which tools to call and when it&apos;s done
        </p>
      </div>
    </div>
  )
}

// The loop inside one step, drawn small: call the model, run tools, call again (or just one call, with no tools).
// Only the shapes: its words are placed over it by WorkflowDiagram.
function InnerLoop({ x, y, w, tools }: { x: number; y: number; w: number; tools: boolean }) {
  const h = 32
  if (!tools) return <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--sunken)" stroke="var(--line)" />
  const mid = x + w / 2
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--sunken)" stroke="var(--line)" />
      {/* asks for a tool → result back → ... until it answers */}
      <path d={`M${mid - 8},${y + 11} Q${mid},${y + 4} ${mid + 8},${y + 11}`} fill="none" stroke="var(--line-strong)" strokeWidth="1.2" markerEnd="url(#flow-arrow)" />
      <path d={`M${mid + 8},${y + 22} Q${mid},${y + 29} ${mid - 8},${y + 22}`} fill="none" stroke="var(--line-strong)" strokeWidth="1.2" markerEnd="url(#flow-arrow)" />
    </g>
  )
}
