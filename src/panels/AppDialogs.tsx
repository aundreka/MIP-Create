// In-app replacements for native alert()/confirm() — awaitable one-liners backed
// by a module-level queue + one <AppDialogHost /> mounted in App. Built on the
// shared Modal (portal, backdrop, focus), so dialogs match the UI and stack above
// whatever surface fired them (Home overlay, drawers, other modals).

import { useEffect, useState } from 'react'
import { Modal } from '../ui'

export type DialogOpts = {
  title?: string
  /** Primary button label ('OK' / 'Confirm' by default). */
  okLabel?: string
  cancelLabel?: string
  /** Destructive confirm: the primary button renders in --danger. */
  danger?: boolean
}

type Pending = {
  id: number
  kind: 'alert' | 'confirm'
  message: string
  opts: DialogOpts
  resolve: (ok: boolean) => void
}

// Module-level store so plain .ts modules (store, export, bridge) can raise
// dialogs without a React context. The host re-renders on every queue change;
// dialogs show one at a time, in order.
let queue: Pending[] = []
let seq = 0
let notify: (() => void) | null = null

function push(p: Omit<Pending, 'id'>): void {
  queue = [...queue, { ...p, id: ++seq }]
  notify?.()
}

/** Styled drop-in for window.alert. Resolves when dismissed. */
export function appAlert(message: string, opts: DialogOpts = {}): Promise<void> {
  return new Promise((res) => push({ kind: 'alert', message, opts, resolve: () => res() }))
}

/** Styled drop-in for window.confirm. Resolves true on confirm, false on cancel/Esc. */
export function appConfirm(message: string, opts: DialogOpts = {}): Promise<boolean> {
  return new Promise((res) => push({ kind: 'confirm', message, opts, resolve: res }))
}

// ---- confirmDestructive: gate an unrecoverable action behind a confirm -------
// Used before project-replacing loads (loadProject clears undo history) and other
// destructive actions. (Moved here from ui.tsx when it became dialog-backed.)
export function confirmDestructive(message: string): Promise<boolean> {
  return appConfirm(message, { danger: true })
}

export function AppDialogHost(): JSX.Element | null {
  const [, rerender] = useState(0)
  useEffect(() => {
    notify = () => rerender((n) => n + 1)
    return () => {
      notify = null
    }
  }, [])
  const cur = queue[0]

  const close = (ok: boolean): void => {
    if (!cur) return
    queue = queue.slice(1)
    cur.resolve(ok)
    rerender((n) => n + 1)
  }

  // Esc cancels, Enter confirms. Capture-phase so an underlying Modal's own Esc
  // listener (bubble on window) never fires while a dialog is on top — Esc must
  // dismiss only the dialog, not the surface beneath it.
  useEffect(() => {
    if (!cur) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close(false)
      } else if (e.key === 'Enter') {
        // A focused dialog button handles Enter itself (so Tab→Cancel→Enter cancels).
        const t = e.target as HTMLElement | null
        if (t?.closest('.app-dialog') && t.tagName === 'BUTTON') return
        e.preventDefault()
        e.stopPropagation()
        close(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id])

  if (!cur) return null
  const title = cur.opts.title ?? (cur.kind === 'confirm' ? 'Confirm' : 'Notice')
  // Primary button first in DOM so Modal's autofocus lands on it (Enter confirms);
  // the row is row-reversed in CSS so it still sits on the right.
  return (
    <Modal key={cur.id} title={title} onClose={() => close(false)} size="sm" className="app-dialog">
      <div className="app-dialog-msg">{cur.message}</div>
      <div className="app-dialog-btns">
        <button className={'primary' + (cur.opts.danger ? ' danger' : '')} onClick={() => close(true)}>
          {cur.opts.okLabel ?? (cur.kind === 'confirm' ? 'Confirm' : 'OK')}
        </button>
        {cur.kind === 'confirm' && <button onClick={() => close(false)}>{cur.opts.cancelLabel ?? 'Cancel'}</button>}
      </div>
    </Modal>
  )
}
