import { describe, expect, it } from 'vitest'
import { appliesNote } from './applies'

// F078: the save toast must say when the change takes effect, not always "your next message"
describe('appliesNote', () => {
  it('the prompt and tool descriptions follow the "when changes apply" switch', () => {
    expect(appliesNote({ system: 'Be brief.' }, 'message')).toBe('It applies from your next message.')
    expect(appliesNote({ system: 'Be brief.' }, 'conversation')).toBe('It applies from your next conversation.')
    expect(appliesNote({ descriptions: { calculate: 'Do maths.' } }, 'conversation')).toBe('It applies from your next conversation.')
  })

  it('everything else applies from the next message whatever the switch says', () => {
    expect(appliesNote({ permissions: { write_file: 'allow' } }, 'conversation')).toBe('It applies from your next message.')
    expect(appliesNote({ limits: { max_tokens: 300, max_turns: 20 } }, 'conversation')).toBe('It applies from your next message.')
  })

  it('saving the switch itself needs no note', () => {
    expect(appliesNote({ apply: 'conversation' }, 'conversation')).toBeUndefined()
  })
})
