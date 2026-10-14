// Adds DOM matchers such as toBeInTheDocument() to Vitest's expect, and clears the page between tests
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => cleanup())

// Every render gets the tooltip provider the App puts around the page, so a component with an IconButton
// (whose label is also a tooltip) renders on its own, as it does inside the App
vi.mock('@testing-library/react', async (importOriginal) => {
  const rtl = await importOriginal<typeof import('@testing-library/react')>()
  const { createElement } = await import('react')
  const { Provider } = await import('@radix-ui/react-tooltip')
  const render: typeof rtl.render = ((ui: Parameters<typeof rtl.render>[0], options?: Parameters<typeof rtl.render>[1]) =>
    rtl.render(ui, { wrapper: ({ children }) => createElement(Provider, null, children), ...options })) as typeof rtl.render
  return { ...rtl, render }
})
