import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import { Toaster } from './Toaster'
import { SettingsDrawer } from '../settings/SettingsDrawer'
import { toast, useUi } from '../../store/ui'
import { useServer } from '../../store/server'

afterEach(() => useUi.setState({ toasts: [], settingsOpen: false, helpOpen: false, experimentsOpen: false }))

// F189 (changed by F302): a toast is never under a dialog; while one is open, the toast lives inside it
describe('Toaster', () => {
  it('sits at the bottom right', () => {
    useUi.setState({ toasts: [{ id: 1, kind: 'ok', title: 'Saved' }] })
    render(<RTooltip.Provider><Toaster /></RTooltip.Provider>)
    expect(screen.getByText('Saved').closest('[data-toaster]')!.className).toMatch(/right-4/)
  })
  it('the page-level one stays empty while a dialog is open', () => {
    useUi.setState({ settingsOpen: true, toasts: [{ id: 1, kind: 'ok', title: 'Saved' }] })
    render(<Toaster />)
    expect(screen.queryByText('Saved')).toBeNull()
  })
  it('an in-dialog one shows only inside an open dialog', () => {
    useUi.setState({ toasts: [{ id: 1, kind: 'ok', title: 'Saved' }] })
    render(<RTooltip.Provider><Toaster inDialog /></RTooltip.Provider>)
    expect(screen.queryByText('Saved')).toBeNull()
    act(() => useUi.setState({ helpOpen: true }))
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  // F302
  it('while Settings is open, a toast renders inside the dialog, is not aria-hidden, and its Undo keeps the drawer open', () => {
    useServer.setState({ settings: null, info: null })
    useUi.setState({ settingsOpen: true })
    const run = vi.fn()
    render(<RTooltip.Provider><SettingsDrawer /><Toaster /></RTooltip.Provider>)
    act(() => toast({ kind: 'ok', title: 'Reset', action: { label: 'Undo', run } }))
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo.closest('[role="dialog"]')).not.toBeNull()
    expect(undo.closest('[aria-hidden="true"]')).toBeNull()
    fireEvent.click(undo)
    expect(run).toHaveBeenCalled()
    expect(useUi.getState().settingsOpen).toBe(true)
  })
})
