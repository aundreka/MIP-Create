import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './editor.css'
import { selectOnly, subscribe } from './store'
import { bootProjects, saveCurrent } from './projects'
import { initTheme } from './theme'

// Apply the saved editor theme before first paint to avoid a flash of the
// wrong palette.
initTheme()

// Open the last project (or create one), from the localStorage project library.
bootProjects()

// Optional deep-link: #sel=<elementId> preselects an element (handy for testing
// and for jumping straight to an element).
const selMatch = /(?:^|[#&])sel=([^&]+)/.exec(location.hash)
if (selMatch) selectOnly(decodeURIComponent(selMatch[1]))

// Debounced autosave to the current project's slot.
let t: number | undefined
subscribe(() => {
  window.clearTimeout(t)
  t = window.setTimeout(() => saveCurrent(), 400)
})

// Surface render crashes instead of a blank page.
class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null }
  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err }
  }
  componentDidCatch(err: Error): void {
    console.error('Editor crashed:', err)
  }
  render(): ReactNode {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, font: "13px/1.5 'Montserrat', system-ui, sans-serif", color: '#e0556b' }}>
          <h2 style={{ margin: '0 0 8px' }}>The editor hit an error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#9aa5bd' }}>{String(this.state.err?.stack ?? this.state.err)}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
