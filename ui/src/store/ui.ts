// Page state that isn't the server's: which call is selected, which screen and panels are
// open, toasts, and preferences kept between visits.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { SettingsChange } from '../api/types'

export type Screen = 'run' | 'compare' | 'evals'
export type InspectorTab = 'summary' | 'sent' | 'received' | 'tools' | 'raw'
export type SettingsSection = 'model' | 'prompt' | 'memory' | 'tools' | 'context' | 'display'
export type MobilePane = 'chat' | 'inspect'

export type Toast = {
  id: number; kind: 'info' | 'ok' | 'error'; title: string; body?: string
  action?: { label: string; run: () => void } // e.g. Undo
}

// armed(): false for the first moment after the panel appears, so a key typed meanwhile can't answer it
export type ApprovalDockHandle = { answer: (allowed: boolean) => void; focus: () => void; armed: () => boolean }

// afterHistory: the question came after other messages, which a comparison doesn't send
export type CompareDraft = { text: string; afterHistory?: boolean }

type UiState = {
  screen: Screen
  selectedCallId: string | null
  selectedToolId: string | null
  followLatest: boolean // keep selecting the newest call as it arrives
  settingsOpen: boolean
  settingsSection: SettingsSection
  helpOpen: boolean
  helpTarget: string | null // an element id in Help to scroll to when it opens (a glossary term, the quiz)
  mobilePane: MobilePane
  sidebarSheet: boolean // the sidebar as a sheet on narrow screens
  compareDraft: CompareDraft | null
  toasts: Toast[]
  experimentId: string | null // the experiment this conversation is following
  guess: string | null // your prediction for it, before sending
  experimentConversation: string | null // the conversation its message was sent in, once it was
  experimentsOpen: boolean
  draft: { text: string; n: number } // text to put in the message box (n changes each time)
  approvalDock: ApprovalDockHandle | null // the approval panel on screen, if any: the A and D keys answer through it
  keepScroll: boolean // you opened a tool row: the chat must not jump to the bottom because it grew
  composerText: string // what is typed in the message box right now (so picking an experiment can ask first)
  settingsDrafts: Record<string, string> // unsaved text in Settings ('system', 'desc:<tool>'), kept while you move around
  spoken: { text: string; n: number } // F425: a sentence for screen readers, read out by the Announcer (n changes each time)
  focusInspector: boolean // F426: the Inspector takes focus when it next shows a call (you picked one in the chat)
  setScreen: (s: Screen) => void
  selectCall: (id: string | null, toolId?: string | null) => void
  inspect: (callId: string, tab: InspectorTab, opts?: { toolId?: string | null; narrow?: boolean }) => void // F406: open the Inspector on a call
  follow: () => void
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  toggleSettings: () => void // Ctrl+,: closes Help and Experiments first, so dialogs don't stack
  anyDialogOpen: () => boolean // Settings, Help or Experiments is open: nothing outside it can be reached
  rememberFocus: () => void // before a shortcut opens a dialog: where focus goes back to when it closes
  restoreFocus: (e: Event) => void // a dialog's onCloseAutoFocus
  setHelp: (open: boolean, target?: string | null) => void
  holdToast: (id: number) => void // you are pointing at it: it waits
  releaseToast: (id: number) => void
  setMobilePane: (p: MobilePane) => void
  setSidebarSheet: (open: boolean) => void
  startCompare: (draft: CompareDraft) => void
  dismiss: (id: number) => void
  setExperiment: (id: string | null) => void
  setGuess: (guess: string | null) => void
  setExperimentsOpen: (open: boolean) => void
  fillDraft: (text: string) => void
  setApprovalDock: (d: ApprovalDockHandle | null) => void
  setSettingsDraft: (key: string, text: string | null) => void
  setComposerText: (text: string) => void
  setKeepScroll: (on: boolean) => void
  setFocusInspector: (on: boolean) => void
}

let nextToast = 1
let returnFocus: HTMLElement | null = null
// Where focus is now, kept so a dialog can give it back when it closes
function remember() {
  returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
}

// F411: an experiment you were following comes back after a reload (it was set aside in this tab)
let restoredExperiment = false
// True once, after a reload brought an experiment back: the message box can get its message again
export function takeRestoredExperiment() {
  const was = restoredExperiment
  restoredExperiment = false
  return was
}

