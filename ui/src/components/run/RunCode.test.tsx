import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { HarnessEvent, RunConfig, Settings } from '../../api/types'
import { api } from '../../api/client'
import { configDiff } from '../../model/configDiff'
import { deriveRuns, type Approval, type ToolRow } from '../../model/derive'
import { describeChange, onlyChanges, previousOf } from '../../learn/setup'
import { findExperiment } from '../../learn/experiments'
import { QUIZ } from '../../learn/quiz'
import { PRESETS } from '../../store/compare'
import { useServer } from '../../store/server'
import { usePrefs } from '../../store/ui'
import { ApprovalDock } from '../composer/ApprovalDock'
import { runCodeRule, ToolsSection } from '../settings/ToolsSection'
import { changedIn, sectionOf, settingsAsChange } from '../settings/common'
import { AccessChecks } from './AccessChecks'
import { Timeline } from './Timeline'
import runCode from '../../test/fixtures/run_code.json'
import toolTurn from '../../test/fixtures/tool_turn.json'

const tool = (name: string, permission = 'allow') =>
  ({ name, description: `${name}.`, default_description: `${name}.`, permission, default_permission: permission, input_schema: {}, source: 'built in' })
const settings = {
  system: 'S', system_default: 'S', changed: [], file: 'f', mcp_problems: [], hooks: { file: '', functions: [], problem: null },
  trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
  limits: { max_tokens: 16000, max_turns: 20 }, run_code: { enabled: false },
  tools: [tool('read_file'), tool('run_python', 'ask')],
} as unknown as Settings
const model = () => deriveRuns(runCode as HarnessEvent[])
const rows = () => { const m = model(); return m.callOrder.flatMap((id) => m.calls[id].toolIds.map((t) => m.tools[t])) }

beforeEach(() => {
  usePrefs.setState({ explained: [], learningMode: false })
  useServer.setState({ settings })
})
afterEach(() => vi.restoreAllMocks())

describe('the model runs a script, reads the error and fixes it', () => {
  it('the first run fails with the traceback, the fix is written, the second run works', () => {
    expect(rows().map((r) => [r.name, r.status])).toEqual([['run_python', 'error'], ['write_file', 'ran'], ['run_python', 'ran']])
    const [first, , second] = rows()
    expect(first.result?.isError).toBe(true)
    expect(first.result?.content).toMatch(/ValueError: invalid literal for int\(\) with base 10: '18\.50'/)
    expect(second.result?.content).toMatch(/^Exit code: 0\nOutput:\ntotal/)
  })

  it('the timeline explains running code at the first run, and the output shows in a code block', () => {
    render(<RTooltip.Provider><Timeline model={model()} inspectedCallId={null} live="" running={false} /></RTooltip.Provider>)
    // one full explanation at a time: an earlier one (the loop) is open, so this one waits as a named ⓘ here
    expect(screen.getByRole('button', { name: 'New, not read yet: what does "code execution (run_python)" mean?' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /run_python/ })[0])
    const error = [...document.querySelectorAll('pre.code-block')].find((p) => p.textContent?.includes('Traceback'))
    expect(error).toBeDefined()
  })

  it('the approval shows the code, or the script it would run', () => {
    const code: Approval = { id: 'a1', toolId: 'x1', tool: 'run_python', prompt: 'Allow?', input: { code: "print('hi')\nprint(2 + 2)" },
      path: '', content: '', outside: false }
    const { unmount } = render(<ApprovalDock approval={code} row={{ permission: 'ask' } as ToolRow} />)
    expect(screen.getByText(/run Python code it wrote/)).toBeTruthy()
    expect(document.querySelector('pre.code-block')!.textContent).toBe("print('hi')\nprint(2 + 2)")
    expect(document.body.textContent).toMatch(/code the model writes then runs without asking you/) // what "Always allow" means
    unmount()
    const byPath = rows()[0].approval!
    render(<ApprovalDock approval={byPath} row={rows()[0]} />)
    expect(screen.getByText(/run a Python script/)).toBeTruthy()
    expect(document.querySelector('code')!.textContent).toMatch(/scripts[\\/]totals\.py$/)
  })

  it('a script run by its path goes through the workspace check', () => {
    const row = rows()[0]
    render(<AccessChecks row={row} setting="ask" />)
    expect(document.body.textContent).toMatch(/yes: the path is inside the workspace folder/)
  })
})

