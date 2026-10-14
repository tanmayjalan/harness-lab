// A workflow as a diagram: two loops, one inside the other.
//   the outer chain   the steps, in an order your code fixes (gather → write → check, and fix → check again)
//   the inner loop    inside each step, the model calls tools until it decides it's done
// With `steps` (a message that ran), the steps it went through light up and the running one is marked.
// Drawn on a narrow canvas (460 wide) so its text stays readable in the conversation column.
import type { WorkflowStep } from '../../model/derive'
import type { WorkflowStepName } from '../../api/types'

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
type Edge = { from: Box['id']; to: Box['id']; d: string; label?: { x: number; y: number; text: string; anchor?: 'start' | 'end' | 'middle' } }
const EDGES: Edge[] = [
  { from: 'gather', to: 'write', d: `M112,${MID} L130,${MID}` },
  { from: 'write', to: 'check', d: `M240,${MID} L258,${MID}` },
  { from: 'check', to: 'answer', d: `M368,${MID} L388,${MID}`, label: { x: 379, y: MID - 8, text: 'PASS' } },
  { from: 'check', to: 'fix', d: `M286,${TOP + H} L286,174`, label: { x: 280, y: 156, text: 'problems', anchor: 'end' } },
  { from: 'fix', to: 'check', d: `M342,176 L342,${TOP + H + 2}`, label: { x: 348, y: 156, text: 'check again', anchor: 'start' } },
]

const name = (id: Box['id']) => BOXES.find((b) => b.id === id)!.title.replace(/^\d\. /, '')

// The steps a message went through, as box ids in order (ending at the answer when it finished)
function pathOf(steps: WorkflowStep[], answered: boolean): Box['id'][] {
  const ids: Box['id'][] = steps.map((s) => s.name)
  return answered ? [...ids, 'answer'] : ids
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
    <div className={className}>
      <svg viewBox="0 0 460 312" role="img" aria-label={label} className="h-full max-h-[inherit] w-full">
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--line-strong)" />
          </marker>
          <marker id="flow-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
        </defs>

        {/* The outer chain: a frame around it, and who decides */}
        <rect x="0.5" y="28" width="459" height="242" rx="10" fill="none" stroke="var(--line-strong)" strokeDasharray="5 4" />
        <text x="4" y="18" fontSize="13" fontWeight="600" fill="var(--text)">
          Outer chain <tspan fontWeight="400" fill="var(--muted)">· your code runs these steps in order</tspan>
        </text>

        {EDGES.map((e) => {
          const on = lit(e.from, e.to)
          return (
            <g key={e.d}>
              <path d={e.d} fill="none" strokeWidth={on ? 2.5 : 1.5} stroke={on ? 'var(--accent)' : 'var(--line-strong)'}
                markerEnd={`url(#${on ? 'flow-arrow-on' : 'flow-arrow'})`} />
              {e.label && (
                <text x={e.label.x} y={e.label.y} textAnchor={e.label.anchor ?? 'middle'} fontSize="11"
                  fill={on ? 'var(--accent)' : 'var(--muted)'} fontWeight={on ? 600 : 400}>{e.label.text}</text>
              )}
            </g>
          )
        })}
        {/* the limit on fixes, in the empty space beside the Fix box */}
        <text x="250" y="210" textAnchor="end" fontSize="11" fill="var(--muted)">
          <tspan x="250">at most {fixes} fixes,</tspan>
          <tspan x="250" dy="14">then the last draft</tspan>
          {fixed > 0 && <tspan x="250" dy="14" fontWeight="600" fill="var(--accent)">fixed {fixed}×</tspan>}
        </text>

        {BOXES.map((b) => {
          const on = running === b.id
          const seen = visited.has(b.id)
          const calls = callsIn(b.id)
          return (
            <g key={b.id}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="8" strokeWidth={on || seen ? 2 : 1}
                fill={on ? 'var(--accent-soft)' : 'var(--panel)'} stroke={on || seen ? 'var(--accent)' : 'var(--line-strong)'} />
              <text x={b.x + b.w / 2} y={b.y + (b.id === 'answer' ? 28 : 19)} textAnchor="middle" fontSize="13" fontWeight="600"
                fill={on || seen ? 'var(--accent)' : 'var(--text)'}>{b.title}{seen && !on && b.id !== 'answer' ? ' ✓' : ''}</text>
              {b.id !== 'answer' && <InnerLoop x={b.x + 8} y={b.y + 28} w={b.w - 16} tools={b.tools} />}
              {b.id !== 'answer' && (
                <text x={b.x + b.w / 2} y={b.y + b.h - 9} textAnchor="middle" fontSize="11" fill={on ? 'var(--accent)' : 'var(--muted)'}
                  fontWeight={on ? 600 : 400}>
                  {on ? 'running…' : calls ? `${calls} call${calls === 1 ? '' : 's'}` : b.tools ? 'read-only tools' : 'no tools: 1 call'}
                </text>
              )}
            </g>
          )
        })}

        {/* The inner loop's key */}
        <text x="4" y="290" fontSize="13" fontWeight="600" fill="var(--text)">
          Inner loop <tspan fontWeight="400" fill="var(--muted)">· in each box, a fresh conversation:</tspan>
        </text>
        <text x="4" y="307" fontSize="12" fill="var(--muted)">the model decides which tools to call and when it's done</text>
      </svg>
    </div>
  )
}

// The loop inside one step, drawn small: call the model, run tools, call again (or just one call, with no tools)
function InnerLoop({ x, y, w, tools }: { x: number; y: number; w: number; tools: boolean }) {
  const h = 32
  if (!tools) {
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--sunken)" stroke="var(--line)" />
        <text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize="11" fill="var(--text)">model → reply</text>
      </g>
    )
  }
  const mid = x + w / 2
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--sunken)" stroke="var(--line)" />
      <text x={x + 19} y={y + 20} textAnchor="middle" fontSize="11" fill="var(--text)">model</text>
      <text x={x + w - 17} y={y + 20} textAnchor="middle" fontSize="11" fill="var(--text)">tools</text>
      {/* asks for a tool → result back → ... until it answers */}
      <path d={`M${mid - 8},${y + 11} Q${mid},${y + 4} ${mid + 8},${y + 11}`} fill="none" stroke="var(--line-strong)" strokeWidth="1.2" markerEnd="url(#flow-arrow)" />
      <path d={`M${mid + 8},${y + 22} Q${mid},${y + 29} ${mid - 8},${y + 22}`} fill="none" stroke="var(--line-strong)" strokeWidth="1.2" markerEnd="url(#flow-arrow)" />
    </g>
  )
}
