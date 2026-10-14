// A tool's whole journey, step by step: the model asks for it in its reply, the harness runs
// it here, and the result goes back to the model inside the next call's request.
import { ArrowDown, Bot, ChevronRight, Cpu, Laptop } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Rule } from '../../api/types'
import { hookOf, hooksLoaded, type RunModel } from '../../model/derive'
import { answersCarried, roundTrips, type RoundTrip } from '../../model/inspector'
import { cn } from '../../lib/cn'
import { count } from '../../lib/format'
import { useUi } from '../../store/ui'
import { AccessChecks } from '../run/AccessChecks'
import { JsonTree } from './JsonTree'

const OPEN = { n: 0, open: true }

function Step({ n, icon, title, where, children, tone = 'neutral' }:
  { n: number; icon: ReactNode; title: string; where: ReactNode; children: ReactNode; tone?: 'neutral' | 'muted' }) {
  return (
    <div className={cn('rounded-md border bg-panel p-2', tone === 'muted' ? 'border-dashed border-line-strong text-muted' : 'border-line')}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="flex size-5 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">{n}</span>
        {icon}<span className="font-semibold">{title}</span>
        <span className="text-muted">· {where}</span>
      </div>
      {children}
    </div>
  )
}

const Arrow = () => <div className="flex justify-center py-0.5 text-muted"><ArrowDown className="size-4" aria-hidden /></div>

function Trip({ trip, callTurn, setting, model }: { trip: RoundTrip; callTurn: number; setting?: Rule; model: RunModel }) {
  const select = useUi((s) => s.selectCall)
  const row = trip.row
  const rewrote = row && hookOf(row, 'after_tool')?.verdict === 'replaced'
  return (
    <li className="space-y-0 rounded-lg border border-line bg-sunken/50 p-2">
      <div className="mb-1.5 flex items-center gap-2 text-sm">
        <code className="font-semibold">{trip.ask.name}</code>
        <span className="min-w-0 text-xs text-muted">its id, <code className="break-all">{trip.ask.id}</code>, ties the request (step 1) to its result (step 3)</span>
      </div>
      <Step n={1} icon={<Bot className="size-3.5 text-accent" />} title="The model asks" where={`a tool_use block in call ${callTurn}'s reply`}>
        <JsonTree value={trip.ask} command={OPEN} openDepth={3} label="The tool_use block" />
        <p className="mt-1 text-xs text-muted">The model only writes this request; it can't run anything. The harness reads <code>name</code> and <code>input</code>.</p>
      </Step>
      <Arrow />
      <Step n={2} icon={<Laptop className="size-3.5 text-accent" />} title="The harness decides, then runs it" where="here, on this computer: nothing goes to the model">
        {row ? <AccessChecks row={row} setting={setting} loaded={hooksLoaded(model, row)} /> : <p className="text-xs text-muted">Not recorded.</p>}
        {row?.result && (
          <p className="mt-1 text-xs text-muted">It produced {count(row.result.chars)} characters{row.result.isError ? ', marked as an error' : ''}.</p>
        )}
      </Step>
      <Arrow />
      {trip.answer ? (
        <Step n={3} icon={<Cpu className="size-3.5 text-accent" />} title="The harness sends the result back"
          where={<>a tool_result block in <button type="button" className="text-accent hover:underline" onClick={() => select(trip.answer!.callId)}>call {trip.answer.turn}</button>'s request, entry {trip.answer.messageIndex + 1} of the messages list</>}>
          <JsonTree value={trip.answer.block} command={OPEN} openDepth={3} label="The tool_result block" />
          <p className="mt-1 text-xs text-muted">
            Same <code>tool_use_id</code> as step 1, so the model knows which request this answers. It goes along with the
            whole history in the next call.
          </p>
          {rewrote && (
            <p className="mt-1 text-xs text-warn">
              This content is your after_tool's version: the tool itself returned something else (open the tool row in
              the chat to see both).
            </p>
          )}
        </Step>
      ) : (
        <Step n={3} icon={<Cpu className="size-3.5 text-muted" />} title="The harness sends the result back" where="not sent" tone="muted">
          <p className="text-xs text-muted">
            {row?.status === 'running' || row?.status === 'awaiting' ? 'Not yet: the tool is still running or waiting for you.'
              : 'No next call for this message (it was stopped or failed), so this result never reached the model.'}
          </p>
        </Step>
      )}
    </li>
  )
}

export function RoundTrips({ model, callId }: { model: RunModel; callId: string }) {
  const [shown, setShown] = useState(true)
  const call = model.calls[callId]
  const trips = roundTrips(model, callId)
  const carried = answersCarried(model, callId)
  const select = useUi((s) => s.selectCall)
  if (!trips.length && !carried.length) return null
  return (
    <section className="space-y-2 rounded-md border border-accent/30 p-2">
      <button type="button" onClick={() => setShown(!shown)} aria-expanded={shown}
        className="flex w-full items-center gap-1 rounded text-left text-sm font-semibold focus-ring">
        <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 transition-transform', shown && 'rotate-90')} />
        Tool round trip
      </button>
      {shown && (
        <>
          {carried.length > 0 && (
            <p className="text-xs text-muted">
              This call's request carries {carried.length === 1 ? 'the result' : `${carried.length} results`} for{' '}
              {carried.map((c) => <code key={c.block.tool_use_id} className="mr-1">{c.block.tool_use_id}</code>)}
              asked for in{' '}
              <button type="button" className="text-accent hover:underline" onClick={() => select(carried[0].askedIn.id)}>
                call {carried[0].askedIn.turn}
              </button>; open that call to follow the whole trip.
            </p>
          )}
          {trips.length > 0 && (
            <ol className="space-y-2">
              {trips.map((t) => (
                <Trip key={t.ask.id} trip={t} callTurn={call.turn} model={model}
                  setting={call.request.tools?.find((x) => x.name === t.ask.name)?.permission} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
