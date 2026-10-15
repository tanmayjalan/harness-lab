import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'

afterEach(() => vi.unstubAllGlobals())

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
