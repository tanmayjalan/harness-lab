// The page: sidebar | run | inspector, plus the settings drawer, help, and the compare and evals screens.
import * as RTooltip from '@radix-ui/react-tooltip'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PollClient } from './api/poll'
import { cn } from './lib/cn'
import { inspectorRoom, inspectorWidthCss, ONE_COLUMN, shownInspectorWidth, useViewportWidth } from './lib/layout'
import { useShortcuts } from './lib/shortcuts'
import { callDivider, escapeStops, inspectCall,newConversation, onRunScreen, openConversation, setPoke, stop } from './store/selectors'
import { isRoute, parseHash, toHash } from './lib/route'
import { useServer } from './store/server'
import { useSession } from './store/session'
import { toast, usePrefs, useUi } from './store/ui'
import { TopBar } from './components/shell/TopBar'
import { ConnectionBanner } from './components/shell/ConnectionBanner'
import { Toaster } from './components/shell/Toaster'
import { Announcer } from './components/shell/Announcer'
import { HelpSheet } from './components/shell/HelpSheet'
import { ExperimentsDialog } from './components/shell/ExperimentsDialog'
import { Sidebar } from './components/sidebar/Sidebar'
import { RunView } from './components/run/RunView'
import { RewindDialog } from './components/run/RewindDialog'
import { Inspector } from './components/inspector/Inspector'
import { SettingsDrawer } from './components/settings/SettingsDrawer'
import { CompareScreen } from './components/compare/CompareScreen'
import { EvalsScreen } from './components/evals/EvalsScreen'
import type { ComposerHandle } from './components/composer/Composer'
import { IconButton, SEGMENT_TRACK, segmentItem } from './components/ui'
import type { Run } from './model/derive'
import { useCompare } from './store/compare'
import { useEvals } from './store/evals'

function useNarrow(width = ONE_COLUMN) {
  const query = `(max-width: ${width - 1}px)`
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}

