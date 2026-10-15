// The Compare screen's state: the question, each side's setup, and the latest results.
import { create } from 'zustand'
import { api } from '../api/client'
import type { CompareSide, Effort, PastComparison, Rule, SkillsSetting } from '../api/types'
import { errorMessage } from './selectors'
import { useServer } from './server'
import { undoToast } from '../lib/undoToast'
import { toast, useUi } from './ui'

// Thinking for one side: as saved, off, a budget (mock, DeepSeek) or an effort (Opus 5.5)
export type SideThinking = undefined | 'off' | { budget: number } | { effort: Effort }

export type SideSpec = {
  id: string // stays with the side when another is removed, so its card keeps its own state
  provider: string
  model: string // '' = the provider's default
  label: string
  system: string // '' = your saved prompt
  permissions: Record<string, Rule> // changes for this side only
  thinking: SideThinking
  cache: boolean | undefined // undefined = as saved
  skills?: SkillsSetting // undefined = as saved
  toolsAtOnce?: boolean // undefined = as saved
  busy?: boolean // the practice switch; undefined = as saved
  workflow?: boolean // answer with the chain of agents; undefined = as saved
  runCode?: boolean // offer run_python; undefined = as saved
  extraTools?: 'off' | 'all' | 'find' // the 40 office tools: off, all sent, or found on demand; undefined = as saved
}

export type CompareResults =
  | { kind: 'compare'; text: string; sides: CompareSide[]; profileIncluded: boolean; lookFor?: string; id?: string }
  | { kind: 'rerun'; text: string; sides: CompareSide[]; conversation: string; seq: number; id?: string }

// Ready-made comparisons: one change between the sides, and what to look for.
// `needs`: a provider it needs to show anything (the mock can't cache)
export type Preset = { id: string; title: string; text: string; lookFor: string; sides: Partial<SideSpec>[]; needs?: string }

