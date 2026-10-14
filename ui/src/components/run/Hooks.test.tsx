// Your hooks, as recorded: each hook call (a "hook" event) shows in the tool row and in the
// Inspector, and an older saved conversation says it wasn't recorded instead of guessing.
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent } from '../../api/types'
import { deriveRuns } from '../../model/derive'
import { useSession } from '../../store/session'
import { usePrefs, useUi } from '../../store/ui'
import { Inspector } from '../inspector/Inspector'
import { Timeline } from './Timeline'
import hooked from '../../test/fixtures/hooked.json'
import toolTurn from '../../test/fixtures/tool_turn.json'
import helper from '../../test/fixtures/helper.json'
import helperHooked from '../../test/fixtures/helper_hooked.json'

type Ev = Record<string, unknown>

const show = (events: unknown) => {
  const model = deriveRuns(events as HarnessEvent[])
  render(<RTooltip.Provider><Timeline model={model} inspectedCallId={null} live="" running={false} /></RTooltip.Provider>)
  return model
}
const openRow = (name: string) => {
  const row = screen.getAllByRole('button', { expanded: false }).find((b) => b.textContent?.includes(name))
  fireEvent.click(row!)
}
const text = () => document.body.textContent ?? ''
// The same conversation as it would have been saved before hook calls were recorded
const older = (hooked as Ev[]).filter((e) => e.kind !== 'hook').map((e) => {
  if (e.kind !== 'request') return e
  const { hooks: _, ...rest } = e
  return rest
})

beforeEach(() => {
  useUi.setState({ selectedCallId: null, selectedToolId: null, followLatest: true })
  usePrefs.setState({ explained: [], learningMode: false, inspectorWidth: 520 })
  window.innerWidth = 1280
})

