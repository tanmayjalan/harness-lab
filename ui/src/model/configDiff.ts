// What differs between two setups, in plain words, for the top of a comparison.
import type { RunConfig } from '../api/types'
import { count } from '../lib/format'

export type ConfigDiff = { what: string; a: string; b: string }

const onOff = (x: { enabled: boolean } | null | undefined, detail: string) => (x?.enabled ? `on (${detail})` : 'off')
const list = (xs: string[] | undefined) => (xs && xs.length ? xs.join(', ') : 'none')
const perms = (p: Record<string, string> | undefined) =>
  p && Object.keys(p).length ? Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(', ') : 'defaults'

export function configDiff(a: RunConfig | null | undefined, b: RunConfig | null | undefined): ConfigDiff[] {
  if (!a || !b) return []
  const rows: ConfigDiff[] = []
  const add = (what: string, x: string, y: string) => x !== y && rows.push({ what, a: x, b: y })
  add('Provider', a.label ?? a.provider ?? '?', b.label ?? b.provider ?? '?')
  add('Model', a.model ?? '?', b.model ?? '?')
  const prompt = (c: RunConfig) => (c.system_edited ? 'edited' : 'default')
  // The facts about you are added to the system prompt, so its text differs when they do: one change, one row
  const factsDiffer = (a.facts_shared ?? 0) !== (b.facts_shared ?? 0)
  if (a.system != null && b.system != null && a.system !== b.system && prompt(a) === prompt(b)) {
    if (!factsDiffer) rows.push({ what: 'System prompt', a: `${prompt(a)} (this text)`, b: `${prompt(b)} (different text)` })
  } else {
    add('System prompt', prompt(a), prompt(b))
  }
  add('Re-described tools', list(a.descriptions), list(b.descriptions))
  add('Permissions', perms(a.permissions), perms(b.permissions))
  add('Trimming', onOff(a.trim, `keep ${a.trim?.keep_last}`), onOff(b.trim, `keep ${b.trim?.keep_last}`))
  add('Summarising', onOff(a.compact, `over ${a.compact?.over_chars}`), onOff(b.compact, `over ${b.compact?.over_chars}`))
  const facts = (c: RunConfig) => `${c.facts_shared ?? 0}${factsDiffer && c.facts_shared ? ' (added to the system prompt)' : ''}`
  add('Facts about you', facts(a), facts(b))
  const think = thinkingWords
  add('Thinking', think(a), think(b))
  add('Prompt caching', a.cache?.enabled ? 'on' : 'off', b.cache?.enabled ? 'on' : 'off')
  const skills = (c: RunConfig) => (!c.skills?.enabled ? 'off' : c.skills.mode === 'all_in_prompt' ? 'all in the prompt' : 'on demand')
  add('Skills', skills(a), skills(b))
  add('Practice: busy service', a.faults?.busy ? 'on' : 'off', b.faults?.busy ? 'on' : 'off')
  add('Tools at once', a.tools_at_once?.enabled ? 'on' : 'off', b.tools_at_once?.enabled ? 'on' : 'off')
  add('Workflow (chain of agents)', a.workflow?.enabled ? 'on' : 'off', b.workflow?.enabled ? 'on' : 'off')
  add('Run code (run_python)', a.run_code?.enabled ? 'on' : 'off', b.run_code?.enabled ? 'on' : 'off')
  const extra = (c: RunConfig) => (!c.extra_tools?.enabled ? 'off' : c.extra_tools.mode === 'all' ? 'all sent' : 'found on demand')
  add('40 extra office tools', extra(a), extra(b))
  const when = (c: RunConfig) => (c.apply === 'conversation' ? 'fixed per conversation' : 'next message')
  add('Prompt and tool edits apply', when(a), when(b))
  const lim = (c: RunConfig) => `${count(c.limits?.max_tokens ?? 16000)} tokens, ${c.limits?.max_turns ?? 20} calls`
  add('Limits (reply, calls)', lim(a), lim(b))
  return rows
}

// Thinking as it was sent: Anthropic thinks by effort, the others by a token budget
export function thinkingWords(c: RunConfig): string {
  if (!c.thinking?.enabled) return 'off'
  const effort = (c.thinking as { effort?: string }).effort
  return c.provider === 'anthropic' ? `on (effort ${effort ?? 'medium'})` : `on (${count(c.thinking.budget)} tokens)`
}
