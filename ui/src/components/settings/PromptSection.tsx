// Settings → Prompt: the system prompt.
import { RotateCcw } from 'lucide-react'
import type { Settings, SkillMode } from '../../api/types'
import { count } from '../../lib/format'
import { CONCEPTS } from '../../learn/concepts'
import { ExplainIcon } from '../../learn/Explain'
import { Button, RadioRow, SectionLabel, TextArea } from '../ui'
import { AppliesFromNextConversation, Changed, Heading, save, useDraft } from './common'

// ---- Prompt ----

export function PromptSection({ settings }: { settings: Settings }) {
  const [text, setText, clear] = useDraft('system', settings.system)
  const dirty = text !== settings.system
  const blank = !text.trim()
  const edited = settings.system.trim() !== settings.system_default.trim()
  return (
    <div className="flex h-full flex-col">
      <Heading title="System prompt">{CONCEPTS.system_prompt.setting} Facts from Memory are added after it.</Heading>
      <AppliesFromNextConversation settings={settings} part="prompt" />
      <div className="mb-2 flex items-center gap-2 text-sm">
        {edited ? <><Changed /> Edited</> : <span className="text-muted">The default</span>}
        <span id="prompt-count" className="text-muted">· {count(text.length)} characters</span>
      </div>
      {/* F444: where the default lives in the code */}
      <p className="mb-2 text-xs text-muted">In the code: the default is <code>SYSTEM</code> in harness/core/loop.py.</p>
      {/* F342: the count and the warning are the box's description; a blank prompt marks it invalid */}
      <TextArea value={text} onChange={(e) => setText(e.target.value)} aria-label="System prompt" spellCheck={false}
        aria-invalid={blank || undefined} aria-describedby={blank ? 'prompt-count prompt-blank' : 'prompt-count'}
        className="min-h-64 flex-1 p-3 font-mono" />
      {blank && (
        <p id="prompt-blank" className="mt-2 text-xs text-warn">
          An empty prompt isn't possible: the harness always sends one. Use "Back to the default" to go back to the original.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={!dirty || blank}
          onClick={async () => { if (await save({ system: text }, 'Prompt saved')) clear() }}>Save</Button>
        <Button disabled={!dirty} onClick={clear}>Undo changes</Button>
        <Button variant="ghost" className="ml-auto" disabled={!edited}
          onClick={async () => {
            const was = settings.system
            if (await save({ system: '' }, 'Prompt is back to the default', () => void save({ system: was }, 'Prompt restored'))) clear()
          }}><RotateCcw className="size-3.5" /> Back to the default</Button>
      </div>
      <SkillsBox settings={settings} />
    </div>
  )
}

// ---- Skills: instructions loaded only when needed (config/skills/) ----

function SkillsBox({ settings }: { settings: Settings }) {
  const sk = settings.skills
  if (!sk) return null
  const on = sk.setting.enabled
  return (
    <fieldset className="mt-6 space-y-2 rounded-lg border border-line p-4">
      <legend className="flex items-center gap-1.5 px-1 font-medium">
        Skills {on && <Changed />} <ExplainIcon concept="skills" />
      </legend>
      <p className="text-sm text-muted">{CONCEPTS.skills.setting}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => void save({ skills: { ...sk.setting, enabled: e.target.checked } }, `Skills are ${e.target.checked ? 'on' : 'off'}`)} />
        Use skills
      </label>
      {on && (
        <RadioRow<SkillMode> label="How skills are sent" value={sk.setting.mode}
          onChange={(mode) => void save({ skills: { enabled: true, mode } }, mode === 'on_demand' ? 'Skills are sent on demand' : 'Skills are all in the prompt')}
          options={[['on_demand', 'On demand', 'One line per skill in the prompt; the model loads the full text with load_skill'],
            ['all_in_prompt', 'All in the prompt', 'Every skill in full, in every call: to compare']]} />
      )}
      <div className="text-sm">
        {sk.found.length ? (
          <ul className="space-y-0.5">
            {sk.found.map((f) => <li key={f.name}><code>{f.name}</code> <span className="text-muted">· {f.description}</span></li>)}
          </ul>
        ) : <p className="text-muted">No skill files yet in <code>{sk.folder}</code>.</p>}
        <p className="mt-1 text-xs text-muted">One Markdown file per skill in <code>{sk.folder}</code>, read again for every message.</p>
      </div>
      {sk.addition && (
        <div className="space-y-1">
          <SectionLabel>
            Exactly what's added to the system prompt{on ? '' : ' (when on)'}
          </SectionLabel>
          <pre className="code-block added">{sk.addition}</pre>
        </div>
      )}
    </fieldset>
  )
}
