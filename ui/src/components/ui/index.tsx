// Small building blocks used everywhere: buttons, badges, keyboard hints, tooltips.
import * as RTooltip from '@radix-ui/react-tooltip'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { ChevronRight, Square } from 'lucide-react'
import {
  forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type DetailsHTMLAttributes, type HTMLAttributes,
  type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { cn } from '../../lib/cn'
import { elapsed } from '../../lib/format'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 disabled:opacity-50',
  secondary: 'bg-panel border border-line text-fg hover:bg-sunken disabled:opacity-50',
  ghost: 'text-fg hover:bg-sunken disabled:opacity-40',
  danger: 'bg-bad text-on-accent hover:brightness-110 disabled:opacity-50',
}
const sizes: Record<Size, string> = {
  sm: 'h-7 px-2 text-sm gap-1',
  md: 'h-9 px-3 text-base gap-2',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors',
        'focus-ring disabled:cursor-not-allowed',
        variants[variant], sizes[size], className)}
      {...rest}
    />
  )
})

// An icon-only button always has a label: shown as a tooltip and read by screen readers.
// `tip`: a longer tooltip when the label alone would leave something out
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string; tip?: ReactNode; shortcut?: string }>(
  function IconButton({ label, tip, shortcut, className, variant = 'ghost', size = 'md', 'aria-describedby': describedBy, ...rest }, ref) {
    // A longer tip is also the button's description, always: the tooltip shows only on hover or Tab
    // focus, which a screen reader's virtual cursor or voice control never trigger
    const tipId = useId()
    const described = tip != null && tip !== label
    return (
      <>
        <Tip text={tip ?? label} shortcut={shortcut}>
          <Button ref={ref} variant={variant} size={size} aria-label={label}
            aria-describedby={[describedBy, described ? tipId : null].filter(Boolean).join(' ') || undefined}
            className={cn('shrink-0', size === 'md' ? 'w-9 px-0' : 'w-7 px-0', className)} {...rest} />
        </Tip>
        {described && <span id={tipId} className="sr-only">{tip}</span>}
      </>
    )
  })

const matches = (el: Element, selector: string) => {
  try { return el.matches(selector) } catch { return false }
}
// Whether the last thing you did was press Tab: focus that arrives any other way (a dialog opening, a
// shortcut) does not open a tooltip, which the next Esc would then close instead of the dialog
let tabbed = false
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => { tabbed = e.key === 'Tab' }, true)
  document.addEventListener('pointerdown', () => { tabbed = false }, true)
}

export function Tip({ text, shortcut, children, side = 'bottom' }:
  { text: ReactNode; shortcut?: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  // Opens on hover, and on focus you moved with Tab; not when a dialog puts focus on its Close button as it
  // opens (a tooltip nobody asked for, which the first Esc would close instead of the dialog)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const onOpenChange = (o: boolean) => {
    const el = trigger.current
    if (o && el && el.contains(document.activeElement) && !matches(el, ':hover') && !tabbed) return
    setOpen(o)
  }
  return (
    <RTooltip.Root delayDuration={400} open={open} onOpenChange={onOpenChange}>
      <RTooltip.Trigger asChild ref={trigger}>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6}
          className="pop-in z-50 max-w-xs rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-lg">
          {text}
          {shortcut && <kbd className="ml-2 rounded bg-current/15 px-1 text-2xs">{shortcut}</kbd>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad'
const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted border-line',
  accent: 'bg-accent-soft text-accent border-transparent',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  bad: 'bg-bad-soft text-bad border-transparent',
}

export function Badge({ tone = 'neutral', className, children, title }:
  { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-full border px-2 text-xs leading-5 whitespace-nowrap',
      tones[tone], className)}>
      {children}
    </span>
  )
}