describe('the setting', () => {
  it('is a switch in Settings → Tools, and the tool says it is offered only with it on', async () => {
    const save = vi.spyOn(api, 'saveSettings').mockResolvedValue({ ...settings, run_code: { enabled: true } })
    const { unmount } = render(<RTooltip.Provider><ToolsSection settings={settings} /></RTooltip.Provider>)
    expect(document.body.textContent).toMatch(/not a sandbox/)
    expect(document.body.textContent).toMatch(/offered only when Run code is on/)
    fireEvent.click(screen.getByRole('checkbox', { name: /Run code/ }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ run_code: { enabled: true } }))
    unmount()
    render(<RTooltip.Provider><ToolsSection settings={{ ...settings, run_code: { enabled: true } } as Settings} /></RTooltip.Provider>)
    expect(document.body.textContent).not.toMatch(/offered only when Run code is on/)
  })

  // F391: the switch says what run_python's own rule means, and Allow on it is a warning, not the safe green
  it("says what run_python's rule means, and marks Allow on it as a warning", () => {
    const { unmount } = render(<RTooltip.Provider><ToolsSection settings={settings} /></RTooltip.Provider>)
    expect(document.body.textContent).toMatch(/It asks you first, so you can read the code/)
    unmount()
    const allowed = { ...settings, run_code: { enabled: true }, tools: [tool('read_file'), tool('run_python', 'allow')] } as Settings
    render(<RTooltip.Provider><ToolsSection settings={allowed} /></RTooltip.Provider>)
    expect(document.body.textContent).toMatch(/run_python is set to Allow: code the model writes runs without asking you/)
    expect(document.body.textContent).not.toMatch(/It asks you first/)
    expect(document.body.textContent).toMatch(/Code the model writes runs as you, without you seeing it first/)
    const on = screen.getByRole('group', { name: 'Permission for run_python' }).querySelector('[aria-pressed="true"]')!
    expect(on.textContent).toBe('Allow')
    expect(on.className).toMatch(/text-warn/)
    expect(on.className).not.toMatch(/text-ok/)
    expect(runCodeRule({ tools: [tool('run_python', 'block')] } as unknown as Settings)).toMatch(/set to Block/)
  })

  it('counts under Tools, comes back after Reset all, and an experiment can set and undo it', () => {
    const on = { ...settings, run_code: { enabled: true } } as Settings
    expect(changedIn(on).tools).toBe(1)
    expect(settingsAsChange(on).run_code).toEqual({ enabled: true })
    expect(sectionOf('run code on')).toBe('tools')
    const change = { run_code: { enabled: true } }
    expect(previousOf(change, settings)).toEqual({ run_code: { enabled: false } })
    expect(onlyChanges(change, on)).toBeNull()
    expect(describeChange(change, settings)).toEqual(['run code on'])
  })

  it('a comparison shows it, and there is a ready-made one', () => {
    const a = { provider: 'mock' } as RunConfig
    const b = { provider: 'mock', run_code: { enabled: true } } as RunConfig
    expect(configDiff(a, b).find((d) => d.what === 'Run code (run_python)')).toEqual({ what: 'Run code (run_python)', a: 'off', b: 'on' })
    const preset = PRESETS.find((p) => p.id === 'run_code')!
    expect(preset.title).toBe('Calculator vs running code')
    expect(preset.sides.map((s) => s.runCode)).toEqual([false, true])
    // it never tells you to let code run unseen without saying so
    expect(preset.lookFor).toMatch(/runs the code the model writes without showing it to you first/)
    expect(preset.lookFor).toMatch(/open side B afterwards to read what ran/)
  })
})

describe('the lesson', () => {
  it('an experiment turns it on and asks how many runs it takes', () => {
    const x = findExperiment('run_code')!
    expect([x.tier, x.title]).toEqual(['Bigger jobs', 'Write, run, fix'])
    expect(x.apply).toEqual({ run_code: { enabled: true } })
    const fixed = model()
    expect(x.predict!.actual(fixed, fixed.runs[0])).toBe('2')
    const none = deriveRuns(toolTurn as HarnessEvent[])
    expect(x.predict!.actual(none, none.runs[0])).toBe('1')
  })

  it('the quiz asks what stops a script that never ends', () => {
    const q = QUIZ.find((x) => x.id === 'run_code')!
    expect(q.after).toBe(findExperiment('run_code')!.title)
    expect(q.options[q.answer]).toMatch(/time limit/)
  })
})
