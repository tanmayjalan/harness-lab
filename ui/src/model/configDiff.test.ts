import { describe, expect, it } from 'vitest'
import { configDiff } from './configDiff'

const base = { provider: 'mock', label: 'Mock', model: 'm', system: 'S', system_edited: false, descriptions: [],
  permissions: {}, trim: null, compact: null, facts_shared: 0 }

describe('configDiff', () => {
  it('lists only what differs, in plain words', () => {
    expect(configDiff(base, base)).toEqual([])
    const rows = configDiff(base, { ...base, system: 'Pirate', system_edited: true, permissions: { roll_dice: 'block' },
      trim: { enabled: true, keep_last: 2 } })
    expect(rows).toEqual([
      { what: 'System prompt', a: 'default', b: 'edited' },
      { what: 'Permissions', a: 'defaults', b: 'roll_dice: block' },
      { what: 'Trimming', a: 'off', b: 'on (keep 2)' },
    ])
  })

  it('notices two different edited prompts', () => {
    const rows = configDiff({ ...base, system: 'A', system_edited: true }, { ...base, system: 'B', system_edited: true })
    expect(rows.map((r) => r.what)).toEqual(['System prompt'])
  })

  it('says nothing when a side has no recorded setup', () => {
    expect(configDiff(null, base)).toEqual([])
  })
})
