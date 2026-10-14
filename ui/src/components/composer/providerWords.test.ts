import { describe, expect, it } from 'vitest'
import { missingKeyHelp, shortLabel, switchNote } from './providerWords'

describe('provider menu words', () => {
  // F043: a provider without a key says how to add one
  it('says how to set a missing key', () => {
    expect(missingKeyHelp('DEEPSEEK_API_KEY')).toBe('Needs DEEPSEEK_API_KEY. In PowerShell: setx DEEPSEEK_API_KEY "your key", then pick it again.')
  })
  // F137: switching mid-conversation re-sends the history, at full price
  it('warns that the history goes to the new model', () => {
    expect(switchNote(0)).toBe('Same loop and tools; only the address, key and model change.')
    expect(switchNote(3)).toBe('Same loop and tools. Your 3 messages so far are sent to the new model, whose first call pays full price.')
    expect(switchNote(1)).toMatch(/Your 1 message so far is sent/)
  })
  // F142: the pill stays one line
  it('shortens the mock label for the pill', () => {
    expect(shortLabel('Mock: replies from claude -p')).toBe('Mock (claude -p)')
    expect(shortLabel('DeepSeek')).toBe('DeepSeek')
  })
})
