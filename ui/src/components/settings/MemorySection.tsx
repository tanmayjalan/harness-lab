// Settings → Memory: facts about you.
import { Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Fact } from '../../api/types'
import { plural } from '../../lib/format'
import { undoToast } from '../../lib/undoToast'
import { CONCEPTS } from '../../learn/concepts'
import { errorMessage } from '../../store/selectors'
import { useServer } from '../../store/server'
import { toast } from '../../store/ui'
import { Button, Field, IconButton, SectionLabel, Skeleton } from '../ui'
import { AppliesFromNextConversation, Heading } from './common'

// ---- Memory ----

// The section is gone (drawer closed, other section open) but its Undo toast is not: save straight from the stored profile
async function restoreAfterClose(i: number, f: Fact) {
  const list = [...(useServer.getState().profile?.facts ?? [])]
  list.splice(Math.min(i, list.length), 0, f)
  useServer.getState().setProfile(await api.saveProfile(list.filter((x) => x.label.trim() || x.value.trim())))
}

export function MemorySection() {
  const profile = useServer((s) => s.profile)
  const settings = useServer((s) => s.settings)
  // What the model's own remember_fact does, by its rule in Settings → Tools
  const rule = settings?.tools.find((t) => t.name === 'remember_fact')?.permission ?? 'ask'
  const remembering = rule === 'allow' ? "it saves them without asking you: it's set to Allow in Settings → Tools"
    : rule === 'block' ? "it can't: it's set to Block in Settings → Tools" : 'it asks you first'
  const [facts, setFacts] = useState<Fact[] | null>(null)
  const [state, setState] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved')
  // The edit that has not been saved yet: closing the section (or the drawer) saves it at once
  const pending = useRef<Fact[] | null>(null)
  const mounted = useRef(true)
  const latest = useRef<Fact[]>([]) // the list as it is now, for an Undo pressed later
  const ownSave = useRef<unknown>(null) // the profile this section's own save came back with
  useEffect(() => {
    if (!profile) return
    if (facts === null) { latest.current = profile.facts; setFacts(profile.facts); return }
    // The stored profile changed elsewhere (an Undo pressed after this section was closed and opened again):
    // take it in when nothing here is waiting to be saved. Not the answer to this section's own save, which
    // leaves out empty facts, so a fact you have just added would vanish
    if (profile === ownSave.current || pending.current || state === 'unsaved' || state === 'saving') return
    if (profile.facts !== latest.current) { latest.current = profile.facts; setFacts(profile.facts) }
  }, [profile, facts, state])

  const persist = async (list: Fact[]) => {
    const saved = await api.saveProfile(list.filter((f) => f.label.trim() || f.value.trim()))
    ownSave.current = saved
    useServer.getState().setProfile(saved)
  }

  // Saves a moment after you stop typing. A failed save stops there (Try again retries): no silent loop
  useEffect(() => {
    if (state !== 'unsaved' || !facts) return
    const t = setTimeout(async () => {
      pending.current = null
      setState('saving')
      try {
        await persist(facts)
        setState('saved')
      } catch (err) {
        pending.current = facts
        toast({ kind: 'error', title: "Couldn't save the facts", body: errorMessage(err) })
        setState('failed')
      }
    }, 700)
    return () => clearTimeout(t)
  }, [facts, state])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (pending.current) {
        const list = pending.current
        pending.current = null
        void persist(list).catch((err) => toast({ kind: 'error', title: "Couldn't save the facts", body: errorMessage(err) }))
      }
    }
  }, [])

  if (!profile || !facts) return <><Heading title="Memory: facts about you">{CONCEPTS.facts.short}</Heading><Skeleton className="h-24" /></>
  const change = (list: Fact[]) => {
    pending.current = list
    latest.current = list
    setFacts(list)
    setState('unsaved')
  }
  // Undo goes through the same path as any edit, so it is saved too; the list is read fresh when Undo is pressed
  const restore = (i: number, f: Fact) => change(((list) => [...list.slice(0, i), f, ...list.slice(i)])(latest.current))
  const edit = (i: number, f: Partial<Fact>) => change(facts.map((x, j) => (j === i ? { ...x, ...f } : x)))
  return (
    <div>
      <Heading title="Memory: facts about you">{CONCEPTS.facts.short} Untick a fact to keep it here without sending it.</Heading>
      {settings && <AppliesFromNextConversation settings={settings} part="memory" />}
      {/* Only the outcomes are announced; "Saving…" would be read out on every keystroke pause */}
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        {state === 'saving' ? <span>Saving…</span> : state === 'unsaved' ? <span>Unsaved changes…</span>
          : state === 'failed' ? (
            <>
              <span aria-live="polite">Couldn't save</span>
              <Button size="sm" onClick={() => setState('unsaved')}>Try again</Button>
            </>
          ) : <span aria-live="polite">{`Saved · ${plural(profile.shared, 'fact')} shared`}</span>}
      </div>
      <ul className="space-y-2">
        {facts.map((f, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <input type="checkbox" checked={f.share && !!f.value.trim()} disabled={!f.value.trim()}
              onChange={(e) => edit(i, { share: e.target.checked })}
              aria-label={`Share ${f.label || 'this fact'}`} title={f.value.trim() ? 'Send this fact to the model' : 'Empty facts are never sent'} />
            <Field value={f.label} onChange={(e) => edit(i, { label: e.target.value })} placeholder="Label, e.g. Name" aria-label={`Label of fact ${i + 1}`}
              className="w-full sm:w-56" />
            <Field value={f.value} onChange={(e) => edit(i, { value: e.target.value })} placeholder="Value" aria-label={`Value of fact ${i + 1}`}
              className="min-w-0 flex-1" />
            {!f.value.trim() && <span className="shrink-0 text-xs text-muted">(empty, not sent)</span>}
            <IconButton size="sm" label={`Remove ${f.label || 'fact'}`} onClick={() => {
              const gone = f
              change(facts.filter((_, j) => j !== i))
              undoToast(`Removed ${f.label || 'a fact'}`, () => (mounted.current ? restore(i, gone) : restoreAfterClose(i, gone)))
            }}
              className="text-muted hover:bg-bad-soft hover:text-bad"><X className="size-4" /></IconButton>
          </li>
        ))}
      </ul>
      <Button size="sm" className="mt-2" onClick={() => {
        const n = facts.length + 1
        change([...facts, { label: '', value: '', share: true }])
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`input[aria-label="Label of fact ${n}"]`)?.focus())
      }}><Plus className="size-3.5" aria-hidden /> Add a fact</Button>
      <div className="mt-6 space-y-1">
        <SectionLabel>Exactly what's added to the system prompt</SectionLabel>
        {profile.addition
          ? <pre className="code-block added">{profile.addition}</pre>
          : <p className="text-sm text-muted">Nothing: no fact is ticked.</p>}
      </div>
      <p className="mt-3 text-xs text-muted">The model can also add facts itself with the <code>remember_fact</code> tool ({remembering}). Saved in <code>{profile.file}</code>.</p>
    </div>
  )
}
