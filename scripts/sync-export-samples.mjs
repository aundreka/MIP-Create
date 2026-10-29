// Regenerates src/exportShell.generated.ts from docs/mip_sample.html and
// docs/sip_sample.html (see scripts/export-shell.mjs). Run after either sample changes:
//
//   npm run sync:samples
//
// Then rebuild the runtime (`npm run build:runtime`) and run the tests.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractMip, extractSip, renderGenerated } from './export-shell.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'exportShell.generated.ts')

const mip = extractMip(readFileSync(join(ROOT, 'docs', 'mip_sample.html'), 'utf8'))
const sip = extractSip(readFileSync(join(ROOT, 'docs', 'sip_sample.html'), 'utf8'))
const next = renderGenerated(mip, sip)

let prev = ''
try {
  prev = readFileSync(OUT, 'utf8')
} catch { /* first run */ }

if (prev === next) {
  console.log('✓ src/exportShell.generated.ts already matches the samples')
} else {
  writeFileSync(OUT, next)
  console.log('✓ wrote src/exportShell.generated.ts from the samples')
}
console.log(`  MIP: date accessor window.${mip.dateAccessor}, boot release window.${mip.bootFlag} / window.${mip.bootCallback}()`)
console.log(`  SIP: date accessor window.${sip.dateAccessor}`)
