// JSON you can fold: every object and list opens and closes on its own, long text is clipped
// until you ask for all of it. "Open all" / "Fold all" reach every level.
// A tree for the keyboard (F333): one Tab stop, ↑ ↓ move between lines, → opens (or goes in), ← folds (or goes
// out), Home / End jump, Enter opens or folds a line (and shows all of a clipped text).
import { ChevronRight } from 'lucide-react'
import { createContext, useContext, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { count } from '../../lib/format'

type Command = { n: number; open: boolean } // bumped by Open all / Fold all
const AllCtx = createContext<Command>({ n: 0, open: false })
// The line that takes Tab (by its path in the value), and a way to move it
const FocusCtx = createContext<{ active: string; setActive: (path: string) => void }>({ active: '', setActive: () => {} })

const CLIP = 160

function summary(value: unknown): string {
  if (Array.isArray(value)) return `[ ${value.length} item${value.length === 1 ? '' : 's'} ]`
  const v = value as Record<string, unknown>
  // a message or block: show what it is, so a folded list still reads well
  const hint = typeof v.role === 'string' ? `role: "${v.role}"` : typeof v.type === 'string' ? `type: "${v.type}"`
    : typeof v.kind === 'string' ? `kind: "${v.kind}"` : ''
  const n = Object.keys(v).length
  return `{ ${hint ? `${hint}, ` : ''}${n} key${n === 1 ? '' : 's'} }`
}

function Leaf({ value, after, all, setAll }: { value: unknown; after?: ReactNode; all: boolean; setAll: (all: boolean) => void }) {
  if (typeof value === 'string') {
    const long = value.length > CLIP
    return (
      <span className="break-words whitespace-pre-wrap text-ok">
        "{long && !all ? value.slice(0, CLIP) : value}"{after}
        {long && (
          // (not a Tab stop of its own: Enter on the line does the same)
          <button type="button" tabIndex={-1} onClick={() => setAll(!all)} className="ml-1 text-accent hover:underline">
            {all ? 'less' : `… +${count(value.length - CLIP)} characters`}
          </button>
        )}
      </span>
    )
  }
  return <><span className={cn(typeof value === 'number' ? 'text-accent' : 'text-warn')}>{String(value)}</span>{after}</>
}

// Moves focus to another line of the same tree
function move(from: HTMLElement, key: string) {
  const tree = from.closest('[role="tree"]')
  if (!tree) return false
  const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')]
  const i = items.indexOf(from)
  const to = key === 'ArrowDown' ? items[i + 1] : key === 'ArrowUp' ? items[i - 1]
    : key === 'Home' ? items[0] : key === 'End' ? items[items.length - 1]
      : key === 'parent' ? from.parentElement?.closest<HTMLElement>('[role="treeitem"]') : null
  to?.focus()
  return !!to
}

// comma: more entries follow this one, so it ends with a comma like JSON does
function Node({ name, value, depth, openDepth, comma = false, path }:
  { name?: string; value: unknown; depth: number; openDepth: number; comma?: boolean; path: string }) {
  const all = useContext(AllCtx)
  const { active, setActive } = useContext(FocusCtx)
  const branch = value !== null && typeof value === 'object'
  const [open, setOpen] = useState(depth < openDepth)
  const [whole, setWhole] = useState(false) // a long text shown in full
  const rowId = useId()
  useEffect(() => {
    if (all.n) setOpen(all.open)
  }, [all])
  // Folded while the Tab stop was a line inside: this line takes it, so the tree keeps one
  useEffect(() => {
    if (!open && active.startsWith(`${path}/`)) setActive(path)
  }, [open, active, path, setActive])

  const label = name !== undefined && <span className="text-fg">{name}: </span>
  const sep = comma && <span className="text-muted">,</span>
  const item = {
    role: 'treeitem',
    tabIndex: active === path ? 0 : -1,
    onFocus: (e: React.FocusEvent) => { if (e.target === e.currentTarget) setActive(path) },
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return
      if (e.altKey || e.ctrlKey || e.metaKey) return // Alt+← is the Inspector's "previous call": don't fold a line too
      const el = e.currentTarget
      let done = true
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') move(el, e.key)
      else if (e.key === 'ArrowRight') {
        if (branch && !open) setOpen(true)
        else if (branch) move(el, 'ArrowDown')
      } else if (e.key === 'ArrowLeft') {
        if (branch && open) setOpen(false)
        else move(el, 'parent')
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (branch) setOpen(!open)
        else if (typeof value === 'string' && value.length > CLIP) setWhole(!whole)
      } else done = false
      if (done) e.preventDefault()
    },
  } as const
  if (!branch) {
    return <div {...item} className="json-row pl-4">{label}<Leaf value={value} after={sep} all={whole} setAll={setWhole} /></div>
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as object)
  return (
    <div {...item} aria-expanded={open} aria-labelledby={rowId}>
      <div id={rowId} onClick={() => setOpen(!open)}
        className="json-row flex cursor-pointer items-center gap-0.5 rounded text-left hover:bg-sunken">
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted transition-transform', open && 'rotate-90')} aria-hidden />
        {label}<span className="text-muted">{open ? (Array.isArray(value) ? '[' : '{') : summary(value)}</span>{!open && sep}
      </div>
      {open && (
        <>
          <div role="group" className="ml-1.5 border-l border-line pl-1.5">
            {entries.map(([k, v], i) => <Node key={k} name={k} value={v} depth={depth + 1} openDepth={openDepth}
              comma={i < entries.length - 1} path={`${path}/${k}`} />)}
          </div>
          {/* the closing bracket, under the line that opened it */}
          <div aria-hidden className="pl-4 text-muted">{Array.isArray(value) ? ']' : '}'}{sep}</div>
        </>
      )}
    </div>
  )
}

// `label`: what the tree is, for screen readers ("Request", "Input shape for get_weather")
export function JsonTree({ value, openDepth = 2, command, label = 'JSON' }: { value: unknown; openDepth?: number; command: Command; label?: string }) {
  const [active, setActive] = useState('')
  return (
    <AllCtx.Provider value={command}>
      <FocusCtx.Provider value={{ active, setActive }}>
        <div role="tree" aria-label={label} className="font-mono text-xs leading-5">
          <Node value={value} depth={0} openDepth={openDepth} path="" />
        </div>
      </FocusCtx.Provider>
    </AllCtx.Provider>
  )
}
