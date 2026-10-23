// How a call is named in the Inspector
import type { Call } from '../../model/derive'

// A call named the way the picker names it
export function callName(c: Call) {
  return `message ${c.runIndex} · call ${c.turn}`
}

// Another call, named from where you are: its message only when it's a different one
export function callRef(c: Call, from: Call) {
  return c.runIndex === from.runIndex ? `call ${c.turn}` : `message ${c.runIndex} · call ${c.turn}`
}
