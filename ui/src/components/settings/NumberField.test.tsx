import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { NumberField } from './NumberField'

const field = (onCommit = vi.fn(async () => true), value = 16000) => {
  render(<NumberField label="Longest reply" value={value} min={256} max={16000} defaultValue={16000} onCommit={onCommit} />)
  return { box: screen.getByRole('spinbutton', { name: 'Longest reply' }) as HTMLInputElement, onCommit }
}

// F079, F174, F182: numbers are kept in range, committed on Enter as well as blur, and put back if refused
describe('NumberField', () => {
  it('clamps a number below the range to the smallest allowed, and saves that', () => {
    const { box, onCommit } = field()
    fireEvent.change(box, { target: { value: '5' } })
    fireEvent.blur(box)
    expect(onCommit).toHaveBeenCalledWith(256)
    expect(box.value).toBe('256')
  })

  it('clamps a number above the range to the largest allowed', () => {
    const { box, onCommit } = field(undefined, 300)
    fireEvent.change(box, { target: { value: '99999' } })
    fireEvent.blur(box)
    expect(onCommit).toHaveBeenCalledWith(16000)
  })

  it('Enter saves too', () => {
    const { box, onCommit } = field()
    fireEvent.change(box, { target: { value: '300' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(300)
  })

  // review focus 3: a blank field must not send NaN
  it('a blank field goes back to the saved value without saving', () => {
    const { box, onCommit } = field()
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)
    expect(onCommit).not.toHaveBeenCalled()
    expect(box.value).toBe('16000')
  })

  it('a value the server refuses goes back to the saved value', async () => {
    const { box } = field(vi.fn(async () => false))
    fireEvent.change(box, { target: { value: '300' } })
    fireEvent.blur(box)
    await vi.waitFor(() => expect(box.value).toBe('16000'))
  })

  it('says the range and the default next to the field', () => {
    field()
    expect(screen.getByText(/256 to 16,000; default 16,000/)).toBeInTheDocument()
  })

  // F341: the label is a real label, the range and hint are the field's description, and a clamp says so
  it('the label and the hint belong to the field', () => {
    const { box } = field()
    expect(screen.getByText('Longest reply').tagName).toBe('LABEL')
    expect(box).not.toHaveAttribute('aria-label')
    expect(box).toHaveAccessibleDescription(/256 to 16,000; default 16,000/)
  })

  it('a clamped value says what it was set to, for a few seconds', () => {
    vi.useFakeTimers()
    try {
      const { box } = field(undefined, 300)
      fireEvent.change(box, { target: { value: '99999' } })
      fireEvent.blur(box)
      expect(box).toHaveAccessibleDescription(/Set to 16,000 \(the most allowed\)/)
      act(() => { vi.advanceTimersByTime(3100) })
      expect(box).not.toHaveAccessibleDescription(/Set to/)
      fireEvent.change(box, { target: { value: '5' } })
      fireEvent.blur(box)
      expect(box).toHaveAccessibleDescription(/Set to 256 \(the least allowed\)/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an unchanged value is not saved again', () => {
    const { box, onCommit } = field()
    fireEvent.blur(box)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
