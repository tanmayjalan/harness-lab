// Help: the page at a glance, shortcuts, the quiz, what the mock can't show, and the glossary.
import * as Dialog from '@radix-ui/react-dialog'
import { Toaster } from './Toaster'
import { Announcer } from './Announcer'
import { Check, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CONCEPTS, GROUPS, TEACHING_ORDER, type Concept, type ConceptKey } from '../../learn/concepts'
import { EXPERIMENTS } from '../../learn/experiments'
import { QUIZ } from '../../learn/quiz'
import { cn } from '../../lib/cn'
import { undoToast } from '../../lib/undoToast'
import { usePrefs, useUi } from '../../store/ui'
import { Button, chipClass, Disclosure, Field, IconButton, Kbd, SectionLabel } from '../ui'

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const CTRL = MAC ? '⌘' : 'Ctrl'

const KEYS: [string[], string][] = [
  [['Enter'], 'send the message'],
  [['Shift', 'Enter'], 'new line'],
  [['Esc'], 'stop the running message (while the harness waits for you to allow or decline, answer that first)'],
  [['A'], 'allow, when the harness is waiting for you'],
  [['D'], 'decline, when the harness is waiting for you'],
  [['['], 'previous model call in the Inspector'],
  [[']'], 'next model call in the Inspector'],
  [['Alt', '←'], 'previous call (Alt+→ for the next one), for keyboards where [ and ] need AltGr'],
  [['←', '→'], 'move between calls in the size chart, once a bar has focus'],
  [['/'], 'jump to the message box, or to the approval panel when the harness is waiting for you'],
  [[CTRL, ','], MAC ? 'open or close Settings (if your browser takes ⌘, for its own settings, use the gear)' : 'open or close Settings'],
  [['?'], 'this help'],
]

// An in-sheet link: scrolls there itself. The browser's own jump would change the address, which names the
// screen and the conversation, and so would count as leaving the conversation
function jump(e: React.MouseEvent<HTMLAnchorElement>) {
  e.preventDefault()
  const el = document.getElementById(e.currentTarget.getAttribute('href')!.slice(1))
  el?.scrollIntoView({ block: 'start' })
  // and focus goes there too (the targets take focus, tabIndex -1), so Tab and a screen reader continue from it
  el?.focus({ preventScroll: true })
}

const CONTENTS: [string, string][] = [['at-a-glance', 'At a glance'], ['shortcuts', 'Shortcuts'], ['quiz', 'Quiz'], ['mock-limits', 'The mock'], ['glossary', 'Glossary']]

