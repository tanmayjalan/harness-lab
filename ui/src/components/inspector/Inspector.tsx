// Look inside one model call: what the harness sent, what came back, and how big it was.
import * as Tabs from '@radix-ui/react-tabs'
import { PanelRightClose, Radio } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import type { Call } from '../../model/derive'
import { callView } from '../../model/inspector'
import { cn } from '../../lib/cn'
import { useShownInspectorWidth } from '../../lib/layout'
import { plural } from '../../lib/format'
import { useInspectedCallId } from '../../store/selectors'
import { useSession } from '../../store/session'
import { usePrefs, useUi, type InspectorTab } from '../../store/ui'
import { Button, IconButton, Kbd } from '../ui'
import { LoopStrip, type LoopNode } from './LoopDiagram'
import { hookNote } from './HooksCard'
import { CallEnd } from './CallEnd'
import { callName } from './callNames'
import { CallPicker } from './CallPicker'
import { RawTab } from './RawTab'
import { ReceivedTab } from './ReceivedTab'
import { SentTab } from './SentTab'
import { SummaryTab } from './SummaryTab'
import { ToolsTab } from './ToolsTab'

export function Inspector({ onClose }: { onClose?: () => void }) {
  const model = useSession((s) => s.derived)
  const callId = useInspectedCallId()
  const follow = useUi((s) => s.followLatest)
  const tab = usePrefs((s) => s.inspectorTab)
  const setTab = usePrefs((s) => s.setInspectorTab)
  const view = useMemo(() => (callId ? callView(model, callId) : null), [model, callId])
  // The width on screen, not the stored one. Below 520 px (the usual 440 included) the follow control is
  // an icon; the count needs 600 px, so between 520 and 600 the picker
  // keeps room for its longest name
  const shownWidth = useShownInspectorWidth()
  const narrowPanel = shownWidth < 520
  const showCount = shownWidth >= 600
  const newestId = model.callOrder[model.callOrder.length - 1]
  const newest = newestId ? model.calls[newestId] : null
  // One scrolling box for every call: another call starts at its top, not where the last one was left
  const scroller = useRef<HTMLDivElement>(null)
  const shownId = view?.call.id
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [shownId])
  // F426: you picked a call in the chat: focus comes here, on the call picker, which says which call it is
  const focusHere = useUi((s) => s.focusInspector)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focusHere) return
    useUi.getState().setFocusInspector(false)
    ;(panel.current?.querySelector<HTMLElement>('select') ?? panel.current)?.focus()
  }, [focusHere])

  return (
    <aside ref={panel} id="inspector" tabIndex={-1} aria-label="Inspector" className="flex h-full min-h-0 flex-col bg-panel outline-none">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        {/* with a call shown the picker needs the room: the title is for screen readers only (the panel is labelled),
            and a narrow panel also drops the count and shows the follow control as an icon */}
        <h2 className={cn('text-sm font-semibold', view && 'sr-only')}>Inspector</h2>
        {view && <CallPicker model={model} current={view.call} />}
        {view && showCount && (
          <span className="shrink-0 text-xs text-muted tabular-nums">
            {model.callOrder.indexOf(view.call.id) + 1} of {plural(model.callOrder.length, 'call')}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {newest && (follow ? (
            <span className="flex shrink-0 items-center gap-1 px-2 text-xs text-muted"
              title="New calls show here as they arrive. Pick any call to stop following.">
              <Radio className="size-3.5" /> <span className={cn(narrowPanel && 'sr-only')}>Following new calls</span>
            </span>
          ) : narrowPanel ? (
            <IconButton label={`${followLabel(view?.call ?? null, newest)}: show the newest call, and keep following new ones`} size="sm"
              onClick={() => useUi.getState().follow()}><Radio className="size-4" /></IconButton>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => useUi.getState().follow()} title="Show the newest call, and keep following new ones">
              <Radio className="size-3.5" /> {followLabel(view?.call ?? null, newest)}
            </Button>
          ))}
          {onClose && <IconButton label="Hide the inspector" size="sm" onClick={onClose}><PanelRightClose className="size-4" /></IconButton>}
        </div>
      </div>
      {!view ? (
        <div className="space-y-4 overflow-y-auto p-4">
          <p className="text-sm text-muted">
            Each model call shows up here once you send a message. Pick one in the chat (the <b>Call 1</b>, <b>Call 2</b>{" "}
            dividers) to see exactly what the harness sent and what came back. <Kbd>[</Kbd> and <Kbd>]</Kbd> step
            through calls; "Follow latest" goes back to the newest.
          </p>
        </div>
      ) : (
        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as InspectorTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-line px-3 pt-2">
            <LoopStrip active={loopNode(view.call)} path={loopPath(view.call)} className="py-1"
              hooks={hookNote(model, view.call)}
              early={!!view.call.stopReason && !['tool_use', 'end_turn'].includes(view.call.stopReason)} />
            {/* At Large text the tabs may not fit: the list scrolls sideways instead of widening the panel.
                The -mb-px sits on the list, not the tabs, so the scrolling box has no 1 px to scroll up and down;
                a scrolling box clips what is drawn outside it, so the focus ring is drawn inside each tab */}
            <Tabs.List aria-label="What to show" className="-mb-px mt-1 flex gap-1 overflow-x-auto">
              {([['summary', 'Summary'], ['sent', 'Sent'], ['received', 'Received'], ['tools', 'Tools'], ['raw', 'Raw']] as const).map(([v, l]) => (
                <Tabs.Trigger key={v} value={v}
                  // the browser does not scroll a partly visible tab into view when it takes focus
                  onFocus={(e) => e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
                  className="shrink-0 border-b-2 border-transparent focus-ring focus-visible:outline-offset-[-2px] px-2.5 py-1.5 text-sm text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
                  {l}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-4">
            <Tabs.Content value="summary"><SummaryTab view={view} model={model} /></Tabs.Content>
            <Tabs.Content value="sent"><SentTab view={view} /></Tabs.Content>
            <Tabs.Content value="received"><ReceivedTab call={view.call} /></Tabs.Content>
            <Tabs.Content value="tools"><ToolsTab call={view.call} model={model} /></Tabs.Content>
            <Tabs.Content value="raw"><RawTab call={view.call} /></Tabs.Content>
            <CallEnd model={model} current={view.call} />
          </div>
        </Tabs.Root>
      )}
    </aside>
  )
}

// The follow button: on the newest call already, there's nothing to jump to, only new calls to follow
function followLabel(shown: Call | null, newest: Call) {
  return shown?.id === newest.id ? 'Follow new calls' : `Follow latest (${callName(newest)})`
}

// Where in the loop this call ended up
function loopNode(call: Call): LoopNode {
  if (!call.response) return 'call'
  if (call.stopReason === 'tool_use') return 'tools'
  return call.stopReason === 'end_turn' ? 'answer' : 'reply'
}

function loopPath(call: Call): LoopNode[] {
  const first = (call.stepTurn ?? call.turn) === 1 // (a workflow step's first call starts afresh too)
  if (!call.response) return first ? ['you', 'call'] : ['tools', 'call']
  const start: LoopNode[] = first ? ['you', 'call', 'reply'] : ['tools', 'call', 'reply']
  return call.stopReason === 'tool_use' ? [...start, 'tools'] : call.stopReason === 'end_turn' ? [...start, 'answer'] : start
}
