// Settings → Tools & permissions: each tool's rule and description.
import { RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Rule, Settings, SettingsTool } from '../../api/types'
import { cn } from '../../lib/cn'
import { count, shortPath } from '../../lib/format'
import { isMcpTool, isRiskyTool, RULES } from '../../model/permission'
import { useServer } from '../../store/server'
import { ExplainIcon } from '../../learn/Explain'
import { JsonTree } from '../inspector/JsonTree'
import { Button, Callout, Disclosure, Field, IconButton, RadioRow, SectionLabel, TextArea } from '../ui'
import { AppliesFromNextConversation, Changed, Heading, save, useDraft } from './common'

const FOLDED = { n: 0, open: false }

// ---- Tools & permissions ----

// F391: what the Run code switch means depends on run_python's own rule
export function runCodeRule(settings: Pick<Settings, 'tools'>) {
  const rule = settings.tools.find((t) => t.name === 'run_python')?.permission
  return rule === 'allow' ? "run_python is set to Allow: code the model writes runs without asking you, and you don't see it first."
    : rule === 'block' ? 'run_python is set to Block, so nothing runs even with this on.'
      : 'It asks you first, so you can read the code.'
}

// F391: Allow on a risky tool, in words: what happens without you seeing it
export function riskyAllowNote(name: string) {
  return name === 'run_python' ? 'Code the model writes runs as you, without you seeing it first.'
    : name === 'remember_fact' ? 'Facts are saved and shared in every conversation without asking you.'
      : isMcpTool(name) ? 'Another program decides what this tool does, and it runs without asking you.'
        : ''
}

export function ToolsSection({ settings }: { settings: Settings }) {
  const [filter, setFilter] = useState('')
  const workspace = useServer((s) => s.info?.folder)
  const groups = useMemo(() => {
    const out = new Map<string, SettingsTool[]>()
    for (const t of settings.tools) {
      if (filter && !`${t.name} ${t.description}`.toLowerCase().includes(filter.toLowerCase())) continue
      out.set(t.source, [...(out.get(t.source) ?? []), t])
    }
    return [...out.entries()].sort(([a], [b]) => (a === 'built in' ? -1 : b === 'built in' ? 1 : a.localeCompare(b)))
  }, [settings.tools, filter])

  return (
    <div>
      <Heading title="Tools & permissions">
        What the model is told about each tool, and whether the harness runs it, asks you first, or refuses.
        Outside the workspace, a file tool set to Allow asks first.
      </Heading>
      <AppliesFromNextConversation settings={settings} part="tools" />
      {settings.tools_at_once && (
        <label className="mb-3 flex items-start gap-2 rounded-md border border-line px-3 py-2 text-sm">
          <input type="checkbox" className="mt-1" checked={settings.tools_at_once.enabled}
            onChange={(e) => void save({ tools_at_once: { enabled: e.target.checked } }, e.target.checked ? 'Tools run at once' : 'Tools run one by one')} />
          <span>
            Run several tools at once {settings.tools_at_once.enabled && <Changed />}
            <span className="block text-xs text-muted">
              When one reply asks for several tools that are all set to Allow, they run at the same time. Anything that
              asks you, writes, starts a helper or comes from an MCP program still runs one by one.
            </span>
          </span>
        </label>
      )}
      {settings.run_code && (
        <label className="mb-3 flex items-start gap-2 rounded-md border border-line px-3 py-2 text-sm">
          <input type="checkbox" className="mt-1" checked={settings.run_code.enabled}
            onChange={(e) => void save({ run_code: { enabled: e.target.checked } }, e.target.checked ? 'Run code is on' : 'Run code is off')} />
          <span>
            Run code (<code>run_python</code>) {settings.run_code.enabled && <Changed />} <ExplainIcon concept="run_code" />
            <span className="block text-xs text-muted">
              Offers the model a tool to run Python scripts it writes, from the workspace folder, for at most 10 seconds.
              This is not a sandbox: a script runs as you and can change any of your files or reach the internet.
              {' '}{runCodeRule(settings)}
            </span>
          </span>
        </label>
      )}
      {settings.extra_tools && <ExtraToolsSwitch setting={settings.extra_tools} />}
      {settings.hooks.functions.length > 0 && (
        <Callout tone="info" className="mb-3">
          <b>Hooks are on</b> ({settings.hooks.functions.map((f, i) => <span key={f}>{i > 0 && ', '}<code>{f}</code></span>)}) from{' '}
          <code title={settings.hooks.file}>{shortPath(settings.hooks.file, workspace)}</code>: they can block a call
          before any rule here applies.
        </Callout>
      )}
      {settings.hooks.problem && (
        <Callout tone="bad" className="mb-3">
          Your hooks file, <code title={settings.hooks.file}>{shortPath(settings.hooks.file, workspace)}</code>, has a mistake, so no
          hook is running: {settings.hooks.problem}
        </Callout>
      )}
      {settings.mcp_problems.map((p) => (
        <Callout key={p} tone="warn" className="mb-3">MCP server skipped: {p}</Callout>
      ))}
      <Field value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tools" aria-label="Filter tools"
        className="mb-3 w-full" />
      <div className="space-y-5">
        {groups.map(([source, tools]) => (
          <section key={source}>
            <SectionLabel as="h4" className="mb-1">
              {source === 'built in' ? 'Built in' : `From ${source}`} · {tools.length}
            </SectionLabel>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {tools.map((t) => <ToolPermissionRow key={t.name} tool={t}
                note={t.name === 'run_python' && !settings.run_code?.enabled ? 'offered only when Run code is on' : undefined} />)}
            </ul>
          </section>
        ))}
        {!groups.length && <p className="text-sm text-muted">No tool matches.</p>}
      </div>
    </div>
  )
}

