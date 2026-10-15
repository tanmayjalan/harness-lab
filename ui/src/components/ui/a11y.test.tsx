import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns } from '../../model/derive'
import { useSession } from '../../store/session'
import { usePrefs, useUi } from '../../store/ui'
import { useServer } from '../../store/server'
import { RadioRow } from './index'
import { Changed } from '../settings/common'
import { LoopDiagram } from '../inspector/LoopDiagram'
import { ApprovalDock } from '../composer/ApprovalDock'
import { Timeline } from '../run/Timeline'
import { Toaster } from '../shell/Toaster'
import { TopBar } from '../shell/TopBar'
import { HelpSheet } from '../shell/HelpSheet'
import { ScoreChart } from '../evals/EvalsScreen'
import { RunView } from '../run/RunView'
import { ResizeHandle } from '../../App'
import toolTurn from '../../test/fixtures/tool_turn.json'
import providerSwitch from '../../test/fixtures/provider_switch.json'
import declined from '../../test/fixtures/approval_declined.json'

const wrap = (ui: React.ReactNode) => render(<RTooltip.Provider>{ui}</RTooltip.Provider>)

// ---- colour contrast, computed from the stylesheet (WCAG 2) ----
const css = readFileSync(join(__dirname, '..', '..', 'styles', 'app.css'), 'utf-8')
const block = (from: number) => css.slice(css.indexOf('{', from) + 1, css.indexOf('}', from))
const vars = (text: string) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
const light = vars(block(css.indexOf(':root')))
const dark = vars(block(css.indexOf(':root', css.indexOf('prefers-color-scheme: dark'))))
// F348a: Settings → Display can pick dark by hand; that block must carry the same colours as the system's dark
const chosenDark = vars(block(css.indexOf(':root[data-theme=dark]')))
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('contrast (F019, F110, F116)', () => {
  const TEXT: [string, string][] = [['ok', 'ok-soft'], ['warn', 'warn-soft'], ['accent', 'accent-soft'], ['bad', 'bad-soft'],
    ['muted', 'sunken'], ['muted', 'panel'], ['muted', 'bg'], ['text', 'bg']]
  it('the dark you pick by hand is the same as the system dark', () => {
    expect(Object.keys(dark).length).toBeGreaterThan(10)
    expect(chosenDark).toEqual(dark)
  })
  for (const [scheme, v] of [['light', light], ['dark', dark], ['picked dark', chosenDark]] as const) {
    for (const [fg, bg] of TEXT) {
      it(`${scheme}: ${fg} on ${bg} is at least 4.5:1`, () => expect(ratio(v[fg], v[bg])).toBeGreaterThanOrEqual(4.5))
    }
    it(`${scheme}: form borders (line-strong) are at least 3:1`, () => expect(ratio(v['line-strong'], v.panel)).toBeGreaterThanOrEqual(3))
  }
})

beforeEach(() => {
  useUi.setState({ toasts: [], approvalDock: null })
  usePrefs.setState({ explained: [], learningMode: false })
})
afterEach(() => vi.restoreAllMocks())

describe('RadioRow (F013)', () => {
  function Row({ onChange = vi.fn() }: { onChange?: (v: string) => void }) {
    return <RadioRow label="Rule" value="ask" onChange={onChange} options={[['allow', 'Allow'], ['ask', 'Ask first'], ['block', 'Block']]} />
  }
  it('is one Tab stop, and the chosen option is never disabled', () => {
    render(<Row />)
    const group = screen.getByRole('group', { name: 'Rule' }) // final review I11: pressed-state buttons, not radios
    const tabbable = [group, ...screen.getAllByRole('button')].filter((b) => b.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1) // Radix: the group is the one Tab stop and hands focus to the picked option
    expect(screen.getByRole('button', { name: 'Ask first' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ask first' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('arrow keys move between options; Enter picks', async () => {
    const onChange = vi.fn()
    render(<Row onChange={onChange} />)
    const ask = screen.getByRole('button', { name: 'Ask first' })
    ask.focus()
    fireEvent.keyDown(ask, { key: 'ArrowRight' })
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) }) // Radix moves focus on the next tick
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Block' }))
    fireEvent.click(document.activeElement!)
    expect(onChange).toHaveBeenCalledWith('block')
  })
})

