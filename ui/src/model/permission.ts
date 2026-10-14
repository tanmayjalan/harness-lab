// Plain words for a tool's rule and for what happened when the harness tried to run it.
import type { Rule } from '../api/types'
import type { ToolRow, ToolStatus } from './derive'

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad'

export const RULES: Record<Rule, { label: string; help: string }> = {
  allow: { label: 'Allow', help: 'Runs without asking you.' },
  ask: { label: 'Ask first', help: 'The harness pauses and asks you before running it.' },
  block: { label: 'Block', help: 'Never runs. The model is told it was blocked.' },
}

// resultText: the result sent back, which tells a tool skipped by a cut-off reply from one skipped by a stop
export function statusLabel(status: ToolStatus, resultText?: string): { label: string; tone: Tone } {
  switch (status) {
    case 'running': return { label: 'running', tone: 'accent' }
    case 'awaiting': return { label: 'waiting for you', tone: 'warn' }
    case 'ran': return { label: 'done', tone: 'ok' }
    case 'error': return { label: 'failed', tone: 'bad' }
    case 'declined': return { label: 'you declined', tone: 'bad' }
    case 'blocked': return { label: 'blocked by your settings', tone: 'bad' }
    case 'unattended': return { label: 'not run: nobody to ask', tone: 'warn' }
    case 'hook_blocked': return { label: 'blocked by your hook', tone: 'bad' }
    case 'not_run':
      return resultText?.startsWith('Not run: the reply was cut off')
        ? { label: 'not run: reply cut off', tone: 'neutral' }
        : { label: 'not run: stopped', tone: 'neutral' }
  }
}

// Why the harness treated this call the way it did, in one short phrase
export function ruleBadge(row: Pick<ToolRow, 'permission' | 'outside' | 'status'>): { label: string; tone: Tone; help: string } | null {
  if (row.status === 'hook_blocked') return { label: 'hook', tone: 'bad', help: 'Your hooks file stopped this call before it ran.' }
  // Block stays Block outside the workspace; only Allow turns into Ask first there
  if (row.outside && row.permission !== 'block') {
    return { label: 'outside workspace', tone: 'warn',
      help: 'The path is outside the workspace folder, so the harness asks first, even for a tool set to Allow.' }
  }
  if (!row.permission) return null
  const r = RULES[row.permission]
  return { label: r.label, tone: row.permission === 'allow' ? 'neutral' : row.permission === 'ask' ? 'warn' : 'bad', help: r.help }
}
