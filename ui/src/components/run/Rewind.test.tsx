import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { HarnessEvent, RewindPreview } from '../../api/types'
import { api, ApiError } from '../../api/client'
import { deriveRuns } from '../../model/derive'
import { CONCEPTS, TEACHING_ORDER } from '../../learn/concepts'
import { findExperiment } from '../../learn/experiments'
import { QUIZ } from '../../learn/quiz'
import { rewoundTitle } from '../../store/selectors'
import { useSession } from '../../store/session'
import { useServer } from '../../store/server'
import { usePrefs, useUi } from '../../store/ui'
import { Composer } from '../composer/Composer'
import { RewindDialog } from './RewindDialog'
import { Timeline } from './Timeline'
import toolTurn from '../../test/fixtures/tool_turn.json'

const model = () => deriveRuns(toolTurn as HarnessEvent[])
const run = () => model().runs[0]
const preview: RewindPreview = {
  seq: 0, message: 1, text: run().text, messages: 1,
  files: { restore: ['notes.md'], delete: ['made/by_code.txt'] },
  edited: ['notes.md'], unreadable: [],
  cannot_undo: [{ tool: 'get_weather', why: 'the web request to open-meteo.com was already sent' }],
}
const list = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('listitem').map((li) => li.textContent)

beforeEach(() => {
  usePrefs.setState({ explained: [], learningMode: false })
  useUi.setState({ toasts: [], composerText: '' })
  useSession.setState({ rewindable: [], running: false })
  vi.spyOn(useServer.getState(), 'loadConversations').mockResolvedValue(undefined as never)
})
afterEach(() => vi.restoreAllMocks())