export const PRESETS: Preset[] = [
  {
    id: 'models', title: 'Opus vs Haiku', text: "What's the weather in Paris, in Fahrenheit?",
    lookFor: 'Did both models use the tools? Compare their calls, time and estimated cost.',
    sides: [{ model: 'claude-opus-5-5', label: 'Opus' }, { model: 'claude-haiku-4-5-20251001', label: 'Haiku' }],
  },
  {
    id: 'thinking', title: 'Thinking off vs on', text: 'Is 391 a prime number? Check your reasoning with the calculator.',
    lookFor: 'Side B thinks first: is it slower, does it use fewer or different tool calls, is the answer better?',
    sides: [{ thinking: 'off', label: 'No thinking' }, { thinking: { budget: 4000 }, label: 'Thinking' }],
  },
  {
    id: 'prompt', title: 'Default prompt vs one-liners', text: 'What can you help me with?',
    lookFor: 'The system prompt is the biggest lever: same model, same question, very different answers.',
    sides: [{ label: 'Default prompt' },
      { label: 'One-line prompt', system: 'Answer in one short line. Use a tool whenever one fits.' }],
  },
  {
    id: 'permission', title: 'Weather allowed vs blocked', text: "What's the weather in Tokyo?",
    lookFor: 'With the tool blocked, the model is told so: does it admit it, guess, or try something else?',
    sides: [{ label: 'Allowed', permissions: { get_weather: 'allow' } }, { label: 'Blocked', permissions: { get_weather: 'block' } }],
  },
  {
    id: 'helper', title: 'Helper vs no helper', text: 'Summarise notes.md and recipes/pancakes.txt (use a helper agent if you can)',
    lookFor: 'Side A hands the reading to a helper; side B has to read the files itself. Compare the main calls and their size.',
    sides: [{ label: 'With helper', permissions: { delegate: 'allow' } }, { label: 'No helper', permissions: { delegate: 'block' } }],
  },
  {
    id: 'search', title: 'Search vs read everything', text: "What's our refund policy for annual plans? The handbook folder has the company policies.",
    lookFor: 'Side B can\'t search, so it has to list and read files: compare the calls, tokens and time.',
    sides: [{ label: 'With search' }, { label: 'No search', permissions: { search_files: 'block' } }],
  },
  {
    id: 'skills', title: 'Skills on demand vs all in the prompt', text: 'File my 18 euro taxi expense from yesterday.',
    lookFor: 'Side A gets one line per skill and loads the expenses skill when it needs it; side B gets every skill in full in every call. Compare tokens in per call.',
    sides: [{ label: 'On demand', skills: { enabled: true, mode: 'on_demand' } },
      { label: 'All in the prompt', skills: { enabled: true, mode: 'all_in_prompt' } }],
  },
  {
    id: 'at_once', title: 'Tools one by one vs at once', text: "What's the weather in Paris, Tokyo and London? Look all three up in one go.",
    lookFor: 'Both sides ask for the same three lookups; side B runs them at the same time. Compare the time each took.',
    sides: [{ label: 'One by one', toolsAtOnce: false }, { label: 'At once', toolsAtOnce: true }],
  },
  {
    id: 'tool_search', title: 'All tools sent vs found on demand', text: 'Book meeting room B for 3pm tomorrow for 4 people.',
    lookFor: 'Both sides have the 40 office tools. Side A sends every description on every call; side B sends only find_tool and loads book_room when the model asks. Compare the tokens sent per call and the number of calls.',
    sides: [{ label: 'All sent', extraTools: 'all' }, { label: 'Found on demand', extraTools: 'find' }],
  },
  {
    id: 'workflow', title: 'One agent vs a workflow', text: 'How many days of annual leave do I get, and can I carry any over? The handbook folder has the company policies.',
    lookFor: 'Side A is one agent that decides everything; side B runs fixed steps (gather facts, write, check) chosen by code. Compare the calls, time and tokens, and whether the answers differ. Inspect side B to see each step.',
    sides: [{ label: 'One agent', workflow: false }, { label: 'Workflow', workflow: true }],
  },
  {
    id: 'run_code', title: 'Calculator vs running code', text: 'What is the sum of the digits of 2 to the power of 100?',
    lookFor: 'Side A has only the calculate tool; side B can also write a script and run it with run_python. run_python asks first, and nobody can be asked during a comparison, so side B runs its code only if you tick "Let Ask-first tools run". That runs the code the model writes without showing it to you first: tick it only if you are happy with that, and open side B afterwards to read what ran. Compare the tools each side used, and the answers: the right one is 115.',
    sides: [{ label: 'Calculator', runCode: false }, { label: 'Running code', runCode: true }],
  },
  {
    id: 'busy', title: 'A calm service vs a busy one', text: 'What is the capital of Australia?',
    lookFor: 'Side B has the practice switch on: the first try of each call fails as if the service were busy. Same answer and the same number of calls, but side B waited and tried each one again, so it took longer.',
    sides: [{ label: 'Calm', busy: false }, { label: 'Busy (practice)', busy: true }],
  },
  {
    id: 'cache', title: 'Caching off vs on', text: 'Read notes.md, then budget.csv, then summarise both in a line each',
    lookFor: "Needs the Anthropic API (the mock can't cache; DeepSeek caches on its own, so the switch shows no difference there): side B reads more of each later call from the cache.",
    needs: "the Anthropic API (the mock can't cache; DeepSeek caches on its own, so the switch shows no difference there)",
    sides: [{ label: 'No caching', cache: false }, { label: 'Caching', cache: true }],
  },
]

type CompareState = {
  text: string
  includeProfile: boolean
  allowAsk: boolean // let tools set to Ask first run (nobody can be asked during a comparison); unticked after each run
  repeat: number // runs per side (1, 3 or 5): models vary, so one run can mislead
  sides: SideSpec[]
  lookFor: string
  preset: Preset | null // the ready-made comparison this setup came from, until you change it
  busy: null | 'compare' | 'rerun'
  busyText: string
  progress: { label: string; done: number }[] | null // while running: runs finished per side
  repeatRunning: number
  startedAt: number | null
  results: CompareResults | null
  history: PastComparison[]
  setText: (t: string) => void
  setIncludeProfile: (on: boolean) => void
  setAllowAsk: (on: boolean) => void
  setRepeat: (n: number) => void
  setSide: (i: number, s: Partial<SideSpec>) => void
  addSide: () => void
  removeSide: (i: number) => void
  insertSide: (i: number, spec: SideSpec) => void // Undo of removeSide
  startFromChat: (text: string, a: Partial<SideSpec>, b: Partial<SideSpec>) => void
  applyPreset: (p: Preset, provider: string) => void
  run: () => Promise<void>
  stop: () => Promise<void>
  loadHistory: () => Promise<void>
  openPast: (id: string) => Promise<void>
  rerun: (conversation: string, seq: number, text: string, allowAsk?: boolean) => Promise<void>
}

const LETTERS = 'ABC'
const styleOf = (provider: string) => useServer.getState().info?.providers.find((p) => p.name === provider)?.thinking ?? 'budget'
const defaultModel = (provider: string) => useServer.getState().info?.providers.find((p) => p.name === provider)?.model ?? ''

// A side's name when you didn't give one: its letter and model, so the difference is in the title
export const sideName = (s: SideSpec, i: number) => s.label.trim() || `Side ${LETTERS[i]} · ${s.model || defaultModel(s.provider)}`

