import { describe, expect, it } from 'vitest'
import { ruleBadge, statusLabel } from './permission'

describe('ruleBadge', () => {
  // F280: only Allow becomes Ask first outside the workspace; a tool set to Block stays Block
  it('a blocked tool reads Block, inside the workspace or not', () => {
    expect(ruleBadge({ permission: 'block', outside: true, status: 'blocked' })?.label).toBe('Block')
    expect(ruleBadge({ permission: 'block', outside: false, status: 'blocked' })?.label).toBe('Block')
  })

  it('an allowed tool outside the workspace reads "outside workspace"', () => {
    const badge = ruleBadge({ permission: 'ask', outside: true, status: 'awaiting' })!
    expect(badge.label).toBe('outside workspace')
    expect(badge.help).toMatch(/set to Allow/)
    expect(badge.help).not.toMatch(/whatever/)
  })
})

describe('statusLabel', () => {
  // F298: refused because nobody could be asked is not "blocked by your settings"
  it('says when a tool needed an OK nobody could give', () => {
    expect(statusLabel('unattended')).toEqual({ label: 'not run: nobody to ask', tone: 'warn' })
    expect(statusLabel('blocked').label).toBe('blocked by your settings')
  })
})
