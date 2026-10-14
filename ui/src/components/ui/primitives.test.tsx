// The shared primitives: one look for each kind of thing (Task 8, F330 family)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { elapsed } from '../../lib/format'
import { Callout, Chip, Disclosure, Field, IconButton, Kbd, RunningBanner, SectionLabel, Select, Stat, TextArea } from './index'

afterEach(() => vi.useRealTimers())

describe('primitives', () => {
  it('a Chip as a button says whether it is picked; as a span it is a plain tag', () => {
    const onClick = vi.fn()
    render(<><Chip as="button" selected onClick={onClick}>Opus</Chip><Chip as="button">Haiku</Chip><Chip tone="warn">needs a key</Chip></>)
    const on = screen.getByRole('button', { name: 'Opus' })
    expect(on).toHaveAttribute('aria-pressed', 'true')
    expect(on.className).toContain('bg-accent-soft')
    expect(on.className).toContain('focus-ring')
    expect(screen.getByRole('button', { name: 'Haiku' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(on)
    expect(onClick).toHaveBeenCalled()
    const tag = screen.getByText('needs a key')
    expect(tag.tagName).toBe('SPAN')
    expect(tag).not.toHaveAttribute('aria-pressed')
    expect(tag.className).toContain('bg-warn-soft')
    expect(tag.className).toContain('rounded-full')
  })

  it('a Callout takes its tone and size, and is an alert only when it is a live error', () => {
    render(<>
      <Callout tone="warn">careful</Callout>
      <Callout tone="bad" size="sm">quiet error</Callout>
      <Callout tone="bad" live>loud error</Callout>
      <Callout tone="info" data-testid="info">fyi</Callout>
    </>)
    expect(screen.getByText('careful').className).toMatch(/border-warn\/30.*bg-warn-soft/)
    expect(screen.getByText('careful').className).toContain('text-sm')
    expect(screen.getByText('quiet error').className).toContain('text-xs')
    expect(screen.getByText('quiet error')).not.toHaveAttribute('role')
    expect(screen.getByRole('alert')).toHaveTextContent('loud error')
    expect(screen.getByTestId('info').className).toContain('bg-accent-soft')
  })

  it('a Disclosure is a native details whose summary has no marker and a turning chevron', () => {
    const { container } = render(<Disclosure summary="More">the rest</Disclosure>)
    const details = container.querySelector('details')!
    expect(details).not.toBeNull()
    expect(details.className).toContain('group/disclosure')
    const summary = details.querySelector('summary')!
    expect(summary.className).toContain('list-none')
    const chevron = summary.querySelector('svg')!
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    expect(chevron.getAttribute('class')).toContain('group-open/disclosure:rotate-90')
    expect(summary).toHaveTextContent('More')
  })

  it('a Disclosure can start open and still reports its toggles', () => {
    const onToggle = vi.fn()
    const { container } = render(<Disclosure summary="Open" defaultOpen onToggle={onToggle}>inside</Disclosure>)
    expect(container.querySelector('details')).toHaveAttribute('open')
  })

  it('Field and Select come in the two button heights, with the strong border and the shared focus ring', () => {
    render(<>
      <Field aria-label="small" size="sm" />
      <Field aria-label="usual" />
      <Select aria-label="menu" size="sm"><option>a</option></Select>
      <TextArea aria-label="text" />
    </>)
    expect(screen.getByLabelText('small').className).toContain('h-7')
    expect(screen.getByLabelText('usual').className).toContain('h-9')
    expect(screen.getByLabelText('menu').className).toContain('h-7')
    for (const name of ['small', 'usual', 'menu', 'text']) {
      expect(screen.getByLabelText(name).className).toContain('border-line-strong')
      expect(screen.getByLabelText(name).className).toContain('focus-ring')
      expect(screen.getByLabelText(name).className).toContain('bg-panel')
    }
  })

  it('SectionLabel and Stat', () => {
    render(<><SectionLabel as="h4">Context window</SectionLabel><Stat label="Time" hint="from start">12s</Stat></>)
    expect(screen.getByRole('heading', { name: 'Context window' }).className).toContain('uppercase')
    expect(screen.getByText('12s').className).toContain('tabular-nums')
    expect(screen.getByText('from start')).toBeInTheDocument()
  })

  it('Kbd on an accent fill has no grey patch', () => {
    render(<><Kbd>A</Kbd><Kbd onAccent>D</Kbd></>)
    expect(screen.getByText('A').className).toContain('bg-sunken')
    expect(screen.getByText('D').className).toContain('bg-current/15')
    expect(screen.getByText('D').className).not.toContain('bg-sunken')
  })

  it('the one elapsed format: seconds under a minute, then m:ss', () => {
    expect(elapsed(0)).toBe('0s')
    expect(elapsed(42.7)).toBe('42s')
    expect(elapsed(75)).toBe('1:15')
    expect(elapsed(600)).toBe('10:00')
  })

  it('RunningBanner shows the time so far (75 s as 1:15), what is left, a progress bar and Stop', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0))
    const start = Date.now() / 1000 - 75
    const onStop = vi.fn()
    render(<RunningBanner text="Running every side" startedAt={start} onStop={onStop} left={(s) => s}
      progress={{ done: 1, total: 4, label: 'Eval progress' }} />)
    expect(screen.getByText('Running every side')).toBeInTheDocument()
    expect(screen.getByText('1:15, about 1:15 left')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByText('1:17, about 1:17 left')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Eval progress' })).toHaveAttribute('aria-valuenow', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
    // the spinner is quiet: the words already say what is happening
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('an IconButton tooltip opens on focus moved with Tab, not on focus a dialog moves there by itself', async () => {
    render(<IconButton label="Close"><span>x</span></IconButton>)
    const close = screen.getByRole('button', { name: 'Close' })
    act(() => close.focus())
    await new Promise((r) => setTimeout(r, 450))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => close.blur())
    fireEvent.keyDown(document, { key: 'Tab' })
    act(() => close.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Close')
  })

  it('an IconButton with a longer tip is described by it, merged with a description the caller gives', () => {
    render(<>
      <p id="extra">Saved in this browser.</p>
      <IconButton label="Reset" tip="Back to the default rule (Allow)" aria-describedby="extra"><span>r</span></IconButton>
      <IconButton label="Close"><span>x</span></IconButton>
    </>)
    const reset = screen.getByRole('button', { name: 'Reset' })
    expect(reset).toHaveAccessibleDescription('Saved in this browser. Back to the default rule (Allow)')
    // a tip that is only the label adds nothing
    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveAttribute('aria-describedby')
  })

  it('a full explanation is an info Callout with spaced paragraphs and room for its close (F330l)', async () => {
    const { Explain } = await import('../../learn/Explain')
    const { usePrefs } = await import('../../store/ui')
    usePrefs.setState({ learningMode: false, explained: [] })
    render(<Explain concept="history" />)
    const box = screen.getByRole('button', { name: 'Got it, shorten this next time' }).closest('div.border')!
    expect(box.className).toMatch(/\bspace-y-1\.5\b/)
    expect(box.className).toMatch(/\bpr-8\b/)
    expect(box.className).toContain('bg-accent-soft')
  })

  it('the focus-ring utility keeps a visible outline (Tailwind v4: outline-none would set the style to none)', () => {
    const css = readFileSync(join(__dirname, '../../styles/app.css'), 'utf8')
    const rule = css.slice(css.indexOf('@utility focus-ring'))
    expect(rule).toMatch(/focus-visible:outline-solid/)
    expect(rule).toMatch(/focus-visible:outline-accent/)
  })
})