// The segmented look, one for every "pick one" row (F330a): RadioRow, and the plain buttons of the TopBar's
// screens and the narrow Chat / Inspect switch (which stay buttons: Tab between them, aria-current / aria-pressed)
export const SEGMENT_TRACK = 'inline-flex rounded-md border border-line p-0.5 text-sm'
export const segmentItem = (on: boolean) =>
  cn('rounded px-3 py-1 focus-ring disabled:cursor-not-allowed disabled:opacity-50', on ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-fg')

// A set of choices where one is picked (a rule, an effort, a text size), each saved the moment it's
// picked: so arrow keys only move between options and Enter or a click picks. That is a group of
// pressed-state buttons (a radio group would promise that arrowing picks). One Tab stop; the
// picked option is never disabled on its own. `disabled`: the whole row (true), or some options (a test of the value)
// that can't be picked now: arrow keys skip them, and the page says why next to the row.
export function RadioRow<T extends string>({ label, value, options, onChange, className, itemClass, describedBy, disabled = false }: {
  label: string
  value: T | null
  options: [T, ReactNode, string?][] // value, what it shows, a title
  onChange: (v: T) => void
  className?: string
  itemClass?: (v: T, on: boolean) => string
  describedBy?: string
  disabled?: boolean | ((v: T) => boolean)
}) {
  return (
    <ToggleGroup.Root type="single" value={value ?? ''} aria-label={label} loop role="group" disabled={disabled === true}
      onValueChange={(v) => { if (v && v !== value) onChange(v as T) }}
      className={cn(SEGMENT_TRACK, 'flex-wrap', className)}>
      {options.map(([v, text, title]) => (
        <ToggleGroup.Item key={v} value={v} title={title} aria-describedby={v === value ? describedBy : undefined}
          disabled={typeof disabled === 'function' && v !== value ? disabled(v) : undefined}
          role="button" aria-checked={undefined} aria-pressed={v === value}
          className={itemClass ? cn(segmentItem(false), 'text-fg', itemClass(v, v === value)) : segmentItem(v === value)}>
          {text}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

// `onAccent`: inside an accent or danger fill (the Allow button), where a grey key cap would be a patch
export function Kbd({ children, onAccent = false }: { children: ReactNode; onAccent?: boolean }) {
  return (
    <kbd className={cn('rounded border px-1 text-2xs',
      onAccent ? 'border-transparent bg-current/15 text-inherit' : 'border-line bg-sunken text-muted')}>
      {children}
    </kbd>
  )
}

// `quiet`: next to text that already says what is happening (no second announcement).
// Under reduced motion it is a still, full ring instead of a frozen three-quarter one.
export function Spinner({ className, quiet = false }: { className?: string; quiet?: boolean }) {
  return (
    <span {...(quiet ? { 'aria-hidden': true } : { role: 'status', 'aria-label': 'working' })}
      className={cn('inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none motion-reduce:border-t-current', className)} />
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse-soft rounded-md bg-sunken', className)} />
}

// A titled box used in panels
export function Section({ title, aside, children, className }:
  { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel as="h3">{title}</SectionLabel>
        {aside}
      </div>
      {children}
    </section>
  )
}

// ---- Shared primitives: one look for each kind of thing (F330 family) ----

type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad'
// Full class strings, so Tailwind sees every one of them
const chipTones: Record<ChipTone, string> = {
  neutral: 'border-line bg-panel',
  accent: 'border-accent/40 bg-accent-soft text-accent',
  ok: 'border-ok bg-ok-soft text-ok',
  warn: 'border-warn/40 bg-warn-soft text-warn',
  bad: 'border-bad bg-bad-soft text-bad',
}

// A small rounded choice or tag. `selected` is the one look for "this one is picked"; `interactive` adds the hover
// and focus of something you can press. For controls that are not plain buttons (a Radix item, a link) use the class.
export function chipClass({ selected = false, tone = 'neutral', interactive = false }:
  { selected?: boolean; tone?: ChipTone; interactive?: boolean } = {}) {
  return cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap',
    selected ? 'border-accent bg-accent-soft text-accent' : chipTones[tone],
    interactive && 'focus-ring hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-default')
}

type ChipProps = { selected?: boolean; tone?: ChipTone; className?: string; children?: ReactNode }
// As a button it says whether it is picked (aria-pressed); as a span it is a tag
export function Chip(props: ChipProps & { as: 'button' } & ButtonHTMLAttributes<HTMLButtonElement>): ReactNode
export function Chip(props: ChipProps & { as?: 'span' } & HTMLAttributes<HTMLSpanElement>): ReactNode
export function Chip({ selected, tone = 'neutral', as = 'span', className, ...rest }:
  ChipProps & { as?: 'span' | 'button' } & HTMLAttributes<HTMLElement>) {
  if (as === 'button') {
    return <button type="button" aria-pressed={!!selected} className={cn(chipClass({ selected, tone, interactive: true }), className)}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} />
  }
  return <span className={cn(chipClass({ selected, tone }), className)} {...rest} />
}

type CalloutTone = 'info' | 'warn' | 'bad' | 'ok'
const calloutTones: Record<CalloutTone, string> = {
  info: 'border-accent/30 bg-accent-soft/60',
  warn: 'border-warn/30 bg-warn-soft text-warn',
  bad: 'border-bad/30 bg-bad-soft text-bad',
  ok: 'border-ok/30 bg-ok-soft',
}

// A box that tells you something: information, a warning or an error. `live`: an error that appeared
// because of something you did, read out at once (role="alert"); only with the bad tone.
type CalloutProps = { tone: CalloutTone; size?: 'sm' | 'md'; icon?: ReactNode; live?: boolean; className?: string; children: ReactNode }
  & Omit<HTMLAttributes<HTMLDivElement>, 'children'>
export const Callout = forwardRef<HTMLDivElement, CalloutProps>(function Callout(
  { tone, size = 'md', icon, live = false, className, children, ...rest }, ref) {
  return (
    <div ref={ref} role={tone === 'bad' && live ? 'alert' : undefined} {...rest}
      className={cn('border', calloutTones[tone], size === 'sm' ? 'rounded-md px-2.5 py-1 text-xs' : 'rounded-lg px-3 py-2 text-sm',
        !!icon && 'flex items-start gap-2', className)}>
      {icon ? <><span aria-hidden className="mt-0.5 flex shrink-0">{icon}</span><div className="min-w-0 flex-1 break-words">{children}</div></> : children}
    </div>
  )
})

// The small uppercase label over a part of a panel (a chart, a list)
export function SectionLabel({ as: Tag = 'div', className, children, id }:
  { as?: 'div' | 'h3' | 'h4' | 'figcaption' | 'span'; className?: string; children: ReactNode; id?: string }) {
  return <Tag id={id} className={cn('text-xs font-semibold tracking-wide text-muted uppercase', className)}>{children}</Tag>
}

// One figure in a tile: a label, the number, and an optional line under it
export function Stat({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-md bg-sunken px-2.5 py-1.5', className)}>
      <div className="text-xs text-muted">{label}</div>
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-base font-semibold tabular-nums">{children}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  )
}

// Text fields and menus, the height of the buttons beside them (sm h-7, md h-9), one border and one background
const fieldSizes = { sm: 'h-7 px-2 text-sm', md: 'h-9 px-2.5 text-sm' }
const fieldBase = 'rounded-md border border-line-strong bg-panel text-fg focus-ring disabled:cursor-not-allowed disabled:opacity-60'

export const Field = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: 'sm' | 'md' }>(
  function Field({ size = 'md', className, ...rest }, ref) {
    return <input ref={ref} className={cn(fieldBase, fieldSizes[size], className)} {...rest} />
  })

export const Select = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'sm' | 'md' }>(
  function Select({ size = 'md', className, ...rest }, ref) {
    return <select ref={ref} className={cn(fieldBase, fieldSizes[size], className)} {...rest} />
  })

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, 'w-full resize-y p-2 text-sm', className)} {...rest} />
  })

