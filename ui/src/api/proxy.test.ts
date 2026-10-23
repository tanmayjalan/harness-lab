// `npm run dev` passes only the listed addresses on to the Python server: every address the page asks for
// must be on that list, or that feature fails in development only (as /local-server and /rewind did)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('the development server', () => {
  it('passes on every address the page asks the server for', () => {
    const list = read('../../vite.config.ts').match(/const api = \[([^\]]*)\]/)
    expect(list).not.toBeNull()
    const proxied = [...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    const used = [...read('./client.ts').matchAll(/['`](\/[a-z][a-z\-/]*)/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(20)
    // Vite matches by the start of the address, so '/rewind' also passes on '/rewind/preview'
    const missing = used.filter((path) => !proxied.some((p) => path === p || path.startsWith(`${p}/`)))
    expect(missing).toEqual([])
  })
})
