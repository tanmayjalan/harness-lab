// Every idea an experiment promises must be explained by the page where it happens (an
// <Explain concept="..."> or an (i) in some component), not only in the glossary.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONCEPTS } from './concepts'
import { EXPERIMENTS, experimentDone, findExperiment } from './experiments'
import { QUIZ } from './quiz'
import type { HarnessEvent } from '../api/types'
import { deriveRuns } from '../model/derive'
import toolTurn from '../test/fixtures/tool_turn.json'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [readFileSync(path, 'utf-8')] : []
  })
}

// (the story's takeaways name their idea in model/story.ts)
const code = [...sources(join(__dirname, '..', 'components')), readFileSync(join(__dirname, '..', 'model', 'story.ts'), 'utf8')].join('\n')
const shown = (key: string) => new RegExp(`concept(=|:\\s*)["'{]+${key}["'}]`).test(code)

describe('experiments', () => {
  it('each names a real idea that a component explains where it happens', () => {
    for (const x of EXPERIMENTS) {
      expect(CONCEPTS[x.concept], x.id).toBeDefined()
      expect(shown(x.concept), `${x.id}: no component explains "${x.concept}"`).toBe(true)
    }
  })

  it('have unique ids and messages', () => {
    expect(new Set(EXPERIMENTS.map((x) => x.id)).size).toBe(EXPERIMENTS.length)
    // (except "Find a tool first", which sends the same message as "Fifty tools" on purpose, to compare the two)
    const own = EXPERIMENTS.filter((x) => x.id !== 'find_tool')
    expect(new Set(own.map((x) => x.message)).size).toBe(own.length)
    expect(findExperiment('find_tool')!.message).toBe(findExperiment('fifty_tools')!.message)
  })
})

describe('predictions', () => {
  it('read the real outcome from the run, and the options include it', () => {
    const m = deriveRuns(toolTurn as HarnessEvent[])
    const loop = findExperiment('loop')!.predict!
    const run = m.runs[0]
    expect(loop.actual(m, run)).toBe('3')
    expect(loop.options).toContain('3')
    expect(findExperiment('cutoff')!.predict!.actual(m, run)).toBe('It finishes the story')
    expect(findExperiment('injection')!.predict!.actual(m, run)).toBe('Yes, it follows it') // this run called get_weather
    for (const x of EXPERIMENTS.filter((e) => e.predict)) expect(x.predict!.options).toContain(x.predict!.actual(m, run))
  })

  it('quiz answers point at a real option', () => {
    for (const q of QUIZ) expect(q.options[q.answer], q.id).toBeDefined()
    expect(new Set(QUIZ.map((q) => q.id)).size).toBe(QUIZ.length)
  })
})

describe('what experiments rely on', () => {
  // F066: "Watch the loop" must not stop on an approval because a tool was set to Ask first earlier
  it('"Watch the loop" makes sure its tools run without asking', () => {
    expect(findExperiment('loop')!.apply?.permissions).toEqual({ get_weather: 'allow', convert_temperature: 'allow' })
  })
  it('"Ask before acting" makes sure writing asks first', () => {
    expect(findExperiment('approval')!.apply?.permissions).toEqual({ write_file: 'ask' })
  })
  // F058: a card must not give away the answer to the guess it is about to ask for
  it('cards that ask for a guess phrase what they teach as a question', () => {
    for (const x of EXPERIMENTS.filter((e) => e.predict)) expect(x.teaches.trim().endsWith('?'), x.id).toBe(true)
  })
})

// F062: done means it ran to the end and could show what it is about
describe('experimentDone', () => {
  const m = deriveRuns(toolTurn as HarnessEvent[])
  const loop = findExperiment('loop')!
  it('is done when the run was answered', () => {
    expect(experimentDone(loop, m.runs[0], 'mock')).toBe(true)
  })
  it('is not done when the run was stopped or failed', () => {
    expect(experimentDone(loop, { ...m.runs[0], outcome: 'stopped' }, 'mock')).toBe(false)
    expect(experimentDone(loop, { ...m.runs[0], outcome: 'error' }, 'mock')).toBe(false)
  })
  it('is not done on the mock when it needs a real API', () => {
    const cache = findExperiment('cache')!
    expect(experimentDone(cache, m.runs[0], 'mock')).toBe(false)
    expect(experimentDone(cache, m.runs[0], 'anthropic')).toBe(true)
  })
})

// F158: "Try next" can fill the message box when it suggests a message
describe('try next', () => {
  it('a suggested message is quoted in the text, word for word', () => {
    const withMessage = EXPERIMENTS.filter((x) => x.tryMessage)
    expect(withMessage.map((x) => x.id)).toEqual(expect.arrayContaining(['loop', 'errors', 'form']))
    for (const x of withMessage) expect(x.tryNext, x.id).toContain(`"${x.tryMessage}"`)
  })
})
