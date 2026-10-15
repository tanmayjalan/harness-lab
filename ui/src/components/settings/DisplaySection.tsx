// Settings → Display: kept in this browser only.
import { putBack } from '../../learn/setup'
import { undoToast } from '../../lib/undoToast'
import { usePrefs, type FontSize, type Theme } from '../../store/ui'
import { Button, RadioRow } from '../ui'
import { Heading } from './common'

// ---- Display ----

// F449: back to a first-time learner's view in one go (a workshop's next attendee, or a second try).
// What the browser keeps: explanations seen, experiment ticks, quiz answers, the "inspect" hint, and any
// experiment Undo still waiting. That experiment's change is put back first, so nothing it set stays behind
export function StartOver() {
  async function run() {
    const before = usePrefs.getState().experimentBefore
    if (before && !(await putBack({ quiet: true }))) return // it said why; nothing cleared
    const { explained, experimentsDone, quizAnswers, inspectHintSeen } = usePrefs.getState()
    usePrefs.getState().startOver()
    undoToast('Started over as a new learner',
      () => { usePrefs.setState({ explained, experimentsDone, quizAnswers, inspectHintSeen }) },
      'Explanations show in full again; the experiment ticks and quiz answers are cleared.'
        + (before ? ` The experiment's change (${before.changes.join(', ')}) is put back; Undo doesn't bring it back.` : ''))
  }
  return (
    <div className="space-y-2 rounded-lg border border-line p-4">
      <Button size="sm" onClick={() => void run()} aria-describedby="start-over-help">Start over as a new learner</Button>
      <p id="start-over-help" className="text-xs text-muted">
        Shows every explanation in full again and clears the experiment ticks and quiz answers, with one Undo.
        A setting an experiment changed (its Undo above the message box) is put back first. Memory,
        conversations and the workspace files stay as they are: docs/workshop.md says how to reset those.
      </p>
    </div>
  )
}

// The Inspector's width without dragging its edge (the edge and its arrow keys still work)
const WIDTHS: [string, number][] = [['narrow', 360], ['usual', 440], ['wide', 720]]

export function DisplaySection() {
  const prefs = usePrefs()
  const width = WIDTHS.find(([, px]) => px === prefs.inspectorWidth)?.[0]
  return (
    <div className="space-y-6">
      <Heading title="Display">Kept in this browser only.</Heading>
      <fieldset className="space-y-2 rounded-lg border border-line p-4">
        <legend className="px-1 font-medium">Inspector width</legend>
        <RadioRow label="Inspector width" value={width ?? null} onChange={(w) => prefs.setInspectorWidth(WIDTHS.find(([k]) => k === w)![1])}
          options={WIDTHS.map(([k, px]) => [k, k[0].toUpperCase() + k.slice(1), `${px} px, as wide as the window allows`])} />
        {!width && <p className="text-xs text-muted">Now {prefs.inspectorWidth} px, set by dragging its edge.</p>}
      </fieldset>
      <fieldset className="space-y-2 rounded-lg border border-line p-4">
        <legend className="px-1 font-medium">Text size</legend>
        <RadioRow<FontSize> label="Text size" value={prefs.fontSize} onChange={(f) => prefs.setFontSize(f)}
          options={[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']]} />
      </fieldset>
      <fieldset className="space-y-2 rounded-lg border border-line p-4">
        <legend className="px-1 font-medium">Light or dark</legend>
        <RadioRow<Theme> label="Light or dark" value={prefs.theme} onChange={(t) => prefs.setTheme(t)} describedBy="theme-help"
          options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} />
        <p id="theme-help" className="text-xs text-muted">System follows your computer's setting.</p>
      </fieldset>
      <div className="space-y-2 rounded-lg border border-line p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={prefs.learningMode} onChange={(e) => prefs.setLearningMode(e.target.checked)} />
          Learning mode: always show every explanation in full
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={prefs.alwaysDetails} onChange={(e) => prefs.setAlwaysDetails(e.target.checked)} />
          Always show details under each answer (every call, its tokens and tool rows), not only the steps
        </label>
      </div>
      <StartOver />
    </div>
  )
}