export const useUi = create<UiState>()(persist((set, get) => ({
  screen: 'run',
  selectedCallId: null,
  selectedToolId: null,
  followLatest: true,
  settingsOpen: false,
  settingsSection: 'model',
  helpOpen: false,
  helpTarget: null,
  mobilePane: 'chat',
  sidebarSheet: false,
  compareDraft: null,
  toasts: [],
  experimentId: null,
  guess: null,
  experimentConversation: null,
  experimentsOpen: false,
  draft: { text: '', n: 0 },
  approvalDock: null,
  settingsDrafts: {},
  composerText: '',
  keepScroll: false,
  spoken: { text: '', n: 0 },
  focusInspector: false,
  setScreen: (screen) => set({ screen }),
  selectCall: (selectedCallId, selectedToolId = null) => {
    usePrefs.getState().sawInspectHint() // you found the Inspector: the "inspect →" hint has done its job
    set({ selectedCallId, selectedToolId, followLatest: false })
  },
  // `narrow`: on a narrow screen go to the Inspector view too (a button asked for it; a tool row opening
  // in the chat does not, so you stay where you were reading)
  inspect: (callId, tab, opts) => {
    get().selectCall(callId, opts?.toolId ?? null)
    usePrefs.getState().setInspectorTab(tab)
    usePrefs.getState().setInspectorOpen(true)
    if (opts?.narrow && typeof matchMedia !== 'undefined' && matchMedia('(max-width: 899px)').matches) set({ mobilePane: 'inspect' })
  },
  follow: () => set({ followLatest: true, selectedToolId: null }),
  openSettings: (section) => { if (!get().settingsOpen) remember(); set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection })) },
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => { const s = get(); if (!s.settingsOpen) remember(); set(s.settingsOpen ? { settingsOpen: false } : { settingsOpen: true, helpOpen: false, experimentsOpen: false }) },
  anyDialogOpen: () => { const s = get(); return s.settingsOpen || s.helpOpen || s.experimentsOpen },
  rememberFocus: () => remember(),
  restoreFocus: (e) => {
    const el = returnFocus
    returnFocus = null
    if (el && el.isConnected) {
      e.preventDefault()
      el.focus()
    }
  },
  setHelp: (helpOpen, helpTarget = null) => { if (helpOpen && !get().helpOpen) remember(); set({ helpOpen, helpTarget: helpOpen ? helpTarget : null }) },
  holdToast: (id) => {
    const t = timers.get(id)
    if (t) clearTimeout(t)
    timers.delete(id)
  },
  releaseToast: (id) => {
    const t = useUi.getState().toasts.find((x) => x.id === id)
    if (t && !timers.has(id)) schedule(t)
  },
  setMobilePane: (mobilePane) => set({ mobilePane }),
  setSidebarSheet: (sidebarSheet) => set({ sidebarSheet }),
  startCompare: (compareDraft) => set({ compareDraft, screen: 'compare' }),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setExperiment: (experimentId) => set({ experimentId, guess: null, experimentConversation: null }),
  setGuess: (guess) => set({ guess }),
  setExperimentsOpen: (experimentsOpen) => { if (experimentsOpen && !get().experimentsOpen) remember(); set({ experimentsOpen }) },
  fillDraft: (text) => set((s) => ({ draft: { text, n: s.draft.n + 1 } })),
  setApprovalDock: (approvalDock) => set({ approvalDock }),
  setComposerText: (composerText) => set({ composerText }),
  setKeepScroll: (keepScroll) => set({ keepScroll }),
  setFocusInspector: (focusInspector) => set({ focusInspector }),
  setSettingsDraft: (key, text) => set((s) => {
    const next = { ...s.settingsDrafts }
    if (text === null) delete next[key]
    else next[key] = text
    return { settingsDrafts: next }
  }),
}), {
  // Only the experiment you are following, and only for this tab (sessionStorage): a reload keeps it,
  // a visit another day starts without it
  name: 'harness-lab-experiment',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (s) => ({ experimentId: s.experimentId, guess: s.guess, experimentConversation: s.experimentConversation }),
  onRehydrateStorage: () => (state) => { if (state?.experimentId) restoredExperiment = true },
}))

// Plain notes go after 6 seconds; errors and ones with a button (Undo) stay 20 seconds, and any of
// them waits while you point at it or tab to it
const timers = new Map<number, ReturnType<typeof setTimeout>>()
function schedule(t: Toast) {
  timers.set(t.id, setTimeout(() => {
    timers.delete(t.id)
    useUi.getState().dismiss(t.id)
  }, t.kind === 'error' || t.action ? 20000 : 6000))
}

// Read a sentence out to screen readers (through the Announcer's always-present live region)
export function say(text: string) {
  useUi.setState((s) => ({ spoken: { text, n: s.spoken.n + 1 } }))
}

