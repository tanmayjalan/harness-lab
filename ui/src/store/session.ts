// The live conversation: the events the server has sent so far, and what they add up to.
import { create } from 'zustand'
import type { HarnessEvent, Origin, Snapshot } from '../api/types'
import { deriveRuns, type RunModel } from '../model/derive'

export type Connection = 'connecting' | 'ok' | 'lost'

type SessionState = {
  gen: number | null
  events: HarnessEvent[]
  since: number
  running: boolean
  live: string
  conversation: string
  provider: string | null
  model: string
  connection: Connection
  loaded: boolean // the first full fetch has arrived (until then, show placeholders)
  frozen: boolean // the conversation keeps the prompt and tools it began with
  origin: Origin | null // a side of a comparison (or a re-run's new run), opened as a conversation
  rewindable: number[] // the seq of each of your messages that has a checkpoint (Rewind to here)
  derived: RunModel
  // full: the snapshot holds every event (after lost contact), so replace rather than add
  ingest: (snap: Snapshot, full?: boolean) => { newConversation: boolean; finished: boolean }
  setConnection: (c: Connection) => void
}

const empty = () => deriveRuns([])
const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])

export const useSession = create<SessionState>((set, get) => ({
  gen: null,
  events: [],
  since: 0,
  running: false,
  live: '',
  conversation: '',
  provider: null,
  model: '',
  connection: 'connecting',
  loaded: false,
  frozen: false,
  origin: null,
  rewindable: [],
  derived: empty(),

  ingest: (snap, full = false) => {
    const s = get()
    // A different gen means a new or reopened conversation, and a different conversation id at the
    // same gen means the server restarted (it starts again at gen 0): start over from the first event
    if ((s.gen !== null && snap.gen !== s.gen) || (s.conversation && snap.conversation !== s.conversation)) {
      set({ gen: snap.gen, events: [], since: 0, derived: empty(), live: '', running: snap.running, conversation: snap.conversation, rewindable: [] })
      return { newConversation: true, finished: false }
    }
    const fresh = full ? snap.events : snap.events.filter((e) => e.seq >= s.since)
    const events = full ? snap.events : fresh.length ? [...s.events, ...fresh] : s.events
    set({
      gen: snap.gen,
      events,
      since: fresh.length ? fresh[fresh.length - 1].seq + 1 : s.since,
      running: snap.running,
      live: snap.running ? snap.live ?? '' : '',
      conversation: snap.conversation,
      provider: snap.provider ?? s.provider,
      model: snap.model ?? s.model,
      loaded: true,
      frozen: !!snap.frozen,
      origin: snap.origin ?? null,
      rewindable: sameList(s.rewindable, snap.rewindable ?? []) ? s.rewindable : snap.rewindable ?? [], // (no redraw per poll)
      derived: full || fresh.length ? deriveRuns(events) : s.derived,
    })
    return { newConversation: false, finished: !full && fresh.some((e) => e.kind === 'done') }
  },

  // Lost contact: nothing can be known about the reply in progress, so stop showing it as live
  // and drop a waiting approval (it can't be answered); both come back when contact returns
  setConnection: (connection) => set((s) => (connection === 'lost'
    ? { connection, running: false, live: '', derived: { ...s.derived, pendingApproval: null, status: 'idle' } }
    : { connection })),
}))
