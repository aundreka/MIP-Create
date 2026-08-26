// Registry validation — the gate a contributed mechanic must pass. A new game is
// added by dropping a module that exports a GameTemplate and registering it in
// registry.ts; this checks the whole registry conforms to the contract so a
// malformed contribution fails fast (in CI, or as a dev-console warning) instead
// of breaking the editor at runtime. Pure; safe to run anywhere.

import type { GameTemplate, ParamField } from './types'

const FIELD_TYPES = new Set(['number', 'color', 'select', 'text', 'boolean', 'font'])
const ACCEPTS = new Set(['image', 'video', 'audio', 'html'])

function checkField(tplId: string, f: ParamField, errs: string[]): void {
  const at = `${tplId}.paramFields["${f?.key ?? '?'}"]`
  if (!f || typeof f.key !== 'string' || !f.key) errs.push(`${at}: missing "key"`)
  if (!f || typeof f.label !== 'string' || !f.label) errs.push(`${at}: missing "label"`)
  if (!FIELD_TYPES.has(f?.type)) errs.push(`${at}: type must be one of ${[...FIELD_TYPES].join('|')} (got "${f?.type}")`)
  if (f?.type === 'select' && (!Array.isArray(f.options) || !f.options.length)) errs.push(`${at}: select needs non-empty "options"`)
}

/** Validate one template against the GameTemplate contract. Returns error strings (empty = OK). */
export function validateTemplate(tpl: GameTemplate): string[] {
  const errs: string[] = []
  const id = tpl?.id ?? '(no id)'
  if (!tpl || typeof tpl.id !== 'string' || !tpl.id) errs.push(`${id}: missing "id"`)
  if (!tpl || typeof tpl.label !== 'string' || !tpl.label) errs.push(`${id}: missing "label"`)
  if (typeof tpl?.create !== 'function') errs.push(`${id}: "create" must be a function returning a GameModule`)
  if (tpl?.defaultParams == null || typeof tpl.defaultParams !== 'object') errs.push(`${id}: "defaultParams" must be an object`)
  if (!Array.isArray(tpl?.paramFields)) errs.push(`${id}: "paramFields" must be an array`)
  else tpl.paramFields.forEach((f) => checkField(id, f, errs))
  if (tpl?.assetSlots != null) {
    if (!Array.isArray(tpl.assetSlots)) errs.push(`${id}: "assetSlots" must be an array when present`)
    else
      for (const s of tpl.assetSlots) {
        const at = `${id}.assetSlots["${s?.key ?? '?'}"]`
        if (!s || typeof s.key !== 'string' || !s.key) errs.push(`${at}: missing "key"`)
        if (!s || typeof s.label !== 'string' || !s.label) errs.push(`${at}: missing "label"`)
        if (s?.accept && !ACCEPTS.has(s.accept)) errs.push(`${at}: accept must be one of ${[...ACCEPTS].join('|')}`)
        if (s?.list && s.countParam && !tpl.paramFields.some((f) => f.key === s.countParam)) errs.push(`${at}: countParam "${s.countParam}" has no matching paramField`)
      }
  }
  return errs
}

/** Validate the whole registry: every template conforms and all ids are unique. */
export function validateRegistry(templates: GameTemplate[]): string[] {
  const errs: string[] = []
  const seen = new Set<string>()
  for (const tpl of templates) {
    errs.push(...validateTemplate(tpl))
    if (tpl?.id) {
      if (seen.has(tpl.id)) errs.push(`duplicate template id "${tpl.id}"`)
      seen.add(tpl.id)
    }
  }
  return errs
}
