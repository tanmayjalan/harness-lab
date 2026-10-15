// A prompt the server cut to fit its window (Ollama does, with no error): the call says so, in plain words
import { describe, expect, it } from 'vitest'
import type { HarnessEvent } from '../api/types'
import { deriveRuns } from './derive'
import { promptCutWords, storySteps } from './story'
import toolTurn from '../test/fixtures/tool_turn.json'

const events = toolTurn as unknown as HarnessEvent[]

describe('a prompt cut by the server', () => {
  it('is marked on the call and in the story, with what to do', () => {
    // the same saved run, with its first reply saying the server read only part of what was sent
    const first = events.findIndex((e) => e.kind === 'response')
    const cut = events.map((e, i) => (i === first ? { ...e, prompt_cut: { read: 2051, sent_about: 12422 } } : e))
    const m = deriveRuns(cut)
    const calls = m.callOrder.map((id) => m.calls[id])
    expect(calls[0].promptCut).toEqual({ read: 2051, sent_about: 12422 })
    expect(calls.slice(1).every((c) => !c.promptCut)).toBe(true)
    const steps = storySteps(m, m.runs[0])
    expect(steps[0].promptCut).toEqual({ read: 2051, sent_about: 12422 })
    expect(steps[1].promptCut).toBeUndefined()
  })

  it('says how much was read, what may be lost and how to fix it', () => {
    const words = promptCutWords({ read: 2051, sent_about: 12422 })
    expect(words).toMatch(/read only 2,051 of about 12,422 tokens/)
    expect(words).toMatch(/the instructions and the tool list/)
    expect(words).toMatch(/setx OLLAMA_CONTEXT_LENGTH 32768/)
  })

  it('a run without a cut has no mark', () => {
    const m = deriveRuns(events)
    expect(m.callOrder.some((id) => m.calls[id].promptCut)).toBe(false)
  })
})