export function HelpSheet() {
  const open = useUi((s) => s.helpOpen)
  const target = useUi((s) => s.helpTarget)
  const learning = usePrefs((s) => s.learningMode)
  const prefs = usePrefs.getState()

  // Opened at a place (a glossary term, the quiz): scroll it into view
  useEffect(() => {
    if (!open || !target) return
    const id = requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }))
    document.getElementById(target)?.scrollIntoView({ block: 'start' })
    return () => cancelAnimationFrame(id)
  }, [open, target])

  return (
    <Dialog.Root open={open} onOpenChange={(o) => useUi.getState().setHelp(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60" />
        <Dialog.Content aria-describedby={undefined} onCloseAutoFocus={(e) => useUi.getState().restoreFocus(e)}
          onInteractOutside={(e) => { if ((e.target as Element).closest('[data-toaster]')) e.preventDefault() }}
          className="pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(40rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-panel shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <Dialog.Title className="text-lg font-semibold">Help</Dialog.Title>
            <Dialog.Close asChild><IconButton size="sm" label="Close" className="text-muted hover:text-fg"><X className="size-4" /></IconButton></Dialog.Close>
          </div>
          {/* F310d: outside the part that scrolls, so it stays at the top and nothing slides under it */}
          <nav aria-label="In this help" className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2 text-xs">
            {CONTENTS.map(([id, name]) => (
              <a key={id} href={`#${id}`} onClick={jump} className={cn(chipClass({ interactive: true }), 'text-muted')}>{name}</a>
            ))}
          </nav>
          <div className="space-y-6 overflow-y-auto p-4">
            <section className="scroll-mt-4 space-y-2 outline-none" id="at-a-glance" tabIndex={-1}>
              <h3 className="text-sm font-semibold">The page at a glance</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
                <li><b className="text-fg">Left:</b> your saved conversations.</li>
                <li><b className="text-fg">Middle:</b> the conversation. Each "Call" line is one model call; tool rows show what it asked for and what the harness did.</li>
                <li><b className="text-fg">Right:</b> the Inspector, a look inside one model call (what was sent, what came back, how big it was).</li>
                <li><b className="text-fg">Compare</b> runs one question with two or three setups side by side; <b className="text-fg">Evals</b> scores a setup on fixed questions.</li>
                <li>The status next to the screens says what the harness is doing: Ready, Waiting for the model, Running tools, Waiting for you, Stopping, Summarising history, and Comparing or Evaluating while those screens run.</li>
              </ul>
              <Button size="sm" onClick={() => { useUi.getState().setHelp(false); useUi.getState().setExperimentsOpen(true) }}>
                <Sparkles className="size-3.5" /> Start the learning path
              </Button>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Explanations</h3>
              <p className="text-sm text-muted">
                Each idea is explained in full the first time it appears, then shrinks to an ⓘ you can click.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={learning} onChange={(e) => prefs.setLearningMode(e.target.checked)} />
                  Learning mode: always show every explanation in full
                </label>
                <Button size="sm" onClick={() => prefs.resetExplained()}>Show all explanations again once</Button>
              </div>
            </section>
            <section className="scroll-mt-4 space-y-2 outline-none" id="shortcuts" tabIndex={-1}>
              <h3 className="text-sm font-semibold">Keyboard <span className="font-normal text-muted">(in a conversation, unless noted)</span></h3>
              <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {KEYS.map(([keys, what]) => (
                  <li key={what} className="flex items-center gap-2">
                    <span className="flex shrink-0 gap-0.5">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                    <span className="text-muted">{what}</span>
                  </li>
                ))}
              </ul>
            </section>
            <Quiz />
            <section className="scroll-mt-4 space-y-2 outline-none" id="mock-limits" tabIndex={-1}>
              <h3 className="text-sm font-semibold">What the mock can and can't show</h3>
              <p className="text-sm text-muted">
                The mock answers through claude -p on your Claude Code plan: no API key, no cost. It imitates a
                real provider, so it is not the real API:
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
                <li>Token counts and costs are <b>estimates</b> (about 4 characters per token, priced as the chosen model).
                  Tokens out leave out thinking (its text isn't returned), so tokens out and cost are <b>at least</b> what's shown.</li>
                <li>The model doesn't get the request as the Raw tab shows it: the mock writes the system prompt, the tools
                  and the conversation into one text prompt for claude -p, asks for the reply in a fixed shape, and makes up
                  the ids of tool requests.</li>
                <li>No prompt caching: the cache switch has no effect, and no cache reads are shown.</li>
                <li>Thinking turns on and off, but its text isn't returned: you only see that it thought.</li>
                <li>No streaming: the reply arrives all at once.</li>
                <li>The longest-reply limit is imitated: a reply longer than "Longest reply" (by the estimate) is cut and stops with max_tokens.</li>
                <li>Each call starts a new claude -p and doesn't stream, so about 5 to 30 seconds per call is normal.</li>
              </ul>
              <p className="text-sm text-muted">Switch to the Anthropic API or DeepSeek (Settings → Model) to see real numbers.</p>
            </section>
            <Glossary />
          </div>
          <Toaster inDialog />
          <Announcer />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Glossary() {
  const [filter, setFilter] = useState('')
  const f = filter.trim().toLowerCase()
  const entries = (Object.entries(CONCEPTS) as [ConceptKey, Concept][])
    .filter(([, c]) => !f || `${c.term} ${c.plain} ${c.short} ${c.long.join(' ')}`.toLowerCase().includes(f))
  return (
    <section className="scroll-mt-4 space-y-3 outline-none" id="glossary" tabIndex={-1}>
      <h3 className="text-sm font-semibold">Glossary, in the order the lab teaches it</h3>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
        <Field value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a term" aria-label="Filter the glossary"
          className="w-full pl-7" />
      </div>
      <nav aria-label="Glossary groups" className="flex flex-wrap gap-1.5 text-xs">
        {GROUPS.map((g) => (
          <a key={g} href={`#group-${g}`} onClick={jump} className={cn(chipClass({ interactive: true }), 'text-muted')}>{g}</a>
        ))}
      </nav>
      {GROUPS.map((g) => {
        const here = entries.filter(([, c]) => c.group === g).sort(([a], [b]) => TEACHING_ORDER.indexOf(a) - TEACHING_ORDER.indexOf(b))
        if (!here.length) return null
        return (
          <div key={g} id={`group-${g}`} tabIndex={-1} className="scroll-mt-4 space-y-1.5 outline-none">
            <SectionLabel as="h4">{g}</SectionLabel>
            <dl className="space-y-2 text-sm">
              {here.map(([key, c]) => (
                <div key={key} id={`term-${key}`} className="scroll-mt-4">
                  <dt className="font-medium">{c.plain} <span className="font-normal text-muted">({c.term})</span></dt>
                  <dd className="text-muted">
                    {c.short}
                    <Disclosure className="mt-1" summaryClassName="text-accent" summary="More">
                      {c.long.map((p, i) => <p key={i} className="mt-1">{p}</p>)}
                    </Disclosure>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )
      })}
      {!entries.length && <p className="text-sm text-muted">No term matches.</p>}
    </section>
  )
}

// A few questions to check what you remember, grouped by the experiment after which each makes sense;
// your answers stay in this browser
function Quiz() {
  const answers = usePrefs((s) => s.quizAnswers)
  const answer = usePrefs((s) => s.answerQuiz)
  const answered = QUIZ.filter((q) => answers[q.id] !== undefined)
  const right = answered.filter((q) => answers[q.id] === q.answer).length
  // In the order the experiments teach; a question after something else (the Evals screen) comes last
  const place = (after: string) => { const i = EXPERIMENTS.findIndex((x) => x.title === after); return i < 0 ? Infinity : i }
  const tiers = [...new Set(QUIZ.map((q) => q.after))].sort((a, b) => place(a) - place(b))
  let n = 0
  return (
    <section className="scroll-mt-4 space-y-2 outline-none" id="quiz" tabIndex={-1}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Quiz me</h3>
        <span className="text-xs text-muted">
          {answered.length ? `${right} right of ${answered.length} answered (${QUIZ.length} questions)` : `${QUIZ.length} questions`}
          {answered.length > 0 && (
            <button type="button" className="ml-2 text-accent hover:underline" onClick={() => {
              const was = answers
              QUIZ.forEach((q) => answer(q.id, null))
              undoToast('Quiz answers cleared', () => { usePrefs.setState({ quizAnswers: was }) })
            }}>start again</button>
          )}
        </span>
      </div>
      {tiers.map((after) => (
        <div key={after} className="space-y-2">
          <h4 className="text-xs text-muted">after: {after}</h4>
          <ol className="space-y-2">
            {QUIZ.filter((q) => q.after === after).map((q) => {
              const picked = answers[q.id]
              n += 1
              return (
                <li key={q.id} className="space-y-1 rounded-md border border-line p-2 text-sm">
                  <div className="font-medium">{n}. {q.q}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((o, j) => (
                      <button key={o} type="button" aria-disabled={picked !== undefined} onClick={() => picked === undefined && answer(q.id, j)}
                        className={cn(chipClass({ interactive: picked === undefined, tone: picked === undefined ? 'neutral' : j === q.answer ? 'ok' : j === picked ? 'bad' : 'neutral' }),
                          'min-h-6 whitespace-normal focus-ring aria-disabled:cursor-default', picked !== undefined && j !== q.answer && j !== picked && 'opacity-60')}>
                        {picked !== undefined && j === q.answer && <><span className="sr-only">right answer: </span><Check aria-hidden className="size-3" /></>}
                        {picked !== undefined && j === picked && j !== q.answer && <><span className="sr-only">your answer, wrong: </span><X aria-hidden className="size-3" /></>}
                        {o}
                      </button>
                    ))}
                  </div>
                  <div role="status" className="empty:hidden">
                  {picked !== undefined && (
                    <p className="text-xs text-muted">
                      {picked === q.answer ? 'Right. ' : `Not quite: it's "${q.options[q.answer]}". `}{q.why}
                      <button type="button" className="ml-2 text-accent hover:underline" onClick={() => answer(q.id, null)}>Try again</button>
                    </p>
                  )}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
    </section>
  )
}
