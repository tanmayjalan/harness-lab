// Answers several views need: which call the Inspector shows, and actions with error toasts.
import { api, ApiError } from '../api/client'
import type { Rule } from '../api/types'
import { count, plural } from '../lib/format'
import { ONE_COLUMN } from '../lib/layout'
import { stopWords } from '../lib/stopWords'
import { useServer } from './server'
import { useSession } from './session'
import { say, toast, usePrefs, useUi } from './ui'

// The call the Inspector shows: the one you picked, or the newest while following along
export function useInspectedCallId(): string | null {
  const selected = useUi((s) => s.selectedCallId)
  const follow = useUi((s) => s.followLatest)
  const order = useSession((s) => s.derived.callOrder)
  if (!follow && selected && order.includes(selected)) return selected
  return order.length ? order[order.length - 1] : null
}

const message = (err: unknown) => (err instanceof ApiError ? err.message : String((err as Error)?.message ?? err))

let poke: (() => void) | null = null
export const setPoke = (f: () => void) => { poke = f }

export async function send(text: string) {
  try {
    await api.chat(text)
    useUi.getState().follow()
    poke?.()
    return true
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't send", body: message(err) })
    return false
  }
}

// Esc stops a running message, but not while a dialog is open (Esc closes that) or while the
// approval panel waits: the server counts a stop as a decline, so Esc there would decline unasked
export function escapeStops() {
  return useSession.getState().running && !useSession.getState().derived.pendingApproval && !useUi.getState().approvalDock
    && useUi.getState().screen === 'run'
    && !(typeof document !== 'undefined' && document.querySelector('[role="dialog"][data-state="open"]'))
}

export async function stop() {
  try {
    await api.stop()
    poke?.()
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't stop", body: message(err) })
  }
}

export async function decide(id: string, allowed: boolean, alwaysAllowTool?: string): Promise<boolean> {
  try {
    if (allowed && alwaysAllowTool) {
      useServer.getState().setSettings(await api.saveSettings({ permissions: { [alwaysAllowTool]: 'allow' as Rule } }))
      toast({ kind: 'ok', title: `${alwaysAllowTool} is now set to Allow`, body: 'Change it any time in Settings → Tools.' })
    }
    await api.approve(id, allowed, !!(allowed && alwaysAllowTool))
    poke?.()
    return true
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't send your answer", body: message(err) })
    return false
  }
}

// true when it worked (callers that do more afterwards must stop on false)
export async function switchProvider(name: string, model?: string): Promise<boolean> {
  try {
    await api.switchProvider(name, model)
    await useServer.getState().loadInfo()
    poke?.()
    return true
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't switch", body: message(err) })
    return false
  }
}

export async function newConversation() {
  try {
    await api.newConversation()
    useUi.getState().follow()
    useUi.getState().setExperiment(null) // (picking an experiment sets it again after this)
    useUi.getState().setScreen('run')
    poke?.()
    // Straight to the message box (past the experiment cards)
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus(), 0)
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't start a new conversation", body: message(err) })
  }
}

// goneToast: the id came from the address (a bookmark, a reload), so a missing file is news, not an error
export async function openConversation(id: string, opts?: { goneToast?: boolean }): Promise<boolean> {
  try {
    useServer.getState().setConversations(await api.openConversation(id))
    useUi.getState().follow()
    useUi.getState().setExperiment(null)
    useUi.getState().setScreen('run')
    poke?.()
    return true
  } catch (err) {
    if (opts?.goneToast && err instanceof ApiError && err.status === 404) {
      toast({ kind: 'info', title: 'That conversation is gone' })
      return false
    }
    toast({ kind: 'error', title: "Couldn't open it", body: message(err) })
    return false
  }
}

// The keys that move around a conversation ([ ] / and Alt+arrows) only work on its screen
export const onRunScreen = () => useUi.getState().screen === 'run'

// A call's line in the chat (its button), to put focus back on
export function callDivider(id: string | null | undefined) {
  if (!id) return null
  return Array.from(document.querySelectorAll<HTMLElement>('[data-call-id]')).find((el) => el.dataset.callId === id) ?? null
}

