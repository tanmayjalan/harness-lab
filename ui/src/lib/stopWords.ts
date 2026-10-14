// Why the model stopped writing, in plain words: used on call lines, helper calls and the Inspector
import { plural } from './format'

export const STOP_WORDS: Record<string, string> = {
  end_turn: 'finished',
  max_tokens: 'hit the longest-reply limit',
  stop_sequence: 'hit a stop sequence',
  refusal: 'refused',
}

export function stopWords(stopReason: string | undefined, toolCount: number): string {
  if (!stopReason) return 'waiting…'
  if (stopReason === 'tool_use') return `asked for ${plural(toolCount, 'tool')}`
  return STOP_WORDS[stopReason] ?? stopReason
}
