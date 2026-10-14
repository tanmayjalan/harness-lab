// When a saved setting takes effect, in words for the "saved" toast. With "From your next
// conversation" the harness keeps the system prompt and tool descriptions a conversation started
// with (server.py, frozen); every other setting is read fresh for each message.
import type { Apply, SettingsChange } from '../api/types'

export function appliesNote(change: SettingsChange, apply: Apply): string | undefined {
  if (change.apply !== undefined) return undefined
  const frozen = change.system !== undefined || change.descriptions !== undefined || change.skills !== undefined
  return frozen && apply === 'conversation'
    ? 'It applies from your next conversation.'
    : 'It applies from your next message.'
}
