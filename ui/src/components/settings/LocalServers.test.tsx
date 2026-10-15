// Settings → Model with models on your own server (Ollama, LM Studio, another): which can be picked, why not,
// the address field, and where your messages go
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import { api } from '../../api/client'
import type { ProviderInfo, Settings } from '../../api/types'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { ModelSection } from './ModelSection'
import { localDestination, localNote, modelsOf, toolsTag, unusable } from '../composer/providerWords'

const ollama: ProviderInfo = {
  name: 'ollama', label: 'Ollama', model: 'qwen3:4b', models: ['qwen3:4b', 'gemma3:1b'], missing_key: null, price: null,
  local: true, address: 'http://127.0.0.1:11434', this_computer: true, problem: null, no_tools: ['gemma3:1b'],
}
const lmstudio: ProviderInfo = {
  name: 'lmstudio', label: 'LM Studio', model: null, models: [], missing_key: null, price: null, local: true,
  address: 'http://127.0.0.1:1234', this_computer: true, no_tools: [],
  problem: 'Nothing answered at http://127.0.0.1:1234. In LM Studio, open the Developer tab and start the server.',
}
const custom: ProviderInfo = {
  name: 'custom', label: 'Other server', model: 'llama3', models: ['llama3'], missing_key: null, price: null, local: true,
  address: 'http://192.168.1.20:8080', this_computer: false, problem: null, no_tools: [],
}
const info = {
  provider: 'mock', model: 'claude-opus-5-5', mode: 'mock', folder: 'ws', max_turns: 20, tools: [],
  providers: [
    { name: 'mock', label: 'Mock', model: 'claude-opus-5-5', models: ['claude-opus-5-5'], missing_key: null, price: null },
    ollama, lmstudio, custom,
  ],
}
const baseSettings = {
  system: 'S', system_default: 'S', changed: [], file: 'data/lab_settings.json', mcp_problems: [],
  hooks: { file: '', functions: [], problem: null },
  trim: { enabled: false, keep_last: 2 }, compact: { enabled: false, over_chars: 40000 },
  thinking: { enabled: false, budget: 4000, effort: 'medium' }, cache: { enabled: false }, apply: 'message',
  limits: { max_tokens: 16000, max_turns: 20 }, tools: [],
} as unknown as Settings
const wrap = (ui: React.ReactNode) => render(<RTooltip.Provider>{ui}</RTooltip.Provider>)

describe('words for local servers', () => {
  it('a server that is not ready says why, and lists its name once', () => {
    expect(unusable(lmstudio)).toMatch(/start the server/)
    expect(unusable(ollama)).toBeNull()
    expect(unusable({ missing_key: 'DEEPSEEK_API_KEY', problem: null })).toMatch(/Needs DEEPSEEK_API_KEY/)
    expect(modelsOf(lmstudio)).toEqual(['no model yet'])
    expect(modelsOf(ollama)).toEqual(['qwen3:4b', 'gemma3:1b'])
  })

  it('marks models that cannot use tools, and says where messages go', () => {
    expect(toolsTag(ollama, 'gemma3:1b')).toBe(' (no tools)')
    expect(toolsTag(ollama, 'qwen3:4b')).toBe('')
    expect(localDestination(ollama)).toBe('Stays on this computer')
    expect(localDestination(custom)).toBe('Sent to 192.168.1.20:8080')
    expect(localNote(ollama)).toMatch(/nothing you send leaves it/)
    expect(localNote(custom)).toMatch(/your messages go to 192\.168\.1\.20:8080, not just this computer/)
  })
})

describe('Settings → Model → Models on your own server', () => {
  beforeEach(() => {
    useServer.setState({ info: info as never, settings: baseSettings })
    useSession.setState({ provider: 'mock', model: 'claude-opus-5-5', running: false })
    vi.spyOn(api, 'info').mockResolvedValue(info as never)
  })
  afterEach(() => vi.restoreAllMocks())

  it('asks the servers again on opening', () => {
    wrap(<ModelSection />)
    expect(api.info).toHaveBeenCalled()
  })

  it('a running server can be picked; one that is not ready cannot, and says why', () => {
    wrap(<ModelSection />)
    const providers = screen.getByRole('group', { name: 'Provider' })
    expect(within(providers).getByRole('button', { name: 'Ollama' })).toBeEnabled()
    expect(within(providers).getByRole('button', { name: 'LM Studio' })).toBeDisabled()
    expect(document.body.textContent).toMatch(/LM Studio: not\s+ready yet/)
    expect(document.body.textContent).toMatch(/open the Developer tab and start the server/)
  })

  it('lists each server\'s models, marks those that cannot use tools, and warns about another computer', () => {
    wrap(<ModelSection />)
    expect(document.body.textContent).toMatch(/2 models: qwen3:4b, gemma3:1b \(no tools\)\./)
    expect(document.body.textContent).toMatch(/Your messages go to http:\/\/192\.168\.1\.20:8080, not just this computer/)
  })

  it('a chosen local server shows it is free, and its models', () => {
    useSession.setState({ provider: 'ollama', model: 'qwen3:4b' })
    wrap(<ModelSection />)
    const models = screen.getByRole('group', { name: 'Model' })
    expect(within(models).getByRole('button', { name: 'gemma3:1b (no tools)' })).toBeInTheDocument()
    expect(document.body.textContent).toMatch(/Free: runs on your computer/)
  })

  it('saves an address, then asks again', async () => {
    const save = vi.spyOn(api, 'localServer').mockResolvedValue({ ...custom, models: ['llama3', 'mistral'] })
    wrap(<ModelSection />)
    const field = screen.getByLabelText('Other server')
    const button = within(field.parentElement!).getByRole('button', { name: 'Save address' })
    expect(button).toBeDisabled() // nothing changed yet
    fireEvent.change(field, { target: { value: '10.0.0.5:11434' } })
    fireEvent.click(button)
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('custom', '10.0.0.5:11434'))
  })

  it('Check again asks every server afresh', async () => {
    const check = vi.spyOn(api, 'localServer').mockResolvedValue(ollama)
    wrap(<ModelSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await vi.waitFor(() => expect(check).toHaveBeenCalledWith('ollama'))
  })
})
