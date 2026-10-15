// An experiment can set things up for you (turn thinking on, shorten the reply limit, switch
// model...). It remembers what was there before, so Undo (in the toast, and above the message box)
// puts it back. Two experiments in a row: undoing restores what was there first.
import { api } from '../api/client'
import type { Settings, SettingsChange } from '../api/types'
import { errorMessage, switchProvider } from '../store/selectors'
import { useServer } from '../store/server'
import { useSession } from '../store/session'
import { toast, usePrefs, type ExperimentBefore } from '../store/ui'
import type { Experiment } from './experiments'

// The current values of exactly the settings a change touches
export function previousOf(change: SettingsChange, s: Settings): SettingsChange {
  const before: SettingsChange = {}
  if (change.thinking) before.thinking = s.thinking
  if (change.cache) before.cache = s.cache
  if (change.limits) before.limits = s.limits
  if (change.trim) before.trim = s.trim
  if (change.compact) before.compact = s.compact
  if (change.apply) before.apply = s.apply
  if (change.skills) before.skills = s.skills?.setting ?? { enabled: false, mode: 'on_demand' }
  if (change.faults) before.faults = s.faults ?? { busy: false }
  if (change.tools_at_once) before.tools_at_once = s.tools_at_once ?? { enabled: false }
  if (change.workflow) before.workflow = s.workflow ?? { enabled: false }
  if (change.run_code) before.run_code = s.run_code ?? { enabled: false }
  if (change.extra_tools) before.extra_tools = s.extra_tools ?? { enabled: false, mode: 'find' }
  if (change.system !== undefined) before.system = s.system
  if (change.descriptions) {
    before.descriptions = Object.fromEntries(Object.keys(change.descriptions).map((name) =>
      [name, s.tools.find((t) => t.name === name)?.description ?? '']))
  }
  if (change.permissions) {
    before.permissions = Object.fromEntries(Object.keys(change.permissions).map((name) =>
      [name, s.tools.find((t) => t.name === name)?.permission ?? 'allow']))
  }
  return before
}

// Only the parts of a change that differ from the current settings (null: nothing to change)
export function onlyChanges(change: SettingsChange, s: Settings): SettingsChange | null {
  const out: SettingsChange = {}
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const t = change.thinking
  if (t && !(s.thinking.enabled === t.enabled
    && (!t.enabled || (s.thinking.budget === t.budget && s.thinking.effort === (t.effort ?? s.thinking.effort))))) out.thinking = t
  if (change.cache && s.cache.enabled !== change.cache.enabled) out.cache = change.cache
  if (change.limits && !same(s.limits, change.limits)) out.limits = change.limits
  if (change.trim && !(s.trim.enabled === change.trim.enabled && s.trim.keep_last === change.trim.keep_last)) out.trim = change.trim
  if (change.compact && !(s.compact.enabled === change.compact.enabled && s.compact.over_chars === change.compact.over_chars)) {
    out.compact = change.compact
  }
  if (change.apply && s.apply !== change.apply) out.apply = change.apply
  const sk = s.skills?.setting
  if (change.skills && !(!!sk?.enabled === change.skills.enabled && (!sk?.enabled || sk.mode === change.skills.mode))) out.skills = change.skills
  if (change.faults && !!s.faults?.busy !== change.faults.busy) out.faults = change.faults
  if (change.tools_at_once && !!s.tools_at_once?.enabled !== change.tools_at_once.enabled) out.tools_at_once = change.tools_at_once
  if (change.workflow && !!s.workflow?.enabled !== change.workflow.enabled) out.workflow = change.workflow
  if (change.run_code && !!s.run_code?.enabled !== change.run_code.enabled) out.run_code = change.run_code
  if (change.extra_tools && (!!s.extra_tools?.enabled !== change.extra_tools.enabled
    || (change.extra_tools.enabled && s.extra_tools?.mode !== change.extra_tools.mode))) out.extra_tools = change.extra_tools
  if (change.system !== undefined && s.system !== change.system) out.system = change.system
  const tool = (name: string) => s.tools.find((x) => x.name === name)
  if (change.descriptions) {
    const d = Object.fromEntries(Object.entries(change.descriptions).filter(([n, v]) => tool(n) && tool(n)!.description !== v))
    if (Object.keys(d).length) out.descriptions = d
  }
  if (change.permissions) {
    const p = Object.fromEntries(Object.entries(change.permissions).filter(([n, v]) => tool(n) && tool(n)!.permission !== v))
    if (Object.keys(p).length) out.permissions = p
  }
  return Object.keys(out).length ? out : null
}

const RULE_WORDS: Record<string, string> = { allow: 'Allow', ask: 'Ask first', block: 'Block' }

