// Typed calls to the Python server. Every POST sends JSON: the server refuses anything else
// (a browser won't send JSON across sites without asking first, which keeps other pages out).
import type {
  CompareResult, CompareStatus, EvalQuestion, Conversations, PastComparison, SavedComparison, EvalResult, EvalRun, EvalStatus, Fact, Info, Profile, RerunResult, SavedConversation, Settings, SettingsChange, Snapshot,
  RewindPreview, RewindResult,
} from './types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

// What to say when the server gives no words of its own
function plainStatus(status: number): string {
  if (status === 404) return "The server doesn't know that address. Is the page older than the server? Reload it."
  if (status >= 500) return 'The server hit an error. Look at the terminal window running start.bat.'
  return `The server refused the request (${status}).`
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, method === 'POST'
      ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }
      : { method })
  } catch {
    throw new ApiError(0, "Can't reach the server. Is start.bat still running?")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? plainStatus(res.status))
  return data as T
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body)

export const api = {
  info: () => get<Info>('/info'),
  events: (since: number) => get<Snapshot>(`/events?since=${since}`),
  profile: () => get<Profile>('/profile'),
  settings: () => get<Settings>('/settings'),
  conversations: () => get<Conversations>('/conversations'),
  conversation: (id: string) => get<SavedConversation>(`/conversations/get?id=${encodeURIComponent(id)}`),

  chat: (text: string) => post<{ ok: boolean }>('/chat', { text }),
  stop: () => post<{ ok: boolean }>('/stop'),
  approve: (id: string, allowed: boolean, always = false) => post<{ ok: boolean }>('/approve', { id, allowed, always }),
  switchProvider: (name: string, model?: string) => post<{ mode: string; model: string }>('/provider', { name, model }),
  newConversation: () => post<{ ok: boolean }>('/reset'),
  saveProfile: (facts: Fact[]) => post<Profile>('/profile', { facts }),
  saveSettings: (change: SettingsChange) => post<Settings>('/settings', change),
  resetSettings: () => post<Settings>('/settings/reset'),
  openConversation: (id: string) => post<Conversations>('/conversations/open', { id }),
  deleteConversation: (id: string) => post<Conversations>('/conversations/delete', { id }),
  restoreConversation: (id: string) => post<Conversations>('/conversations/restore', { id }),
  compare: (body: unknown) => post<CompareResult>('/compare', body),
  compareStatus: () => get<CompareStatus>('/compare/status'),
  compareStop: () => post<{ ok: boolean }>('/compare/stop'),
  compareHistory: () => get<{ items: PastComparison[] }>('/compare/history'),
  compareGet: (id: string) => get<SavedComparison>(`/compare/get?id=${encodeURIComponent(id)}`),
  startEvals: (body: { provider: string; model?: string; repeat: number; use_my_settings: boolean; judge: boolean; only?: string }) =>
    post<{ ok: boolean; total: number }>('/evals', body),
  evalsStatus: () => get<EvalStatus>('/evals/status'),
  evalCases: (only = '') => get<{ cases: EvalQuestion[] }>(`/evals/cases?only=${encodeURIComponent(only)}`),
  evalsStop: () => post<{ ok: boolean }>('/evals/stop'),
  evalsHistory: () => get<{ runs: EvalRun[] }>('/evals/history'),
  evalRun: (id: string) => get<EvalResult>(`/evals/get?id=${encodeURIComponent(id)}`),
  rerun: (conversation_id: string, message_seq: number, allow_ask = false) =>
    post<RerunResult>('/rerun', { conversation_id, message_seq, allow_ask, include_profile: true }), // current settings include the facts
  rewindPreview: (seq: number) => post<RewindPreview>('/rewind/preview', { seq }),
  rewind: (seq: number) => post<RewindResult>('/rewind', { seq }),
}
