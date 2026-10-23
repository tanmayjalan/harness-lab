// A pointer from an Inspector tab to the code behind it
import type { ReactNode } from 'react'

// F444: a quiet pointer from a tab to the Python function behind it (names, not line numbers, so it stays true)
export function InCode({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">In the code: {children}</p>
}
