import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import { useServer } from '../../store/server'
import { usePrefs } from '../../store/ui'
import { api } from '../../api/client'
import { Sidebar } from './Sidebar'

const item = (id: string, title: string, kind: string | null = null) =>
  ({ id, title, created: 1_790_000_000, updated: 1_790_000_000, runs: 1, badge: [], kind })

describe('Sidebar', () => {
  // F149's other half: eval runs are saved to be inspected from Evals, not to fill the conversation list
  it('leaves out conversations saved by eval runs', () => {
    useServer.setState({ conversations: { current: '', items: [item('a', 'My chat'), item('b', 'Eval · What is 2+2?', 'eval')] } as never })
    render(<RTooltip.Provider><Sidebar /></RTooltip.Provider>)
    expect(screen.getByText('My chat')).toBeInTheDocument()
    expect(screen.queryByText(/Eval · What is 2\+2\?/)).toBeNull()
  })

  // F301a: the row is gone, so focus must not fall to the page
  it('after a confirmed delete, focus is on New conversation', async () => {
    const list = { current: '', items: [item('a', 'My chat')] } as never
    useServer.setState({ conversations: list })
    vi.spyOn(api, 'deleteConversation').mockResolvedValue({ current: '', items: [] } as never)
    render(<RTooltip.Provider><Sidebar /></RTooltip.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete My chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete My chat' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /New conversation/ })).toHaveFocus())
    vi.restoreAllMocks()
  })

  // F330n: the confirmation waits for you
  it('the delete confirmation stays armed until you leave the button or press Esc', () => {
    vi.useFakeTimers()
    useServer.setState({ conversations: { current: '', items: [item('a', 'My chat')] } as never })
    render(<RTooltip.Provider><Sidebar /></RTooltip.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete My chat' }))
    act(() => { vi.advanceTimersByTime(10000) })
    expect(screen.getByRole('button', { name: 'Confirm delete My chat' })).toBeInTheDocument()
    expect(screen.getByText('Press again to delete')).toHaveAttribute('role', 'status')
    fireEvent.blur(screen.getByRole('button', { name: 'Confirm delete My chat' }))
    expect(screen.getByRole('button', { name: 'Delete My chat' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete My chat' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Confirm delete My chat' }), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Delete My chat' })).toBeInTheDocument()
    vi.useRealTimers()
  })

  // F330m: a cut-off title has a tooltip, and "Delete? Click again" never covers it
  it('a long title has a tooltip and the armed delete sits under the title', () => {
    const long = "What's the weather in Paris, in Celsius and Fahrenheit, tomorrow morning?"
    useServer.setState({ conversations: { current: '', items: [item('a', long)] } as never })
    render(<RTooltip.Provider><Sidebar /></RTooltip.Provider>)
    const title = screen.getByText(long)
    expect(title.className).toMatch(/\btruncate\b/)
    expect(title).toHaveAttribute('title', long)
    const bin = screen.getByRole('button', { name: `Delete ${long}` })
    expect(bin.parentElement!.className).toMatch(/\btop-1\b/)
    fireEvent.click(bin)
    const armed = screen.getByRole('button', { name: `Confirm delete ${long}` })
    // the bin stays under the pointer, so the second click lands where the first did
    expect(armed.parentElement!.className).toMatch(/\btop-1\b/)
    // the label hangs under it, inside the button (a click on it counts)
    const label = screen.getByText('Delete? Click again')
    expect(armed).toContainElement(label)
    expect(label.className).toMatch(/\babsolute\b/)
    expect(label.className).toMatch(/\btop-full\b/)
  })
})

// F349b: comparison sides fold into one group, after the dated ones
describe('Sidebar comparisons', () => {
  it('comparison sides are grouped and folded', () => {
    usePrefs.setState({ sidebarComparisonsOpen: false })
    useServer.setState({ conversations: { current: '', items: [item('a', 'My chat'), item('b', 'Compare · Allowed · A', 'compare'), item('c', 'Compare · Allowed · B', 'compare')] } as never })
    render(<RTooltip.Provider><Sidebar /></RTooltip.Provider>)
    const summary = screen.getByText('Comparisons (2)')
    const group = summary.closest('details')!
    expect(group.open).toBe(false)
    expect(group.contains(screen.getByText('Compare · Allowed · A'))).toBe(true)
    expect(group.contains(screen.getByText('My chat'))).toBe(false)
    expect(screen.getByText('My chat').compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    group.open = true // (jsdom doesn't open a group when its title is clicked)
    fireEvent(group, new Event('toggle'))
    expect(usePrefs.getState().sidebarComparisonsOpen).toBe(true)
  })
})