// A call in words, for a screen reader: "Message 1, call 2 (2 of 3 calls): asked for 1 tool"
export function callSentence(id: string) {
  const model = useSession.getState().derived
  const c = model.calls[id]
  if (!c) return ''
  const asked = (c.response?.content ?? []).filter((b) => b.type === 'tool_use').length
  const what = c.failed ? 'failed' : stopWords(c.stopReason, Math.max(asked, c.toolIds.length))
  return `Message ${c.runIndex}, call ${c.turn} (${model.callOrder.indexOf(id) + 1} of ${plural(model.callOrder.length, 'call')}): ${what}`
}

// F425, F426: show a call in the Inspector. `focus`: you picked it in the chat, so the Inspector takes focus
// (on a narrow screen it is its own view: go there). Without it ([ and ]) focus stays where it is and the
// call is read out instead; a narrow screen stays on the chat, with the call marked there
export function inspectCall(id: string, { focus = false, before = '' }: { focus?: boolean; before?: string } = {}) {
  const ui = useUi.getState()
  ui.selectCall(id)
  const narrow = typeof matchMedia !== 'undefined' && matchMedia(`(max-width: ${ONE_COLUMN - 1}px)`).matches
  if (!narrow) usePrefs.getState().setInspectorOpen(true)
  else if (focus) ui.setMobilePane('inspect')
  if (focus) ui.setFocusInspector(true)
  else say(`${before}${narrow ? '' : 'Inspector: '}${callSentence(id)}`)
}

export async function deleteConversation(id: string) {
  const title = useServer.getState().conversations?.items.find((c) => c.id === id)?.title ?? 'the conversation'
  try {
    useServer.getState().setConversations(await api.deleteConversation(id))
    poke?.()
    toast({ kind: 'ok', title: `Deleted "${title}"`, action: { label: 'Undo', run: () => void restoreConversation(id) } })
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't delete it", body: message(err) })
  }
}

export async function restoreConversation(id: string) {
  try {
    useServer.getState().setConversations(await api.restoreConversation(id))
    toast({ kind: 'ok', title: 'Brought back' })
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't bring it back", body: message(err) })
  }
}

// What the toast after a rewind says: only the counts that aren't zero
export function rewoundTitle(done: { files: boolean; restored: number; deleted: number }) {
  if (!done.files) return "Rewound: the messages only (the files weren't saved before it)"
  const restored = done.restored ? `${plural(done.restored, 'file')} restored` : ''
  const deleted = !done.deleted ? '' : restored ? `${count(done.deleted)} deleted` : `${plural(done.deleted, 'file')} deleted`
  return `Rewound: ${[restored, deleted].filter(Boolean).join(', ') || 'no files needed changing'}`
}

// "Rewind to here": the files go back as they were before that message, the conversation is cut there, and
// the message's text goes back in the box. No Undo: the dialog that lists what it does is the guard.
// Returns null when it failed, otherwise whether the text was put in the box ('filled') or, because you had
// typed something else there, the toast asks first ('asked'), as the experiment cards do
export async function rewindTo(seq: number): Promise<'filled' | 'asked' | null> {
  try {
    const done = await api.rewind(seq)
    useUi.getState().follow()
    poke?.()
    void useServer.getState().loadConversations() // (saved at once, maybe with fewer messages)
    const typed = useUi.getState().composerText.trim()
    if (typed && typed !== done.text.trim()) {
      toast({ kind: 'ok', title: rewoundTitle(done), body: 'What you typed is still in the message box. Replace it with the rewound message?',
        action: { label: 'Replace', run: () => useUi.getState().fillDraft(done.text) } })
      return 'asked'
    }
    useUi.getState().fillDraft(done.text)
    toast({ kind: 'ok', title: rewoundTitle(done) })
    return 'filled'
  } catch (err) {
    toast({ kind: 'error', title: "Couldn't rewind", body: message(err) })
    return null
  }
}

export { message as errorMessage }
