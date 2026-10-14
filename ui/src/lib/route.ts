// The address bar mirrors the screen and the conversation: #chat/<id>, #compare, #evals.
import type { Screen } from '../store/ui'

export function parseHash(hash: string): { screen: Screen; conversation?: string } {
  const [head, id] = hash.replace(/^#/, '').split('/')
  if (head === 'compare' || head === 'evals') return { screen: head }
  return id ? { screen: 'run', conversation: id } : { screen: 'run' }
}

// R9: only these forms name a place in the page (empty, #chat, #chat/<id>, #compare, #evals). Any other fragment
// (an in-page link such as #quiz) is not a route: Back and Forward over it change nothing
export function isRoute(hash: string) {
  return /^#?$|^#chat(\/[^/]+)?$|^#(compare|evals)$/.test(hash)
}

export function toHash(screen: Screen, conversation: string | null) {
  return screen === 'run' ? (conversation ? `#chat/${conversation}` : '#chat') : `#${screen}`
}
