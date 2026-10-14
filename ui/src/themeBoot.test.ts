// Final review: a saved Light or Dark is set on <html> by a small script in index.html, before React mounts,
// so the page doesn't show the system's colours first. App.tsx keeps it in step after that.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8')
const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
const boot = scripts.find((m) => !/type="module"/.test(m[1] ?? ''))

// Runs the inline script with a stand-in localStorage holding `stored` under the prefs key
function run(stored: string | null) {
  const localStorage = { getItem: (k: string) => (k === 'harness-lab-prefs' ? stored : null) }
  new Function('localStorage', boot![2])(localStorage)
  return document.documentElement.dataset.theme
}
const prefs = (theme: unknown) => JSON.stringify({ state: { theme, inspectorWidth: 440 }, version: 1 })

describe('the theme is set before the page draws', () => {
  afterEach(() => { delete document.documentElement.dataset.theme })

  it('index.html has an inline script before the module script', () => {
    expect(boot).toBeDefined()
    const module = scripts.findIndex((m) => /type="module"/.test(m[1] ?? ''))
    expect(scripts.indexOf(boot!)).toBeLessThan(module)
  })

  it('a saved Light or Dark is set on <html>', () => {
    expect(run(prefs('light'))).toBe('light')
    delete document.documentElement.dataset.theme
    expect(run(prefs('dark'))).toBe('dark')
  })

  it('System, nothing saved, or a broken value leaves the attribute off', () => {
    expect(run(prefs('system'))).toBeUndefined()
    expect(run(null)).toBeUndefined()
    expect(run('{not json')).toBeUndefined()
    expect(run(JSON.stringify({ version: 1 }))).toBeUndefined()
    expect(run(prefs('<b>'))).toBeUndefined()
  })
})
