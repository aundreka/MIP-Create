// Command palette (Cmd/Ctrl+K). Fuzzy-filters the command registry; arrow keys
// move, Enter runs, Esc closes. Commands only invoke existing store actions.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Command } from '../commands'
import { Icon, Search } from '../icons'

export function CommandPalette(props: { commands: Command[]; onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return props.commands
    return props.commands.filter((c) => c.title.toLowerCase().includes(s) || (c.hint?.toLowerCase().includes(s) ?? false))
  }, [q, props.commands])

  useEffect(() => {
    setActive(0)
  }, [q])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (c: Command | undefined): void => {
    if (!c) return
    props.onClose()
    c.run()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(filtered.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(filtered[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
    }
  }

  return (
    <div className="modal-overlay cmdk-overlay" onClick={props.onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()} onKeyDown={onKey} role="dialog" aria-modal="true">
        <div className="cmdk-search">
          <Icon icon={Search} size={16} />
          <input ref={inputRef} value={q} placeholder="Search commands…" onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="cmdk-list" ref={listRef}>
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={'cmdk-item' + (i === active ? ' active' : '')}
              onMouseMove={() => setActive(i)}
              onClick={() => run(c)}
            >
              {c.icon ? <Icon icon={c.icon} size={15} /> : <span className="cmdk-ico-spacer" />}
              <span className="cmdk-title">{c.title}</span>
              {c.hint && <span className="cmdk-hint">{c.hint}</span>}
            </button>
          ))}
          {!filtered.length && <div className="hint pad">No matching commands.</div>}
        </div>
      </div>
    </div>
  )
}
