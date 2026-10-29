# Localization

The game uses a lightweight runtime localization system. It does not build one HTML file per language. Instead, every built playable contains all supported text and chooses the correct language when the HTML loads.


| Layer | Purpose | Reuse Guidance |
|---|---|---|
| Generic runtime | `src/utils/localization.ts` with `createLocalization(...)`, locale detection, URL query parsing, browser-language fallback, typed helper methods | Copy this file into any project as-is |
| Project config | `src/localization.ts` with `SUPPORTED_LOCALES`, `TRANSLATIONS`, `localization`, and project-specific helper functions | Keep or rewrite per project |

This means a new playable can add the utility file, define its own project adapter, and then import helper functions from any scene or UI module.

## Drop-In Setup Prompt
Copy `Localization.md` and the reusable localization runtime into the new project, then prompt the AI with:

```text
Read Localization.md and implement localization for this project.

Use the localization runtime that was copied into this project. First inspect the project structure and avoid creating duplicate localization systems:
- If `src/utils/localization.ts` exists, keep it as the reusable runtime and create or update `src/localization.ts` as the project-specific adapter.
- If `src/localization.ts` already contains the copied runtime, extend that file in place unless the project already uses a separate `src/utils/localization.ts` pattern.
- If a localization system already exists, update it to follow this document instead of replacing it blindly.

Use the Supported Languages table in this document as the required locale list. Default to English. Support URL overrides with `?lang=`, `?locale=`, and `?language=`, then browser/device language, then English fallback.

For an existing project:
- Scan scenes, components, UI modules, config files, and text creation calls for all user-facing strings.
- Move visible text into a typed translation pack.
- Add translations for every supported locale.
- Replace hardcoded strings with helper functions exported from the project localization file.
- Check existing fonts. If the current font only supports English or Latin text, add suitable fallbacks or per-locale font handling for Russian, Chinese, Korean, and Japanese.
- Verify long translated strings fit on mobile-sized viewports.

For a project still being built:
- Every new user-facing word, label, button, tutorial line, HUD string, result message, and end-card text must be added to localization when it is created.
- Do not leave new visible text hardcoded in scenes or components.
- Export helper functions from the project localization file and import those helpers wherever text is rendered.

Do not localize image-only assets unless the project replaces them with text or provides localized image assets. Run the project build after implementation.
```

Use this prompt whenever the doc and runtime are pasted into a new project. The AI should treat this document as the source of truth for supported locales, runtime behavior, and integration rules.

## Supported Languages
| Language | Code |
|---|---|
| English | `en` |
| German | `de` |
| French | `fr` |
| Spanish | `es` |
| Portuguese | `pt` |
| Russian | `ru` |
| Chinese Simplified | `zh-Hans` |
| Chinese Traditional | `zh-Hant` |
| Korean | `ko` |
| Japanese | `ja` |

## Project Responsibilities
| Area | Responsibility |
|---|---|
| `src/localization.ts` | Supported language list, translation table, configured runtime, and public text helpers |
| Scene and UI modules | Request localized text through project helpers and render the returned strings |
| Image-only assets | Stay as assets unless the project replaces them with text or provides localized image files |
| `Localization.md` | Documents the reusable localization pattern for future playable projects |

## Runtime Flow
1. The playable loads in the browser, phone WebView, or ad-network preview container.
2. `src/localization.ts` creates a configured localization runtime using `createLocalization(...)`.
3. The runtime computes `currentLocale` once at startup.
4. A scene or UI module calls localization helpers such as `getLevelLabel(level)` and `getEncouragementText(levelIndex)`.
5. Phaser or the UI layer renders the returned text into the HUD, tutorial, modal, result screen, or end card.
6. If the device/browser language changes while the playable is already open, reload the playable to re-run locale detection.

## Detection Order
1. URL override for QA/editor testing: `?lang=de`, `?locale=fr`, `?language=ru`, or `?lang=zh-Hans`
2. Browser/device language from `navigator.languages` / `navigator.language`
3. English fallback when no supported language is found

Regional browser tags are normalized to the base language when possible. Chinese uses explicit aliases so common region tags resolve to the matching script.

| Browser value | Resolved game locale |
|---|---|
| `de-DE` | `de` |
| `fr-FR` | `fr` |
| `es-MX` | `es` |
| `pt-BR` | `pt` |
| `ru-RU` | `ru` |
| `zh` | `zh-Hans` |
| `zh-CN` / `zh-SG` / `zh-Hans-CN` / `zh-Hans-SG` | `zh-Hans` |
| `zh-TW` / `zh-HK` / `zh-MO` / `zh-Hant-TW` / `zh-Hant-HK` | `zh-Hant` |
| `ko-KR` | `ko` |
| `ja-JP` | `ja` |
| Unsupported value, such as `it-IT` | `en` |

