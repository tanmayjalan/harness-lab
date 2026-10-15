// The chat as a story: plain steps by default, today's full view under "Show details"
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns } from '../../model/derive'
import { useSession } from '../../store/session'
import { usePrefs, useUi } from '../../store/ui'
import { RunView } from './RunView'
import toolTurn from '../../test/fixtures/tool_turn.json'

const show = (events: unknown[], running = false) => {
  useSession.setState({ derived: deriveRuns(events as HarnessEvent[]), loaded: true, running, conversation: 'c1' })
  return render(<RunView composerRef={{ current: null }} />)
}

const chat = () => document.querySelector<HTMLElement>('.overflow-y-auto')!

beforeEach(() => {
  usePrefs.setState({ alwaysDetails: false, learningMode: false, explained: [], inspectorOpen: false })
  useUi.setState({ experimentId: null, guess: null })
})

describe('the story view', () => {
  it('tells each trip to the model as a numbered step in plain words, then the answer', () => {
    show(toolTurn)
    const story = screen.getByRole('list', { name: 'What happened, step by step' })
    const steps = within(story).getAllByRole('listitem').filter((li) => li.parentElement === story)
    expect(steps).toHaveLength(3)
    expect(steps[0].textContent).toMatch(/The model asked for 2 tools at once:/)
    expect(steps[0].textContent).toMatch(/look up the weather in Paris(inspect →)?↩ The harness ran it here and sent back: Paris/)
    expect(steps[2].textContent).toBe('3The model answered:')
    expect(screen.getByRole('heading', { name: "The model's reply" })).toBeInTheDocument()
  })

  it('shows one quiet line of numbers, and no call lines, tool rows or ⓘ chips', () => {
    show(toolTurn)
    expect(screen.getByTestId('story-numbers').textContent).toMatch(/^3 trips to the model · /)
    expect(screen.queryByRole('button', { name: /^Call 1/ })).toBeNull()
    // the only ⓘ is the takeaway's
    const chips = screen.queryAllByRole('button', { name: /mean\?/ })
    expect(chips.every((c) => c.closest('[data-testid=takeaway]'))).toBe(true)
    expect(within(chat()).queryByText(/tokens in/)).toBeNull()
  })

  it('"Show details" opens today\'s full view, by keyboard as well, and says what it controls', () => {
    show(toolTurn)
    const toggle = screen.getByRole('button', { name: 'Show details ▾' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const details = screen.getByTestId('details')
    expect(toggle).toHaveAttribute('aria-controls', details.id)
    expect(within(details).getByRole('button', { name: /^Call 1/ })).toBeInTheDocument()
    expect(within(details).getAllByText(/tokens in/).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('heading', { name: "The model's reply" })).toHaveLength(1) // (the answer isn't drawn twice)
    fireEvent.click(screen.getByRole('button', { name: 'Hide details ▴' }))
    expect(screen.queryByTestId('details')).toBeNull()
  })

  it('Learning mode, or "Always show details", opens the details by default', () => {
    usePrefs.setState({ learningMode: true })
    const { unmount } = show(toolTurn)
    expect(screen.getByTestId('details')).toBeInTheDocument()
    unmount()
    usePrefs.setState({ learningMode: false, alwaysDetails: false })
    show(toolTurn)
    fireEvent.click(screen.getByRole('button', { name: 'Show details ▾' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Always show details' }))
    expect(usePrefs.getState().alwaysDetails).toBe(true)
  })

  it('clicking what the model asked for opens it in Inspector → Tools', () => {
    show(toolTurn)
    fireEvent.click(screen.getByRole('button', { name: 'look up the weather in Paris' }))
    expect(usePrefs.getState()).toMatchObject({ inspectorOpen: true, inspectorTab: 'tools' })
  })

  it('one "What just happened" after the newest answer; an experiment shows its own reveal instead', () => {
    const { unmount } = show(toolTurn)
    expect(screen.getByTestId('takeaway').textContent).toMatch(/What just happened.*That repeat is the loop/)
    unmount()
    useUi.setState({ experimentId: 'loop' })
    show(toolTurn)
    expect(screen.queryByTestId('takeaway')).toBeNull()
    expect(screen.getByTestId('experiment-reveal').textContent).toMatch(/What just happened: Watch the loop/)
  })

  it('while it runs, the steps so far show, with "Waiting for the model…" as the current one', () => {
    const events = (toolTurn as Array<Record<string, unknown>>)
    const cut = events.findIndex((e, i) => e.kind === 'request' && i > 0 && events.slice(0, i).some((x) => x.kind === 'tool_result'))
    show(events.slice(0, cut + 1), true)
    const story = screen.getByRole('list', { name: 'What happened, step by step' })
    const current = story.querySelector('[aria-current="step"]')!
    expect(current.textContent).toMatch(/Waiting for the model/)
    expect(story.textContent).toMatch(/look up the weather in Paris/)
  })
})
