import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { Rule } from '../../api/types'
import type { ToolRow } from '../../model/derive'
import { AccessChecks } from './AccessChecks'

const row = (over: Partial<ToolRow>): ToolRow => ({
  id: 't1', callId: 'c1', runIndex: 1, name: 'read_file', input: { path: 'C:/elsewhere/a.txt' }, permission: 'allow',
  outside: false, source: 'built in', status: 'ran', ...over,
})
const checks = (r: ToolRow, setting?: Rule) => {
  const { container } = render(<AccessChecks row={r} setting={setting} loaded={null} />)
  return [...container.querySelectorAll('li')].map((li) => li.textContent ?? '')
}

// F280: only Allow turns into Ask first outside the workspace; Block and Ask first say what really happened
describe('the workspace check', () => {
  it('Allow outside the workspace becomes Ask first', () => {
    expect(checks(row({ outside: true, permission: 'ask', status: 'declined' }), 'allow')[1]).toMatch(/so "Allow" becomes "Ask first"/)
  })

  it('a tool set to Block stays blocked, outside or not', () => {
    const c = checks(row({ outside: true, permission: 'block', status: 'blocked' }), 'block')
    expect(c[1]).toMatch(/outside the workspace folder, but the tool is set to Block anyway/)
    expect(c[1]).not.toMatch(/becomes "Ask first"/)
  })

  it('a tool set to Ask first asks anyway', () => {
    expect(checks(row({ outside: true, permission: 'ask', status: 'declined' }), 'ask')[1]).toMatch(/it's set to Ask first anyway/)
  })
})

// F298: needing an OK nobody could give is its own reason, not "blocked by your settings"
describe('nobody to ask', () => {
  it('says the tool is set to Ask first and nobody could be asked here', () => {
    const c = checks(row({ name: 'write_file', permission: 'ask', status: 'unattended', input: { path: 'out.txt' } }), 'ask')
    expect(c[2]).toMatch(/set to Ask first: nobody can be asked here/)
    expect(c[2]).not.toMatch(/refused\. The model is told it was blocked/)
    expect(c[3]).toMatch(/nobody could be asked/)
    expect(c[4]).toMatch(/didn't run/)
  })
})

// A tool the call didn't offer (run_python with Run code off, say) is refused before any rule: say so
describe('not offered', () => {
  it('says the call did not offer it, not that you stopped the message', () => {
    const content = "Not run: run_python wasn't offered to you on this call, so the harness didn't run it. Use only the tools you were given."
    const result = { content, isError: true, chars: content.length }
    const c = checks(row({ name: 'run_python', input: { code: 'print(1)' }, status: 'not_run', result }), 'allow')
    expect(c[2]).toMatch(/not reached \(it's set to Allow\)/)
    expect(c[4]).toMatch(/this call didn't offer that tool, so the harness refused it \(whatever your rule says\)/)
    expect(c[4]).not.toMatch(/you stopped the message/)
  })
})

// F396: a tool that went online doesn't say it ran "on this computer"; F447: only the tools this call offered
describe('where a tool ran', () => {
  it('get_weather says it sent a request to the internet', () => {
    const c = checks(row({ name: 'get_weather', input: { city: 'Paris' } }), 'allow')
    expect(c[4]).toMatch(/it ran here; it sent a request to the internet \(open-meteo\.com\)/)
    expect(c[4]).not.toMatch(/on this computer/)
  })

  it('run_python and MCP tools may have reached the internet; a file tool ran here', () => {
    expect(checks(row({ name: 'run_python', input: { code: 'print(1)' } }), 'allow')[4]).toMatch(/may have reached the internet/)
    expect(checks(row({ name: 'notes__add', input: {} }), 'allow')[4]).toMatch(/its MCP server\) ran it; it may have reached the internet/)
    expect(checks(row({ input: { path: 'a.txt' } }), 'allow')[4]).toMatch(/it ran here, on this computer\./)
  })

  it('says every tool this call offered goes to the model', () => {
    const { container } = render(<AccessChecks row={row({})} setting="allow" loaded={null} />)
    expect(container.textContent).toMatch(/Every tool this call offered goes to the model \(even blocked\s+ones\)/)
  })
})
