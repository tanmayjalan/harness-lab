// Wording the UX review retired (F106 to F231): it must not come back. Reads every page source
// file except tests, so a stray old label fails here.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONCEPTS } from '../learn/concepts'
import { findExperiment } from '../learn/experiments'
import { approx } from './format'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path) ? [readFileSync(path, 'utf-8')] : []
  })
}
const code = sources(join(__dirname, '..')).join('\n')

const RETIRED: [RegExp, string][] = [
  [/Put it back/, 'F108: the action is "Undo" everywhere'],
  [/\(turn limit\)/, 'F106: it is a limit on calls'],
  [/title="About you"/, 'F216: the section is "Memory: facts about you"'],
  [/Default description/, 'F217: per-item resets read "Back to the default"'],
  [/>use the default</, 'F217'],
  [/clear_tool_uses/, 'F218: no unexplained API names in the Anthropic trimming note'],
  [/\(est\.\)/, 'F219: one estimate mark, ≈'],
  [/didn't run"/, 'F226: failures read "Couldn\'t …"'],
  [/didn't start"/, 'F226'],
  [/Rename a tool's job/, 'F227: the experiment changes a description, not a name'],
  [/Shows <b/, 'F228: cards say "Idea:"'],
  [/What is \$\{c\.term\}\?/, 'F229: "What does … mean?"'],
  [/\} chars`/, 'F230: "characters", not "chars"'],
  [/ chars\)<\/span>/, 'F230'],
  [/Keep every explanation open/, 'F223: one Learning-mode sentence'],
  [/'Switch provider'/, 'F221: it switches the model too'],
  [/\['run', 'Run'\]/, 'F107: the screen is "Chat"'],
  [/\{' '\}ID <code/, 'F231: lowercase id, one phrase'],
  [/>trim on</, 'F092 (final review M10): "trimming on" like the other tags'],
]

describe('retired wording', () => {
  for (const [pattern, why] of RETIRED) {
    it(`no ${pattern}`, () => expect(pattern.test(code), why).toBe(false))
  }
})

describe('new wording', () => {
  it('F222: summarising names its industry term', () => {
    expect(CONCEPTS.summarising.term).toBe('summarising (compaction)')
  })
  it('F106: the limit is named for calls', () => {
    expect(CONCEPTS.max_turns.term).toBe('call limit (max_turns)')
  })
  it('F227: the experiment says what it changes', () => {
    expect(findExperiment('rename')!.title).toBe('Change what a tool says it does')
  })
  it('F219: one mark for an estimate', () => {
    expect(approx('1.2k', true)).toBe('≈ 1.2k')
    expect(approx('1.2k', false)).toBe('1.2k')
  })
})
