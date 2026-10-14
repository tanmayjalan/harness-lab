// Small formatters shared by every view

export const count = (n: number) => Math.round(n).toLocaleString('en-US')

export function tokens(n: number) {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function dollars(n: number) {
  if (n === 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export const plural = (n: number, word: string, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`

// A clock reading for a running job: 2:23
export const minutes = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
// Time so far, the one way every running state writes it: "42s" under a minute, then "1:15"
export const elapsed = (s: number) => (s < 60 ? `${Math.floor(Math.max(0, s))}s` : minutes(s))
// A rough length of time, for an estimate: "under a minute", "about 3 minutes"
export const roughly = (s: number) => (s < 60 ? 'under a minute' : `about ${plural(Math.round(s / 60), 'minute')}`)

export function seconds(s: number | undefined) {
  if (s == null) return ''
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`
}

// get_weather(city: "Paris") as a short one-liner for a tool row
export function shortArgs(input: Record<string, unknown>, max = 60) {
  const parts = Object.entries(input ?? {}).map(([k, v]) => {
    const s = typeof v === 'string' ? JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v) : JSON.stringify(v)
    return `${k}: ${s && s.length > 40 ? `${s.slice(0, 40)}…` : s}`
  })
  const out = parts.join(', ')
  return out.length > max ? `${out.slice(0, max)}…` : out
}

export const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

export function timeAgo(when: number, now = Date.now() / 1000) {
  const s = Math.max(0, now - when)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = new Date(when * 1000)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export const clock = (when: number) =>
  new Date(when * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

// The one mark for a figure the provider didn't report but the mock guessed (about 4 characters a token)
export const ESTIMATE_TITLE = 'The mock guesses: about 4 characters per token'
export const approx = (value: string, estimated: boolean | undefined) => (estimated ? `≈ ${value}` : value)
