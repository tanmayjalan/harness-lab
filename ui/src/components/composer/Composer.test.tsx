import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as RTooltip from '@radix-ui/react-tooltip'
import { useUi } from '../../store/ui'
import { useSession } from '../../store/session'
import { useServer } from '../../store/server'
import { api } from '../../api/client'
import { Composer } from './Composer'

const box = () => screen.getByLabelText('Message') as HTMLTextAreaElement
const composer = () => render(<RTooltip.Provider><Composer /></RTooltip.Provider>)

describe('Composer', () => {
  // F300: a half-typed message survives a visit to another screen
  it('the box starts from the saved draft', () => {
    useUi.setState({ composerText: 'half typed' })
    composer()
    expect(box().value).toBe('half typed')
    useUi.setState({ composerText: '' })
  })

  it('puts a draft in the box once, not again when the box is re-created', () => {
    useUi.getState().fillDraft('Read notes.md')
    const first = composer()
    expect(box().value).toBe('Read notes.md')
    first.unmount() // e.g. a visit to the Evals screen
    useUi.setState({ composerText: '' }) // (it was sent meanwhile)
    composer()
    expect(box().value).toBe('')
  })

  it('a draft made while the box is away still arrives', () => {
    useUi.getState().fillDraft('Read budget.csv')
    composer()
    expect(box().value).toBe('Read budget.csv')
  })

  // F038: while a reply runs, Enter can't send; the hint says so
  it('while a reply is running the hint says Enter works again once it finishes', () => {
    useSession.setState({ running: true })
    composer()
    expect(document.body.textContent).toMatch(/Enter works again once the reply finishes; your message stays in the box/)
    useSession.setState({ running: false })
  })

  // F138: the running total says "tokens", with one mark that it is an estimate
  it('the token total says what it counts, with one estimate mark', () => {
    const d = useSession.getState().derived
    useSession.setState({ derived: { ...d, tokensReported: true, tokensEstimated: true, costKnown: true, cost: 0.0072,
      tokens: { read: 1700, wrote: 12, cached: 0, written: 0 } } })
    composer()
    expect(document.body.textContent).toMatch(/≈ 1\.7k tokens in · 12 or more out · \$0\.0072 or more/) // F380: thinking isn't counted
    expect(document.body.textContent).not.toMatch(/\(estimated\)/)
  })

  // F315: a second Enter while the first send is still in flight must not send twice
  it('a second Enter while the first send is in flight is ignored', async () => {
    const chat = vi.spyOn(api, 'chat').mockImplementation(() => new Promise((r) => setTimeout(() => r({} as never), 50)))
    composer()
    fireEvent.change(box(), { target: { value: 'hello' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 80))
    expect(chat).toHaveBeenCalledTimes(1)
    chat.mockRestore()
  })

  // F316: the provider menu is a set of radio items, so a screen reader says which one is checked
  it('the current model is a checked menuitemradio', async () => {
    useServer.setState({ info: { provider: 'mock', mode: 'mock', model: 'm1', providers: [
      { name: 'mock', label: 'Mock', model: 'm1', models: ['m1', 'm2'], missing_key: null, price: null },
      { name: 'anthropic', label: 'Anthropic', model: 'c1', missing_key: 'ANTHROPIC_API_KEY', price: null },
    ] } as never })
    useSession.setState({ provider: 'mock', model: 'm1', running: false })
    composer()
    await userEvent.setup().click(screen.getByRole('button', { name: /Mock/ }))
    expect(screen.getByRole('menuitemradio', { checked: true })).toHaveTextContent('m1')
    // (anchored: the mock's item also says where its data goes, "Sent to Anthropic, …")
    expect(screen.getByRole('menuitemradio', { name: /^Anthropic/ })).toHaveAttribute('aria-disabled', 'true')
  })

  // F317: the tooltip's words are also in the page for a keyboard or screen reader user
  it('the token total carries its explanation as hidden text', () => {
    const d = useSession.getState().derived
    useSession.setState({ derived: { ...d, tokensReported: true, tokensEstimated: false, costKnown: false,
      tokens: { read: 10, wrote: 2, cached: 0, written: 0 } } })
    composer()
    expect(document.body.querySelector('.sr-only')?.textContent).toMatch(/Tokens read and written in this conversation/)
  })
})

// Third pass, Task 9 (F373): a disabled button rarely shows its title, so the reason is written out
describe('the provider pill while a reply runs (F373)', () => {
  it('says in words why it is greyed out', () => {
    useServer.setState({ info: { provider: 'mock', mode: 'mock', model: 'm1', providers: [
      { name: 'mock', label: 'Mock', model: 'm1', models: ['m1'], missing_key: null, price: null }] } as never })
    useSession.setState({ provider: 'mock', model: 'm1', running: true })
    composer()
    const why = screen.getByText('Switch after the reply finishes')
    expect(why.className).toMatch(/text-2xs/)
    useSession.setState({ running: false })
  })
})

// F386: the provider menu says where your messages go
describe('the provider menu says where data goes', () => {
  it('names Anthropic under your Claude Code login for the mock', async () => {
    useServer.setState({ info: { provider: 'mock', mode: 'mock', model: 'm1', providers: [
      { name: 'mock', label: 'Mock', model: 'm1', models: ['m1'], missing_key: null, price: null },
      { name: 'deepseek', label: 'DeepSeek', model: 'd1', models: ['d1'], missing_key: null, price: null },
    ] } as never })
    useSession.setState({ provider: 'mock', model: 'm1', running: false })
    composer()
    await userEvent.setup().click(screen.getByRole('button', { name: /Mock/ }))
    expect(screen.getByRole('menuitemradio', { name: /Mock/ })).toHaveTextContent('Sent to Anthropic, under your Claude Code login')
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek/ })).toHaveTextContent("Sent to DeepSeek's servers")
  })
})

// F392: a hooks file with a mistake means no hook runs: say so above the message box
describe('a broken hooks file', () => {
  it('shows a warning above the box, with the path from the lab folder on', () => {
    const d = useSession.getState().derived
    useSession.setState({ running: false, derived: { ...d, callOrder: [], calls: {} } })
    useServer.setState({ info: { folder: 'C:/Users/ada/Harness/workspace', providers: [] } as never,
      settings: { hooks: { file: 'C:/Users/ada/Harness/config/my_hooks.py', functions: [], problem: 'SyntaxError: invalid syntax (my_hooks.py, line 3)' } } as never })
    composer()
    expect(document.body.textContent).toMatch(/Your hooks file has a mistake, so no hook is running \(not even the block on secret-looking files\): SyntaxError/)
    expect(screen.getByText('config/my_hooks.py')).toHaveAttribute('title', 'C:/Users/ada/Harness/config/my_hooks.py')
    expect(document.body.textContent).not.toMatch(/Users/)
    useServer.setState({ settings: null, info: null })
  })

  it('says nothing when the hooks file loaded', () => {
    useServer.setState({ settings: { hooks: { file: 'x', functions: ['before_tool'], problem: null } } as never })
    composer()
    expect(document.body.textContent).not.toMatch(/hooks file has a mistake/)
    useServer.setState({ settings: null })
  })
})
