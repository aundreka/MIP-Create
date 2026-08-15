// Turning a stored font-family value into something CSS will actually accept.
//
// A font asset's id doubles as its CSS family name (see src/bridge.ts importFont),
// and that id is derived from the uploaded filename. Upload `068ad4a6548dab7c.otf`
// and the family becomes `068ad4a6548dab7c` — a perfectly legal FontFace family,
// but NOT a legal *unquoted* CSS identifier, because an identifier may not start
// with a digit. Assigning it to `style.fontFamily` makes the CSSOM reject the whole
// declaration silently: the property keeps its previous value, the loaded face is
// never asked for, and the text renders in the browser's default serif. Same trap
// for any family carrying punctuation — a hand-typed `Exposure[-30]` is dropped too.
//
// So quote. But the same field also holds hand-typed stacks from before the font
// picker existed ("Poppins, sans-serif"), and quoting one of those whole would turn
// a two-family fallback list into one absurd family name. Hence: split into families,
// then quote only the ones that aren't already legal on their own.

// One family per match: a quoted string (which may contain commas) or a run of
// anything up to the next comma.
const FAMILIES = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+/g

// A CSS identifier: a letter or underscore (optionally behind one hyphen), then
// word characters and hyphens. Generic keywords like `sans-serif` and `system-ui`
// match this, so they pass through untouched. Non-ASCII names fall through to the
// quoted branch, which renders identically.
const IDENT = /^-?[^\W\d][\w-]*$/

function quoteFamily(raw: string): string {
  const name = raw.trim()
  if (!name) return ''
  // Already quoted by whoever typed it — leave their escaping alone.
  if (/^"[\s\S]*"$/.test(name) || /^'[\s\S]*'$/.test(name)) return name
  // An unquoted family may be several space-separated identifiers ("Times New Roman").
  if (name.split(/\s+/).every((word) => IDENT.test(word))) return name
  return '"' + name.replace(/[\\"]/g, '\\$&') + '"'
}

/** Make a stored font-family value safe to assign to `style.fontFamily`.
 * Returns '' for an empty/missing value so callers can fall back. */
export function cssFontFamily(value: string | null | undefined): string {
  if (!value) return ''
  return (value.match(FAMILIES) ?? []).map(quoteFamily).filter(Boolean).join(',')
}
