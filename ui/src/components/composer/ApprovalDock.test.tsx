import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useUi } from '../../store/ui'
import type { Approval, ToolRow } from '../../model/derive'
import { useShortcuts } from '../../lib/shortcuts'
import { decide } from '../../store/selectors'
import { ApprovalDock } from './ApprovalDock'

const calls: string[] = []
vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    saveSettings: vi.fn(async (change: unknown) => { calls.push(`save ${JSON.stringify(change)}`); return {} }),
    approve: vi.fn(async (id: string, allowed: boolean) => { calls.push(`approve ${id} ${allowed}`); return { ok: true } }),
  },
}))

const approval = (over: Partial<Approval> = {}): Approval => ({
  id: 'a1', toolId: 'w1', tool: 'write_file', prompt: 'Allow?', input: { path: 'todo.txt' }, path: 'todo.txt',
  content: '- book the room', outside: false, ...over,
})
const row = { permission: 'ask' } as ToolRow

beforeEach(() => { calls.length = 0 })

describe('ApprovalDock', () => {
  it('"Always allow" saves the permission before approving', async () => {
    render(<ApprovalDock approval={approval()} row={row} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Always allow/ }))
    fireEvent.click(screen.getByRole('button', { name: /Allow/ }))
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls).toEqual(['save {"permissions":{"write_file":"allow"}}', 'approve a1 true'])
  })

  it('declining never saves anything', async () => {
    render(<ApprovalDock approval={approval()} row={row} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Always allow/ }))
    fireEvent.click(screen.getByRole('button', { name: /Decline/ }))
    await vi.waitFor(() => expect(calls).toEqual(['approve a1 false']))
  })

  it('offers no "Always allow" outside the workspace (that always asks)', () => {
    render(<ApprovalDock approval={approval({ outside: true })} row={row} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText(/outside the workspace folder/)).toBeInTheDocument()
  })

  it('takes focus so A and D work straight away, but not while typing', async () => {
    function Page() {
      useShortcuts([
        { key: 'a', run: () => decide('a1', true) },
        { key: 'd', run: () => decide('a1', false) },
      ])
      return <><textarea aria-label="Message" /><ApprovalDock approval={approval()} row={row} /></>
    }
    render(<Page />)
    expect(document.activeElement).toHaveAttribute('data-approval-dock')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'a' }) // typing an "a" doesn't approve
    fireEvent.keyDown(document.activeElement!, { key: 'd' })
    await vi.waitFor(() => expect(calls).toEqual(['approve a1 false']))
  })

  // F001, F002, F034: the A and D keys go through the panel, so key and click do the same thing
  it('registers an answer function while shown and clears it when gone', () => {
    const { unmount } = render(<ApprovalDock approval={approval()} row={row} />)
    expect(useUi.getState().approvalDock).not.toBeNull()
    unmount()
    expect(useUi.getState().approvalDock).toBeNull()
  })

  it('the registered answer honours the "Always allow" box', async () => {
    render(<ApprovalDock approval={approval()} row={row} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Always allow/ }))
    act(() => { useUi.getState().approvalDock!.answer(true) })
    await vi.waitFor(() => expect(calls).toEqual(['save {"permissions":{"write_file":"allow"}}', 'approve a1 true']))
  })

  it('ignores a second answer while the first is still being sent', async () => {
    render(<ApprovalDock approval={approval()} row={row} />)
    act(() => {
      useUi.getState().approvalDock!.answer(true)
      useUi.getState().approvalDock!.answer(true)
    })
    await vi.waitFor(() => expect(calls).toEqual(['approve a1 true']))
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toEqual(['approve a1 true'])
  })

  // F042: the box says what it does and where the rule ends up
  it('"Always allow" says it changes the rule in Settings', () => {
    render(<ApprovalDock approval={approval()} row={row} />)
    expect(screen.getByRole('checkbox', { name: /sets it to Allow in Settings → Tools/ })).toBeInTheDocument()
  })

  // F277: a label you already have is replaced, and shared again: say so before you allow it
  it('says what a fact would replace', () => {
    render(<ApprovalDock approval={approval({ tool: 'remember_fact', input: { label: 'Temperature unit', value: 'Fahrenheit' },
      replaces: { label: 'Temperature unit', value: 'Celsius', shared: false } })} row={row} />)
    expect(screen.getByText(/Replaces “Celsius”, which isn't shared now: allowing shares the new value/)).toBeInTheDocument()
  })

  // F278: "Always allow" on remember_fact means future facts are saved and shared without asking
  it('"Always allow" on remember_fact says future facts are shared without asking', () => {
    render(<ApprovalDock approval={approval({ tool: 'remember_fact', input: { label: 'Name', value: 'Ada' } })} row={row} />)
    expect(screen.getByRole('checkbox', { name: /future facts are saved and shared without asking you/ })).toBeInTheDocument()
  })

  // F388: a script run by path shows what the file says, as code the model wrote does
  it('shows what a script file says before you allow it', () => {
    render(<ApprovalDock approval={approval({ tool: 'run_python', input: { path: 'scripts/x.py' }, path: 'scripts/x.py',
      content: '', where: 'C:\\lab\\workspace\\scripts\\x.py', script: { text: "print('hi')", cut: false } })} row={row} />)
    expect(screen.getByText('C:\\lab\\workspace\\scripts\\x.py')).toBeInTheDocument()
    expect(screen.getByText("print('hi')")).toBeInTheDocument()
    expect(screen.getByText(/the file as it is now\. It could still change before it runs/)).toBeInTheDocument()
  })

  it("says so when a script file can't be read", () => {
    render(<ApprovalDock approval={approval({ tool: 'run_python', input: { path: 'gone.py' }, path: 'gone.py', content: '',
      script: { error: "can't be read (No such file or directory)" } })} row={row} />)
    expect(screen.getByText(/The file can't be read \(No such file or directory\), so you can't see what it would run/)).toBeInTheDocument()
  })

  // F279: where a file really goes, from the server, not the prompt's wording
  it('shows where the file really goes', () => {
    render(<ApprovalDock approval={approval({ path: 'todo.txt', where: 'C:\\lab\\workspace\\todo.txt' })} row={row} />)
    expect(screen.getByText('C:\\lab\\workspace\\todo.txt')).toBeInTheDocument()
  })

  // F280, F281: outside the workspace, Allow became Ask first; "Always allow" isn't offered, and says why
  it('outside the workspace, says Allow became Ask first and why there is no "Always allow"', () => {
    render(<ApprovalDock approval={approval({ outside: true, setting: 'allow' })} row={row} />)
    expect(screen.getByText(/even though it's set to Allow/)).toBeInTheDocument()
    expect(screen.getByText(/"Always allow" isn't offered here: paths outside the workspace always ask/)).toBeInTheDocument()
  })

  it('"Always allow" says paths outside the workspace will still ask', () => {
    render(<ApprovalDock approval={approval()} row={row} />)
    expect(screen.getByRole('checkbox', { name: /paths outside the workspace will still ask/ })).toBeInTheDocument()
  })

  // F311: a key typed before the panel is ready (while you were typing a message) must not answer it
  it('a key typed in the first 800 ms after the dock appears does nothing', async () => {
    vi.useFakeTimers()
    try {
      function Page() {
        useShortcuts([{ key: 'a', when: () => { const d = useUi.getState().approvalDock; return !!d && d.armed() }, run: () => useUi.getState().approvalDock!.answer(true) }])
        return <ApprovalDock approval={approval()} row={row} />
      }
      render(<Page />)
      fireEvent.keyDown(document.body, { key: 'a' })
      expect(calls).toEqual([])
      act(() => { vi.advanceTimersByTime(800) })
      fireEvent.keyDown(document.body, { key: 'a' })
      await vi.waitFor(() => expect(calls).toEqual(['approve a1 true']))
    } finally { vi.useRealTimers() }
  })

  it('says which keys answer it, in the visible panel', () => {
    render(<ApprovalDock approval={approval()} row={row} />)
    expect(screen.getByText('Press A to allow or D to decline.')).toBeInTheDocument()
  })

  // F114 groundwork and F141: "/" while the panel waits goes to Allow
  it('can put focus on Allow', () => {
    render(<ApprovalDock approval={approval()} row={row} />)
    act(() => { useUi.getState().approvalDock!.focus() })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Allow/ }))
  })
})