export function toast(t: Omit<Toast, 'id'>) {
  // The same message while it is still showing (a refused value saved twice, say) shows once
  if (!t.action && useUi.getState().toasts.some((x) => !x.action && x.title === t.title && x.body === t.body && x.kind === t.kind)) return
  const id = nextToast++
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
  schedule({ ...t, id })
}

// ---- preferences, kept in the browser between visits ----

export type FontSize = 'sm' | 'md' | 'lg'
export type Theme = 'system' | 'light' | 'dark'

// What experiments changed and what was there before, so Undo works after a reload too
export type ExperimentBefore = {
  settings?: SettingsChange
  provider?: { provider: string; model: string }
  changes: string[] // each change in plain words, e.g. "longest reply set to 300 tokens"
}

type Prefs = {
  learningMode: boolean // explain every concept in full, every time
  explained: string[] // concepts already explained in full once
  experimentsDone: string[] // experiments you've run to the end
  experimentBefore: ExperimentBefore | null
  alwaysDetails: boolean // every message opens with its details (calls, tokens, tool rows), not only the story
  inspectHintSeen: boolean // you have clicked a call line once, so the "inspect →" hint can go
  quizAnswers: Record<string, number> // Help → Quiz me: the option you picked per question
  fontSize: FontSize
  theme: Theme // F348a: light or dark by hand, or the system's setting
  sidebarCollapsed: boolean
  sidebarComparisonsOpen: boolean // the folded "Comparisons" group in the sidebar
  inspectorTab: InspectorTab
  inspectorOpen: boolean
  inspectorWidth: number // px; drag the inspector's left edge to change it
  setLearningMode: (on: boolean) => void
  markExplained: (key: string) => void
  markExperimentDone: (id: string) => void
  setExperimentBefore: (b: ExperimentBefore | null) => void
  resetExperimentsDone: () => void
  sawInspectHint: () => void
  setAlwaysDetails: (on: boolean) => void
  answerQuiz: (id: string, option: number | null) => void
  resetExplained: () => void
  setFontSize: (f: FontSize) => void
  setTheme: (t: Theme) => void
  toggleSidebar: () => void
  setInspectorTab: (t: InspectorTab) => void
  setInspectorOpen: (open: boolean) => void
  setInspectorWidth: (px: number) => void
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      learningMode: false,
      explained: [],
      experimentsDone: [],
      experimentBefore: null,
      inspectHintSeen: false,
      alwaysDetails: false,
      quizAnswers: {},
      fontSize: 'md',
      // (no version bump: the stored prefs are merged over these defaults, so a page saved before has System)
      theme: 'system',
      sidebarCollapsed: false,
      sidebarComparisonsOpen: false,
      inspectorTab: 'summary',
      // closed until you pick a call: an empty Inspector only takes room from the chat
      inspectorOpen: false,
      // F305: the conversation stays the widest column at 1280 px (its loop diagram is the compact one)
      inspectorWidth: 440,
      setLearningMode: (learningMode) => set({ learningMode }),
      markExplained: (key) => set((s) => (s.explained.includes(key) ? s : { explained: [...s.explained, key] })),
      answerQuiz: (id, option) => set((s) => {
        const next = { ...s.quizAnswers }
        if (option === null) delete next[id]
        else next[id] = option
        return { quizAnswers: next }
      }),
      markExperimentDone: (id) => set((s) => (s.experimentsDone.includes(id) ? s : { experimentsDone: [...s.experimentsDone, id] })),
      resetExplained: () => set({ explained: [] }),
      setExperimentBefore: (experimentBefore) => set({ experimentBefore }),
      resetExperimentsDone: () => set({ experimentsDone: [] }),
      sawInspectHint: () => set({ inspectHintSeen: true }),
      setAlwaysDetails: (alwaysDetails) => set({ alwaysDetails }),
      setFontSize: (fontSize) => set({ fontSize }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
      setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
    }),
    {
      name: 'harness-lab-prefs',
      // 1: the usual Inspector width went from 520 to 440 (F305). A stored 520 was the old default, never
      // a width picked by hand as far as we can tell, so it moves to the new one; any other width stays
      // 2: the Inspector starts closed and opens when you pick a call; a stored "open" was the old default
      version: 2,
      migrate: (persisted, version) => {
        let state = (persisted ?? {}) as Partial<Prefs>
        if (version < 1 && state.inspectorWidth === 520) state = { ...state, inspectorWidth: 440 }
        if (version < 2) state = { ...state, inspectorOpen: false }
        return state as Prefs
      },
    },
  ),
)