describe('hook calls', () => {
  it('are attached to their tool, in the order they ran', () => {
    const m = deriveRuns(hooked as HarnessEvent[])
    expect(m.tools.k1.hooks?.map((h) => [h.hook, h.verdict])).toEqual([['before_tool', 'allowed'], ['after_tool', 'replaced']])
    expect(m.tools.k1.hooks?.[1].original).toBe('item,amount\ncoffee,18.50\ntrain,64.00\n')
    expect(m.tools.k2.hooks?.map((h) => h.verdict)).toEqual(['allowed', 'kept'])
    expect(m.tools.k3.hooks?.map((h) => [h.verdict, h.error])).toEqual([['failed', 'ZeroDivisionError: division by zero']])
    expect(m.calls[m.callOrder[0]].request.hooks?.functions).toEqual(['before_tool', 'after_tool'])
  })

  it('a helper\'s hook calls go on the helper\'s tool', () => {
    const m = deriveRuns(helperHooked as HarnessEvent[])
    const row = Object.values(m.tools).find((r) => r.helper)!
    expect(row.helper!.tools[0].hooks?.map((x) => [x.hook, x.verdict])).toEqual([['before_tool', 'allowed'], ['after_tool', 'replaced']])
    // the delegate call itself goes through your hooks as well, like any tool
    expect(row.hooks?.map((x) => x.hook)).toEqual(['before_tool', 'after_tool'])
  })

  it('the helper card shows what your hooks did for each of its tools', () => {
    show(helperHooked)
    expect(text()).toMatch(/your hooks: before_tool let it through \((under 1|\d+) ms\) · after_tool rewrote the result/)
  })

  it('a helper whose tools went through no hooks shows no hook line', () => {
    show(helper)
    expect(text()).not.toMatch(/your hooks:/)
  })

  it('a row shows a badge only when a hook did something', () => {
    show(hooked)
    expect(screen.getAllByText('rewritten by your hook')).toHaveLength(1)
    expect(screen.getAllByText('your hook crashed')).toHaveLength(1)
  })

  it('an opened row shows what each hook decided, and both versions of a rewritten result', () => {
    show(hooked)
    openRow('read_file')
    expect(text()).toMatch(/looked at the call and let it through/)
    expect(text()).toMatch(/rewrote the result before the model saw it/)
    expect(screen.getByText('What the tool returned (before your after_tool)')).toBeInTheDocument()
    expect(screen.getByText('What the model got (after your after_tool)')).toBeInTheDocument()
  })

  it('a result left alone says so', () => {
    show(hooked)
    openRow('calculate')
    expect(text()).toMatch(/left it as it was/)
    expect(screen.queryByText('What the tool returned (before your after_tool)')).toBeNull()
  })

  it('a crashed before_tool says the tool never ran, not that it ran and failed', () => {
    show(hooked)
    openRow('roll_dice')
    expect(text()).toMatch(/your before_tool hook crashed, so the harness did not run it/)
    expect(text()).toMatch(/never ran: your before_tool crashed first/)
    expect(text()).not.toMatch(/it ran but failed/)
  })

  it('an older saved conversation says the hooks were not recorded, instead of guessing', () => {
    show(older)
    openRow('calculate')
    expect(screen.getAllByText(/not recorded: this conversation was saved before hook calls were recorded/)).toHaveLength(2)
  })

  it('a call waiting for your answer says after_tool is still to come', () => {
    // calculate (k2) has passed before_tool and is waiting for you: no after_tool, no result yet
    const later = (e: Ev) => (e.kind === 'hook' && e.id === 'k2' && e.hook === 'after_tool')
      || (e.kind === 'tool_result' && (e.result as { tool_use_id: string }).tool_use_id === 'k2')
    const events = (hooked as Ev[]).filter((e) => !later(e))
    const at = events.findIndex((e) => e.kind === 'hook' && e.id === 'k2')
    events.splice(at + 1, 0, { seq: 998, kind: 'approval', time: 1, msg: 1, id: 'a1', prompt: 'Allow?', tool: 'calculate',
      input: {}, path: '', content: '' })
    show(events)
    openRow('calculate')
    expect(text()).toMatch(/runs once the tool has finished/)
  })

  it('a message with no hooks says there was nothing to check', () => {
    show(toolTurn)
    openRow('get_weather')
    expect(text()).toMatch(/no before_tool in your hooks file for this message/)
    expect(text()).toMatch(/no after_tool in your hooks file for this message/)
  })
})

describe('the Inspector', () => {
  const inspect = (events: unknown) => {
    const model = deriveRuns(events as HarnessEvent[])
    useSession.setState({ derived: model, loaded: true })
    useUi.setState({ followLatest: false, selectedCallId: model.callOrder[0] })
    usePrefs.setState({ inspectorTab: 'tools' })
    render(<RTooltip.Provider><Inspector /></RTooltip.Provider>)
  }

  it('lists every hook call of the call in the Tools tab', () => {
    inspect(hooked)
    const region = screen.getByRole('region', { name: 'Your hooks in this call' })
    const card = within(region)
    expect(region.textContent).toMatch(/for this message: before_tool, after_tool\./)
    expect(card.getAllByText('let it through')).toHaveLength(2)
    expect(card.getByText('rewrote the result')).toBeInTheDocument()
    expect(card.getByText('left the result as it was')).toBeInTheDocument()
    expect(card.getByText('crashed')).toBeInTheDocument()
    expect(card.getByText(/ZeroDivisionError/)).toBeInTheDocument()
  })

  it('marks what the hooks did on the loop diagram', () => {
    inspect(hooked)
    expect(screen.getByRole('img', { name: /your hooks: 1 rewrote, 1 crashed/ })).toBeInTheDocument()
  })

  it('an older saved conversation says the hooks were not recorded', () => {
    inspect(older)
    const card = within(screen.getByRole('region', { name: 'Your hooks in this call' }))
    expect(card.getByText(/saved before hook calls were recorded/)).toBeInTheDocument()
  })
})