describe('Rewind to here', () => {
  it('shows only on messages that have a checkpoint, and passes the message on', () => {
    const onRewind = vi.fn()
    const { rerender } = render(<Timeline model={model()} inspectedCallId={null} live="" running={false} onRewind={onRewind} />)
    expect(screen.queryByRole('button', { name: /Rewind to here/ })).toBeNull() // e.g. saved before Rewind existed
    useSession.setState({ rewindable: [run().userSeq] })
    rerender(<Timeline model={model()} inspectedCallId={null} live="" running={false} onRewind={onRewind} />)
    fireEvent.click(screen.getByRole('button', { name: /Rewind to here/ }))
    expect(onRewind).toHaveBeenCalledWith(expect.objectContaining({ userSeq: run().userSeq, text: run().text }))
    // not while a reply runs
    rerender(<Timeline model={model()} inspectedCallId={null} live="" running onRewind={onRewind} />)
    expect(screen.queryByRole('button', { name: /Rewind to here/ })).toBeNull()
  })

  it('the dialog lists what it will do; Rewind puts the message back in the box and says what changed', async () => {
    const ask = vi.spyOn(api, 'rewindPreview').mockResolvedValue(preview)
    const go = vi.spyOn(api, 'rewind').mockResolvedValue({ text: run().text, files: true, restored: 2, deleted: 1 })
    const onClose = vi.fn()
    render(<><Composer /><RewindDialog run={run()} onClose={onClose} /></>)
    expect(await screen.findByRole('list', { name: 'Put back as they were' })).toBeTruthy()
    expect(ask).toHaveBeenCalledWith(0)
    expect(list('Put back as they were')).toEqual(['notes.md'])
    expect(list('Deleted (added since)')).toEqual(['made/by_code.txt'])
    // (true whoever made the change: you, another conversation, Compare or Re-run)
    expect(list('Changed since the last reply, not by this conversation: rewinding overwrites these')).toEqual(['notes.md'])
    expect(list("Can't be undone: it happened outside the workspace")).toEqual(['get_weather: the web request to open-meteo.com was already sent'])
    expect(document.body.textContent).toMatch(/This message and its reply are removed\. Its text goes back in the message box \(if you have typed something there, you are asked first\)\. There\s+is no Undo\./)
    fireEvent.click(screen.getByRole('button', { name: 'Rewind' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(go).toHaveBeenCalledWith(0)
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe(run().text)
    expect(useUi.getState().toasts.map((t) => t.title)).toEqual(['Rewound: 2 files restored, 1 deleted'])
  })

  it('the toast leaves out a count of zero', () => {
    expect(rewoundTitle({ files: true, restored: 1, deleted: 0 })).toBe('Rewound: 1 file restored')
    expect(rewoundTitle({ files: true, restored: 0, deleted: 2 })).toBe('Rewound: 2 files deleted')
    expect(rewoundTitle({ files: true, restored: 0, deleted: 0 })).toBe('Rewound: no files needed changing')
    expect(rewoundTitle({ files: false, restored: 0, deleted: 0 })).toBe("Rewound: the messages only (the files weren't saved before it)")
  })

  it('what you typed in the box stays until you choose to replace it', async () => {
    vi.spyOn(api, 'rewindPreview').mockResolvedValue(preview)
    vi.spyOn(api, 'rewind').mockResolvedValue({ text: run().text, files: true, restored: 1, deleted: 0 })
    const onClose = vi.fn()
    render(<><Composer /><RewindDialog run={run()} onClose={onClose} /></>)
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'my half-written question' } })
    await screen.findByRole('list', { name: 'Put back as they were' })
    fireEvent.click(screen.getByRole('button', { name: 'Rewind' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(box.value).toBe('my half-written question')
    const [t] = useUi.getState().toasts
    expect([t.title, t.body, t.action?.label]).toEqual(['Rewound: 1 file restored',
      'What you typed is still in the message box. Replace it with the rewound message?', 'Replace'])
    act(() => t.action!.run())
    expect(box.value).toBe(run().text)
  })

  it('opening it again never shows the last answer, even for a moment', async () => {
    const ask = vi.spyOn(api, 'rewindPreview').mockResolvedValueOnce(preview).mockReturnValueOnce(new Promise(() => {}))
    const onClose = vi.fn()
    const { rerender } = render(<RewindDialog run={run()} onClose={onClose} />)
    expect(await screen.findByRole('list', { name: 'Put back as they were' })).toBeTruthy()
    rerender(<RewindDialog run={null} onClose={onClose} />)
    rerender(<RewindDialog run={run()} onClose={onClose} />)
    expect(ask).toHaveBeenCalledTimes(2) // asked again, and the answer hasn't come yet
    expect(screen.queryByRole('list', { name: 'Put back as they were' })).toBeNull()
  })

  it('Cancel changes nothing', async () => {
    vi.spyOn(api, 'rewindPreview').mockResolvedValue(preview)
    const go = vi.spyOn(api, 'rewind')
    const onClose = vi.fn()
    render(<RewindDialog run={run()} onClose={onClose} />)
    await screen.findByRole('list', { name: 'Put back as they were' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(go).not.toHaveBeenCalled()
  })

  it('a refusal is shown in words, and Rewind stays off', async () => {
    vi.spyOn(api, 'rewindPreview').mockRejectedValue(new ApiError(409, 'This message has no checkpoint (a saved copy of the files before it), so it can\'t be rewound.'))
    render(<RewindDialog run={run()} onClose={() => {}} />)
    expect(await screen.findByText(/has no checkpoint/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Rewind' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a workspace too big to keep: only the conversation goes back', async () => {
    vi.spyOn(api, 'rewindPreview').mockResolvedValue({ ...preview, files: null, edited: [], cannot_undo: [], messages: 3 })
    render(<RewindDialog run={run()} onClose={() => {}} />)
    expect(await screen.findByText(/the workspace was over 5,000 files or 50 MB/)).toBeTruthy()
    expect(document.body.textContent).toMatch(/This message and the 2 messages after it are removed/)
    expect(screen.queryByRole('list', { name: 'Put back as they were' })).toBeNull()
  })
})

describe('the lesson', () => {
  it('a glossary entry in the teaching order, an experiment and a quiz question', () => {
    expect(CONCEPTS.checkpoints.plain).toBe('a saved copy of the files before each message, so it can be undone')
    expect(TEACHING_ORDER).toContain('checkpoints')
    const x = findExperiment('rewind')!
    expect([x.title, x.tier, x.concept, x.predict]).toEqual(['Take it back', 'Control and safety', 'checkpoints', undefined])
    expect(x.message).toBe("Add the line 'Rewind test' to the end of notes.md, then read it back.")
    expect(x.lookAt).toMatch(/the dialog lists notes\.md/)
    const q = QUIZ.find((y) => y.id === 'rewind')!
    expect(q.after).toBe(x.title)
    expect(q.q).toBe('Rewind removed the messages. What else must a harness undo?')
    expect(q.options[q.answer]).toBe('The changes the tools made')
  })
})
