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
  private asking = false // a request is out: only one at a time, or a second loop would start
  private askAgain = false // asked for while one was out: ask again as soon as it returns

  constructor(private hooks: Hooks = {}, private fetchEvents = api.events) {}

  start() {
    this.stopped = false
    this.now()
  }

  stop() {
    this.stopped = true
    this.askAgain = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  // Ask again now (after sending a message, say) instead of waiting for the next tick
  now() {
    if (this.asking) {
      this.askAgain = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    void this.tick()
  }

  private async tick() {
    if (this.stopped) return
    this.timer = null
    this.asking = true
    let delay: number
    try {
      const wasLost = useSession.getState().connection === 'lost'
      // After lost contact read everything again: what happened meanwhile (an approval still
      // waiting, a reply that finished) must come back, not only what's new
      const snap = await this.fetchEvents(wasLost ? 0 : useSession.getState().since)
      if (this.stopped) return
      this.failures = 0
      const store = useSession.getState() // read after the wait: it may have changed meanwhile
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
    } finally {
      this.asking = false
    }
    if (this.askAgain) {
      this.askAgain = false
      delay = 0
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), delay)
  }
}
