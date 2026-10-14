import { afterEach, describe, expect, it } from 'vitest'
import { escapeStops } from './selectors'
import { useSession } from './session'
import { useUi } from './ui'

afterEach(() => {
  useSession.setState({ running: false })
  useUi.setState({ approvalDock: null, screen: 'run' })
})

// F035: the server treats a stop as a decline, so Esc must not stop while the approval panel is up
describe('escapeStops', () => {
  it('stops a running message', () => {
    useSession.setState({ running: true })
    expect(escapeStops()).toBe(true)
  })

  // F313: Esc on another screen must not stop a run you can't see
  it('Esc does not stop a run from the Compare screen', () => {
    useSession.setState({ running: true })
    useUi.setState({ screen: 'compare' })
    expect(escapeStops()).toBe(false)
  })

  it('does nothing when nothing is running', () => {
    expect(escapeStops()).toBe(false)
  })

  it('does nothing while the approval panel is waiting for an answer', () => {
    useSession.setState({ running: true })
    useUi.setState({ approvalDock: { answer: () => {}, focus: () => {}, armed: () => true } })
    expect(escapeStops()).toBe(false)
  })
})
