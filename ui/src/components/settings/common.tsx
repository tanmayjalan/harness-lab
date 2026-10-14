// What every Settings section shares: saving with a toast, what changed, a heading, the dot.
import { type ReactNode } from 'react'
import { api } from '../../api/client'
import type { Settings, SettingsChange } from '../../api/types'
import { undoToast } from '../../lib/undoToast'
import { errorMessage } from '../../store/selectors'
import { useServer } from '../../store/server'
import { toast, useUi, type SettingsSection } from '../../store/ui'
import { appliesNote } from '../../model/applies'

// `what`: the toast's own words, a sentence ("Caching is on", "Limits saved")
// `undo`: the toast carries an Undo button that runs it
export async function save(change: SettingsChange, what: string, undo?: () => void | Promise<void>) {
  try {
    const saved = await api.saveSettings(change)
    useServer.getState().setSettings(saved)
    if (undo) undoToast(what, undo, appliesNote(change, saved.apply))
    else toast({ kind: 'ok', title: what, body: appliesNote(change, saved.apply) })
    return true
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't save that change", body: errorMessage(err) })
    return false
  }
}

export function changedIn(s: Settings | null) {
  if (!s) return {} as Record<string, number>
  return {
    prompt: (s.system.trim() !== s.system_default.trim() ? 1 : 0) + (s.skills?.setting.enabled ? 1 : 0),
    tools: s.tools.filter((t) => t.permission !== t.default_permission || t.description.trim() !== t.default_description.trim()).length
      + (s.tools_at_once?.enabled ? 1 : 0) + (s.run_code?.enabled ? 1 : 0)
      + (s.extra_tools?.enabled ? 1 : 0),
    context: (s.trim.enabled ? 1 : 0) + (s.compact.enabled ? 1 : 0),
    model: (s.thinking?.enabled ? 1 : 0) + (s.cache?.enabled ? 1 : 0) + (s.apply === 'conversation' ? 1 : 0)
      + (s.limits.max_tokens !== 16000 || s.limits.max_turns !== 20 ? 1 : 0) + (s.faults?.busy ? 1 : 0)
      + (s.workflow?.enabled ? 1 : 0),
  } as Record<string, number>
}

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 space-y-1">
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="text-sm text-muted">{children}</p>}
    </div>
  )
}

export function Changed({ title = 'Changed from the default' }: { title?: string }) {
  return <span role="img" className="inline-block size-2 shrink-0 rounded-full bg-warn" title={title} aria-label={`changed: ${title}`} />
}

// Unsaved text for one setting, kept in the page's store so it survives closing the drawer,
// switching section or filtering the list. Setting it back to the saved text clears it.
export function useDraft(key: string, saved: string): [string, (t: string) => void, () => void] {
  const draft = useUi((s) => s.settingsDrafts[key])
  const set = (t: string) => useUi.getState().setSettingsDraft(key, t === saved ? null : t)
  const clear = () => useUi.getState().setSettingsDraft(key, null)
  return [draft ?? saved, set, clear]
}

// With "From your next conversation", a conversation keeps the prompt, the tool descriptions and the
// facts about you it began with (they're all in the start of each request): say so where you edit them
const KEPT: Record<'prompt' | 'tools' | 'memory', string> = {
  prompt: 'Edits apply from your next conversation: the current one keeps the prompt, the tool descriptions and the facts about you it began with.',
  tools: 'Description edits apply from your next conversation: the current one keeps the descriptions it began with. Allow / Ask first / Block apply from your next message.',
  memory: 'Fact changes apply from your next conversation: the current one keeps the facts it began with, as part of its system prompt.',
}

export function AppliesFromNextConversation({ settings, part }: { settings: Settings; part: keyof typeof KEPT }) {
  if (settings.apply !== 'conversation') return null
  return (
    <p className="mb-3 rounded-md border border-line bg-sunken px-3 py-1.5 text-xs text-muted">
      {KEPT[part]} (Settings → Model → When prompt and tool changes apply.)
    </p>
  )
}

// Saved settings as a change that would restore them (for Undo after "Reset all")
export function settingsAsChange(s: Settings): SettingsChange {
  return {
    system: s.system.trim() === s.system_default.trim() ? '' : s.system,
    descriptions: Object.fromEntries(s.tools.map((t) => [t.name, t.description.trim() === t.default_description.trim() ? '' : t.description])),
    permissions: Object.fromEntries(s.tools.map((t) => [t.name, t.permission])),
    trim: s.trim, compact: s.compact, thinking: s.thinking, cache: s.cache, apply: s.apply, limits: s.limits,
    ...(s.skills ? { skills: s.skills.setting } : {}),
    ...(s.faults ? { faults: s.faults } : {}),
    ...(s.tools_at_once ? { tools_at_once: s.tools_at_once } : {}),
    ...(s.workflow ? { workflow: s.workflow } : {}),
    ...(s.run_code ? { run_code: s.run_code } : {}),
    ...(s.extra_tools ? { extra_tools: s.extra_tools } : {}),
  }
}

// Which section an item of the server's "what you changed" list belongs to
export function sectionOf(item: string): SettingsSection {
  if (item === 'the system prompt' || /^skills/.test(item)) return 'prompt'
  if (/tool description|permission|^tools at once|^run code|^extra tools/.test(item)) return 'tools'
  if (/^(trimming|summarising)/.test(item)) return 'context'
  return 'model'
}
