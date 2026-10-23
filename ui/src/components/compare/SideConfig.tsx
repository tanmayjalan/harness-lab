// One side's setup: its name, model, and the changes for that side only
import { ChevronDown, X } from 'lucide-react'
import { useState } from 'react'
import type { Effort, Rule } from '../../api/types'
import { cn } from '../../lib/cn'
import { undoToast } from '../../lib/undoToast'
import { RULES } from '../../model/permission'
import { useCompare, type SideSpec } from '../../store/compare'
import { useServer } from '../../store/server'
import { modelsOf, providerName, toolsTag, unusable } from '../composer/providerWords'
import { Field, IconButton, Select, TextArea } from '../ui'
import { LETTERS, SideLetter } from './SideLetter'

// What a side changes, in words, for its folded card
function changesInWords(side: SideSpec): string[] {
  const out: string[] = []
  if (side.system.trim()) out.push('own system prompt')
  for (const [name, rule] of Object.entries(side.permissions)) out.push(`${name}: ${RULES[rule].label}`)
  if (side.thinking !== undefined) {
    out.push(side.thinking === 'off' ? 'thinking off' : 'effort' in side.thinking ? `thinking effort ${side.thinking.effort}` : `thinking ${side.thinking.budget / 1000}k`)
  }
  if (side.cache !== undefined) out.push(side.cache ? 'caching on' : 'caching off')
  return [...out, ...presetOnlyWords(side)]
}

// What only a preset can set: the side's panel has no control for these (F349g)
function presetOnlyWords(side: SideSpec): string[] {
  const out: string[] = []
  if (side.toolsAtOnce !== undefined) out.push(side.toolsAtOnce ? 'tools at once' : 'tools one by one')
  if (side.busy !== undefined) out.push(side.busy ? 'practice: busy service' : 'practice switch off')
  if (side.workflow !== undefined) out.push(side.workflow ? 'workflow' : 'one agent')
  if (side.runCode !== undefined) out.push(side.runCode ? 'run code on' : 'run code off')
  if (side.extraTools !== undefined) {
    out.push(side.extraTools === 'off' ? 'no extra tools' : side.extraTools === 'all' ? '40 tools, all sent' : '40 tools, found on demand')
  }
  if (side.skills !== undefined) out.push(!side.skills.enabled ? 'skills off' : side.skills.mode === 'all_in_prompt' ? 'skills all in the prompt' : 'skills on demand')
  return out
}