export function App() {
  const narrow = useNarrow()
  const screen = useUi((s) => s.screen)
  const mobilePane = useUi((s) => s.mobilePane)
  const sidebarSheet = useUi((s) => s.sidebarSheet)
  const sidebarCollapsed = usePrefs((s) => s.sidebarCollapsed)
  const inspectorOpen = usePrefs((s) => s.inspectorOpen)
  // nothing to inspect before the first model call: the chat keeps the room
  const hasCalls = useSession((s) => s.derived.callOrder.length > 0)
  const inspectorWidth = usePrefs((s) => s.inspectorWidth)
  const fontSize = usePrefs((s) => s.fontSize)
  const theme = usePrefs((s) => s.theme)
  const composer = useRef<ComposerHandle>(null)
  const [rewinding, setRewinding] = useState<Run | null>(null) // "Rewind to here": the message its dialog is about

  // The address bar names the screen and (once it has a message) the conversation, so a reload or
  // Back returns to the same place. The id from the address waits here until the server answers.
  const hashConversation = useRef<string | null>(null)
  const firstWrite = useRef(true)
  useLayoutEffect(() => {
    const r = parseHash(location.hash)
    useUi.getState().setScreen(r.screen)
    hashConversation.current = r.conversation ?? null
  }, [])
  const conversation = useSession((s) => s.conversation)
  const hasRuns = useSession((s) => s.derived.runs.length > 0)
  useEffect(() => {
    if (hashConversation.current) return // not yet known whether that conversation exists
    const h = toHash(useUi.getState().screen, hasRuns ? conversation : null)
    if (location.hash !== h) {
      // the first write on page load replaces the entry, so a plain load adds no history step
      if (firstWrite.current) history.replaceState(null, '', h)
      else history.pushState(null, '', h)
    }
    firstWrite.current = false
  }, [screen, conversation, hasRuns])
  useEffect(() => {
    const back = () => {
      if (!isRoute(location.hash)) return // an in-page fragment, not a screen or a conversation (R9)
      const r = parseHash(location.hash)
      if (r.screen !== useUi.getState().screen) useUi.getState().setScreen(r.screen)
      if (r.conversation && r.conversation !== useSession.getState().conversation) void openConversation(r.conversation, { goneToast: true })
      // Back out of a conversation to plain #chat means leaving it: start a new one
      else if (!r.conversation && r.screen === 'run' && useSession.getState().derived.runs.length > 0) {
        // (not while a reply runs: the address then stays on the conversation)
        if (useSession.getState().running) history.replaceState(null, '', toHash('run', useSession.getState().conversation))
        else void newConversation()
      }
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])

  useEffect(() => {
    document.documentElement.classList.remove('text-size-sm', 'text-size-md', 'text-size-lg')
    document.documentElement.classList.add(`text-size-${fontSize}`)
  }, [fontSize])

  // F348a: the colours follow this attribute (app.css); System leaves them to the OS setting
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const server = useServer.getState()
    const poll = new PollClient({
      // Load the lab info, settings, profile and conversation list whenever contact is made, so a
      // page opened before the server was up (or a restarted server) fills in by itself
      onConnected: (wasLost) => {
        server.loadAll()
        void useEvals.getState().refresh()
        if (wasLost) toast({ kind: 'ok', title: 'Back in touch with the server' })
        // The conversation named in the address: opened once, so a later reconnect (say after the
        // server restarted) never swaps it in again
        const id = hashConversation.current
        if (id) {
          hashConversation.current = null
          void (async () => {
            // opened: the next poll brings the conversation in and the effect above writes the address
            if (id !== useSession.getState().conversation && await openConversation(id, { goneToast: true })) return
            const s = useSession.getState()
            const h = toHash(useUi.getState().screen, s.derived.runs.length > 0 ? s.conversation : null)
            if (location.hash !== h) history.replaceState(null, '', h)
          })()
        }
      },
      onNewConversation: () => {
        useUi.getState().follow()
        server.loadConversations()
        server.loadInfo()
      },
      onFinished: () => {
        server.loadConversations() // it was just saved
        server.loadProfile() // the model may have remembered something
      },
    })
    setPoke(() => poll.now())
    poll.start()
    return () => poll.stop()
  }, [])

  // A tool is waiting for your Allow or Decline: bring the chat to the front (narrow Inspect pane), or
  // say so from another screen with a way back
  useEffect(() => useSession.subscribe((s, prev) => {
    const p = s.derived.pendingApproval
    if (!p || p.id === prev.derived.pendingApproval?.id) return
    const ui = useUi.getState()
    if (ui.mobilePane !== 'chat') ui.setMobilePane('chat')
    if (ui.screen !== 'run') toast({ kind: 'info', title: 'The harness is waiting for you', body: 'A tool needs your Allow or Decline.', action: { label: 'Go to the conversation', run: () => ui.setScreen('run') } })
  }), [])

  // A and D answer only once the panel has been on screen a moment (see ApprovalDock)
  const dockArmed = () => { const d = useUi.getState().approvalDock; return !!d && d.armed() }
  useShortcuts([
    { key: 'Escape', whileTyping: true, when: escapeStops, run: () => stop() },
    { key: 'a', when: dockArmed, run: () => useUi.getState().approvalDock!.answer(true) },
    { key: 'd', when: dockArmed, run: () => useUi.getState().approvalDock!.answer(false) },
    { key: '[', repeat: true, when: onRunScreen, run: () => step(-1) },
    { key: ']', repeat: true, when: onRunScreen, run: () => step(1) },
    // for keyboards where [ needs AltGr; also while typing, so the browser's own Alt+← (Back) can't leave the page
    { key: 'ArrowLeft', alt: true, whileTyping: true, repeat: true, when: onRunScreen, run: () => step(-1) },
    { key: 'ArrowRight', alt: true, whileTyping: true, repeat: true, when: onRunScreen, run: () => step(1) },
    { key: ',', ctrl: true, run: () => useUi.getState().toggleSettings() },
    { key: '?', run: () => useUi.getState().setHelp(true) },
    { key: '/', when: onRunScreen, run: () => { const dock = useUi.getState().approvalDock; if (dock) dock.focus(); else composer.current?.focus() } },
  ])

  const sidebar = <Sidebar onPicked={() => useUi.getState().setSidebarSheet(false)} />

  return (
    <RTooltip.Provider>
      <div className="flex h-dvh flex-col bg-bg text-fg">
        <SkipLink screen={screen} />
        <TopBar narrow={narrow} />
        <ConnectionBanner />
        <div className="flex min-h-0 flex-1">
          {!narrow && !sidebarCollapsed && <div id="sidebar" className="w-64 shrink-0 border-r border-line">{sidebar}</div>}
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 basis-[420px] outline-none">
            {screen === 'compare' ? <CompareScreen /> : screen === 'evals' ? <EvalsScreen /> : narrow ? (
              <div className="flex h-full flex-col">
                <div className="flex shrink-0 justify-center border-b border-line bg-panel p-1">
                  <div className={SEGMENT_TRACK} role="group" aria-label="Show">
                    {(['chat', 'inspect'] as const).map((p) => (
                      <button key={p} type="button" aria-pressed={mobilePane === p} onClick={() => useUi.getState().setMobilePane(p)}
                        className={cn(segmentItem(mobilePane === p), 'px-4')}>
                        {p === 'chat' ? 'Chat' : 'Inspect'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  {mobilePane === 'chat' ? <RunView composerRef={composer} onRerun={rerun} onRewind={setRewinding} /> : <Inspector />}
                </div>
              </div>
            ) : <RunView composerRef={composer} onRerun={rerun} onRewind={setRewinding} />}
          </main>
          {!narrow && screen === 'run' && inspectorOpen && hasCalls && (
            <div className="relative shrink-0 border-l border-line" style={{ width: inspectorWidthCss(inspectorWidth, !sidebarCollapsed) }}>
              <ResizeHandle />
              <Inspector onClose={closeInspector} />
            </div>
          )}
        </div>
      </div>
      {narrow && (
        <Dialog.Root open={sidebarSheet} onOpenChange={(o) => useUi.getState().setSidebarSheet(o)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60" />
            <Dialog.Content id="sidebar" aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-sunken shadow-xl">
              <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
                <Dialog.Title className="text-sm font-semibold">Conversations</Dialog.Title>
                <Dialog.Close asChild><IconButton size="sm" label="Close" className="text-muted hover:text-fg"><X className="size-4" /></IconButton></Dialog.Close>
              </div>
              <div className="min-h-0 flex-1">{sidebar}</div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      <SettingsDrawer />
      <HelpSheet />
      <ExperimentsDialog />
      <RewindDialog run={rewinding} onClose={() => setRewinding(null)} />
      <Toaster />
      <Announcer />
    </RTooltip.Provider>
  )
}

// F309: the first thing Tab reaches. A click handler, not the browser's own jump: a changed address would
// count as leaving the conversation (the address names the screen and the conversation)
function SkipLink({ screen }: { screen: string }) {
  const toBox = screen === 'run'
  return (
    <a href={toBox ? '#message-box' : '#main'}
      onClick={(e) => {
        e.preventDefault()
        // while the harness waits for your Allow or Decline the box is hidden: the panel takes focus instead
        const dock = toBox ? useUi.getState().approvalDock : null
        if (dock) return dock.focus()
        const box = toBox ? document.getElementById('message-box') : null
        ;(box ?? document.getElementById('main'))?.focus()
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus-ring rounded-md border border-line bg-panel px-3 py-1 text-sm">
      {toBox ? 'Skip to the message box' : 'Skip to the main content'}
    </a>
  )
}

// The inspector's left edge: drag to make it wider or narrower (double-click to reset)
export function ResizeHandle() {
  const sidebarOpen = !usePrefs((s) => s.sidebarCollapsed)
  const viewport = useViewportWidth()
  // Never stores more than can be shown, so the arrows and the reported width match what you see
  const most = Math.min(window.innerWidth * 0.65, inspectorRoom(sidebarOpen, window.innerWidth))
  const set = (px: number) => usePrefs.getState().setInspectorWidth(Math.round(Math.max(Math.min(320, most), Math.min(most, px))))
  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => set(window.innerWidth - ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const width = shownInspectorWidth(usePrefs((s) => s.inspectorWidth), sidebarOpen, viewport)
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Inspector width (← → to change, Home to reset)" tabIndex={0}
      aria-valuenow={width} aria-valuemin={Math.round(Math.min(320, most))} aria-valuemax={Math.round(most)}
      title="Drag to resize · double-click to reset"
      onPointerDown={start} onDoubleClick={() => usePrefs.getState().setInspectorWidth(440)}
      onKeyDown={(e) => {
        // the edge is on the Inspector's left: moving it left makes the Inspector wider
        if (e.key === 'ArrowLeft') { e.preventDefault(); set(width + 32) }
        if (e.key === 'ArrowRight') { e.preventDefault(); set(width - 32) }
        // Home puts back the usual width (shown as wide as the window allows)
        if (e.key === 'Home') { e.preventDefault(); usePrefs.getState().setInspectorWidth(440) }
      }}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none hover:bg-accent/30 focus-visible:bg-accent/50 active:bg-accent/40" />
  )
}

// [ and ]: step to the previous or next model call. It opens the Inspector and reads the call out (F425);
// at either end it says so, rather than nothing
function step(d: number) {
  const order = useSession.getState().derived.callOrder
  if (!order.length) return
  const ui = useUi.getState()
  const current = ui.followLatest || !ui.selectedCallId ? order[order.length - 1] : ui.selectedCallId
  const at = order.indexOf(current)
  const i = Math.max(0, Math.min(order.length - 1, at + d))
  const stuck = i === at && (d < 0 || !ui.followLatest)
  inspectCall(order[i], { before: stuck ? (d < 0 ? 'Already at the first call. ' : 'Already at the newest call. ') : '' })
}

// F426: hiding the Inspector puts focus back on the call it showed, in the chat (its button is gone)
function closeInspector() {
  usePrefs.getState().setInspectorOpen(false)
  const order = useSession.getState().derived.callOrder
  const ui = useUi.getState()
  const id = !ui.followLatest && ui.selectedCallId && order.includes(ui.selectedCallId) ? ui.selectedCallId : order[order.length - 1]
  const divider = callDivider(id)
  ;(divider ?? document.getElementById('main'))?.focus()
}

// "Re-run with current settings" on a past message: the saved run against a new one
function rerun(run: Run) {
  const conversation = useSession.getState().conversation
  if (conversation) useCompare.getState().rerun(conversation, run.userSeq, run.text)
}
