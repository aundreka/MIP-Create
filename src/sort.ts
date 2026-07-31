export type SortDir = 'asc' | 'desc'

export interface SortState<K extends string> {
  key: K
  dir: SortDir
}

export function toggleSort<K extends string>(cur: SortState<K>, key: K): SortState<K> {
  return cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
}

export function cmpText(a: string | null | undefined, b: string | null | undefined): number {
  const aa = (a ?? '').trim()
  const bb = (b ?? '').trim()
  if (!aa && !bb) return 0
  if (!aa) return 1
  if (!bb) return -1
  return aa.localeCompare(bb, undefined, { numeric: true, sensitivity: 'base' })
}

export function cmpNumber(a: number | null | undefined, b: number | null | undefined): number {
  const aa = a ?? Number.NEGATIVE_INFINITY
  const bb = b ?? Number.NEGATIVE_INFINITY
  return aa === bb ? 0 : aa < bb ? -1 : 1
}
