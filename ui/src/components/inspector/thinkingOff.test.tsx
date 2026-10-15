// Thinking turned off out loud (your own server is sent thinking: {type: "disabled"}), and a cut prompt,
// as the Inspector and the chat show them
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns } from '../../model/derive'
import { useSession } from '../../store/session'
import { usePrefs, useUi } from '../../store/ui'
import { Inspector } from './Inspector'
import { RunView } from '../run/RunView'
import toolTurn from '../../test/fixtures/tool_turn.json'

const wrap = (ui: React.ReactNode) => render(<RTooltip.Provider>{ui}</RTooltip.Provider>)
const text = () => document.body.textContent ?? ''

// The saved weather run, with thinking turned off out loud on every call and the first prompt cut
function events(thought: boolean) {
  let firstResponse = true
  return (toolTurn as Array<Record<string, unknown>>).map((e) => {
    if (e.kind === 'request') return { ...e, thinking: { type: 'disabled' } }
    if (e.kind === 'response') {
      const content = thought ? [{ type: 'thinking', thinking: 'Plan: call get_weather.', signature: '' }, ...(e.content as unknown[])] : e.content
      const cut = firstResponse ? { prompt_cut: { read: 2051, sent_about: 12422 } } : {}
      firstResponse = false
      return { ...e, content, ...cut }
    }
    return e
  }) as HarnessEvent[]
}

describe('thinking turned off, and a cut prompt', () => {
  it('the Inspector says thinking was turned off, and when the model thought anyway', () => {
    for (const [thought, words] of [[false, /Thinking: turned off \(thinking: disabled\)/], [true, /Thinking: turned off, but the model thought anyway/]] as const) {
      const model = deriveRuns(events(thought))
      useSession.setState({ derived: model, loaded: true })
      useUi.setState({ followLatest: false, selectedCallId: model.callOrder[0] })
      usePrefs.setState({ inspectorTab: 'summary', explained: [], learningMode: false })
      const view = wrap(<Inspector />)
      expect(text()).toMatch(words)
      view.unmount()
    }
  })

  it('the chat says the server cut the prompt, and what to do', () => {
    useSession.setState({ derived: deriveRuns(events(false)), loaded: true, running: false })
    wrap(<RunView composerRef={{ current: null }} />)
    expect(text()).toMatch(/The server read only 2,051 of about 12,422 tokens/)
    expect(text()).toMatch(/setx OLLAMA_CONTEXT_LENGTH 32768/)
  })
})
