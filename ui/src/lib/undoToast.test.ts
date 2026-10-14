import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUi } from '../store/ui'
import { undoToast } from './undoToast'

beforeEach(() => useUi.setState({ toasts: [] }))

describe('undoToast', () => {
  it('shows Undo and runs the restore', () => {
    const undo = vi.fn()
    undoToast('Removed Name', undo, 'Put it back')
    const t = useUi.getState().toasts[0]
    expect(t.title).toBe('Removed Name')
    expect(t.action?.label).toBe('Undo')
    t.action?.run()
    expect(undo).toHaveBeenCalledOnce()
  })
  it('says so when the restore fails', async () => {
    undoToast('Removed Name', () => Promise.reject(new Error('nope')))
    useUi.getState().toasts[0].action?.run()
    await vi.waitFor(() => expect(useUi.getState().toasts.some((t) => t.title === "Couldn't undo")).toBe(true))
  })
})
