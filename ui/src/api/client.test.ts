import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// A server that takes the request but never answers must not freeze the page: reads give up after a while
// (so the polling notices and the "lost" banner shows); sending (a run, a comparison) can take minutes, so it waits
describe('time limits', () => {
  it('a read that gets no answer gives up and says the server cannot be reached', async () => {
    const stop = new AbortController()
    const limit = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(stop.signal)
    vi.stubGlobal('fetch', vi.fn((_path: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')))
    })))
    const asking = api.events(0)
    stop.abort()
    await expect(asking).rejects.toMatchObject({ status: 0 })
    expect(limit).toHaveBeenCalledWith(10_000)
  })

  // /info asks each local server (Ollama, LM Studio) for its models, 1.5 s each and one more per Ollama model
  // the first time: a working server can take longer than 10 s there
  it('the start-up read (/info) waits longer', async () => {
    const limit = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await api.info()
    expect(limit).toHaveBeenCalledWith(60_000)
  })

  // The time limit also covers reading the answer: one cut off halfway is an error, not an empty success
  it('an answer cut off while it is read says the server cannot be reached', async () => {
    const cut = { ok: true, status: 200, json: () => Promise.reject(new DOMException('timed out', 'TimeoutError')) }
    vi.stubGlobal('fetch', vi.fn(async () => cut as unknown as Response))
    await expect(api.events(0)).rejects.toMatchObject({ status: 0 })
  })

  it('sending has no time limit', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await api.compare({})
    expect((fetch.mock.calls[0] as unknown[])[1]).not.toHaveProperty('signal')
  })
})

// F194: no "/chat failed (500)" or "Failed to fetch": say what happened and where to look
describe('error messages from the server', () => {
  it('a server error without its own text points at the terminal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))
    await expect(api.chat('hi')).rejects.toThrow(/The server had an error\. Look at the terminal window running start\.bat/)
  })
  it("the server's own words are kept when it gives them", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'empty message' }), { status: 400 })))
    await expect(api.chat('')).rejects.toThrow('empty message')
  })
  it('no answer at all says the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(api.chat('hi')).rejects.toThrow(/Can't reach the server\. Is start\.bat still running\?/)
  })
})
