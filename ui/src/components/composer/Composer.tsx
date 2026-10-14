// Where you type. Above it: the provider and model in use. While a reply runs, Send becomes Stop.
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ArrowUp, Check, ChevronDown, Square } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { dollars, tokens } from '../../lib/format'
import { send, stop, switchProvider } from '../../store/selectors'
import { useServer } from '../../store/server'
import { useSession } from '../../store/session'
import { toast, useUi } from '../../store/ui'
import { missingKeyHelp, shortLabel, switchNote } from './providerWords'
import { Button, Kbd, Spinner, Tip } from '../ui'

export type ComposerHandle = { focus: () => void; fill: (text: string) => void }

let usedDraft = 0 // the last draft put in the box

export const Composer = forwardRef<ComposerHandle>(function Composer(_, ref) {
  const [text, setText] = useState(() => useUi.getState().composerText)
  const box = useRef<HTMLTextAreaElement>(null)
  const running = useSession((s) => s.running)
  const stopping = useSession((s) => s.derived.status === 'stopping')

  // An experiment (or anything else) can put text in the box, once: coming back from another
  // screen re-creates the box, and must not bring back a draft that was already sent
  const draft = useUi((s) => s.draft)
  useEffect(() => {
    if (draft.n && draft.n !== usedDraft) {
      usedDraft = draft.n
      setText(draft.text)
      box.current?.focus()
    }
  }, [draft])

  // What's in the box, for anything that would replace it (picking an experiment asks first)
  useEffect(() => { useUi.getState().setComposerText(text) }, [text])

  useImperativeHandle(ref, () => ({
    focus: () => box.current?.focus(),
    fill: (t: string) => { setText(t); box.current?.focus() },
  }))

  const inFlight = useRef(false)
  const submit = async () => {
    const t = text.trim()
    if (!t) return
    if (running) {
      toast({ kind: 'info', title: 'Enter works again once the reply finishes', body: 'Your message stays in the box.' })
      return
    }
    // A second Enter before the first send has been answered must not send the message twice
    if (inFlight.current) return
    inFlight.current = true
    try {
      if (await send(t)) setText('')
    } finally {
      inFlight.current = false
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex flex-col items-start gap-0.5">
          <ProviderPill />
          {/* F373: the reason in words (a disabled button rarely shows its title) */}
          {/* (while the harness waits for your Allow or Decline, the approval panel replaces this box) */}
          {running && <span className="pl-2.5 text-2xs text-muted">Switch after the reply finishes</span>}
        </div>
        <Totals />
      </div>
      <div className={cn('flex items-end gap-2 rounded-xl border bg-panel p-2 shadow-sm transition-colors',
        'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 border-line')}>
        <textarea
          ref={box}
          rows={1}
          value={text}
          id="message-box"
          aria-label="Message"
          placeholder={running ? 'The harness is working… you can type your next message' : 'Message the model…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          className="field-sizing-content max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-muted"
        />
        {running ? (
          <Tip text="Stop at the next step" shortcut="Esc">
            <Button variant="secondary" onClick={stop} disabled={stopping} aria-label="Stop" className="w-9 px-0">
              {stopping ? <Spinner /> : <Square className="size-3.5 fill-current" />}
            </Button>
          </Tip>
        ) : (
          <Tip text="Send" shortcut="Enter">
            <Button variant="primary" onClick={submit} disabled={!text.trim()} aria-label="Send" className="w-9 px-0">
              <ArrowUp className="size-4" />
            </Button>
          </Tip>
        )}
      </div>
      <div className="px-1 text-xs text-muted">
        {running ? <><Kbd>Enter</Kbd> works again once the reply finishes; your message stays in the box</> : <><Kbd>Enter</Kbd> send</>}
        {' '}· <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line{running && <> · <Kbd>Esc</Kbd> stop</>}
      </div>
    </div>
  )
})

// What the mock's menu line says about price: its numbers are guesses, priced as the model it imitates
function mockPrice(mp: { input: number; output: number } | undefined) {
  return mp ? ` · ≈ $${mp.input}/$${mp.output} per M tokens, estimated` : ' · estimated tokens'
}

function ProviderPill() {
  const info = useServer((s) => s.info)
  const running = useSession((s) => s.running)
  const waitingForYou = useSession((s) => !!s.derived.pendingApproval)
  const messages = useSession((s) => s.derived.runs.length)
  const current = useSession((s) => s.provider) ?? info?.provider
  const model = useSession((s) => s.model) || info?.model
  const label = info?.providers.find((p) => p.name === current)?.label ?? info?.mode ?? '…'
  return (
    <Menu.Root>
      <Menu.Trigger asChild disabled={running || !info}>
        <button type="button" title={waitingForYou ? 'Answer the approval first (Allow or Decline)' : running ? 'Wait for the reply to finish to switch' : 'Switch provider or model'}
          className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-0.5 text-xs hover:border-muted disabled:opacity-60">
          <span className="size-1.5 rounded-full bg-ok" aria-hidden />
          <span className="font-medium whitespace-nowrap">{shortLabel(label)}</span>
          <span className="max-w-40 truncate text-muted" title={model}>· <code>{model}</code></span>
          <ChevronDown className="size-3 text-muted" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6}
          className="pop-in z-50 min-w-72 rounded-lg border border-line bg-panel p-1 text-sm shadow-xl">
          <Menu.Label className="max-w-80 px-2 py-1 text-xs text-muted">{switchNote(messages)}</Menu.Label>
          <Menu.RadioGroup value={`${current}/${model}`}>
          {info?.providers.flatMap((p) => (p.models ?? [p.model]).map((m) => {
            const on = p.name === current && m === model
            return (
              <Menu.RadioItem key={`${p.name}/${m}`} value={`${p.name}/${m}`} aria-disabled={p.missing_key ? true : undefined}
                onSelect={(e) => { if (p.missing_key) e.preventDefault(); else if (!on) switchProvider(p.name, m) }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent data-[highlighted]:ring-2 data-[highlighted]:ring-accent data-[highlighted]:ring-inset">
                <Check className={cn('size-3.5', on ? 'text-accent' : 'invisible')} />
                <span className="flex-1">
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-xs text-muted">
                    {m}
                    {p.missing_key ? '' : p.price ? ` · $${p.price.input} in / $${p.price.output} out per million tokens` : mockPrice(p.model_prices?.[m])}
                  </span>
                  {p.missing_key && <span className="block max-w-72 text-xs text-warn">{missingKeyHelp(p.missing_key)}</span>}
                </span>
              </Menu.RadioItem>
            )
          }))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

function Totals() {
  const d = useSession((s) => s.derived)
  if (!d.tokensReported) return null
  const estimateText = d.tokensEstimated
    ? 'Estimated: the mock guesses tokens from characters (about 4 each) and prices them as the chosen model'
    : 'Tokens read and written in this conversation so far, helpers and summaries included'
  return (
    <Tip text={estimateText}>
      <span className="text-xs text-muted tabular-nums">
        <span className="sr-only">{estimateText}</span>
        {d.tokensEstimated && '≈ '}{tokens(d.tokens.read)} tokens in · {tokens(d.tokens.wrote)} out{d.costKnown && ` · ${dollars(d.cost)}`}
      </span>
    </Tip>
  )
}
