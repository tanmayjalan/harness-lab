// Words for the provider menu above the message box.
import type { ProviderInfo } from '../../api/types'
import { plural } from '../../lib/format'

export function missingKeyHelp(env: string) {
  return `Needs ${env}. In PowerShell: setx ${env} "your key", then pick it again.`
}

// Why a provider can't be picked now (a missing key, or a local server that isn't ready), or null
export function unusable(p: Pick<ProviderInfo, 'missing_key' | 'problem'>) {
  return p.missing_key ? missingKeyHelp(p.missing_key) : p.problem ?? null
}

// The models to list for a provider: a local server that isn't running has none yet, so list its name once
export function modelsOf(p: Pick<ProviderInfo, 'models' | 'model'>): string[] {
  return p.models?.length ? p.models : [p.model ?? 'no model yet']
}

// " (no tools)" after a model that can't use tools (Ollama says which)
export function toolsTag(p: Pick<ProviderInfo, 'no_tools'>, model: string) {
  return p.no_tools?.includes(model) ? ' (no tools)' : ''
}

// Where a local server is, for the price line: free, and on this computer or the one named
export function localNote(p: Pick<ProviderInfo, 'address' | 'this_computer'>) {
  if (p.this_computer) return 'Free: runs on your computer, so nothing you send leaves it. Token counts come from the server.'
  const host = p.address ? hostOf(p.address) : 'another computer'
  return `Free to use, but your messages go to ${host}, not just this computer. Token counts come from the server.`
}

// The menu's "where it goes" line for a local server (destination() covers the services)
export function localDestination(p: Pick<ProviderInfo, 'address' | 'this_computer'>) {
  return p.this_computer ? 'Stays on this computer' : `Sent to ${p.address ? hostOf(p.address) : 'the server you entered'}`
}

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// What switching does, and (mid-conversation) what it costs
export function switchNote(messages: number) {
  if (!messages) return 'Same loop and tools; only the address, key and model change.'
  return `Same loop and tools. Your ${messages} ${messages === 1 ? 'message' : 'messages'} so far ${messages === 1 ? 'is' : 'are'} `
    + 'sent to the new model, whose first call pays full price.'
}

// F386: where everything the model reads goes, for the providers that send it somewhere you can name.
// (Ollama, LM Studio and another server: wherever you set that server up, so nothing is claimed)
export function destination(name: string): string | null {
  switch (name) {
    case 'mock': return 'Sent to Anthropic, under your Claude Code login'
    case 'deepseek': return "Sent to DeepSeek's servers"
    case 'anthropic': return "Sent to Anthropic's API"
    default: return null
  }
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
