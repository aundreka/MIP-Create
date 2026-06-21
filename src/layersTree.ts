// Build a one-level layer tree from the flat element list. Consecutive elements
// (front-first z-order) sharing a groupId collapse into a group node; everything
// else is a leaf. Grouping is a flat tag (matches groupSelected), so this is
// intentionally one level deep. DnD reorder still operates on the flat id list.

import type { SceneElement } from '../runtime/scene'

export interface LayerLeaf {
  kind: 'leaf'
  el: SceneElement
}
export interface LayerGroup {
  kind: 'group'
  groupId: string
  children: SceneElement[]
}
export type LayerNode = LayerLeaf | LayerGroup

export function buildLayerTree(orderedFrontFirst: SceneElement[]): LayerNode[] {
  const nodes: LayerNode[] = []
  let i = 0
  while (i < orderedFrontFirst.length) {
    const el = orderedFrontFirst[i]
    const gid = el.groupId
    if (gid) {
      const children: SceneElement[] = []
      while (i < orderedFrontFirst.length && orderedFrontFirst[i].groupId === gid) {
        children.push(orderedFrontFirst[i])
        i++
      }
      if (children.length > 1) nodes.push({ kind: 'group', groupId: gid, children })
      else nodes.push({ kind: 'leaf', el: children[0] })
    } else {
      nodes.push({ kind: 'leaf', el })
      i++
    }
  }
  return nodes
}
