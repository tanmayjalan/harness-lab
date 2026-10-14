import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toast, usePrefs, useUi } from './ui'

beforeEach(() => useUi.setState({ toasts: [] }))

// F189: the same message twice in a row shows once
describe('toast', () => {
  it('does not stack an identical message that is still showing', () => {
    toast({ kind: 'error', title: "Couldn't save limits", body: 'too small' })
    toast({ kind: 'error', title: "Couldn't save limits", body: 'too small' })
    expect(useUi.getState().toasts).toHaveLength(1)
  })
  it('different messages still stack', () => {
    toast({ kind: 'ok', title: 'A saved' })
    toast({ kind: 'ok', title: 'B saved' })
    expect(useUi.getState().toasts).toHaveLength(2)
  })
})

// F305: the old default (520) moves to the new one (440); a width you picked stays
describe('stored prefs', () => {
  afterEach(() => localStorage.removeItem('harness-lab-prefs'))
  it('a stored width of 520 migrates to 440', async () => {
    localStorage.setItem('harness-lab-prefs', JSON.stringify({ state: { inspectorWidth: 520 }, version: 0 }))
    await usePrefs.persist.rehydrate()
    expect(usePrefs.getState().inspectorWidth).toBe(440)
  })
  it('any other stored width is kept', async () => {
    localStorage.setItem('harness-lab-prefs', JSON.stringify({ state: { inspectorWidth: 720 }, version: 0 }))
    await usePrefs.persist.rehydrate()
    expect(usePrefs.getState().inspectorWidth).toBe(720)
  })
})
