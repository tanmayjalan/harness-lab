// The letters A, B and C that name the sides


export const LETTERS = 'ABC'

// A side's round letter, the name progress, deltas and toasts use for it
export function SideLetter({ letter }: { letter: string }) {
  return <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{letter}</span>
}
