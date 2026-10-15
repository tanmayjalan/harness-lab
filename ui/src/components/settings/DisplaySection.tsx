// Settings → Display: kept in this browser only.
import { undoToast } from '../../lib/undoToast'
import { toast, usePrefs, type FontSize, type Theme } from '../../store/ui'
import { Button, RadioRow } from '../ui'
import { Heading } from './common'

// ---- Display ----

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
        <Button size="sm" onClick={() => { prefs.resetExplained(); toast({ kind: 'ok', title: 'Explanations will show in full once more' }) }}>
          Show all explanations again once
        </Button>
        <Button size="sm" onClick={() => {
          const was = prefs.experimentsDone
          prefs.resetExperimentsDone()
          undoToast('Experiment progress cleared', () => { usePrefs.setState({ experimentsDone: was }) }, 'The ticks on the experiment cards are gone.')
        }}>
          Reset experiment progress
        </Button>
      </div>
    </div>
  )
}
