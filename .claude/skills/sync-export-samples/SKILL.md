---
name: sync-export-samples
description: Re-match the builder's MIP and SIP exports to docs/mip_sample.html and docs/sip_sample.html after either sample (or docs/AGENTS.md / docs/LOCALIZATION.md) changes. Use when the user says the samples or guidelines were updated, or asks to make exports match the samples again.
---

# Sync exports to the reference samples

`docs/mip_sample.html` and `docs/sip_sample.html` are the source of truth for every
network-facing part of an export. The builder never hand-writes that shell:

| Piece | Where |
|---|---|
| Extractors (what is taken from each sample, verbatim) | `scripts/export-shell.mjs` |
| Generated shell constants (`MIP_*`, `SIP_*`) | `src/exportShell.generated.ts` (never edit by hand) |
| Assembly: sample shell + our styles, data, runtime and glue | `buildBaseHtml` in `src/export.ts` (`MIP_BOOT`, `SIP_BODY`) |
| Runtime side of the contract (`handleClickAction`, `PA_NOW` date, `[Analytics]`, boot) | `runtime/networks.ts`, `runtime/export-entry.ts`, `runtime/elements/countdown.ts`, `runtime/i18n.ts` |
| Rules a validator applies (shell present verbatim, reserved click ids, browser navigation, literal URLs, imported HTML end cards) | `shellFindings` in `src/preflight.ts` |
| Drift gate | `src/exportShell.test.ts` (fails while the generated file is stale) |

The builder's SIP keeps rendering the end card with its runtime (HTML import, video or image card, plus anything added on top). Only the SIP sample's shell is used, never its video template.

## Steps

1. **See what changed.** Diff the samples with their base64 stripped:
   ```bash
   for f in mip_sample sip_sample; do
     git show HEAD:docs/$f.html 2>/dev/null | perl -pe 's/(;base64,)[A-Za-z0-9+\/=]{200,}/$1<B64>/g' > /tmp/$f.old.html
     perl -pe 's/(;base64,)[A-Za-z0-9+\/=]{200,}/$1<B64>/g' docs/$f.html > /tmp/$f.new.html
     diff /tmp/$f.old.html /tmp/$f.new.html | cut -c1-300
   done
   ```
   Also diff `docs/AGENTS.md` and `docs/LOCALIZATION.md` if they changed. The MIP sample's minified bundle (`<script>var …` in `<head>`) is not copied. Read it for behaviour the runtime must mirror, such as analytics event names, lifecycle stubs, the CTA order (`gameClose` → `CTA_CLICKED` → `handleClickAction`) and how it waits on the boot flag.

2. **Regenerate the shell:**
   ```bash
   npm run sync:samples
   ```
   If it throws `could not find …`, the sample's structure moved. Update the matching extractor in `scripts/export-shell.mjs`, keep it verbatim (never paraphrase sample code), and re-run. If a piece was added, renamed or removed, follow it through `buildBaseHtml` (`src/export.ts`), `shellFindings` (`src/preflight.ts`), `src/viteExport.ts` (Vite source export, which uses the MIP head) and `scripts/mraid-check.mjs`.

3. **Mirror behaviour changes in the runtime.** Examples: a new click rule goes in `triggerCTA` / `clickTagUrl` in `runtime/networks.ts`, a renamed date accessor is handled automatically (`PA_NOW` glue), and a new analytics event goes in `trackEvent`. Reserved names and forbidden APIs must not appear anywhere in the built runtime, not even in comments that survive minification.

4. **Verify:**
   ```bash
   npm run build:runtime && npm run typecheck && npm test && npm run smoke && npm run mraid
   ```
   Then grep the built runtime for anything the samples or validators forbid:
   ```bash
   grep -oE 'window\.open|location\.href|clickTag1|clickthrough|clickThrough|/\*!|https?://' runtime-dist/playable-runtime.js | sort | uniq -c
   ```
   (Only escaped `https:\/\/` may survive in the final HTML; `escapeUrls` in `src/export.ts` handles the runtime and project data.)

5. **Report** what changed in the samples, what was regenerated, any runtime or preflight changes, and the verification output, including any check that fails because of the sample itself rather than the builder.
