// The Evals screen: the setup to score, the run in progress, and past runs for the chart.
import { create } from 'zustand'
import { api } from '../api/client'
import type { EvalQuestion, EvalResult, EvalRun, EvalStatus } from '../api/types'
import { errorMessage } from './selectors'
import { toast } from './ui'

type EvalsState = {
  provider: string
  model: string
  repeat: number
  useMySettings: boolean
  judge: boolean
  only: string
  status: EvalStatus
  history: EvalRun[]
  viewing: EvalResult | null // the run shown in the table (the latest, or one picked on the chart)
  cases: EvalQuestion[] | null // the questions a run would ask, with the current filter (null: couldn't read them)
  casesFailed: boolean // the question list couldn't be read (as against: not read yet)
  // the results heading takes focus once: a round you were watching has just finished, or you came back
  // to a round from one of its conversations ("Back to Evals", whose button is gone once Evals shows)
  focusResults: boolean
  set: (s: Partial<Pick<EvalsState, 'provider' | 'model' | 'repeat' | 'useMySettings' | 'judge' | 'only'>>) => void
  loadCases: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  refresh: () => Promise<void>
  view: (id: string) => Promise<void>
}

let timer: ReturnType<typeof setTimeout> | null = null
let casesAsked = 0 // counts question-list requests, so only the newest answer is used
let refreshAsked = 0 // the same for status checks, so only the newest one goes on asking

export const useEvals = create<EvalsState>((set, get) => ({
  provider: 'mock',
  model: '',
  repeat: 1,
  useMySettings: true,
  judge: true,
  only: '',
  status: { running: false },
  history: [],
  viewing: null,
  cases: null, // not read yet
  casesFailed: false,
  focusResults: false,
  set: (s) => {
    set(s)
    if (s.only !== undefined) void get().loadCases()
  },

  loadCases: async () => {
    const mine = ++casesAsked
    try {
      const cases = (await api.evalCases(get().only.trim())).cases
      if (mine === casesAsked) set({ cases, casesFailed: false }) // a slower, older answer doesn't overwrite a newer one
    } catch {
      // the page says it couldn't read them; Run still works (the server checks). An older failure doesn't count
      if (mine === casesAsked) set({ cases: null, casesFailed: true })
    }
  },

  stop: async () => {
    try {
      await api.evalsStop()
      toast({ kind: 'info', title: 'Stopping the evals', body: 'Questions already running finish; the rest are skipped. What finished is kept.' })
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't stop the evals", body: errorMessage(err) })
    }
  },

  start: async () => {
    const { provider, model, repeat, useMySettings, judge, only } = get()
    try {
      await api.startEvals({ provider, ...(model ? { model } : {}), repeat, use_my_settings: useMySettings, judge,
        ...(only.trim() ? { only: only.trim() } : {}) })
      set({ status: { running: true, done: 0 } })
      void get().refresh()
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't start the evals", body: errorMessage(err) })
    }
  },

  // Ask how it's going every second while it runs; then load the result and the history
  // Only the newest call carries on: clearing the timer can't stop a request already out, so an older
  // one that returns later drops its answer instead of starting a second loop
  refresh: async () => {
    if (timer) clearTimeout(timer)
    timer = null
    const mine = ++refreshAsked
    try {
      const wasRunning = get().status.running
      const status = await api.evalsStatus()
      if (mine !== refreshAsked) return
      set({ status })
      if (status.running) {
        timer = setTimeout(() => void get().refresh(), 1000)
        return
      }
      // The latest round is shown when it has just finished or nothing is shown yet: never over one you picked
      if (status.result && (wasRunning || !get().viewing)) set({ viewing: status.result, ...(wasRunning ? { focusResults: true } : {}) })
      const runs = (await api.evalsHistory()).runs
      if (mine === refreshAsked) set({ history: runs })
    } catch {
      // the server may be restarting: ask again shortly (the connection banner says if it's down)
      if (mine === refreshAsked) timer = setTimeout(() => void get().refresh(), 2000)
    }
  },

  view: async (id) => {
    try {
      set({ viewing: await api.evalRun(id) })
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't open that run", body: errorMessage(err) })
    }
  },
}))