## Public API
The reusable runtime exposes these project-safe APIs:

| API | Purpose |
|---|---|
| `createLocalization(config)` | Creates a localization runtime for any set of supported languages and translations, with optional locale aliases |
| `runtime.currentLocale` | Current resolved locale chosen at startup or through `setLocale(...)` |
| `runtime.detectLocale(options)` | Resolves a locale from URL params, browser/device language, then default fallback |
| `runtime.resolveLocale(value)` | Normalizes a value such as `de-DE` into a supported locale such as `de` |
| `runtime.setLocale(value)` | Overrides the active locale at runtime, useful for editor tools or debug menus |
| `runtime.getPack(locale?)` | Returns the full translation pack for the active or requested locale |
| `runtime.getValue(key, locale?)` | Returns one translation value from the active or requested locale |
| `runtime.format(key, ...args)` | Calls a translation formatter function or converts a string value to text |


```ts
import { createLocalization } from './utils/localization';

export const SUPPORTED_LOCALES = ['en', 'de', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

type TranslationPack = {
  title: string;
  levelLabel: (level: number) => string;
};

const TRANSLATIONS = {
  en: {
    title: 'Puzzle Game',
    levelLabel: level => `Level ${level}`,
  },
  de: {
    title: 'Puzzlespiel',
    levelLabel: level => `Stufe ${level}`,
  },
  fr: {
    title: 'Jeu de puzzle',
    levelLabel: level => `Niveau ${level}`,
  },
} satisfies Record<SupportedLocale, TranslationPack>;

export const localization = createLocalization<SupportedLocale, TranslationPack>({
  supportedLocales: SUPPORTED_LOCALES,
  defaultLocale: 'en',
  translations: TRANSLATIONS,
});

export function getTitle(): string {
  return localization.format('title');
}

export function getLevelLabel(level: number): string {
  return localization.format('levelLabel', level);
}
```

Any other script can then reference the project helpers:

```ts
import { getLevelLabel, getTitle } from './localization';

titleText.setText(getTitle());
levelText.setText(getLevelLabel(currentLevel));
```

Image-only assets are not translated by this text system. If a project replaces those assets with Phaser text, the text should be added to `src/localization.ts` and consumed through a helper. If a project needs localized image assets, keep them in the asset pipeline and select the correct image for the active locale.

## Phaser Integration Rules
- Do not hardcode user-facing strings directly in scene files.
- Add or update copy inside the project `TRANSLATIONS` object in `src/localization.ts`.
- Expose scene-friendly helper functions from `src/localization.ts` instead of importing the raw translation table.
- Run long strings through a fit-to-width helper before display. German, French, Portuguese, Russian, Korean, and Japanese strings can be longer than English and may clip on narrow phone canvases.
- Locale detection is startup-only by design to keep playable runtime simple and deterministic. Reload to test a changed browser/device language.

## Adding New Copy
1. Add the new key to the project translation pack type in `src/localization.ts`.
2. Add a value for every supported language in the project `TRANSLATIONS`.
3. Export a helper function, for example `getRetryLabel()` or `getTutorialText()`.
4. Import and call that helper from the Phaser scene or UI module.
5. Verify every `?lang=` URL on mobile-sized viewports.

## Adding A New Language
1. Add the language code to `SUPPORTED_LOCALES`.
2. TypeScript will require a matching `TRANSLATIONS` entry.
3. Fill every translation key for the new language.
4. Add common browser or region aliases to `LOCALE_ALIASES` when the canonical code should also accept values like `zh-CN` or `zh-TW`.
5. Add a test URL to this document.
6. Run `npm run build:all` and test the built HTML with `?lang=<code>`.

## Local QA Links
After `npm run dev`, open:

```text
http://localhost:5173/?lang=en
http://localhost:5173/?lang=de
http://localhost:5173/?lang=fr
http://localhost:5173/?lang=es
http://localhost:5173/?lang=pt
http://localhost:5173/?lang=ru
http://localhost:5173/?lang=zh-Hans
http://localhost:5173/?lang=zh-Hant
http://localhost:5173/?lang=ko
http://localhost:5173/?lang=ja
```

## Built HTML QA
After `npm run build:all`, open any generated network HTML and append the same query parameter:

```text
dist/.../AppLovin/..._al.html?lang=de
dist/.../Facebook/..._fb.html?lang=fr
dist/.../Unity/..._un.html?lang=ru
dist/.../Facebook/..._fb.html?lang=zh-Hans
dist/.../Unity/..._un.html?lang=zh-Hant
dist/.../IronSource/..._is.html?lang=ko
dist/.../Moloco/..._mo.html?lang=ja
```

The same built file will also follow the browser/device language on page load when no URL override is present.
