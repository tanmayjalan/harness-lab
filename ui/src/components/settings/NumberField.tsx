// A number setting: kept within the range the server accepts, saved on Enter or when you leave
// the field, and put back to the saved value if it is blank or the server refuses it.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Field } from '../ui'
import { count } from '../../lib/format'

type Props = {
  label: string
  value: number // the saved value
  min: number
  max: number
  defaultValue: number
  step?: number
  unit?: ReactNode
  hint?: ReactNode // a sentence before the range
  className?: string
  onCommit: (n: number) => Promise<boolean> | boolean // false: refused, put the saved value back
}

export function NumberField({ label, value, min, max, defaultValue, step = 1, unit, hint, className, onCommit }: Props) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const id = useId()
  // F341: a typed number outside the range is put in range, and the hint says so for a few seconds
  const [clampNote, setClampNote] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const commit = async () => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) return setText(String(value))
    const clamped = Math.min(max, Math.max(min, Math.round(n)))
    if (n > max || n < min) {
      setClampNote(n > max ? `Set to ${count(max)} (the most allowed).` : `Set to ${count(min)} (the least allowed).`)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setClampNote(''), 3000)
    }
    setText(String(clamped))
    if (clamped === value) return
    if (!(await onCommit(clamped))) setText(String(value))
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={`${id}-field`}>{label}</label>
      <Field id={`${id}-field`} size="sm" type="number" min={min} max={max} step={step} value={text} aria-describedby={`${id}-hint`}
        onChange={(e) => setText(e.target.value)} onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commit() } }}
        className={className ?? 'w-24'} />
      {unit}
      <p id={`${id}-hint`} className="w-full text-xs text-muted">
        {clampNote && <span className="font-medium text-warn">{clampNote} </span>}
        {hint ? <>{hint} </> : null}{count(min)} to {count(max)}; default {count(defaultValue)}.
      </p>
    </div>
  )
}
