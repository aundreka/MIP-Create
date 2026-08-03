# Clarinze Aundreka Perez

Dasmariñas, Cavite, Philippines (open to remote) · +63 966 470 1756
c.aundrekaperez@gmail.com · github.com/aundreka · linkedin.com/in/aundreka-perez · aundreka.github.io/portfolio

---

## Profile

Full-stack engineer and technical lead. Currently lead a team of 5 developers on a
five-application accounting and practice-management platform serving New Zealand
accounting firms, owning delivery from React frontends through Laravel APIs to a
nine-server production fleet. Track record of removing operational cost with
measurable results: previously built, solo, an in-house production platform that
cut per-unit turnaround 12x and is now the standard tool for 20 developers, with
1,100+ units shipped through it.

---

## Technical Skills

| | |
|---|---|
| **Languages** | TypeScript, JavaScript, PHP, Python, SQL, Dart, Java, C++ |
| **Frontend** | React, React Native (Expo), Vue, Vite, Tailwind, TanStack Query, Zustand, Zod, Flutter, Electron, Web Workers, Canvas / OffscreenCanvas |
| **Backend** | Laravel, AdonisJS, Node.js, REST API design, OAuth 2.0 (provider and client), queues and schedulers, MySQL, PostgreSQL, Supabase (Postgres, RLS, Storage) |
| **Infrastructure** | Docker, nginx, Cloudflare, GitHub Actions CI/CD, Linux VPS fleet management, SSH and TLS certificate management, AWS, Google Compute Engine, Vercel, Netlify |
| **Reliability** | Sentry, custom error logging and alerting, public status page, incident response and post-incident review, Playwright, Vitest, Puppeteer |
| **AI/ML** | TensorFlow, PyTorch, scikit-learn, Hugging Face, n8n, LLM-assisted pipeline automation |
| **Tools** | Git, Docker, Figma, Tableau, Power BI |

---

## Experience

### Fullstack Developer, Technical Lead
**DAD: Daclan Accountant** · Auckland, New Zealand (remote) · Jan 2026 - Present

Lead engineer on a five-repository platform for New Zealand accounting firms:
a Laravel API, two React SPAs, an AdonisJS billing application, and a React Native
mobile app, running across nine production servers.

- **Lead a team of 5 developers.** Scope and assign work, review and gate releases,
  and own the staging-to-production ship process across all five repositories.
- **Own third-party integration partnerships end to end**, including direct bank
  feeds and Akahu: technical onboarding, mTLS certificate management, OAuth token
  refresh, and the ongoing relationship with each provider's integration team.
- **Designed and built role-based access control spanning four applications** on a
  shared identity layer, covering plan, module, and role gating, and resolved
  cross-application permission collisions affecting live customer accounts.
- **Shipped competitor-parity feature modules** benchmarked against Xero, FYI Docs
  and Annature: e-signature with PDF field positioning and audit trails, document
  management with merge-field templating and bulk delivery, and New Zealand tax
  return preparation covering GST and income tax.
- **Own the production platform**: Docker, nginx, Cloudflare, SiteHost VPS fleet,
  and GitHub Actions pipelines with environment-branch auto-deploy. Led incident
  response and wrote the post-incident reviews for multiple production outages,
  each closed with a guard preventing recurrence.
- **Built the observability stack** from scratch: Sentry, a queryable error log with
  severity-based email escalation, an internal health dashboard, and a public
  status page.
- **Delivered a security assessment and remediation package to Inland Revenue**,
  New Zealand's tax authority, covering server hardening, credential rotation
  across the fleet, and access review.
- **Built and shipped an OAuth 2.0 developer portal** allowing third parties to
  integrate against the platform API, plus Google and Microsoft OAuth application
  verification for mailbox integration.
- Maintain and release the React Native mobile app, including signed Android
  builds and Play Console releases.

*Laravel, PHP, React, TypeScript, Vue, Vite, TanStack Query, Zustand, Zod, AdonisJS,
React Native, MySQL, PostgreSQL, Docker, nginx, Cloudflare, GitHub Actions*

---

### Junior Developer → Developer
**[HPL - FILL IN FULL COMPANY NAME]** · [Location] · [Start] - [End]

Sole engineer on the company's in-house playable-ad production platform: a 40k+ line
TypeScript system (React authoring tool, dependency-free DOM/CSS ad runtime, Electron
desktop app) that replaced a hand-coded, per-ad build process.

- **Built the platform end to end and cut turnaround from ~3 hours to 5-15 minutes
  per unit** — a 12x throughput increase that removed roughly 80% of manual
  production work. **Now the standard production tool for 20 developers, with 1,100+
  playables shipped through it.** Converted to permanent employment on the strength
  of the system.
