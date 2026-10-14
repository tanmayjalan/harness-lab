// What the server knows besides the live conversation: providers, settings, the facts about
// you, and the saved conversations. Loaded on start and refreshed after changes.
import { create } from 'zustand'
import { api } from '../api/client'
import type { Conversations, Info, Profile, Settings } from '../api/types'
import { toast } from './ui'

type ServerState = {
  info: Info | null
  settings: Settings | null
  profile: Profile | null
  conversations: Conversations | null
  loadInfo: () => Promise<void>
  loadSettings: () => Promise<void>
  loadProfile: () => Promise<void>
  loadConversations: () => Promise<void>
  loadAll: () => Promise<void>
  setSettings: (s: Settings) => void
  setProfile: (p: Profile) => void
  setConversations: (c: Conversations) => void
}

const quietly = async <T,>(what: string, f: () => Promise<T>) => {
  try {
    return await f()
  } catch (err) {
    toast({ kind: 'error', title: `Couldn't load ${what}`, body: String((err as Error).message ?? err) })
    return null
  }
}

export const useServer = create<ServerState>((set, get) => ({
  info: null,
  settings: null,
  profile: null,
  conversations: null,
  loadInfo: async () => {
    const info = await quietly('the lab info', api.info)
    if (info) set({ info })
  },
  loadSettings: async () => {
    const settings = await quietly('settings', api.settings)
    if (settings) set({ settings })
  },
  loadProfile: async () => {
    const profile = await quietly('the facts about you', api.profile)
    if (profile) set({ profile })
  },
  loadConversations: async () => {
    const conversations = await quietly('conversations', api.conversations)
    if (conversations) set({ conversations })
  },
  loadAll: async () => {
    const s = get()
    await Promise.all([s.loadInfo(), s.loadSettings(), s.loadProfile(), s.loadConversations()])
  },
  setSettings: (settings) => set({ settings }),
  setProfile: (profile) => set({ profile }),
  setConversations: (conversations) => set({ conversations }),
}))
