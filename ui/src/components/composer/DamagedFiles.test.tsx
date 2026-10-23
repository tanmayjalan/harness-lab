import { afterEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { Settings } from '../../api/types'
import { useServer } from '../../store/server'
import { DamagedFiles } from './DamagedFiles'

const sentence = "lab_settings.json couldn't be read (bad JSON), so it was moved to lab_settings.damaged-20261023-134334-e750.json and the defaults are used."
const withDamaged = (damaged?: string[]) => useServer.setState({ settings: { mcp_problems: [], ...(damaged ? { damaged } : {}) } as unknown as Settings })

afterEach(() => useServer.setState({ settings: null }))

describe('a saved file that could not be read', () => {
  it('is said above the message box, with what the server did about it', () => {
    withDamaged([sentence])
    const { container } = render(<DamagedFiles />)
    expect(container.textContent).toBe(`A saved file couldn't be read: ${sentence}`)
  })

  it('shows each one', () => {
    withDamaged([sentence, 'profile.json was moved too.'])
    const { container } = render(<DamagedFiles />)
    expect(container.textContent).toContain(sentence)
    expect(container.textContent).toContain('profile.json was moved too.')
  })

  it('shows nothing when every file was read, or the server is older and does not say', () => {
    withDamaged([])
    expect(render(<DamagedFiles />).container).toBeEmptyDOMElement()
    withDamaged(undefined)
    expect(render(<DamagedFiles />).container).toBeEmptyDOMElement()
  })
})