- **Designed a three-tier architecture with enforced one-way boundaries.** The ad
  runtime ships standalone and never imports editor code; the editor renders every
  ad in a sandboxed iframe behind a typed postMessage protocol, so editor styling
  can never leak into a shipped creative.
- **Shipped 25 reusable game mechanics as a plugin registry** (scratch, spin,
  memory-match, merge, catch, slots, …) plus 24 starter templates. A new mechanic is
  one file and one registry line, so designers self-serve instead of queueing for a
  developer.
- **Built the single-file export pipeline**: inlines runtime and assets as base64
  into one self-contained HTML under 5 MB, applies per-network transforms (MRAID 3.0,
  ExitAPI, zip) for AppLovin, Mintegral, Vungle and Facebook, and re-encodes media to
  WebP in a Web Worker with an ffmpeg fallback in the desktop build.
- **Cut rejected uploads with automated preflight and QA.** Per-network compliance
  checks (size ceiling, external-request detection, MRAID presence, placeholder click
  URLs); an engagement linter for dead scenes, missing CTAs and undersized tap
  targets; a perceptual pixel-diff engine; and a cross-project checker that diffs each
  ad's style fingerprint against the client's established norm.
- **Diagnosed rendering defects specific to AppLovin's Chromium WebView** —
  compositor edge seams, overlay white-flash, z-index inversion — plus a canvas race
  causing instant-win in Brave. Wrote the internal engineering guide the team now
  builds against.
- **Owned the quality gate**: GitHub Actions running typecheck, lint, 276 unit tests,
  build, and a headless render of a real export; plus a Puppeteer harness verifying
  the MRAID handshake, autoplay-gesture audio policy and animation timing in real
  Chrome.
- **Built the collaboration layer**: Supabase team server with role-based access and a
  draft → review → approved → shipped workflow, per-ad version history with structural
  diffs, shareable review links, and Figma REST import that rebuilds a frame as
  editable elements.

*TypeScript, React, Vite, Electron, Supabase (Postgres, RLS), Web Workers,
Canvas/OffscreenCanvas, ffmpeg, Puppeteer, GitHub Actions, MRAID 3.0, Figma REST API*

---

### Founder & Freelance Developer
**PixelPulse Solutions** · Remote · Oct 2024 - Apr 2026

- Built and shipped 15+ client projects across mobile, web, and games, with multiple
  returning clients. Managed the full project lifecycle solo including scoping,
  version control, iterative releases, deployment, and client communication,
  alongside full-time studies with no missed deadlines.

*PHP, SQL, JavaScript (React), Flutter, Python, Git*

---

## Education

### Bachelor of Science in Computer Science
**Lyceum of the Philippines University - Cavite** · Aug 2023 - May 2027

- Consistent Dean's Lister and Resident Scholarship Holder (A.Y. 2023-2025, current)
- **GWA: 1.18**
- Certiport / Pearson VUE, Database IT Specialist (May 2025)

---

## Selected Projects

**Piraso** · BYTEForward Hackathon 2025 South Luzon, Finalist · Oct 2025
[GitHub] [Pitch]
Led a 4-person team to a Finalist placement among 80 teams of South Luzon's top
CS and IT students. Engineered a visual database tool that translates to SQL,
enabling non-technical users to write valid queries with zero code.
*Dart (Flutter), Python, Revlabs APIs, Supabase, Node.js, SQL*

**Physics of Life and Stuff** · **University of Santo Tomas** Manila · Jan 2026
[GitHub] [Live]
Delivered a live research website for a University of Santo Tomas Department of
Math and Science organization, chosen over agency alternatives. Designed a
zero-cost CMS on Google Sheets and Apps Script, cutting backend hosting to $0
while giving non-technical researchers full content control with no dashboard login.
*TypeScript (React), Google Sheets with Apps Script, Vercel*

**Beth Aven E-commerce** · Client Project · Dec 2024 - May 2025
[GitHub] [Live]
Solo engineered a production e-commerce platform serving 1,000+ users and 20+
products, covering dynamic listings, cart, and full checkout, with zero reported
downtime post-launch. Self-managed deployment and uptime on a GCE virtual machine
with no external DevOps support.
*PHP, SQL, JavaScript, Google Compute Engine*

**TreeQuest** · Personal Project · Nov 2024 · [GitHub] [Live]
Educational browser game teaching binary tree traversals through interactive
visualization and guided preorder, inorder, and postorder practice.
*HTML, CSS, JavaScript*

*Full project list at aundreka.github.io/portfolio*
