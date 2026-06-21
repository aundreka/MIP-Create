// Template usage log — records which client + MIP used which game template, e.g.
// "Bioma · MIP3" under the Scratch card template. Editor metadata, persisted to
// localStorage (kept out of the project/undo store).

const LS_KEY = 'pa:tpl-usage'

export interface Usage {
  id: string
  templateId: string
  client: string
  mip: string
}

function load(): Usage[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? (JSON.parse(raw) as Usage[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

let cache = load()

function save(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
}

export function allUsages(): Usage[] {
  return cache.slice()
}

export function usagesFor(templateId: string): Usage[] {
  return cache.filter((u) => u.templateId === templateId)
}

export function addUsage(templateId: string, client: string, mip: string): void {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  cache.push({ id, templateId, client: client.trim(), mip: mip.trim() })
  save()
}

export function removeUsage(id: string): void {
  cache = cache.filter((u) => u.id !== id)
  save()
}