// Something folded: a native <details> (keyboard, find-in-page) whose summary shows a chevron that turns when open.
// The group is named, so a Disclosure inside another one (or inside any other `group`) turns only its own chevron.
export function Disclosure({ summary, children, defaultOpen, className, summaryClassName, open, ...rest }:
  { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string; summaryClassName?: string }
  & Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'children' | 'className'>) {
  return (
    <details className={cn('group/disclosure', className)} open={open ?? defaultOpen} {...rest}>
      <summary className={cn('flex cursor-pointer list-none items-start gap-1 rounded focus-ring [&::-webkit-details-marker]:hidden', summaryClassName)}>
        <ChevronRight aria-hidden className="mt-0.5 size-3.5 shrink-0 transition-transform group-open/disclosure:rotate-90" />
        <span className="min-w-0 flex-1">{summary}</span>
      </summary>
      {children}
    </details>
  )
}

// What is running and for how long: one card for the chat's wait, Compare and Evals (F330h).
// `startedAt` in seconds (Unix time); `left`: an estimate of the seconds still to go, from the seconds so far.
export function RunningBanner({ text, startedAt, onStop, stopRef, stopTitle, progress, left, children, className }: {
  text: ReactNode
  startedAt?: number | null
  onStop?: () => void
  stopRef?: Ref<HTMLButtonElement>
  stopTitle?: string
  progress?: { done: number; total: number; label: string } | null
  left?: (elapsedSeconds: number) => number | null
  children?: ReactNode | ((elapsedSeconds: number) => ReactNode) // a function: lines that depend on the time so far
  className?: string
}) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [])
  const so = startedAt ? Math.max(0, now - startedAt) : null
  const rest = so != null && left ? left(so) : null
  return (
    <div className={cn('space-y-2 rounded-lg border border-dashed border-accent bg-panel px-3 py-2 text-sm', className)}>
      <div className="flex items-center gap-2">
        {/* the spinner shows it is working; the words stay still so they stay readable */}
        <Spinner quiet className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">{text}</span>
        {so != null && (
          <span className="shrink-0 text-muted tabular-nums">{elapsed(so)}{rest != null && `, about ${elapsed(rest)} left`}</span>
        )}
        {onStop && (
          <Button ref={stopRef} size="sm" onClick={onStop} title={stopTitle}><Square className="size-3.5" aria-hidden /> Stop</Button>
        )}
      </div>
      {progress && (
        <div className="h-2 w-full overflow-hidden rounded border border-line-strong bg-sunken" role="progressbar" aria-label={progress.label}
          aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div className="h-full bg-accent transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
        </div>
      )}
      {typeof children === 'function' ? children(so ?? 0) : children}
    </div>
  )
}
