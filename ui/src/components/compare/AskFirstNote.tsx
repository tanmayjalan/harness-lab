// The note below the sides about tools set to Ask first
import { cn } from '../../lib/cn'
import { useCompare } from '../../store/compare'
import { useServer } from '../../store/server'
import { Callout } from '../ui'
import { andList, letThroughWords } from './letThrough'
import { LETTERS } from './SideLetter'

// Which tools would be blocked because nobody can be asked, and the switch to let them run
export function AskFirstNote() {
  const c = useCompare()
  const settings = useServer((s) => s.settings)
  if (!settings) return null
  // Each tool set to Ask first, with the sides where it is
  const where = new Map<string, string[]>()
  c.sides.forEach((side, i) => settings.tools
    .filter((t) => (side.permissions[t.name] ?? t.permission) === 'ask')
    .filter((t) => t.name !== 'run_python' || (side.runCode ?? settings.run_code?.enabled)) // offered only with Run code on
    .forEach((t) => where.set(t.name, [...(where.get(t.name) ?? []), LETTERS[i]])))
  if (!where.size) return null
  const onSides = (letters: string[]) => letters.length === c.sides.length ? 'on every side'
    : `on side${letters.length > 1 ? 's' : ''} ${letters.join(' and ')}`
  const asking = [...where.keys()]
  // Tools that are set to Ask first on the same sides share one clause: "on every side: write_file and calculate"
  const sameSides = new Map<string, string[]>()
  for (const name of asking) sameSides.set(onSides(where.get(name)!), [...(sameSides.get(onSides(where.get(name)!)) ?? []), name])
  const names = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0])
  return (
    <Callout tone="warn" className="space-y-1.5">
      <p>
        {[...sameSides].map(([sides, tools], i) => `${i ? 'set' : 'Set'} to Ask first ${sides}: ${names(tools)}`).join('; ')}. Nobody can be asked
        during a comparison, so {asking.length === 1 ? 'it is' : 'they are'} {c.allowAsk ? 'let through' : 'blocked'} there.
      </p>
      {/* F389: names what it lets through, and what that means; unticked again after each comparison */}
      <label className="flex items-start gap-2 text-fg">
        <input type="checkbox" className="mt-1" checked={c.allowAsk} onChange={(e) => c.setAllowAsk(e.target.checked)} />
        <span>
          Let Ask-first tools run for this comparison: {andList(asking)}
          {letThroughWords(asking, (where.get('run_python')?.length ?? 0) * c.repeat).map((w) => (
            <span key={w} className={cn('block text-xs', w.startsWith('Code the model writes') ? 'font-medium text-warn' : 'text-muted')}>{w}</span>
          ))}
          <span className="block text-xs text-muted">It is unticked again after the comparison runs.</span>
        </span>
      </label>
    </Callout>
  )
}
