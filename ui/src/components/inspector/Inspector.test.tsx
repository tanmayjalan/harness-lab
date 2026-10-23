import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns } from '../../model/derive'
import { windowUsed } from '../../model/inspector'
import { useSession } from '../../store/session'
import { useServer } from '../../store/server'
import { usePrefs, useUi } from '../../store/ui'
import { Inspector } from './Inspector'
import { JsonTree } from './JsonTree'
import { LoopDiagram } from './LoopDiagram'
import { TokenChart } from './TokenChart'
import type { SeriesPoint } from '../../model/inspector'
import toolTurn from '../../test/fixtures/tool_turn.json'
import answer from '../../test/fixtures/answer.json'

type Ev = Record<string, unknown>
const open = (events: unknown, callIndex: number | null = null, tab: 'summary' | 'sent' | 'received' | 'tools' | 'raw' = 'summary') => {
  const model = deriveRuns(events as HarnessEvent[])
  useSession.setState({ derived: model, loaded: true })
  if (callIndex === null) useUi.setState({ followLatest: true, selectedCallId: null })
  else useUi.setState({ followLatest: false, selectedCallId: model.callOrder[callIndex] })
  usePrefs.setState({ inspectorTab: tab, explained: [], learningMode: false })
  render(<RTooltip.Provider><Inspector /></RTooltip.Provider>)
  return model
}
const text = () => document.body.textContent ?? ''

// A wide window, so the stored width is the width shown (jsdom starts at 1024 px)
beforeEach(() => {
  window.innerWidth = 1280
  usePrefs.setState({ inspectorWidth: 520, sidebarCollapsed: false })
})
afterEach(() => { window.innerWidth = 1024 })

describe('tabs', () => {
  // F068: the round-trip walkthrough has its own tab, and Summary links to it
  it('the tool round trip is in its own Tools tab, not under Raw', () => {
    open(toolTurn, 0, 'raw')
    expect(screen.getByRole('tab', { name: 'Tools' })).toBeInTheDocument()
    expect(text()).not.toMatch(/The model asks/)
  })

  it('a tool name in the Summary opens the Tools tab', () => {
    open(toolTurn, 0, 'summary')
    fireEvent.click(screen.getByRole('button', { name: /get_weather.*round trip/ }))
    expect(usePrefs.getState().inspectorTab).toBe('tools')
  })

  // F070: the Summary's own sections are not named like the tabs
  it('Summary sections say what went in and what came back', () => {
    open(toolTurn, 1)
    expect(text()).toMatch(/What went in/)
    expect(text()).toMatch(/What came back/)
  })
})