describe('labels and roles', () => {
  // F014
  it('the changed dot is an image with a name', () => {
    render(<Changed />)
    expect(screen.getByRole('img', { name: /changed/i })).toBeInTheDocument()
  })
  // F020
  it('the loop diagram says where this call is', () => {
    render(<LoopDiagram active="tools" path={['you', 'call', 'reply', 'tools']} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/You → Call the model → Model replies → Run tools; now at Run tools/)
  })
  // F111
  it('tool status icons are named images', () => {
    wrap(<Timeline model={deriveRuns(toolTurn as HarnessEvent[])} inspectedCallId={null} live="" running={false} />)
    expect(screen.getAllByRole('img', { name: 'done' }).length).toBeGreaterThan(0)
  })
  // F115
  it('a provider switch is announced', () => {
    wrap(<Timeline model={deriveRuns(providerSwitch as HarnessEvent[])} inspectedCallId={null} live="" running={false} />)
    expect(screen.getAllByRole('status').some((s) => /Switched to/.test(s.textContent ?? ''))).toBe(true)
  })
  // F119
  it('the toaster container does not announce on top of its messages', () => {
    render(<Toaster />)
    expect(document.querySelector('[data-toaster]')!.hasAttribute('aria-live')).toBe(false)
  })
})

describe('the approval panel (F113, F114)', () => {
  const approval = { id: 'a1', toolId: 'w1', tool: 'write_file', prompt: '', input: {}, path: 'todo.txt', content: 'x'.repeat(500), outside: false }
  it('announces its heading, not the whole file; buttons are named by their action', () => {
    wrap(<ApprovalDock approval={approval} row={{ permission: 'ask' } as never} />)
    expect(screen.getByRole('alert').textContent).toBe('The harness is waiting for you')
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'The harness is waiting for you' })).toBeInTheDocument()
  })
  it('puts "Always allow" before the buttons, so Tab reaches it first', () => {
    wrap(<ApprovalDock approval={approval} row={{ permission: 'ask' } as never} />)
    const box = screen.getByRole('checkbox', { name: /Always allow/ })
    expect(box.compareDocumentPosition(screen.getByRole('button', { name: 'Allow' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('focus (F016)', () => {
  it('after an approval is answered, focus returns to the message box with an announcement', () => {
    useServer.setState({ info: null })
    const events = (declined as Array<Record<string, unknown>>)
    useSession.setState({ derived: deriveRuns(events.slice(0, 5) as HarnessEvent[]), loaded: true, running: true })
    wrap(<RunView composerRef={{ current: null }} />)
    act(() => { useSession.setState({ derived: deriveRuns(events.slice(0, 7) as HarnessEvent[]) }) })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }))
    expect(screen.getByText(/^Declined\. The harness carries on\./)).toBeInTheDocument() // (a marker makes repeats read out)
  })
})

describe('keyboard (F121, F012)', () => {
  it('the inspector edge can be moved with the arrow keys', () => {
    usePrefs.setState({ inspectorWidth: 520 })
    usePrefs.setState({ sidebarCollapsed: true }) // (room for 604px in the 1024px test window)
    render(<ResizeHandle />)
    const edge = screen.getByRole('separator')
    expect(edge).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(edge, { key: 'ArrowLeft' })
    expect(usePrefs.getState().inspectorWidth).toBe(552)
    fireEvent.keyDown(edge, { key: 'Home' })
    expect(usePrefs.getState().inspectorWidth).toBe(440) // F305: the usual width
    usePrefs.setState({ inspectorWidth: 520 })
    fireEvent.doubleClick(edge)
    expect(usePrefs.getState().inspectorWidth).toBe(440)
    usePrefs.setState({ sidebarCollapsed: false })
  })
  // M11: in a narrow window the Inspector is shown narrower than the stored width
  it('the inspector edge reports the width you see, and arrows move from there', () => {
    expect(window.innerWidth).toBe(1024)
    usePrefs.setState({ inspectorWidth: 520 })
    usePrefs.setState({ sidebarCollapsed: false })
    render(<ResizeHandle />)
    const edge = screen.getByRole('separator')
    const shown = Math.min(520, Math.max(300, 1024 - 256 - 420)) // 348
    expect(edge).toHaveAttribute('aria-valuenow', String(shown))
    fireEvent.keyDown(edge, { key: 'ArrowLeft' }) // no room to grow: stays at what's shown
    expect(usePrefs.getState().inspectorWidth).toBe(shown)
    expect(edge).toHaveAttribute('aria-valuenow', String(shown))
    fireEvent.keyDown(edge, { key: 'ArrowRight' }) // narrower, from what's shown (not from 520)
    expect(usePrefs.getState().inspectorWidth).toBe(320)
  })
  it('the eval chart is one Tab stop, with arrows between points', () => {
    const run = (id: string) => ({ id, time: 1_790_000_000, provider: 'mock', label: 'M', model: 'm', repeat: 1, use_my_settings: true,
      judge: 'mock', setup: [], passed: 3, total: 6, questions: 6 })
    const onPick = vi.fn()
    render(<ScoreChart runs={[run('a'), run('b'), run('c')]} selected="b" onPick={onPick} />)
    const points = screen.getAllByRole('button')
    expect(points.map((p) => p.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
    fireEvent.keyDown(points[1], { key: 'ArrowRight' })
    expect(onPick).toHaveBeenCalledWith('c')
  })
})

describe('more focus and labels', () => {
  // F299: a dialog opened by its button gives focus back to that button
  it('a dialog opened by its button returns focus to that button', async () => {
    wrap(<><TopBar narrow={false} /><HelpSheet /></>)
    const btn = screen.getByRole('button', { name: 'Help, glossary and quiz' })
    btn.focus()
    fireEvent.click(btn)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => useUi.getState().setHelp(false))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(document.activeElement).toBe(btn)
  })

  // F015: a dialog opened by a shortcut gives focus back to where you were
  it('closing Settings opened with Ctrl+, puts focus back in the message box', async () => {
    const { SettingsDrawer } = await import('../settings/SettingsDrawer')
    useServer.setState({ settings: null, info: null })
    render(<><textarea aria-label="Message" /><RTooltip.Provider><SettingsDrawer /></RTooltip.Provider></>)
    const box = screen.getByRole('textbox', { name: 'Message' })
    box.focus()
    act(() => { useUi.getState().rememberFocus(); useUi.getState().toggleSettings() })
    act(() => { useUi.getState().closeSettings() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(document.activeElement).toBe(box)
  })

  // F018: a new conversation puts you in the message box
  it('New conversation moves focus to the message box', async () => {
    const { api } = await import('../../api/client')
    const { newConversation } = await import('../../store/selectors')
    vi.spyOn(api, 'newConversation').mockResolvedValue({ ok: true })
    render(<textarea aria-label="Message" />)
    await act(async () => { await newConversation() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }))
  })

  // F125: better or worse in words, not colour alone
  it('Compare deltas say better or worse in words', async () => {
    const { Delta } = await import('../compare/CompareScreen')
    render(<Delta value={8} base={10} comparable runs={3} format={String} />)
    expect(screen.getByText('(better)')).toBeInTheDocument()
    expect(document.querySelector('svg.lucide-arrow-down')).toHaveAttribute('aria-hidden', 'true') // Task 8 (F330g): lucide, not ▼
  })
})

// ---- the second review's accessibility findings ----

// F285, F286: Windows high contrast removes rings and backgrounds, so focus and "current" need outlines
describe('high contrast (F285, F286)', () => {
  const at = css.indexOf('@media (forced-colors: active)')
  const forced = css.slice(at)
  it('comes after the dark colours, so the contrast check above still reads the right blocks', () => {
    expect(at).toBeGreaterThan(css.indexOf('prefers-color-scheme: dark'))
  })
  it('gives every focused control an outline high contrast keeps', () => {
    expect(forced).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid CanvasText/)
  })
  it('marks what is current or picked with an outline, and new rows with a border', () => {
    for (const sel of ['[aria-current="page"]', '[aria-pressed="true"]', '[role="tab"][data-state="active"]']) expect(forced).toContain(sel)
    expect(forced).toMatch(/\.added\s*\{[^}]*border-left/)
  })
})

// F283: graphics need 3:1 against the panel they sit on
describe('graphics (F283)', () => {
  const GRAPHIC = ['line-strong', 'muted', 'warn', 'accent', 'ok', 'bad']
  for (const [scheme, v] of [['light', light], ['dark', dark]] as const) {
    for (const g of GRAPHIC) {
      it(`${scheme}: ${g} on panel is at least 3:1`, () => expect(ratio(v[g], v.panel)).toBeGreaterThanOrEqual(3))
    }
  }
  it('the loop diagram draws its quiet boxes and arrows with the strong line colour', () => {
    const { container } = render(<LoopDiagram active="tools" path={['you', 'call', 'reply', 'tools']} />)
    const strokes = [...container.querySelectorAll('path, rect')].map((e) => e.getAttribute('stroke')).filter(Boolean)
    expect(strokes).not.toContain('var(--line)')
    expect(strokes).toContain('var(--line-strong)')
  })
  it('the made-of and time bars use full colours and keep them in high contrast', async () => {
    const { PART_COLOURS, TIME_COLOURS } = await import('../inspector/Inspector')
    for (const c of [...Object.values(PART_COLOURS), ...Object.values(TIME_COLOURS)]) {
      expect(c).not.toMatch(/\//) // no faded colour
      expect(c).not.toBe('bg-line')
    }
  })
  it('unselected chart bars are drawn in full', async () => {
    const { TokenChart } = await import('../inspector/TokenChart')
    const p = (n: number) => ({ callId: `c${n}`, runIndex: 1, turn: n, read: 1000 * n, cached: 0, wrote: 50, chars: 4000 * n,
      trimmedChars: 0, summarisedBefore: false })
    const { container } = render(<TokenChart points={[p(1), p(2)]} selected="c2" onSelect={() => {}} useTokens={false} />)
    const bar = container.querySelector('g[data-call="c1"] rect[rx]')!
    expect(bar.getAttribute('fill')).toBe('var(--line-strong)')
    expect(bar.getAttribute('fill-opacity') ?? '1').toBe('1')
  })
})

// F282: working controls and content aren't faded below the contrast minimum
describe('nothing faded (F282)', () => {
  // They show on hover, so the chat stays calm: hidden or in full, never half-faded, and always there for
  // the keyboard (focus inside shows them) and on touch screens (no hover)
  it('Re-run and Compare under a message are never half-faded, and show on keyboard focus', () => {
    wrap(<Timeline model={deriveRuns(toolTurn as HarnessEvent[])} inspectedCallId={null} live="" running={false} onRerun={() => {}} onCompare={() => {}} />)
    const rerun = screen.getByRole('button', { name: /Re-run with current settings/ })
    for (let el: HTMLElement | null = rerun; el; el = el.parentElement) {
      expect(el.className).not.toMatch(/(^|\s)opacity-(?!0\b|100\b)\d/)
      if (/(^|\s)opacity-0\b/.test(el.className)) {
        expect(el.className).toContain('group-focus-within:opacity-100')
        expect(el.className).toContain('[@media(hover:none)]:opacity-100')
      }
    }
  })
  it('the delete bin is not faded, and is at least 24 px to hit', async () => {
    const { Sidebar } = await import('../sidebar/Sidebar')
    const item = (id: string, title: string) => ({ id, title, created: 1_790_000_000, updated: Date.now() / 1000, runs: 1, badge: [], kind: null })
    useServer.setState({ conversations: { current: 'b', items: [item('a', 'One'), item('b', 'Two')] } } as never)
    wrap(<Sidebar />)
    const bin = screen.getByRole('button', { name: 'Delete One' })
    expect(bin.className).not.toMatch(/opacity-\d/)
    expect(bin.className).toMatch(/\bp-1\.5\b/) // 14 px icon + 2 × 6 px = 26 px
  })
})

// F348a: light, dark or the system's choice, picked in Settings → Display
describe('theme (F348a)', () => {
  afterEach(() => { usePrefs.setState({ theme: 'system' }); delete document.documentElement.dataset.theme })

  it('picking Dark sets data-theme', async () => {
    const { App } = await import('../../App')
    const { DisplaySection } = await import('../settings/DisplaySection')
    render(<><App /><DisplaySection /></>)
    const row = screen.getAllByRole('group', { name: 'Light or dark' }).find((g) => g.tagName !== 'FIELDSET')!
    expect(within(row).getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(row).getByRole('button', { name: 'Dark' }))
    expect(usePrefs.getState().theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    fireEvent.click(within(row).getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('a saved page from before the switch starts on System', () => {
    expect(usePrefs.getInitialState().theme).toBe('system')
  })

  it('the system dark yields to a picked Light, and the dark: variant follows the pick', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme=light\]\)/)
    expect(css).toMatch(/:root\[data-theme=light\]\s*\{[^}]*color-scheme:\s*light/)
    expect(css).toMatch(/@custom-variant dark/)
  })
})

// F288: resizing the Inspector doesn't need a drag
describe('Inspector width by clicks (F288)', () => {
  it('Settings → Display sets the Inspector width', async () => {
    const { DisplaySection } = await import('../settings/DisplaySection')
    usePrefs.setState({ inspectorWidth: 440 }) // F305: the usual width
    render(<DisplaySection />)
    expect(screen.getByRole('button', { name: 'Usual' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    expect(usePrefs.getState().inspectorWidth).toBe(720)
    fireEvent.click(screen.getByRole('button', { name: 'Narrow' }))
    expect(usePrefs.getState().inspectorWidth).toBe(360)
  })
})

// F289: small targets reach 24 px
describe('target sizes (F289)', () => {
  it('"Got it" on an explanation is at least 24 px', async () => {
    const { Explain } = await import('../../learn/Explain')
    render(<Explain concept="tool" />)
    const gotIt = screen.getByRole('button', { name: /Got it/ })
    // Task 8 (F330): an IconButton size="sm", 28 by 28 px
    expect(gotIt.className).toMatch(/\bh-7\b/)
    expect(gotIt.className).toMatch(/\bw-7\b/)
  })
})

// F332, F330k, F331, F326: sizes follow their surroundings; one small size, as a token
describe('type sizes and wrapping (F326, F330k, F331, F332)', () => {
  it('code and key caps take their size from the text around them; pre keeps its own', () => {
    expect(css).toMatch(/code, kbd \{ font-family: var\(--font-mono\); font-size: 0\.92em; \}/)
    expect(css).toMatch(/pre \{ font-family: var\(--font-mono\); font-size: 0\.8125rem; \}/)
    expect(css).not.toMatch(/code, pre, kbd/)
    expect(css).toMatch(/pre code \{ font-size: inherit; \}/) // a code block is not shrunk twice
  })
  it('in high contrast a tab keeps its focus ring inside (the tab list scrolls, so it clips)', () => {
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'))
    const general = forced.indexOf(':is([role="tab"][data-state], [aria-current], [aria-pressed], *):focus-visible')
    const tab = forced.indexOf('[role="tab"][data-state]:focus-visible { outline-offset: -2px; }')
    expect(general).toBeGreaterThan(-1)
    expect(tab).toBeGreaterThan(general) // same weight, later: it wins
  })
  it('chart text is sized by a class, not by a rule over every svg text', () => {
    expect(css).not.toMatch(/svg text\s*\{/)
    expect(css).toMatch(/\.chart-text \{ font-size: var\(--text-2xs\); \}/)
    expect(css).toMatch(/--text-2xs: 0\.6875rem;/)
  })
  it('long words in answers break instead of widening the column', () => {
    expect(css).toMatch(/\.md \{ overflow-wrap: anywhere; \}/)
  })
  it('key caps use the small-size token, not a one-off size', async () => {
    const { Kbd } = await import('./index')
    render(<Kbd>Esc</Kbd>)
    expect(screen.getByText('Esc').className).toMatch(/\btext-2xs\b/)
    expect(screen.getByText('Esc').className).not.toMatch(/\[0\.6875rem\]/)
  })
  it('every chart label carries the chart class', async () => {
    const { TokenChart } = await import('../inspector/TokenChart')
    const run = (id: string) => ({ id, time: 1_790_000_000, provider: 'mock', label: 'M', model: 'm', repeat: 1, use_my_settings: true,
      judge: 'mock', setup: [], passed: 3, total: 6, questions: 6 })
    const a = render(<ScoreChart runs={[run('a'), run('b'), run('c')]} selected="b" onPick={() => {}} />)
    const point = (n: number) => ({ callId: `c${n}`, runIndex: n, turn: 1, read: 1000 * n, cached: 0, wrote: 50, chars: 4000 * n,
      trimmedChars: n === 2 ? 500 : 0, summarisedBefore: false })
    const b = render(<TokenChart points={[point(1), point(2), point(3)]} selected="c1" onSelect={() => {}} useTokens />)
    for (const container of [a.container, b.container]) {
      const texts = [...container.querySelectorAll('text')]
      expect(texts.length).toBeGreaterThan(0)
      for (const t of texts) expect(t.getAttribute('class')).toBe('chart-text')
    }
  })
})

// F326a, F330j: motion only on small marks, and none when you asked for less
describe('motion (F326a, F330j)', () => {
  // Task 8 (F330h): the waiting line is the shared RunningBanner, whose quiet spinner moves, not its words
  it('the waiting line moves a mark, not its words', () => {
    const m = deriveRuns((toolTurn as HarnessEvent[]).slice(0, 2))
    expect(m.status).toBe('waiting_model')
    wrap(<Timeline model={m} inspectedCallId={null} live="" running />)
    const pulsing = [...document.querySelectorAll('.animate-pulse-soft, .animate-spin')]
    expect(pulsing.length).toBeGreaterThan(0)
    for (const el of pulsing) {
      expect(el).toHaveAttribute('aria-hidden')
      expect(el.textContent).toBe('')
    }
  })
  it('the spinner becomes a still ring under reduced motion', async () => {
    const { Spinner } = await import('./index')
    render(<Spinner />)
    const s = screen.getByRole('status', { name: 'working' })
    expect(s.className).toMatch(/motion-reduce:animate-none/)
    expect(s.className).toMatch(/motion-reduce:border-t-current/)
  })
})