export function SideConfig({ index, side, onRemove }: { index: number; side: SideSpec; onRemove: () => void }) {
  const info = useServer((s) => s.info)
  const settings = useServer((s) => s.settings)
  const c = useCompare()
  const changes = changesInWords(side)
  // what the preset set that this panel has no control for (F349g)
  const fromPreset = presetOnlyWords(side)
  // On an empty setup, open side B: it is the one you would change
  const [open, setOpen] = useState(() => index === 1 && !c.preset && changes.length === 0)
  const style = info?.providers.find((p) => p.name === side.provider)?.thinking ?? 'budget'
  const savedThinking = !settings?.thinking.enabled ? 'off'
    : style === 'adaptive' ? `effort ${settings.thinking.effort ?? 'medium'}` : `${settings.thinking.budget / 1000}k tokens`
  const thinkingValue = side.thinking === undefined ? 'saved' : side.thinking === 'off' ? 'off'
    : 'effort' in side.thinking ? `e:${side.thinking.effort}` : `b:${side.thinking.budget}`
  const savedRule = (name: string) => settings?.tools.find((t) => t.name === name)?.permission ?? 'allow'

  return (
    <section data-side={side.id} className="space-y-3 rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <SideLetter letter={LETTERS[index]} />
        <Field data-side-name value={side.label} onChange={(e) => c.setSide(index, { label: e.target.value })} placeholder={`Side ${LETTERS[index]} (name it, optional)`}
          aria-label={`Name of side ${LETTERS[index]}`} className="min-w-0 flex-1 font-medium" />
        {c.sides.length > 2 && (
          <IconButton size="sm" label={`Remove side ${LETTERS[index]}`} onClick={() => {
            const gone = side
            c.removeSide(index)
            onRemove()
            undoToast(`Removed side ${LETTERS[index]}`, () => useCompare.getState().insertSide(index, gone))
          }}
            className="text-muted hover:text-fg"><X className="size-4" /></IconButton>
        )}
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Provider and model</span>
        <Select value={`${side.provider}/${side.model || info?.providers.find((p) => p.name === side.provider)?.model}`}
          onChange={(e) => {
            const [provider, ...rest] = e.target.value.split('/')
            c.setSide(index, { provider, model: rest.join('/') })
          }}
          className="w-full">
          {info?.providers.flatMap((p) => modelsOf(p).map((m) => (
            <option key={`${p.name}/${m}`} value={`${p.name}/${m}`} disabled={!!unusable(p)}>
              {providerName(info.providers, p.name)} · {m}{toolsTag(p, m)}{p.missing_key ? ` (needs ${p.missing_key})` : p.problem ? ' (not ready)' : ''}
            </option>
          )))}
        </Select>
      </label>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-start gap-1.5 text-left text-sm text-accent hover:underline">
        <ChevronDown className={cn('mt-0.5 size-4 shrink-0 transition-transform', !open && '-rotate-90')} />
        <span>
          Changes for this side only{' '}
          {changes.length > 0 ? <span className="text-warn">({changes.join(' · ')})</span> : <span className="text-muted">(none: your saved settings)</span>}
        </span>
      </button>
      {open && (
        <div className="space-y-3">
          {fromPreset.length > 0 && (
            <p className="text-2xs text-muted">Set by the preset: {fromPreset.join(', ')}. Pick another preset to clear it.</p>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-muted">System prompt (leave empty to use your saved one)</span>
            <TextArea value={side.system} onChange={(e) => c.setSide(index, { system: e.target.value })} rows={4}
              placeholder={settings?.system.slice(0, 200)} className="font-mono text-xs" />
          </label>
          <div className="space-y-1 text-sm">
            <span className="text-muted">Permissions</span>
            <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {settings?.tools.map((t) => {
                const rule = side.permissions[t.name] ?? savedRule(t.name)
                return (
                  <li key={t.name} className="flex items-center gap-2 px-2 py-1">
                    <code className="min-w-0 flex-1 truncate text-xs" title={t.name}>{t.name}</code>
                    <Select size="sm" value={rule} aria-label={`Permission for ${t.name} on side ${LETTERS[index]}${side.permissions[t.name] ? ' (changed)' : ''}`}
                      onChange={(e) => {
                        const next = { ...side.permissions }
                        if (e.target.value === savedRule(t.name)) delete next[t.name]
                        else next[t.name] = e.target.value as Rule
                        c.setSide(index, { permissions: next })
                      }}
                      className={cn('px-1 text-xs', side.permissions[t.name] && 'border-warn text-warn')}>
                      {(['allow', 'ask', 'block'] as Rule[]).map((r) => <option key={r} value={r}>{RULES[r].label}</option>)}
                    </Select>
                    {side.permissions[t.name] && <span className="text-xs text-warn">changed</span>}
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-muted">
              Nobody can be asked during a comparison, so a tool set to "Ask first" isn't run, unless you tick "Let Ask-first
              tools run" (shown below the sides when a tool is set to Ask first).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span className="text-muted">Thinking</span>
              <Select value={thinkingValue}
                onChange={(e) => {
                  const v = e.target.value
                  c.setSide(index, { thinking: v === 'saved' ? undefined : v === 'off' ? 'off'
                    : v.startsWith('e:') ? { effort: v.slice(2) as Effort } : { budget: Number(v.slice(2)) } })
                }}
                className={cn('w-full', side.thinking !== undefined && 'border-warn text-warn')}>
                <option value="saved">As saved ({savedThinking})</option>
                <option value="off">{style === 'adaptive' ? 'Default' : 'Off'}</option>
                {style === 'adaptive'
                  ? (['low', 'medium', 'high', 'xhigh', 'max'] as Effort[]).map((x) => <option key={x} value={`e:${x}`}>Effort {x}</option>)
                  : [2000, 4000, 8000, 12000].map((b) => <option key={b} value={`b:${b}`}>On, {b / 1000}k tokens</option>)}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-muted">Prompt caching</span>
              <Select value={side.cache === undefined ? 'saved' : side.cache ? 'on' : 'off'}
                onChange={(e) => c.setSide(index, { cache: e.target.value === 'saved' ? undefined : e.target.value === 'on' })}
                className={cn('w-full', side.cache !== undefined && 'border-warn text-warn')}>
                <option value="saved">As saved ({settings?.cache.enabled ? 'on' : 'off'})</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </Select>
            </label>
          </div>
        </div>
      )}
    </section>
  )
}