describe('summary', () => {
  // F071, F074: the tiles say what they measure
  it('tiles are named for what they measure', () => {
    open(toolTurn, 1)
    expect(text()).toMatch(/Reply time/) // F383: one name, one meaning
    expect(text()).toMatch(/Cost \(this call\)/)
    expect(text()).toMatch(/Where the time went, from this call to the next/)
  })

  // F075: where you are among the calls, and how to get back to the newest (the count needs a wide panel)
  it('says which call you are on and offers the newest', () => {
    usePrefs.setState({ inspectorWidth: 640 })
    open(toolTurn, 0)
    expect(text()).toMatch(/1 of 3 calls/)
    expect(screen.getByRole('button', { name: /Follow latest \(message 1 · call 3\)/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Message 1 · call 3 (newest)' })).toBeInTheDocument()
  })

  // The newest call is named by its message, the way the picker names calls
  const twoMessages = () => [...(toolTurn as Ev[]),
    ...(answer as Ev[]).map((e) => ({ ...e, msg: 2, seq: (e.seq as number) + 100 }))]

  it('names the message the newest call is in', () => {
    open(twoMessages(), 0)
    expect(screen.getByRole('button', { name: /Follow latest \(message 2 · call 1\)/ })).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: /\(newest\)/ }).map((o) => o.textContent)).toEqual(['Message 2 · call 1 (newest)'])
    expect(screen.getByRole('button', { name: /^Next call: message 1 · call 2/ })).toBeInTheDocument()
  })

  it('the step buttons say when they cross into another message', () => {
    open(twoMessages(), 2)
    expect(screen.getByRole('button', { name: /^Next call: message 2 · call 1/ })).toBeInTheDocument()
  })

  it('while following, says so instead of offering a button', () => {
    open(toolTurn)
    expect(text()).toMatch(/Following new calls/)
    expect(screen.queryByRole('button', { name: /Follow/ })).toBeNull()
  })

  it('on the newest call picked by hand, offers to follow new calls', () => {
    open(toolTurn, 2)
    expect(screen.getByRole('button', { name: /^Follow new calls/ })).toBeInTheDocument()
    expect(text()).not.toMatch(/Follow latest/)
  })

  it('a narrow panel keeps the picker readable: the follow button is an icon that still names the newest', () => {
    usePrefs.setState({ inspectorWidth: 400 })
    open(toolTurn, 0)
    expect(screen.getByRole('button', { name: /^Follow latest \(message 1 · call 3\)/ })).toBeInTheDocument()
    expect(text()).not.toMatch(/of 3 calls/)
  })

  // F232: at the usual 520 px the count gives way, so the picker keeps room for its longest name
  it('at the usual width the header drops the count but keeps the follow button in words', () => {
    open(toolTurn, 0)
    expect(text()).not.toMatch(/of 3 calls/)
    expect(screen.getByRole('button', { name: /^Follow latest \(message 1 · call 3\)$/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inspector' }).className).toMatch(/sr-only/)
  })

  it('a small window makes the header narrow even when the stored width is wide', () => {
    window.innerWidth = 1024 // with the sidebar open, the Inspector gets 348 px of its 520
    open(toolTurn, 0)
    expect(screen.getByRole('button', { name: /^Follow latest \(message 1 · call 3\)/ })).toBeInTheDocument()
    expect(text()).not.toMatch(/of 3 calls/)
  })

  // The foot of every tab names the next call, so a long tab does not just stop
  it('the end of a tab offers the next call, and it opens on the same tab', () => {
    const model = open(toolTurn, 0, 'raw')
    expect(text()).toMatch(/End of message 1 · call 1/)
    expect(screen.queryByRole('button', { name: /^← Previous/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Next: call 2/ }))
    expect(useUi.getState().selectedCallId).toBe(model.callOrder[1])
    expect(usePrefs.getState().inspectorTab).toBe('raw')
    expect(screen.getByRole('button', { name: /^← Previous: call 1/ })).toBeInTheDocument()
  })

  it('the next call in another message is named with it, and shows what you wrote', () => {
    open(twoMessages(), 2)
    const next = screen.getByRole('button', { name: /^Next: message 2 · call 1/ })
    expect(next.textContent).toMatch(/A new message/)
  })

  it('on the newest call the end says so instead of offering a next one', () => {
    open(toolTurn, 2)
    expect(screen.queryByRole('button', { name: /^Next:/ })).toBeNull()
    expect(text()).toMatch(/This is the newest call/)
  })

  it('the previous call is named with its message when it is in another one', () => {
    open(twoMessages(), 3)
    expect(text()).toMatch(/new since message 1 · call 3/)
  })

  it('counts the messages list in entries, not messages', () => {
    open(toolTurn, 1)
    expect(text()).toMatch(/\d+ entries in the messages list/)
  })

  // F161: the stop badge uses plain words for every reason
  it('a cut-off call is labelled in words', () => {
    const events = (answer as Ev[]).map((e) => (e.kind === 'response' ? { ...e, stop_reason: 'max_tokens' } : e))
    open(events, 0)
    expect(text()).toMatch(/max_tokens · hit the longest-reply limit/)
  })

  // F073: with caching off there is no cache to lose; say only what changed
  it('a changed start without caching gets a neutral note, not a cache warning', () => {
    const events = (toolTurn as Ev[]).map((e) => (e.kind === 'request' && e.seq !== 1 ? { ...e, start_changed: true, cache: false } : e))
    open(events, 1)
    expect(text()).toMatch(/The system prompt or tools changed since call 1\./)
    expect(text()).not.toMatch(/nothing could come from the cache/)
  })

  // F167: the CSV export is a download, outside the folded card
  it('Export CSV is visible and says what it gives', () => {
    open(toolTurn, 1)
    expect(screen.getByRole('button', { name: /Export every call as CSV/ })).toBeVisible()
    expect(screen.getByTitle(/One row per model call/)).toBeInTheDocument()
  })

  // F164
  it('the "made of" bar has a visible title', () => {
    open(toolTurn, 1)
    expect(text()).toMatch(/What this call is made of \(by characters\)/)
  })
})

describe('sent and raw', () => {
  // F170: on the first call, everything is new; no misleading "since the previous call"
  it('the first call says everything is new', () => {
    open(toolTurn, 0, 'sent')
    expect(text()).toMatch(/First call: everything here is new/)
  })

  it('the Sent tab names the messages list and its entries', () => {
    open(toolTurn, 1, 'sent')
    expect(text()).toMatch(/Messages list \(\d+ entries\)/)
    expect(text()).toMatch(/new since call 1/)
  })

  // F069, F169: list positions are entries, sizes are characters, repeats are "in N calls"
  it('message rows use entries, characters and "in N calls"', () => {
    open(toolTurn, 2, 'sent')
    expect(text()).toMatch(/#1 user/)
    expect(text()).toMatch(/in 3 calls/)
    expect(text()).toMatch(/\d characters/) // F230: one word for sizes
    expect(text()).not.toMatch(/\d ch\b/)
  })

  it('the round trip names list entries, not "messages"', () => {
    open(toolTurn, 0, 'tools')
    expect(text()).toMatch(/entry \d+ of the messages list/)
  })

  // F168, F377: a conversation saved before the exact request was kept says so, instead of rebuilding one
  it('Raw says plainly when the exact request was not recorded', () => {
    open(toolTurn, 0, 'raw')
    expect(text()).toMatch(/saved before the harness kept the exact request, so it can't be shown/)
    expect(text()).not.toMatch(/not loaded/)
  })

  // F377, F381: with the request recorded, Raw shows it as sent (full tool definitions, strict), and on the mock
  // says the model gets it rewritten
  it('Raw shows the recorded request body, and on the mock says the model gets it rewritten', () => {
    const tool = { name: 'pick', description: 'Pick one.', strict: true, input_schema: { type: 'object', properties: {} } }
    const events = (toolTurn as Ev[]).map((e) => e.kind !== 'request' ? e : {
      ...e, config: { ...(e.config as Ev), provider: 'mock' },
      api_body: { model: e.model, max_tokens: 16000, system: e.system, tools: [tool] } })
    open(events, 0, 'raw')
    expect(text()).toMatch(/The request body exactly as the harness sent it/)
    expect(text()).toMatch(/the model doesn't get it in this form/)
    expect(text()).toMatch(/characters of system prompt, tools and messages \(counted as in the Summary\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Open all' }))
    expect(text()).toMatch(/strict/)
    expect(text()).toMatch(/input_schema/)
  })
})

describe('pieces', () => {
  // F160: while a call is waiting, its size is the previous call's, marked as at least that
  it('windowUsed uses the previous call while waiting', () => {
    const m = deriveRuns(toolTurn as HarnessEvent[])
    const [c1, c2] = m.callOrder.map((id) => m.calls[id])
    const waiting = { ...c2, response: undefined, tokens: { read: 0, cached: 0, wrote: 0, written: 0 } }
    expect(windowUsed(waiting, c1)).toEqual({ used: c1.tokens.read, atLeast: true })
    expect(windowUsed(c2, c1).atLeast).toBe(false)
  })

  // F005: a narrow panel still says what the two ways out of "Model replies" mean
  it('the compact diagram keeps a one-line legend', () => {
    render(<LoopDiagram active={null} compact />)
    expect(text()).toMatch(/asked for tools: run them, call again · finished: show the answer/) // F414: plain words
  })

  // F162: a reply that stopped early is marked on the diagram
  it('marks a reply that stopped early', () => {
    render(<LoopDiagram active="reply" path={['you', 'call', 'reply']} early />)
    expect(text()).toMatch(/stopped early/)
  })

  // An open object or list ends with its closing bracket; a folded one shows only its summary
  it('the JSON tree closes every bracket it opens', () => {
    render(<JsonTree value={{ content: [{ type: 'text' }], usage: { a: 1 } }} openDepth={2} command={{ n: 0, open: false }} />)
    const lines = [...document.querySelectorAll('.font-mono div')].map((d) => d.textContent)
    expect(lines.filter((t) => t === '}')).toHaveLength(2) // the whole reply and usage; the block inside content is folded
    expect(lines.filter((t) => t === '],')).toHaveLength(1) // usage follows content, so its bracket takes a comma
    expect(text()).toMatch(/\{ type: "text", 1 key \}/)
  })

  // Commas between entries, as in JSON: every entry but the last
  it('the JSON tree puts a comma after every entry but the last', () => {
    render(<JsonTree value={{ a: 1, b: 'x'.repeat(200), c: { d: true } }} openDepth={1} command={{ n: 0, open: false }} />)
    const lines = [...document.querySelectorAll('.font-mono > div > div > div')].map((d) => d.textContent ?? '')
    expect(lines[0]).toBe('a: 1,')
    expect(lines[1]).toMatch(/^b: "x+",… \+40 characters$/) // the comma follows the text, before "show all"
    expect(lines[2]).toBe('c: { 1 key }') // the last entry: no comma
  })

  // F305 (was F005): the panel starts at 440 px, so the conversation stays the widest column at 1280
  it('the inspector starts 440 pixels wide', () => {
    expect(usePrefs.getInitialState().inspectorWidth).toBe(440)
  })

  // F304: at Large text the five tabs may not fit: the list scrolls instead of widening the panel
  it('the tab list can scroll sideways', () => {
    open(toolTurn, 0)
    const list = screen.getByRole('tablist')
    expect(list.className).toMatch(/\boverflow-x-auto\b/)
    for (const tab of screen.getAllByRole('tab')) expect(tab.className).toMatch(/\bshrink-0\b/)
  })

  // Live check (Task 10): at 1024 px and Large text, arrowing to Raw left it cut off, because the browser
  // does not scroll a partly visible element on focus. A focused tab brings itself fully into view
  it('a focused tab scrolls the tab list so the whole tab shows', () => {
    open(toolTurn, 0)
    const raw = screen.getByRole('tab', { name: 'Raw' })
    const scroll = vi.fn()
    raw.scrollIntoView = scroll
    fireEvent.focus(raw)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  // A scrolling list clips anything drawn outside it: the focus ring is drawn inside each tab
  it('the tabs draw their focus ring inside, where the scrolling list does not clip it', () => {
    open(toolTurn, 0)
    // Task 8 (F330e): the shared focus-ring utility, with its offset turned inward
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('focus-ring')
      expect(tab.className).toContain('focus-visible:outline-offset-[-2px]')
    }
  })

  // Two lines of title must fit a box that shrinks with the drawing (compact at 1024 px, Large text too)
  it('loop diagram titles shrink with the drawing and close up when they may wrap', () => {
    const size = 'text-[length:min(0.75rem,3.75cqi)]'
    const a = render(<LoopDiagram active={null} compact />)
    for (const t of ['1. You', '2. Call the model']) {
      expect(screen.getByText(t).className).toContain(size)
      expect(screen.getByText(t).className).toMatch(/(^|\s)leading-none\b/)
    }
    a.unmount()
    render(<LoopDiagram active={null} />)
    const title = screen.getByText('2. Call the model')
    expect(title.className).toContain(size)
    expect(title.className).toMatch(/(^|\s)leading-tight\b/)
    expect(title.className).toContain('@max-[34rem]:leading-none') // where the second line gives way
  })

  // F331: the labels are page text, so they keep their size however small the drawing gets
  it("the loop diagram's labels are HTML text, not SVG text", () => {
    for (const compact of [true, false]) {
      const { unmount } = render(<LoopDiagram active="call" path={['you', 'call']} compact={compact} early />)
      const img = screen.getByRole('img', { name: /Harness loop/ })
      expect(img.querySelectorAll('text')).toHaveLength(0)
      for (const title of ['1. You', '2. Call the model', '3. Model replies', '4. Run tools', '5. Show answer']) {
        const el = within(img).getByText(title)
        expect(el.tagName).toBe('DIV')
        expect(el.className).toContain('text-[length:min(0.75rem,3.75cqi)]') // 12 px unless the box is too small
      }
      expect(within(img).getByText('2. Call the model').className).toMatch(/\btext-accent\b/)
      expect(within(img).getByText('1. You').className).not.toMatch(/\btext-accent\b/)
      expect(within(img).getByText('stopped early').tagName).toBe('DIV')
      if (!compact) {
        expect(within(img).getByText('send all history').className).toMatch(/\btext-2xs\b/)
        expect(within(img).getByText('finished').tagName).toBe('DIV')
      } else {
        expect(within(img).queryByText('send all history')).toBeNull()
      }
      unmount()
    }
  })
})

describe('size chart', () => {
  const point = (n: number, run = 1, over: Partial<SeriesPoint> = {}): SeriesPoint => ({
    callId: `c${n}`, runIndex: run, turn: 1, read: 1000 * n, cached: 0, wrote: 50, chars: 4000 * n, trimmedChars: 0,
    summarisedBefore: false, ...over,
  })

  // F171, F163
  it('names the top of the chart and how to use the bars', () => {
    render(<TokenChart points={[point(1), point(2)]} selected="c1" onSelect={() => {}} useTokens />)
    expect(text()).toMatch(/top of chart = 2k tokens/)
    expect(text()).toMatch(/click a bar, or use ← → once one is focused/)
  })

  // F172: with many messages, labels don't print over each other
  it('labels only some messages when there are many', () => {
    const points = Array.from({ length: 20 }, (_, i) => point(i + 1, i + 1))
    const { container } = render(<TokenChart points={points} selected="c1" onSelect={() => {}} useTokens />)
    const labels = [...container.querySelectorAll('text')].filter((t) => /^msg \d+$/.test(t.textContent ?? ''))
    expect(labels.length).toBeLessThanOrEqual(10)
    expect(labels.length).toBeGreaterThan(1)
  })

  // F173: the cached share is a pattern, visible on every bar
  it('draws the cached share with a pattern', () => {
    const { container } = render(<TokenChart points={[point(1, 1, { cached: 500 }), point(2, 1, { cached: 900 })]}
      selected="c1" onSelect={() => {}} useTokens />)
    expect(container.querySelectorAll('rect[fill="url(#cached-hatch)"]').length).toBe(2)
  })
})

describe('Copy tells the truth (F334)', () => {
  const copyBtn = () => screen.getAllByRole('button', { name: /^Copy$/ })[0]
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  afterEach(() => {
    vi.restoreAllMocks(); useUi.setState({ toasts: [] })
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else delete (navigator as { clipboard?: unknown }).clipboard
  })

  it('a refused clipboard write shows an error, not Copied', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    useUi.setState({ toasts: [] })
    open(toolTurn, 0, 'raw')
    fireEvent.click(copyBtn())
    await vi.waitFor(() => expect(useUi.getState().toasts.at(-1)?.title).toBe("Couldn't copy"))
    expect(text()).not.toMatch(/Copied/)
  })

  it('a successful copy says Copied in a status region', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    open(toolTurn, 0, 'raw')
    fireEvent.click(copyBtn())
    await vi.waitFor(() => expect(screen.getAllByRole('status').some((s) => s.textContent === 'Copied')).toBe(true))
  })
})

// ---- Third pass, Task 9: a keyboard tree for the JSON, and charts with words (F333 F335) ----
describe('the JSON tree as a tree (F333)', () => {
  it('the JSON tree is one Tab stop and arrows move', () => {
    render(<JsonTree value={{ a: 1, b: { c: 2 }, d: 'x'.repeat(200) }} openDepth={1} command={{ n: 0, open: false }} label="Request" />)
    const tree = screen.getByRole('tree', { name: 'Request' })
    const tabbable = () => [...tree.querySelectorAll('[tabindex="0"], button:not([tabindex="-1"])')]
    expect(tabbable()).toHaveLength(1)
    const [root] = screen.getAllByRole('treeitem')
    expect(root).toHaveAttribute('aria-expanded', 'true')
    root.focus()
    fireEvent.keyDown(root, { key: 'ArrowDown' })
    expect(document.activeElement!.textContent).toBe('a: 1,')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    const b = document.activeElement as HTMLElement
    expect(b).toHaveAttribute('aria-expanded', 'false')
    expect(b).toHaveAccessibleName(/^b:\s*\{ 1 key \}/)
    fireEvent.keyDown(b, { key: 'ArrowRight' })
    expect(b).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(b, { key: 'ArrowRight' })
    expect(document.activeElement!.textContent).toBe('c: 2')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(b)
    fireEvent.keyDown(b, { key: 'ArrowLeft' })
    expect(b).toHaveAttribute('aria-expanded', 'false')
    expect(tabbable()).toEqual([b]) // the Tab stop follows you
    fireEvent.keyDown(b, { key: 'End' })
    const long = document.activeElement as HTMLElement
    expect(long.textContent).toMatch(/\+40 characters/)
    fireEvent.keyDown(long, { key: 'Enter' })
    expect(long.textContent).toMatch(/less$/)
  })

  // Lines inside a line that Open all or Fold all just opened or folded follow it too, however deep
  it('Open all reaches every level; after Fold all, a line you open shows its insides folded', () => {
    const value = { a: { b: { c: { d: 1 } } } }
    const { rerender } = render(<JsonTree value={value} openDepth={1} command={{ n: 0, open: false }} />)
    expect(text()).not.toMatch(/d: 1/)
    rerender(<JsonTree value={value} openDepth={1} command={{ n: 1, open: true }} />)
    expect(text()).toMatch(/d: 1/)
    rerender(<JsonTree value={value} openDepth={3} command={{ n: 2, open: false }} />)
    expect(text()).not.toMatch(/a:/)
    fireEvent.keyDown(screen.getAllByRole('treeitem')[0], { key: 'ArrowRight' })
    expect(text()).toMatch(/a: \{ 1 key \}/) // folded, though openDepth alone would open it
    expect(text()).not.toMatch(/b:/)
  })

  it('folding the line that holds the Tab stop away hands it to the line that folded', () => {
    const { rerender } = render(<JsonTree value={{ b: { c: 2 } }} openDepth={2} command={{ n: 0, open: false }} />)
    const c = screen.getAllByRole('treeitem').find((i) => i.textContent === 'c: 2')!
    c.focus()
    rerender(<JsonTree value={{ b: { c: 2 } }} openDepth={2} command={{ n: 1, open: false }} />)
    const tree = screen.getByRole('tree', { name: 'JSON' })
    expect(tree.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
  })
})

describe('charts in words (F335)', () => {
  it('the loop diagram names its five steps and where the loop goes', () => {
    render(<LoopDiagram active={null} />)
    const label = screen.getByRole('img').getAttribute('aria-label')!
    for (const step of ['1. You', '2. Call the model', '3. Model replies', '4. Run tools', '5. Show answer']) expect(label).toContain(step)
    expect(label).toContain('asking for tools loops back to Call the model; a finished reply ends it')
  })

  it('the selected bar keeps its colour and gets an outline in Windows high contrast', () => {
    const p = (n: number) => ({ callId: `c${n}`, runIndex: 1, turn: n, read: 1000 * n, cached: 0, wrote: 50, chars: 4000 * n, trimmedChars: 0, summarisedBefore: false })
    render(<TokenChart points={[p(1), p(2)]} selected="c2" onSelect={() => {}} useTokens />)
    const picked = document.querySelectorAll('.chart-selected')
    expect(picked).toHaveLength(1)
    expect((picked[0] as SVGElement).style.forcedColorAdjust).toBe('none')
    const css = readFileSync(join(__dirname, '..', '..', 'styles', 'app.css'), 'utf-8')
    expect(css.slice(css.indexOf('@media (forced-colors: active)'))).toMatch(/\.chart-selected\s*\{[^}]*stroke:\s*Highlight/)
  })
})

// Final review: Alt+← steps to the previous call (the Inspector's shortcut); the tree leaves keys with Alt, Ctrl or
// Meta alone, so it doesn't also fold the line
describe('the JSON tree and modifier keys', () => {
  it('Alt, Ctrl or Meta with an arrow neither folds nor moves', () => {
    render(<JsonTree value={{ a: 1, b: { c: 2 } }} openDepth={1} command={{ n: 0, open: false }} label="Request" />)
    const [root] = screen.getAllByRole('treeitem')
    root.focus()
    for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(fireEvent.keyDown(root, { key: 'ArrowLeft', ...mod })).toBe(true) // true: not prevented, so it reaches the Inspector
      expect(root).toHaveAttribute('aria-expanded', 'true')
      fireEvent.keyDown(root, { key: 'ArrowDown', ...mod })
      expect(document.activeElement).toBe(root)
    }
    fireEvent.keyDown(root, { key: 'ArrowLeft' }) // without a modifier it still folds
    expect(root).toHaveAttribute('aria-expanded', 'false')
  })
})

// F444-F447 (developer path): each tab names the code behind it, edited tools are marked, the sandbox and the
// reply say what they really are
describe('from the page to the code', () => {
  afterEach(() => {
    useServer.setState({ settings: null })
    useSession.setState({ frozen: false })
  })
  const withRequests = (change: (e: Ev) => Ev) => (toolTurn as Ev[]).map((e) => (e.kind === 'request' ? change(e) : e))

  // F444 / DEV-2: a quiet line names the function behind each tab
  it('Sent names the function that builds the request', () => {
    open(toolTurn, 0, 'sent')
    expect(text()).toMatch(/In the code: agent\(\) in harness\/core\/loop.py builds this request/)
  })

  it('Received names the function that gets the reply', () => {
    open(toolTurn, 0, 'received')
    expect(text()).toMatch(/In the code: agent\(\) in harness\/core\/loop.py gets this reply/)
  })

  it('Tools names the functions around each tool, and where hooks are loaded', () => {
    open(toolTurn, 0, 'tools')
    expect(text()).toMatch(/In the code: _before \(checks\), _run_one \(runs\) and _after \(your after_tool hook\) in harness\/core\/loop.py/)
    expect(text()).toMatch(/harness\/features\/hooks.py/)
  })

  // F446 / DEV-7: a tool whose description you edited is marked, as the system prompt is
  it('the Sent tab marks a tool description edited in Settings', () => {
    open(withRequests((e) => ({ ...e, config: { ...(e.config as Ev), descriptions: ['get_weather'] } })), 0, 'sent')
    expect(text()).toMatch(/your edits: get_weather/)
    const row = screen.getAllByText('get_weather', { selector: 'code' })[0].closest('li')!
    expect(within(row).getByText('edited')).toBeInTheDocument()
    expect(text()).not.toMatch(/waits for your next conversation/)
  })

  // F446 / DEV-7: with "From your next conversation", a newer edit says it waits
  it('the Sent tab says when an edit waits for the next conversation', () => {
    useServer.setState({ settings: { apply: 'conversation', tools: [{ name: 'get_weather', description: 'A newer description.' }] } as never })
    useSession.setState({ frozen: true })
    open(toolTurn, 0, 'sent')
    expect(text()).toMatch(/Your edits to get_weather wait for your next conversation/)
    expect(text()).toMatch(/Your newer edit to this description waits for your next conversation/)
  })

  it('a per-message conversation does not say an edit waits', () => {
    useServer.setState({ settings: { apply: 'message', tools: [{ name: 'get_weather', description: 'A newer description.' }] } as never })
    open(toolTurn, 0, 'sent')
    expect(text()).not.toMatch(/wait for your next conversation/)
  })

  // F447 / DEV-9: in the sandbox the hooks file is a copy, and the card says so
  it('the hooks card says when the hooks file is a sandbox copy', () => {
    const file = 'C:\\Users\\me\\AppData\\Local\\Temp\\harness-sandbox-ab12\\config\\my_hooks.py'
    open(withRequests((e) => ({ ...e, hooks: { file, functions: ['before_tool'], problem: null } })), 0, 'tools')
    expect(text()).toMatch(/Loaded from a sandbox copy of config\/my_hooks.py for this message/)
  })

  it('the hooks card names config/my_hooks.py plainly outside the sandbox', () => {
    const file = 'C:\\Harness\\config\\my_hooks.py'
    open(withRequests((e) => ({ ...e, hooks: { file, functions: ['before_tool'], problem: null } })), 0, 'tools')
    expect(text()).toMatch(/Loaded from config\/my_hooks.py for this message/)
    expect(text()).not.toMatch(/sandbox copy/)
  })

  // F447 / DEV-10: Raw says the reply shown is the part the harness reads, not the whole API reply
  it('Raw labels the reply as the parts the harness reads', () => {
    open(toolTurn, 0, 'raw')
    expect(text()).toMatch(/The parts of the API reply the harness reads/)
  })
})
