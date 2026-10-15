// The context window: the most a model can take in on one call (system prompt, tools and the
// whole history). Sizes come from the server (harness/core/providers.py).
import type { Info } from '../api/types'

export const CHARS_PER_TOKEN = 4 // the rough rule the lab uses everywhere for estimates

export function windowFor(info: Info | null | undefined, provider: string | null | undefined, model: string | null | undefined) {
  const p = info?.providers.find((x) => x.name === provider)
  return (model && p?.context_windows?.[model]) || null
}

// Where a provider's prices (or window sizes) come from, in words: "Anthropic's model list, checked 2026-10-15"
export function sourceNote(info: Info | null | undefined, provider: string | null | undefined, what: 'prices' | 'windows') {
  const s = info?.providers.find((x) => x.name === provider)?.source
  return s ? `${s[what]}, checked ${s.checked}` : null
}

// The summarising threshold is stored in characters; show it as a share of the model's window
export const charsToPercent = (chars: number, window: number) => Math.round((chars / CHARS_PER_TOKEN / window) * 1000) / 10
export const percentToChars = (percent: number, window: number) => Math.round((percent / 100) * window * CHARS_PER_TOKEN)