let sidesMade = 0
export const blank = (provider: string): SideSpec =>
  ({ id: `side-${++sidesMade}`, provider, model: '', label: '', system: '', permissions: {}, thinking: undefined, cache: undefined })

// How long the mock takes for one run, and so for several one after another
function mockTime(runs: number) {
  const [lo, hi] = [20 * runs, 60 * runs]
  return hi < 90 ? `${lo} to ${hi} seconds` : `about ${Math.round(lo / 60)} to ${Math.round(hi / 60)} minutes`
}

function thinkingSetting(t: SideThinking) {
  if (t === undefined) return {}
  if (t === 'off') return { thinking: { enabled: false } }
  return { thinking: { enabled: true, ...t } }
}

export const useCompare = create<CompareState>((set, get) => ({
  text: '',
  includeProfile: false,
  allowAsk: false,
  repeat: 1,
  sides: [blank('mock'), blank('mock')],
  lookFor: '',
  preset: null,
  busy: null,
  busyText: '',
  progress: null,
  repeatRunning: 1,
  startedAt: null,
  results: null,
  history: [],
  // A different question is a different comparison: the preset's "Look for" no longer applies
  setText: (text) => set((st) => (st.preset && text !== st.preset.text ? { text, preset: null, lookFor: '' } : { text })),
  setIncludeProfile: (includeProfile) => set({ includeProfile }),
  setAllowAsk: (allowAsk) => set({ allowAsk }),
  setRepeat: (repeat) => set({ repeat }),
  setSide: (i, s) => set((st) => {
    const old = st.sides[i]
    const next = { ...old, ...s }
    // A preset's name for a side ("Haiku") is wrong once its model changes: fall back to letter and model
    if ((s.model !== undefined || s.provider !== undefined) && st.preset && st.preset.sides[i]?.label === old.label) next.label = ''
    const setupChanged = Object.keys(s).some((k) => k !== 'label')
    return { sides: st.sides.map((x, j) => (j === i ? next : x)), ...(setupChanged && st.preset ? { preset: null, lookFor: '' } : {}) }
  }),
  // Another side, or one fewer, is a different comparison: the preset's "Look for" no longer describes it
  addSide: () => set((st) => (st.sides.length >= 3 ? st
    : { sides: [...st.sides, blank(st.sides[0]?.provider ?? 'mock')], preset: null, lookFor: '' })),
  removeSide: (i) => set((st) => (st.sides.length <= 2 ? st // a comparison needs two
    : { sides: st.sides.filter((_, j) => j !== i), preset: null, lookFor: '' })),
  insertSide: (i, spec) => set((st) => {
    if (st.sides.length >= 3) throw new Error('There are already three sides')
    const sides = [...st.sides]
    sides.splice(Math.min(i, sides.length), 0, spec)
    return { sides, preset: null, lookFor: '' }
  }),
  // "Compare this question" from the chat: a fresh comparison of two sides, whatever was set up before
  startFromChat: (text, a, b) => set((st) => ({
    text, preset: null, lookFor: '',
    sides: [{ ...blank(a.provider ?? st.sides[0].provider), ...a }, { ...blank(b.provider ?? st.sides[0].provider), ...b }],
  })),
  applyPreset: (p, provider) => {
    const typed = get().text.trim()
    const sides = p.sides.map((s) => {
      const side: SideSpec = { ...blank(s.model ? 'mock' : provider), ...s }
      // A budget means nothing to a provider that thinks by effort
      if (side.thinking && side.thinking !== 'off' && 'budget' in side.thinking && styleOf(side.provider) === 'adaptive') side.thinking = { effort: 'medium' }
      return side
    })
    const before = { sides: get().sides, text: get().text, preset: get().preset, lookFor: get().lookFor }
    set({ preset: p, lookFor: p.lookFor, sides, ...(typed && typed !== p.text ? {} : { text: p.text }) })
    undoToast(`"${p.title}" set up both sides`, () => set(before))
    if (typed && typed !== p.text) {
      toast({ kind: 'info', title: `"${p.title}" kept your question`, body: `Its own question is: "${p.text}"`,
        action: { label: 'Use its question', run: () => set({ text: p.text }) } })
    }
    if (p.sides.some((s) => s.model) && provider !== 'mock') {
      toast({ kind: 'info', title: 'This comparison runs on the mock', body: 'The mock can imitate all three Claude models; your provider has one.' })
    }
  },

  run: async () => {
    const { text, sides, includeProfile, allowAsk, lookFor, repeat } = get()
    if (!text.trim() || get().busy) return
    const mock = sides.some((s) => s.provider === 'mock')
    set({ busy: 'compare', repeatRunning: repeat, startedAt: Date.now(), progress: sides.map((_, i) => ({ label: LETTERS[i], done: 0 })),
      busyText: repeat > 1
        ? `Running each side ${repeat} times: the sides at the same time, their runs one after another.${mock ? ` On the mock that takes ${mockTime(repeat)}.` : ''}`
        : `Running every side at the same time.${mock ? ` On the mock that takes ${mockTime(1)}.` : ''}` })
    // How far each side has got, from the server, while the request runs
    const poll = setInterval(async () => {
      try {
        const st = await api.compareStatus()
        if (st.running && st.sides) set({ progress: st.sides.map((x, i) => ({ label: LETTERS[i], done: x.done })) })
      } catch { /* the request itself reports errors */ }
    }, 1000)
    try {
      const r = await api.compare({
        text,
        include_profile: includeProfile,
        repeat,
        look_for: lookFor,
        sides: sides.map((s, i) => ({
          provider: s.provider,
          allow_ask: allowAsk,
          ...(s.model ? { model: s.model } : {}),
          label: sideName(s, i),
          settings: {
            ...(s.system.trim() ? { system: s.system } : {}),
            permissions: s.permissions,
            ...thinkingSetting(s.thinking),
            ...(s.cache !== undefined ? { cache: { enabled: s.cache } } : {}),
            ...(s.skills !== undefined ? { skills: s.skills } : {}),
            ...(s.toolsAtOnce !== undefined ? { tools_at_once: { enabled: s.toolsAtOnce } } : {}),
            ...(s.busy !== undefined ? { faults: { busy: s.busy } } : {}),
            ...(s.workflow !== undefined ? { workflow: { enabled: s.workflow } } : {}),
            ...(s.runCode !== undefined ? { run_code: { enabled: s.runCode } } : {}),
            ...(s.extraTools !== undefined
              ? { extra_tools: s.extraTools === 'off' ? { enabled: false, mode: 'find' as const } : { enabled: true, mode: s.extraTools } }
              : {}),
          },
        })),
      })
      set({ results: { kind: 'compare', text, sides: r.results, profileIncluded: r.profile_included, lookFor, id: r.id } })
      useServer.getState().loadConversations() // each side was saved as a conversation: show them in the sidebar
      void get().loadHistory()
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't run the comparison", body: errorMessage(err) })
    } finally {
      clearInterval(poll)
      // F389: letting Ask-first tools run (code you haven't seen, for run_python) is for one comparison only
      set({ busy: null, progress: null, startedAt: null, allowAsk: false })
    }
  },

  stop: async () => {
    try {
      await api.compareStop()
      set({ busyText: 'Stopping: each run stops at its next step, and no side starts another.' })
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't stop the comparison", body: errorMessage(err) })
    }
  },

  loadHistory: async () => {
    try {
      set({ history: (await api.compareHistory()).items })
    } catch { /* not important enough for a message */ }
  },

  openPast: async (id) => {
    try {
      const c = await api.compareGet(id)
      set({ results: c.kind === 'rerun' && c.conversation
        ? { kind: 'rerun', text: c.text, sides: c.sides, conversation: c.conversation, seq: c.seq ?? 0, id: c.id }
        : { kind: 'compare', text: c.text, sides: c.sides, profileIncluded: false, lookFor: c.look_for, id: c.id } })
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't open that comparison", body: errorMessage(err) })
    }
  },

  // (leaves the question you may have typed in the Compare box alone)
  rerun: async (conversation, seq, text, allowAsk = false) => {
    if (get().busy) {
      toast({ kind: 'info', title: 'A comparison is running', body: 'Re-run this message once it has finished, or stop it first.',
        action: { label: 'Go to Compare', run: () => useUi.getState().setScreen('compare') } })
      return
    }
    useUi.getState().setScreen('compare')
    // What was on screen stays (dimmed) until the new results arrive, or if the re-run fails
    set({ busy: 'rerun', busyText: `Re-running “${text}” with your current settings…`, startedAt: Date.now(), progress: null, repeatRunning: 1 })
    try {
      const r = await api.rerun(conversation, seq, allowAsk)
      set({ results: { kind: 'rerun', text: r.text, sides: [r.baseline, r.rerun], conversation, seq, id: r.id } })
      useServer.getState().loadConversations() // the new run was saved as a conversation
      void get().loadHistory() // and the re-run with the comparisons
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't re-run it", body: errorMessage(err) })
    } finally {
      set({ busy: null, startedAt: null })
    }
  },
}))
