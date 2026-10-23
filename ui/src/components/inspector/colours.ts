// The colours of the made-of and time bars
import type { Part } from '../../model/inspector'

// Full colours, each at least 3:1 against the panel; a 1 px gap of panel between parts tells them apart
export const PART_COLOURS: Record<Part['key'], string> = {
  system: 'bg-muted', tools: 'bg-warn', earlier: 'bg-line-strong', results: 'bg-accent', new: 'bg-ok',
}
export const TIME_COLOURS = { model: 'bg-accent', overhead: 'bg-line-strong', retrying: 'bg-bad', tools: 'bg-ok', waited: 'bg-warn' }
