// Words for the provider menu above the message box.
import type { ProviderInfo } from '../../api/types'
import { plural } from '../../lib/format'

export function missingKeyHelp(env: string) {
  return `Needs ${env}. In PowerShell: setx ${env} "your key", then pick it again.`
}

// What switching does, and (mid-conversation) what it costs
export function switchNote(messages: number) {
  if (!messages) return 'Same loop and tools; only the address, key and model change.'
  return `Same loop and tools. Your ${messages} ${messages === 1 ? 'message' : 'messages'} so far ${messages === 1 ? 'is' : 'are'} `
    + 'sent to the new model, whose first call pays full price.'
}

// A short label for the pill, so it stays on one line
export function shortLabel(label: string) {
  return label === 'Mock: replies from claude -p' ? 'Mock (claude -p)' : label
}

// What a run on a paid provider uses, in that provider's own prices (never an invented figure); null when none is paid
export function paidNote(used: { name: string; conversations: number }[], providers: ProviderInfo[] | undefined) {
  const paid = used.flatMap((u) => {
    const p = providers?.find((x) => x.name === u.name)
    return p?.price ? [{ p, price: p.price, n: u.conversations }] : []
  })
  if (!paid.length) return null
  const rates = paid.map(({ p, price }) => `$${price.input} in / $${price.output} out per million tokens${paid.length > 1 ? ` (${shortLabel(p.label)})` : ''}`)
  return `Uses the paid API: ${plural(paid.reduce((a, x) => a + x.n, 0), 'conversation')} at ${rates.join(' and ')}.`
}

// One name for a provider everywhere: its label from /info, shortened; the raw name until /info arrives
export function providerName(providers: { name: string; label: string }[] | undefined, name: string) {
  return shortLabel(providers?.find((p) => p.name === name)?.label ?? name)
}
