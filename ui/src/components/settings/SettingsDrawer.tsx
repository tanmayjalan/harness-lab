// Everything that shapes the next run, in one drawer (Ctrl+,). Changes apply from the next
// message; a dot marks anything that differs from the default, with a way back.
import * as Dialog from '@radix-ui/react-dialog'
import { Toaster } from '../shell/Toaster'
import { Announcer } from '../shell/Announcer'
import { Bot, Brain, FileText, Layers, Monitor, RotateCcw, Wrench, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import { cn } from '../../lib/cn'
import { shortPath } from '../../lib/format'
import { errorMessage } from '../../store/selectors'
import { useServer } from '../../store/server'
import { toast, useUi, type SettingsSection } from '../../store/ui'
import { Button, chipClass, IconButton, Skeleton } from '../ui'
import { changedIn, sectionOf, settingsAsChange } from './common'
import { ModelSection } from './ModelSection'
import { PromptSection } from './PromptSection'
import { MemorySection } from './MemorySection'
import { ToolsSection } from './ToolsSection'
import { ContextSection } from './ContextSection'
import { DisplaySection } from './DisplaySection'

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'model', label: 'Model', icon: <Bot className="size-4" /> },
  { id: 'prompt', label: 'Prompt', icon: <FileText className="size-4" /> },
  { id: 'memory', label: 'Memory', icon: <Brain className="size-4" /> },
  { id: 'tools', label: 'Tools', icon: <Wrench className="size-4" /> },
  { id: 'context', label: 'Context', icon: <Layers className="size-4" /> },
  { id: 'display', label: 'Display', icon: <Monitor className="size-4" /> },
]

// Reset all's armed state, readable by the drawer: Esc disarms it first and only then closes the drawer
const resetArm = { armed: false, disarm: () => {} }

export function SettingsDrawer() {
  const open = useUi((s) => s.settingsOpen)
  const section = useUi((s) => s.settingsSection)
  const settings = useServer((s) => s.settings)
  const profile = useServer((s) => s.profile)
  const changed = changedIn(settings)
  const drafts = useUi((s) => s.settingsDrafts)
  const shared = profile?.shared ?? 0
  const workspace = useServer((s) => s.info?.folder)

  useEffect(() => {
    if (open) {
      useServer.getState().loadSettings()
      useServer.getState().loadProfile()
    }
  }, [open])

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? useUi.getState().openSettings() : useUi.getState().closeSettings())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60" />
        <Dialog.Content aria-describedby={undefined}
          onEscapeKeyDown={(e) => { if (resetArm.armed) { e.preventDefault(); resetArm.disarm() } }}
          onCloseAutoFocus={(e) => useUi.getState().restoreFocus(e)}
          onInteractOutside={(e) => { if ((e.target as Element).closest('[data-toaster]')) e.preventDefault() }}
          className="slide-in fixed inset-y-0 right-0 z-50 flex w-[min(52rem,100vw)] flex-col border-l border-line bg-panel shadow-2xl">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <Dialog.Title className="text-base font-semibold">Settings</Dialog.Title>
            <span className="text-sm text-muted">
              {settings?.apply === 'conversation'
                ? 'The prompt, tool descriptions and facts about you apply from your next conversation; the rest from your next message.'
                : 'Changes apply from your next message.'}
            </span>
            <Dialog.Close asChild><IconButton size="sm" label="Close" className="ml-auto text-muted hover:text-fg"><X className="size-4" /></IconButton></Dialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav aria-label="Settings sections" className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line p-2 sm:w-52 sm:flex-col sm:border-r sm:border-b-0">
              {SECTIONS.map((s) => {
                const n = s.id === 'memory' ? 0 : changed[s.id] ?? 0
                const unsaved = s.id === 'prompt' ? 'system' in drafts : s.id === 'tools' ? Object.keys(drafts).some((k) => k.startsWith('desc:')) : false
                return (
                  <button key={s.id} type="button" onClick={() => useUi.getState().openSettings(s.id)}
                    aria-current={section === s.id ? 'page' : undefined}
                    className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap focus-ring',
                      section === s.id ? 'bg-accent-soft font-medium text-accent' : 'text-fg hover:bg-sunken')}>
                    {s.icon}<span className="flex-1">{s.label}{s.id === 'memory' && shared > 0 && <>{' '}<span className="font-normal text-muted">· {shared} shared</span></>}</span>
                    {unsaved && <span className="text-xs font-normal text-warn">unsaved</span>}
                    {n > 0 && (
                      <span title={`${n} changed from the default`}
                        className="min-w-5 rounded-full bg-warn-soft px-1.5 text-center text-xs text-warn">
                        {n}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {!settings && section !== 'display' && section !== 'model' ? (
                <div className="space-y-3"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-40" /></div>
              ) : section === 'model' ? <ModelSection />
                : section === 'prompt' ? <PromptSection settings={settings!} />
                  : section === 'memory' ? <MemorySection />
                    : section === 'tools' ? <ToolsSection settings={settings!} />
                      : section === 'context' ? <ContextSection settings={settings!} />
                        : <DisplaySection />}
            </div>
          </div>
          {settings && (
            <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-xs text-muted">
              {settings.changed.length > 0 && section !== 'display' ? (
                <span className="flex min-w-0 flex-wrap items-center gap-1" title={`Saved in ${settings.file}`}>
                  Changed:
                  {settings.changed.map((c) => (
                    <button key={c} type="button" onClick={() => useUi.getState().openSettings(sectionOf(c))}
                      className={chipClass({ interactive: true })}>{c}</button>
                  ))}
                </span>
              ) : (
                <span className="min-w-0 truncate" title={settings.file}>
                  {section === 'display' ? 'Display choices are kept in this browser only.' : <>Nothing changed from the defaults. Saved in <code>{shortPath(settings.file, workspace)}</code></>}
                </span>
              )}
              <ResetAll />
            </div>
          )}
          <Toaster inDialog />
          <Announcer />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ResetAll() {
  const [sure, setSure] = useState(false)
  // Armed until you act or leave the button (blur, Esc): a timer is too short for keyboard and screen-reader users
  useEffect(() => {
    resetArm.armed = sure
    resetArm.disarm = () => setSure(false)
    return () => { resetArm.armed = false }
  }, [sure])
  return (
    <>
    <span className="sr-only" role="status">{sure ? 'Press again to reset everything' : ''}</span>
    <Button size="sm" variant={sure ? 'danger' : 'ghost'} className="ml-auto"
      onBlur={() => setSure(false)}
      onClick={async () => {
        if (!sure) return setSure(true)
        const before = useServer.getState().settings
        try {
          useServer.getState().setSettings(await api.resetSettings())
          toast({
            kind: 'ok', title: 'Model, prompt, tools and context are back to the defaults',
            body: 'Memory and Display are kept. Undo puts back what you had.',
            action: before ? {
              label: 'Undo', run: () => void api.saveSettings(settingsAsChange(before))
                .then((s) => useServer.getState().setSettings(s))
                .catch((err) => toast({ kind: 'error', title: "Couldn't undo the reset", body: errorMessage(err) })),
            } : undefined,
          })
        } catch (err) {
          toast({ kind: 'error', title: "Couldn't reset", body: errorMessage(err) })
        }
        setSure(false)
      }}>
      <RotateCcw className="size-3.5" /> {sure ? 'Click again to reset everything' : 'Reset all to defaults'}
    </Button>
    </>
  )
}
