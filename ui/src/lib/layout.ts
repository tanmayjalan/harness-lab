// How wide the columns are: the sums the page and the Inspector share
import { useEffect, useState } from 'react'
import { usePrefs } from '../store/ui'

// Below this window width the page shows one column at a time (Chat or Inspect)
export const ONE_COLUMN = 900

// The Inspector's width: what you set, but never so wide that the conversation gets under 420 px
export function inspectorWidthCss(width: number, sidebarOpen: boolean) {
  return `min(${width}px, max(300px, calc(100vw - ${sidebarOpen ? 256 : 0}px - 420px)))`
}

// The same sum in pixels: how wide the Inspector really is, for a stored width and a window width
export function shownInspectorWidth(width: number, sidebarOpen: boolean, viewport: number) {
  return Math.min(width, inspectorRoom(sidebarOpen, viewport))
}

// The widest the Inspector can be shown: the run view keeps 420px, the sidebar 256px when open
export function inspectorRoom(sidebarOpen: boolean, viewport: number) {
  return Math.max(300, viewport - (sidebarOpen ? 256 : 0) - 420)
}

export function useViewportWidth() {
  const [viewport, setViewport] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return viewport
}

// The width the Inspector has on screen: the whole window in the one-column layout, else the stored
// width as far as the window allows
export function useShownInspectorWidth() {
  const viewport = useViewportWidth()
  const sidebarOpen = !usePrefs((s) => s.sidebarCollapsed)
  const stored = usePrefs((s) => s.inspectorWidth)
  return viewport < ONE_COLUMN ? viewport : shownInspectorWidth(stored, sidebarOpen, viewport)
}