// The 40 office tools (features/tool_search.py): one switch with three positions. They aren't listed below.
type ExtraMode = 'off' | 'all' | 'find'
const EXTRA_MODES: [ExtraMode, string][] = [['off', 'off'], ['all', 'all sent every call'], ['find', 'found on demand (find_tool)']]

function ExtraToolsSwitch({ setting }: { setting: NonNullable<Settings['extra_tools']> }) {
  const value: ExtraMode = setting.enabled ? setting.mode : 'off'
  const choose = (m: ExtraMode) => void save(
    { extra_tools: m === 'off' ? { enabled: false, mode: setting.mode } : { enabled: true, mode: m } },
    m === 'off' ? 'The extra office tools are off' : m === 'all' ? 'All 40 office tools are sent on every call'
      : 'Office tools are found on demand with find_tool')
  return (
    <div className="mb-3 space-y-1.5 rounded-md border border-line px-3 py-2 text-sm">
      <div>
        40 extra office tools {setting.enabled && <Changed />} <ExplainIcon concept="tool_search" />
      </div>
      <RadioRow<ExtraMode> label="40 extra office tools" value={value} options={EXTRA_MODES} onChange={choose} />
      <p className="text-xs text-muted">
        Pretend tools for Northwind Labs, the handbook's company: <code>book_room</code>, <code>request_leave</code>,
        {' '}<code>check_parking</code> and 37 more. Sent on every call, each description costs tokens every time and
        the model has more to choose from. Found on demand, every call sends only <code>find_tool</code>; the model
        describes what it wants to do, and the few tools that match are sent from its next step on.
        They aren't listed below. Helpers and the workflow never get them: those use read-only tools only.
      </p>
    </div>
  )
}

