// The button that re-runs and lets Ask-first tools through
import { useState } from 'react'
import { Button } from '../ui'
import { andList, letThroughWords } from './letThrough'

// F389: the re-run that lets Ask-first tools through names them, and asks once more when that means
// running code you haven't seen
export function RerunLettingThrough({ tools, run }: { tools: string[]; run: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const code = tools.includes('run_python')
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-xs font-medium">Let the model's code run without you seeing it first?</span>
          <Button size="sm" variant="danger" onClick={() => { setConfirming(false); run() }}>Yes, re-run and let it run</Button>
          {/* (the button you pressed is gone: focus lands on the safe choice) */}
          <Button size="sm" variant="ghost" autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
        </>
      ) : (
        <Button size="sm" onClick={() => (code ? setConfirming(true) : run())}>
          Re-run letting Ask-first tools run: {andList(tools)}
        </Button>
      )}
      {letThroughWords(tools, 1).map((w) => <span key={w} className="basis-full text-xs">{w}</span>)}
    </span>
  )
}
