// Keeps the page in step with the server: asks for new events every 200 ms while a reply is
// running (so streamed text appears smoothly), every 500 ms otherwise. If the server stops
// answering it backs off up to 5 s and says so; it picks up again on its own.
import { api } from './client'
import { useSession } from '../store/session'

// onConnected: contact made, at the start or after it was lost (wasLost tells which)
type Hooks = { onNewConversation?: () => void; onFinished?: () => void; onConnected?: (wasLost: boolean) => void }

export class PollClient {
  private timer: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private stopped = false

  constructor(private hooks: Hooks = {}, private fetchEvents = api.events) {}

  start() {
    this.stopped = false
    this.tick()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
  }

  // Ask again now (after sending a message, say) instead of waiting for the next tick
  now() {
    if (this.timer) clearTimeout(this.timer)
    this.tick()
  }

  private async tick() {
    if (this.stopped) return
    const store = useSession.getState()
    let delay: number
    try {
      const wasLost = store.connection === 'lost'
      // After lost contact read everything again: what happened meanwhile (an approval still
      // waiting, a reply that finished) must come back, not only what's new
      const snap = await this.fetchEvents(wasLost ? 0 : store.since)
      if (this.stopped) return
      this.failures = 0
      const connected = store.connection !== 'ok'
      if (connected) store.setConnection('ok')
      const { newConversation, finished } = useSession.getState().ingest(snap, wasLost)
      if (connected) this.hooks.onConnected?.(wasLost)
      if (newConversation) {
        this.hooks.onNewConversation?.()
        delay = 0
      } else {
        if (finished) this.hooks.onFinished?.()
        delay = snap.running ? 200 : 500
      }
    } catch {
      this.failures++
      if (this.failures >= 2) useSession.getState().setConnection('lost')
      delay = Math.min(5000, 500 * 2 ** (this.failures - 1))
    }
    if (!this.stopped) this.timer = setTimeout(() => this.tick(), delay)
  }
}