// `note`: a word on when the model is offered this tool at all (run_python: only with Run code on)
function ToolPermissionRow({ tool, note }: { tool: SettingsTool; note?: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText, clear] = useDraft(`desc:${tool.name}`, tool.description)
  const blank = !text.trim()
  const tooLong = text.length > 4000
  const helpId = `rule-help-${tool.name}`
  const countId = `desc-count-${tool.name}`
  const blankId = `desc-blank-${tool.name}`
  const permChanged = tool.permission !== tool.default_permission
  const risky = isRiskyTool(tool.name) // Allow on it is a warning, not the safe green
  const descChanged = tool.description.trim() !== tool.default_description.trim()
  const setRule = (rule: Rule) => rule !== tool.permission && save({ permissions: { [tool.name]: rule } }, `${tool.name} is set to ${RULES[rule].label}`)

  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <code className="shrink-0 max-w-[40%] truncate font-semibold" title={tool.name}>{tool.name}</code>
          {(permChanged || descChanged) && (
            <Changed title={[permChanged && `rule changed (default: ${RULES[tool.default_permission].label})`,
              descChanged && 'description edited'].filter(Boolean).join(', ')} />
          )}
          {note && <span className="shrink-0 text-xs text-warn">{note}</span>}
          <span className="min-w-0 truncate text-xs text-muted">{tool.description}</span>
        </button>
        {permChanged && (
          <IconButton size="sm" label={`Back to the default rule for ${tool.name}`} tip={`Back to the default rule (${RULES[tool.default_permission].label})`}
            onClick={() => setRule(tool.default_permission)} className="text-muted hover:text-fg">
            <RotateCcw className="size-3.5" />
          </IconButton>
        )}
        <RadioRow label={`Permission for ${tool.name}`} value={tool.permission} onChange={(r) => setRule(r)} describedBy={helpId}
          className="text-xs" options={(['allow', 'ask', 'block'] as Rule[]).map((r) => [r, RULES[r].label, RULES[r].help])}
          itemClass={(r, on) => cn('px-2 py-0.5', on
            ? r === 'allow' ? (risky ? 'bg-warn-soft font-semibold text-warn ring-1 ring-inset ring-warn' : 'bg-ok-soft font-medium text-ok') : r === 'ask' ? 'bg-warn-soft font-medium text-warn' : 'bg-bad-soft font-medium text-bad'
            : 'text-muted hover:text-fg')} />
      </div>
      <p id={helpId} className={cn('mt-0.5 text-right text-xs', risky && tool.permission === 'allow' ? 'font-medium text-warn' : 'text-muted')}>
        {RULES[tool.permission].help}{risky && tool.permission === 'allow' && ` ${riskyAllowNote(tool.name)}`}
      </p>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="text-xs text-muted">
            Default rule: {RULES[tool.default_permission].label}
            {permChanged && <button type="button" className="ml-2 text-accent hover:underline" onClick={() => setRule(tool.default_permission)}>Back to the default</button>}
          </div>
          <Disclosure className="text-xs" summaryClassName="font-medium text-muted" summary="Input shape the model must follow (schema)">
            <div className="mt-1 rounded-md border border-line p-2">
              <JsonTree value={tool.input_schema} command={FOLDED} openDepth={2} label={`Input shape for ${tool.name}`} />
            </div>
          </Disclosure>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted">Description the model reads</span>
            {/* F342: named for its tool (several can be open), and the count and the warning are its description */}
            <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label={`Description the model reads for ${tool.name}`}
              aria-invalid={blank || tooLong || undefined} aria-describedby={blank ? `${countId} ${blankId}` : countId} />
            <span id={countId} className={cn('block text-right text-xs', tooLong ? 'text-bad' : 'text-muted')}>
              {count(text.length)} of 4,000 characters{tooLong && ': too long'}
            </span>
          </label>
          {blank && <p id={blankId} className="text-xs text-warn">A tool always has a description. Use "Back to the default" to go back to the original.</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={text === tool.description || blank || tooLong}
              onClick={async () => { if (await save({ descriptions: { [tool.name]: text } }, `${tool.name}'s description saved`)) clear() }}>Save</Button>
            <Button size="sm" variant="ghost" disabled={!descChanged}
              onClick={async () => {
                const was = tool.description
                if (await save({ descriptions: { [tool.name]: '' } }, `${tool.name}'s description is back to the default`,
                  () => void save({ descriptions: { [tool.name]: was } }, `${tool.name}'s description restored`))) clear()
              }}>
              <RotateCcw className="size-3.5" /> Back to the default
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
