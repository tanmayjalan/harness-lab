import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useUi } from '../store/ui'
import { Markdown } from './Markdown'

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const setClipboard = (value: unknown) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
beforeEach(() => useUi.setState({ toasts: [] }))
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original)
  else delete (navigator as { clipboard?: unknown }).clipboard
})

const link = () => { render(<Markdown text="See [docs](https://example.com)." />); fireEvent.click(screen.getByRole('button', { name: 'docs' })) }

describe('copying a link (F334)', () => {
  it('says Link copied', async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) })
    link()
    await vi.waitFor(() => expect(useUi.getState().toasts.at(-1)?.title).toBe('Link copied'))
  })
  it('a refused write shows an error', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    link()
    await vi.waitFor(() => expect(useUi.getState().toasts.at(-1)?.title).toBe("Couldn't copy"))
  })
  it('no clipboard at all shows an error too', async () => {
    setClipboard(undefined)
    link()
    await vi.waitFor(() => expect(useUi.getState().toasts.at(-1)?.title).toBe("Couldn't copy"))
  })
})
