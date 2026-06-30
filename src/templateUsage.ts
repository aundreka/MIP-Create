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

// ---- brands -----------------------------------------------------------------
// A "brand" is the `client` on a usage (e.g. "Feenko"). The usage log is already
// a many-to-many map: one template can carry many brand tags, one brand can tag
// many templates. These helpers derive the brand facet for the Home filter.

const norm = (s: string): string => s.trim().toLowerCase()

// Distinct brands across every usage, sorted A→Z, keeping the first-seen casing.
export function allBrands(): { name: string; count: number }[] {
  const byKey = new Map<string, { name: string; ids: Set<string> }>()
  for (const u of cache) {
    const name = u.client.trim()
    if (!name) continue
    const key = norm(name)
    const e = byKey.get(key) ?? { name, ids: new Set<string>() }
    e.ids.add(u.templateId)
    byKey.set(key, e)
  }
  return [...byKey.values()]
    .map((e) => ({ name: e.name, count: e.ids.size }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Distinct brand names tagging one template (for the chips on its card).
export function brandsFor(templateId: string): string[] {
  const seen = new Map<string, string>()
  for (const u of cache) {
    if (u.templateId !== templateId) continue
    const name = u.client.trim()
    if (name && !seen.has(norm(name))) seen.set(norm(name), name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

// Template ids tagged with a given brand (case-insensitive) — drives the filter.
export function templateIdsForBrand(brand: string): Set<string> {
  const key = norm(brand)
  const out = new Set<string>()
  for (const u of cache) if (norm(u.client) === key) out.add(u.templateId)
  return out
}