// Each change in plain words, for the note that says what an experiment set up
export function describeChange(change: SettingsChange, s: Settings): string[] {
  const out: string[] = []
  if (change.limits) {
    if (change.limits.max_tokens !== s.limits.max_tokens) out.push(`longest reply set to ${change.limits.max_tokens} tokens`)
    if (change.limits.max_turns !== s.limits.max_turns) out.push(`at most ${change.limits.max_turns} calls per message`)
  }
  if (change.thinking) out.push(change.thinking.enabled ? 'thinking on' : 'thinking off')
  if (change.cache) out.push(change.cache.enabled ? 'caching on' : 'caching off')
  if (change.trim) out.push(change.trim.enabled ? `trimming on, keeping the last ${change.trim.keep_last}` : 'trimming off')
  if (change.compact) out.push(change.compact.enabled ? 'summarising on' : 'summarising off')
  if (change.apply) out.push(change.apply === 'conversation' ? 'changes apply from your next conversation' : 'changes apply from your next message')
  if (change.faults) out.push(change.faults.busy ? 'practice: a busy provider' : 'practice switch off')
  if (change.tools_at_once) out.push(change.tools_at_once.enabled ? 'tools run at once' : 'tools run one by one')
  if (change.workflow) out.push(change.workflow.enabled ? 'workflow on' : 'workflow off')
  if (change.run_code) out.push(change.run_code.enabled ? 'run code on' : 'run code off')
  if (change.extra_tools) {
    out.push(!change.extra_tools.enabled ? 'extra tools off'
      : change.extra_tools.mode === 'all' ? 'extra tools: all sent' : 'extra tools: found on demand')
  }
  if (change.skills) {
    out.push(!change.skills.enabled ? 'skills off' : `skills on (${change.skills.mode === 'all_in_prompt' ? 'all in the prompt' : 'on demand'})`)
  }
  if (change.system !== undefined) out.push('system prompt changed')
  for (const name of Object.keys(change.descriptions ?? {})) out.push(`${name}'s description changed`)
  for (const [name, rule] of Object.entries(change.permissions ?? {})) out.push(`${name} set to ${RULE_WORDS[rule] ?? rule}`)
  return out
}

// Two experiments in a row: what was there before the FIRST one is what Undo restores
export function mergeBefore(earlier: ExperimentBefore | null, later: ExperimentBefore): ExperimentBefore {
  if (!earlier) return later
  const a = earlier.settings ?? {}
  const b = later.settings ?? {}
  const settings: SettingsChange = { ...b, ...a }
  if (a.descriptions || b.descriptions) settings.descriptions = { ...b.descriptions, ...a.descriptions }
  if (a.permissions || b.permissions) settings.permissions = { ...b.permissions, ...a.permissions }
  return {
    settings: Object.keys(settings).length ? settings : undefined,
    provider: earlier.provider ?? later.provider,
    changes: [...earlier.changes, ...later.changes.filter((c) => !earlier.changes.includes(c))],
  }
}

// `undone`: what an earlier experiment had changed, just put back before this one: the note says so
export async function setUpExperiment(x: Experiment, undone?: string[]) {
  const before: ExperimentBefore = { changes: [] }
  try {
    const settings = useServer.getState().settings
    const change = x.apply && settings ? onlyChanges(x.apply, settings) : null
    if (change && settings) {
      before.settings = previousOf(change, settings)
      before.changes.push(...describeChange(change, settings))
      useServer.getState().setSettings(await api.saveSettings(change))
    }
    if (x.switchTo) {
      const from = { provider: useSession.getState().provider ?? 'mock', model: useSession.getState().model }
      // Stay on your provider when it has another model to switch to; otherwise use the experiment's own
      const mine = useServer.getState().info?.providers.find((p) => p.name === from.provider)
      const other = (mine?.models ?? []).find((m) => m !== from.model)
      const to = other ? { provider: from.provider, model: other } : x.switchTo
      if (from.provider !== to.provider || from.model !== to.model) {
        if (!(await switchProvider(to.provider, to.model))) throw new Error(`couldn't switch to ${to.model}`)
        before.provider = from
        before.changes.push(to.provider === from.provider ? `switched to ${to.model}`
          : `switched to the mock's ${to.model} (your provider has only one model)`)
      }
    }
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't set up the experiment", body: errorMessage(err) })
    return
  }
  const first = undone?.length ? `First put back what the last experiment changed (${undone.join(', ')}). ` : ''
  if (!before.changes.length) {
    if (first) toast({ kind: 'info', title: 'Settings restored', body: first.trim() })
    return
  }
  const prefs = usePrefs.getState()
  prefs.setExperimentBefore(mergeBefore(prefs.experimentBefore, before))
  toast({
    kind: 'info', title: `"${x.title}": ${before.changes.join(', ')}`, body: `${first}Undo, here or above the message box, puts it back.`,
    action: { label: 'Undo', run: () => void putBack() },
  })
}

// Undo everything experiments changed, once (kept in your saved preferences until you do).
// True when it is all back. `quiet`: no note when it worked (the next experiment's note says so)
export async function putBack(opts?: { quiet?: boolean }): Promise<boolean> {
  const before = usePrefs.getState().experimentBefore
  if (!before) return true
  try {
    if (before.settings) {
      useServer.getState().setSettings(await api.saveSettings(before.settings))
      usePrefs.getState().setExperimentBefore(before.provider ? { ...before, settings: undefined } : null)
    }
    // switchProvider reports its own error; keep the model part of the way back if it failed
    if (before.provider && !(await switchProvider(before.provider.provider, before.provider.model))) return false
    usePrefs.getState().setExperimentBefore(null)
    if (opts?.quiet) return true
    // A conversation that keeps its fixed beginning keeps the experiment's prompt and descriptions, whatever Undo does
    const kept = !!before.settings && (before.settings.system !== undefined || before.settings.descriptions !== undefined)
      && useSession.getState().frozen && useServer.getState().settings?.apply === 'conversation'
    toast({ kind: 'ok', title: 'Settings restored', body: before.changes.join(', ') + ': undone.'
      + (kept ? " This conversation keeps the experiment's prompt and tool descriptions: start a new conversation to use yours." : '') })
    return true
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't undo it", body: errorMessage(err) })
    return false
  }
}
