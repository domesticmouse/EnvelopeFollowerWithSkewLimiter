# Research: Static Site Generators for Single-Source Hardware Docs & Interactive Components

- **Ticket:** [`#5`](https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter/issues/5) (`wayfinder:research`)
- **Date:** 2026-11-23
- **Scope:** Evaluate **Astro (core vs. Starlight)**, **VitePress**, **Eleventy (11ty)**, **MkDocs Material / Zensical**, and a **lightweight custom build** against primary official documentation and this repository's actual Markdown constructs and static assets.

---

## Executive Recommendation

**Choose Astro (Core with Content Layer `glob()` + `remark`/`rehype` + Preact/Vanilla Islands) — do not use Starlight, MkDocs Material, or Zensical.**

- **Astro core** is the only out-of-the-box SSG that simultaneously:
  1. Ingests root and subdirectory `.md` files directly from the repository (`base: '.'`) **without duplicating prose or requiring YAML frontmatter** via Astro's Content Layer `glob()` loader ([Astro Content Collections](https://docs.astro.build/en/guides/content-collections/)).
  2. Preserves **every** existing Markdown and HTML quirk in this repo — including `$...$` / `$$...$$` math (`remark-math` + `rehype-katex`), `11` Mermaid diagrams (`excludeLangs: ['mermaid']`), `211` GFM task items, and **`patches/README.md`'s GFM pipe table nested inside raw HTML `<table><td>`** — because `.md` files stay on CommonMark/`remark-gfm` rather than MDX or Python-Markdown.
  3. Ships **zero client-side JS** on static spec/checklist pages while hydrating the interactive `ENV / SKEW` front-panel patch overlay and pan/zoom schematic/PCB viewer as isolated `client:visible` islands ([Astro Islands](https://docs.astro.build/en/concepts/islands/)).
  4. Deploys natively to `/EnvelopeFollowerWithSkewLimiter/` via `base` + `withastro/action` and `actions/deploy-pages` ([Deploy Astro to GitHub Pages](https://docs.astro.build/en/guides/deploy/github/)).
- **One mandatory custom piece (~40 lines):** Because Astro's Markdown pipeline does **not** rewrite raw HTML `<img src="../images/...">` tags (`86` occurrences across `README.md`, `checklists/`, `patches/README.md`) or relative `.md`/`.zip`/`.pdf`/`ibom.html` links when pages emit as directory URLs (`.../index.html`), Astro needs a small project-local `rehype` link/image-rewriting plugin (plus copying passthrough assets into `dist/` or `public/`).
- **Runner-up:** **VitePress** works if a turnkey Vue docs UI outweighs the friction of mapping `README.md` via `rewrites`, routing non-media files (`bom/ibom.html`, PDFs, ZIPs, CSVs) through `public/` + link rewriting (`target="_self"` for `ibom.html`), and wrapping Vue SFC layouts around unmodified `.md` files.
- **Disqualified / High-Friction:**
  - **Starlight** hardcodes `docsLoader()` to `src/content/docs/` and requires `title` frontmatter in `docsSchema()`.
  - **MkDocs Material** entered maintenance mode on **2025-11-05** (EOL extended to **2027-05-05**) in favor of **Zensical**, and **both** use Python-Markdown — which fails to render the GFM table inside raw `<td>` in `patches/README.md` without modifying source prose to add `markdown="1"`. Furthermore, Zensical does not run MkDocs Python `hooks` needed to fix raw HTML `<img>` paths under `use_directory_urls: true`.
  - **Custom build** (Node `unified` + Vite MPA) duplicates Astro's exact `remark`/`rehype` + Vite stack while forcing us to maintain nav, TOC, search, and base styling manually.

---

## 1. Repository Audit: Actual Constructs & Static Assets

An automated audit of the **21 documentation Markdown files** (excluding agent-config files `AGENTS.md`, `docs/agents/*.md`, `.agents/skills/**/SKILL.md`) and static artifacts establishes the exact compatibility baseline:

### 1.1 Markdown Construct Inventory

| File | Frontmatter | Inline `$...$` | Display `$$...$$` | `mermaid` Fences | Task Lists (`[x]` / `[ ]`) | Raw HTML Tags | GFM Tables |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `README.md` | None | 4 (`$V$`, `$I$`) | 0 | 0 | 0 / 0 | 4 `<img>` (inside pipe tables) | 3 |
| `EnvelopeFollower.md` | None | 58 | 4 | 1 (`flowchart LR`) | 0 / 0 | 0 | 8 |
| `EnvelopeFollowerImprovements.md` | None | 75 | 3 | 1 (`flowchart LR`, Unicode `→`) | 0 / 0 | 0 | 5 |
| `DesignSpec.md` | None | 40 | 0 | 1 (`flowchart LR`) | 0 / 0 | 0 | 10 |
| `panel_svg_spec.md` | None | 0 | 0 | 0 | 0 / 0 | 0 | 4 |
| `checklists/README.md` | None | 0 | 0 | 0 | 0 / 0 | 0 | 1 |
| `checklists/01-main-board-ordering.md` | None | 0 | 0 | 0 | 5 / 37 | 0 | 0 |
| `checklists/01b-front-panel-ordering.md` | None | 0 | 0 | 0 | 4 / 18 | 0 | 0 |
| `checklists/02-pcba-part-alignment.md` | None | 0 | 0 | 0 | 0 / 54 | 51 `<img>` (50 indented in `- [ ]`) | 0 |
| `checklists/03-tayda-ordering.md` | None | 0 | 0 | 0 | 0 / 22 | 0 | 0 |
| `checklists/04-hand-assembly.md` | None | 0 | 0 | 0 | 0 / 41 | 21 `<img>` (18 indented in `- [ ]`) | 0 |
| `checklists/05-board-bringup.md` | None | 0 | 0 | 0 | 0 / 30 | 9 `<img>` | 2 |
| `patches/README.md` | None | 0 | 0 | 0 | 0 / 0 | 1 `<table>`, 1 `<img>` | 4 *(1 inside `<td>`!)* |
| `patches/01`..`08` (8 guides) | None | 1 (`06-*.md`) | 0 | 8 (`flowchart LR`) | 0 / 0 | 0 | 2–3 each (21 total) |
| **Total (21 files)** | **0 / 21** | **178** | **7** | **11** | **9 / 202** | **86 `<img>`, 1 `<table>`** | **58** |

### 1.2 Critical Edge Cases Discovered in Source Files

1. **Zero YAML Frontmatter & `README.md` Entrypoints:** Every `.md` file begins directly with `# Title` (or `[← All Patch Guides](README.md)` in `patches/01`..`08`). Directory indexes are `README.md`, `checklists/README.md`, and `patches/README.md` (not `index.md`), and links use both explicit `README.md` and bare directory targets (`checklists/`, `patches/`, `../panel_art/`).
2. **GFM Pipe Table Nested Inside Raw HTML `<td>` (`patches/README.md` L20–43):**
   ```html
   <table>
   <tr>
   <td width="240" valign="top" align="center">
   <img src="../panel_art/preview_clean.png" alt="ENV / SKEW 6 HP Front Panel" width="210">
   </td>
   <td valign="top">

   | Control / Jack | Label | Range / Behavior | Notes |
   ...
   </td>
   </tr>
   </table>
   ```
   Under CommonMark/GFM (GitHub, `remark-gfm`, `markdown-it` with `html: true`), the blank line after `<td valign="top">` closes HTML block type 6, so the pipe table parses into HTML `<table>` elements. Under Python-Markdown (MkDocs / Zensical) and MDX, this either fails to parse the inner table or breaks JSX compilation.
3. **Raw HTML `<img>` Relative Paths (`86` tags) & Directory-URL Drift:**
   - `checklists/02-pcba-part-alignment.md` (`51`), `checklists/04-hand-assembly.md` (`21`), and `checklists/05-board-bringup.md` (`9`) embed `<img src="../images/..." width="...">` — mostly indented 2 spaces under `- [ ]` task items — and `patches/README.md` embeds `<img src="../panel_art/preview_clean.png" width="210">`.
   - `README.md` embeds `<img src="images/..." width="280">` inside Markdown pipe-table cells.
   - **Trap:** Any SSG that compiles `checklists/02-pcba-part-alignment.md` to a clean directory URL `checklists/02-pcba-part-alignment/index.html` breaks `../images/...` in raw HTML `<img>` tags (resolving to `/checklists/images/...` instead of `/images/...`) unless an HTML/rehype transform rewrites raw HTML `src` attributes or the SSG emits `.html` files (`build.format: 'file'` / `use_directory_urls: false`).
4. **LaTeX Math Delimiter Hygiene:** All `178` `$...$` and `7` `$$...$$` expressions are genuine LaTeX (`\text{...}`, `\parallel`, `\frac`, `\ln\!\left(...)`, `\implies`, `\mathbf`). Dollar currency values in checklists (e.g., `` `$3` ``, `` `$9` ``, `` `$0` ``) are wrapped in backticks, though real math spans start with digits (`$0\,\text{V}$`, `$1f$`, `$10\times$`), so math plugins must not reject `$` followed by a digit.
5. **Relative Links to Non-Markdown Files & Cross-Section Anchors:**
   - Fragment anchors across files: `EnvelopeFollower.md#6-practical-build--pcb-implementation-notes`.
   - Links to pass-through web/fabrication assets: `../bom/ibom.html` (`282 KB` self-contained InteractiveHtmlBom `v2.11.1` with zero external `<script>` or `<link>` refs), `../envelope_follower.pdf` (`213 KB`), `../manufacturing/envelope_follower_gerbers.zip` (`216 KB`), `../manufacturing/envelope_follower_panel_gerbers.zip` (`47 KB`), `../manufacturing/jlcpcb_cpl.csv`, `../jlcpcb_bom.csv` (`798 B`), `EnvelopeFollower.webp` (`144 KB`), `images/` (`86` PNGs), and `panel_art/` (`2` mockup PNGs + `2` 1:1 mm Plain SVGs).
   - Links to raw CAD/Python/repo files (`../envelope_follower.kicad_pcb`, `../envelope_follower.py`, `generate_*.py`, `LICENSE`, `.agents/skills/`), which should either be rewritten to `https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter/blob/main/...` or explicitly copied.

---

## 2. Option-by-Option Evaluation Against Primary Documentation

### 2.1 Astro (Core Content Collections) vs. Starlight

#### Astro Core (`docs.astro.build`)
- **(a) Single-source ingestion:** Astro 5+'s Content Layer API ([Content Collections](https://docs.astro.build/en/guides/content-collections/)) decouples `glob()` from `src/content/`. In `src/content.config.ts`, `loader: glob({ pattern: ['README.md', 'EnvelopeFollower*.md', 'DesignSpec.md', 'panel_svg_spec.md', 'checklists/*.md', 'patches/*.md'], base: '.' })` reads existing root and subdirectory `.md` files directly without copying prose. An optional schema (`z.object({}).optional()` or `parseData` wrapper / route title helper) derives `<title>` from the first `# Heading` so zero YAML frontmatter needs to be added.
- **(b) Exact Markdown syntax:** Built on `unified` / `remark` / `rehype` ([Markdown Content](https://docs.astro.build/en/guides/markdown-content/), [Configuration Reference](https://docs.astro.build/en/reference/configuration-reference/)).
  - *GFM & Task lists:* `markdown.gfm` is `true` by default (`remark-gfm`).
  - *Math:* `remark-math` + `rehype-katex` renders all `$...$` and `$$...$$` to static KaTeX HTML at build time with zero client-side math runtime ([remark-math / rehype-katex](https://github.com/remarkjs/remark-math)).
  - *Mermaid:* Setting `markdown: { syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] } }` prevents Shiki from transforming `mermaid` code fences, allowing `rehype-mermaid` (server-side SVG) or `astro-mermaid` / client-side Mermaid hydration ([Astro Markdown Configuration](https://docs.astro.build/en/reference/configuration-reference/), [rehype-mermaid](https://github.com/remcohaszing/rehype-mermaid)).
  - *Raw HTML + nested pipe table:* Because source files remain `.md` (not `.mdx`), Astro uses `@astrojs/markdown-remark`, whose CommonMark/GFM parser handles `patches/README.md`'s `<td valign="top">\n\n| ...` cleanly.
  - *Relative links & raw HTML `<img>` caveat:* Per [Astro Images Guide](https://docs.astro.build/en/guides/images/), Astro optimizes relative Markdown `![](...)` images inside `src/`, **not** raw HTML `<img src="../images/...">` tags or `publicDir` assets. A small project-local `rehype` plugin inspecting each file's entry path resolves relative `.md` links (including `README.md` -> directory index and `#anchors`), prefixes `base`, and rewrites raw HTML `<img src>` / `<a href>` relative paths to `base`-prefixed static paths (or GitHub `blob/main/` URLs for `.kicad_pcb` / `.py` source links). Alternatively, `build.format: 'file'` preserves directory depth parity for raw `../` paths, though explicit `rehype` resolution works under default clean URLs (`build.format: 'directory'`) as well.
- **(c) GitHub Pages deployment:** Official support via `site: 'https://domesticmouse.github.io'` and `base: '/EnvelopeFollowerWithSkewLimiter'` in `astro.config.mjs`, built and deployed via `withastro/action` + `actions/deploy-pages` ([Deploy Astro to GitHub Pages](https://docs.astro.build/en/guides/deploy/github/)).
- **(d) Static asset passthrough:** Files in `publicDir` (default `./public`) are copied verbatim without bundling or HTML minification ([Configuration Reference](https://docs.astro.build/en/reference/configuration-reference/)). In CI or a prebuild hook (or `astro:build:done` integration), copying `bom/ibom.html`, `envelope_follower.pdf`, `manufacturing/`, `jlcpcb_bom.csv`, `EnvelopeFollower.webp`, `images/`, and `panel_art/` directly into `dist/` (or `public/` before build) keeps `bom/ibom.html` byte-for-byte intact and avoids duplicating large binary trees in git.
- **(e) Interactive components:** Astro's Islands Architecture ([Islands](https://docs.astro.build/en/concepts/islands/), [Framework Components](https://docs.astro.build/en/guides/framework-components/)) ships zero JS on static pages and hydrates Preact/Svelte/Web Component islands via `client:visible` or `client:load`. A dynamic page route (`src/pages/[...slug].astro`) renders `<Content />` from the unmodified Markdown alongside `<PanelOverlay client:visible />` (fed by a structured JSON/TS preset map + `panel_svg_spec.md` coordinates) on `patches/01`..`08` and `<SchematicPcbViewer client:visible />` on schematic/layout pages.

#### Starlight (`@astrojs/starlight`)
- **(a) Single-source ingestion (Poor Fit):** Starlight's `docsLoader()` is hardcoded to `src/content/docs/`, and `docsSchema()` requires YAML frontmatter `title` on every page ([Starlight Manual Setup](https://starlight.astro.build/guides/manual-setup/), [Starlight Frontmatter Reference](https://starlight.astro.build/reference/frontmatter/)). Replacing `docsLoader()` with an external `glob()` loader and synthesizing titles forfeits Starlight's built-in remark/rehype integrations unless re-configured or pre-copying modified Markdown into `src/content/docs/`.
- **(b–e):** Inherits Astro's `remark`/`rehype`/`base` mechanics ([Starlight Configuration Reference](https://starlight.astro.build/reference/configuration/)), and islands inside unmodified `.md` require overriding `MarkdownContent` ([Overriding Components](https://starlight.astro.build/reference/overrides/)). The rigid `src/content/docs/` + mandatory frontmatter model adds friction with little upside over Astro Core with a clean custom docs layout.

---

### 2.2 VitePress (`vitepress.dev`)

- **(a) Single-source ingestion:** Setting `srcDir: '.'` in `.vitepress/config.ts` with `srcExclude: ['AGENTS.md', 'docs/**', '.agents/**']` reads root and subdirectory Markdown in place ([Site Config](https://vitepress.dev/reference/site-config), [Routing](https://vitepress.dev/guide/routing)). Because VitePress uses `index.md` rather than `README.md` for directory indexes, `rewrites` must map `README.md` -> `index.md`, `checklists/README.md` -> `checklists/index.md`, and `patches/README.md` -> `patches/index.md`. **Subtle trap:** under `rewrites`, VitePress resolves relative Markdown links against the *rewritten* path while Vite resolves relative asset imports against the *physical* file path ([Routing](https://vitepress.dev/guide/routing)).
- **(b) Exact Markdown syntax:**
  - *Math:* Opt-in `markdown: { math: true }` backed by `markdown-it-mathjax3` ([Markdown Extensions](https://vitepress.dev/guide/markdown)). MathJax 3 emits `<mjx-*>` custom elements; configuring `vue.template.compilerOptions.isCustomElement` avoids Vue compiler warnings ([Site Config](https://vitepress.dev/reference/site-config)), or a `markdown-it` KaTeX plugin can replace MathJax.
  - *Task lists:* Built-in via `@mdit/plugin-tasklist` (`markdown.tasklist`) ([Markdown Extensions](https://vitepress.dev/guide/markdown)).
  - *Mermaid:* Not built-in; requires `vitepress-plugin-mermaid` (or a custom `markdown.config` fence override + client Vue wrapper).
  - *Raw HTML + Vue SFC compilation:* Every `.md` file compiles into a Vue 3 SFC ([VitePress Markdown & Vue](https://vitepress.dev/guide/markdown)). `markdown-it` (`html: true`) closes the `<td valign="top">` block on the blank line in `patches/README.md`, so the inner pipe table parses before Vue compiles the template; Vite's asset transform rewrites relative `<img src="../...">` when files exist relative to the source `.md`. However, any stray `{{ ... }}` outside fenced code/math would be parsed as Vue mustache interpolation unless wrapped in `v-pre`.
- **(c) GitHub Pages deployment:** `base: '/EnvelopeFollowerWithSkewLimiter/'` in `.vitepress/config.ts` paired with `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages` ([Deploy VitePress](https://vitepress.dev/guide/deploy)).
- **(d) Static asset passthrough (High Friction):** Per [Asset Handling](https://vitepress.dev/guide/asset-handling), VitePress/Vite **only** auto-bundles referenced images/media/fonts — **non-Markdown linked files (`.pdf`, `.zip`, `.csv`, `bom/ibom.html`) are NOT treated as Vite assets**, must live in `<srcDir>/public/` (e.g., `./public/`), and must be referenced by root-absolute URLs (`/bom/ibom.html{target="_self"}` so VitePress's SPA router does not hijack `.html` navigation). Thus, unmodified relative links like `[../bom/ibom.html](../bom/ibom.html)` and `[../envelope_follower.pdf](../envelope_follower.pdf)` trigger build-time dead-link errors unless `ignoreDeadLinks: true` (or a pattern whitelist) is enabled **and** a `markdown.config` plugin rewrites those relative asset URLs to root-absolute `public/` URLs + `target="_self"`.
- **(e) Interactive components:** Vue 3 components work natively in VitePress, and to avoid editing source `.md` files they can be injected via custom theme layout slots (`#doc-before` / `#doc-after` keyed on `useData().page.relativePath`) or `[slug].paths.js` dynamic routes (`<!-- @content -->`, [Routing](https://vitepress.dev/guide/routing)). Ships Vue 3 + SPA router JS on every page.

---

### 2.3 Eleventy (`11ty.dev`)

- **(a) Single-source ingestion:** `dir: { input: "." }` plus `eleventyConfig.ignores.add(...)` / `.eleventyignore` ingests root and subdirectory `.md` files directly with zero frontmatter ([Configuration](https://www.11ty.dev/docs/config/), [Ignore Files](https://www.11ty.dev/docs/ignores/)). Requires Eleventy Computed Data / directory data files to remap `README.md` -> `index.html` and map `.html` or directory permalinks.
- **(b) Exact Markdown syntax:** Uses `markdown-it` (`html: true`, [Markdown Templates](https://www.11ty.dev/docs/languages/markdown/)). Out of the box it supports CommonMark + GFM tables/strikethrough, so **task lists, LaTeX math, and Mermaid all require manual plugin wiring** (`@mdit/plugin-tasklist` or `markdown-it-task-lists`, `@mdit/plugin-katex` + KaTeX CSS, and a custom `fence` renderer + client-side Mermaid). `patches/README.md`'s nested table inside `<td>` parses cleanly under `markdown-it`.
- **(c) GitHub Pages deployment:** `pathPrefix: "/EnvelopeFollowerWithSkewLimiter/"` + built-in `HtmlBasePlugin` ([HTML Base Plugin](https://www.11ty.dev/docs/plugins/html-base/), [GitHub Deployment](https://www.11ty.dev/docs/deployment/github/)). **Catch:** `HtmlBasePlugin` prefixes root-absolute URLs (`/images/...`), **not** relative `../` URLs shifted by directory-style permalinks (`checklists/02-pcba-part-alignment/index.html`) or `.md` suffixes — requiring an extra `markdown-it` link rule + HTML transform (or `.html` permalinks + `.md`->`.html` link rewriting).
- **(d) Static asset passthrough:** `eleventyConfig.addPassthroughCopy(...)` copies `bom/ibom.html`, `envelope_follower.pdf`, `manufacturing/`, `jlcpcb_bom.csv`, `EnvelopeFollower.webp`, `images/`, and `panel_art/` cleanly untouched ([Passthrough File Copy](https://www.11ty.dev/docs/copy/)).
- **(e) Interactive components:** Zero client JS by default; supports progressive hydration via `<is-land>` (`@11ty/is-land`, `on:visible`, [Is-land](https://www.11ty.dev/docs/plugins/is-land/)) and [WebC](https://www.11ty.dev/docs/languages/webc/), or esbuild/Vite asset bundling mounted from Nunjucks layout templates without modifying `.md` prose. However, all docs navigation, TOC, search, code styling, and responsive CSS must be authored from scratch.

---

### 2.4 MkDocs Material & Zensical (`squidfunk.github.io`, `zensical.org`)

- **Current Official Project Status (Verified):** On **November 5, 2025**, Martin Donath (`squidfunk`) and the Material for MkDocs team announced **Zensical** — a new MIT-licensed, Rust-core successor ([Zensical Docs](https://zensical.org/docs/setup/basics/), [Compatibility](https://zensical.org/docs/compatibility/)). Material for MkDocs `9.7.0` unlocked previously sponsor-only Insiders features and entered maintenance mode, with critical security/bug-fix EOL extended to **May 5, 2027**. **Zensical Studio** exited beta on **November 5, 2026**. Zensical reads both `zensical.toml` and existing `mkdocs.yml` files natively.
- **(a) Single-source ingestion:** Both default to `docs_dir: docs`. Pointing `docs_dir: .` at the repo root is awkward because MkDocs forbids `site_dir` inside `docs_dir` and treats every non-excluded file in `docs_dir` as site output, forcing a brittle `exclude_docs` allow/denylist over `.git/`, `.agents/`, `docs/`, `*.py`, `*.kicad_*`, `footprints/`, etc. ([MkDocs Configuration](https://www.mkdocs.org/user-guide/configuration/), [Zensical `exclude_docs`](https://zensical.org/docs/compatibility/)). On the positive side, MkDocs natively builds `README.md` as `index.html` when `index.md` is absent ([Writing Your Docs](https://www.mkdocs.org/user-guide/writing-your-docs/)).
- **(b) Exact Markdown syntax (Dealbreakers for Unmodified Source):**
  - *Math, Task Lists, Mermaid:* Supported in both via `pymdownx.arithmatex` (`generic: true` + MathJax/KaTeX JS), `pymdownx.tasklist`, and `pymdownx.superfences` custom `mermaid` fences ([Material Math](https://squidfunk.github.io/mkdocs-material/reference/math/), [Material Diagrams](https://squidfunk.github.io/mkdocs-material/reference/diagrams/), [Material Lists](https://squidfunk.github.io/mkdocs-material/reference/lists/), [Zensical Math](https://zensical.org/docs/authoring/math/), [Zensical Diagrams](https://zensical.org/docs/authoring/diagrams/), [Zensical Markdown Extensions](https://zensical.org/docs/compatibility/markdown/extensions/)).
  - **Fatal incompatibility (`patches/README.md`):** Python-Markdown does **not** parse Markdown inside raw HTML blocks (`<table>...<td>...</td></table>`) unless `md_in_html` is enabled **AND** `markdown="1"` is placed directly on the HTML tag (`<td valign="top" markdown="1">`) ([Python-Markdown `md_in_html`](https://python-markdown.github.io/extensions/md_in_html/)). Leaving `patches/README.md` untouched renders the Front-Panel Control Reference table as raw `| Control / Jack | ... |` text.
  - **Raw HTML `<img>` breakage (`81` checklist tags):** With default `use_directory_urls: true`, MkDocs rewrites Markdown `![](...)` links, **not** raw HTML `<img src="../images/...">` tags, causing `404`s unless `use_directory_urls: false` is forced or a Python hook rewrites raw HTML. Crucially, **Zensical does not natively support MkDocs Python `hooks` or arbitrary third-party MkDocs plugins** ([Zensical Plugins Compatibility](https://zensical.org/docs/compatibility/mkdocs/plugins/)).
- **(c) GitHub Pages deployment:** Setting `site_url: https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/` configures the subpath; Material uses `mkdocs gh-deploy` or `actions/deploy-pages` ([Publishing Your Site](https://squidfunk.github.io/mkdocs-material/publishing-your-site/)), while Zensical uses `zensical build --clean` + `actions/configure-pages`, `upload-pages-artifact`, and `deploy-pages` ([Zensical Publish Guide](https://zensical.org/docs/get-started/publish-your-site/)).
- **(d) Static asset passthrough:** Non-excluded files under `docs_dir` copy to `site/`, though `use_directory_urls: true` breaks relative `../bom/ibom.html` or `../images/...` if referenced in raw HTML, and `docs_dir: .` risks leaking internal files unless `exclude_docs` stays exhaustive.
- **(e) Interactive components:** Neither includes a JS component framework or Vite bundler. Custom widgets must be injected as pre-built or vanilla JS via `extra_javascript` and must re-bind on Material/Zensical's `document$` RxJS observable to survive `navigation.instant` DOM swaps ([Material Customization](https://squidfunk.github.io/mkdocs-material/customization/)).

---

### 2.5 Lightweight Custom Build (Node `unified` + Vite MPA, or Python + Vite)

- **(a) Ingestion:** A small build script (`Node` or `Python`) explicitly reads only the target root `.md`, `checklists/*.md`, and `patches/*.md` files with zero frontmatter and zero risk of leaking `.agents/` or CAD files.
- **(b) Exact Markdown syntax:**
  - *Node (`unified`):* `remark-parse` + `remark-gfm` + `remark-math` + `remark-rehype({ allowDangerousHtml: true })` + `rehype-raw` + `rehype-katex` + `rehype-mermaid` + `rehype-stringify` ([unified](https://unifiedjs.com/), [rehype-raw](https://github.com/rehypejs/rehype-raw)) handles 100% of the repo's exact syntax, including `patches/README.md`'s table-in-`<td>`, and makes relative link / `<img src>` rewriting trivial in AST.
  - *Python (`markdown-it-py`):* Handles CommonMark/GFM/math cleanly, though building TypeScript/Preact islands or SSR Mermaid still pulls Node into CI.
- **(c) & (d) GitHub Pages & Assets:** Vite Multi-Page App (`build.rollupOptions.input`, `base: '/EnvelopeFollowerWithSkewLimiter/'`, `publicDir`) + `actions/configure-pages` / `upload-pages-artifact` / `deploy-pages` gives exact subpath prefixing and byte-for-byte passthrough of `bom/ibom.html`, PDFs, ZIPs, CSVs, and PNGs ([Vite Shared Options](https://vite.dev/config/shared-options), [Vite Multi-Page Build](https://vite.dev/guide/build), [Vite Static Deploy](https://vite.dev/guide/static-deploy)).
- **(e) Interactive components:** First-class TypeScript/Preact/Web Component hydration via Vite MPA entrypoints, **but** you own building and maintaining navigation sidebars, breadcrumbs, search, dark/light styling, mobile drawers, and heading anchors — all of which Astro Core gives out of the box on top of the exact same `unified` + Vite internals.

---

## 3. Side-by-Side Comparison Matrix

| Criterion | Astro (Core) | Starlight | VitePress | Eleventy (11ty) | MkDocs Material / Zensical | Custom (`unified` + Vite) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **(a) Single-source root + subdirs, no frontmatter** | **Native** (`glob` `base: '.'`) | **Poor** (`docsLoader` locked, `title` required) | **Good** (`srcDir: '.'` + `rewrites` for `README`) | **Good** (`dir.input: '.'` + computed `README` permalinks) | **Awkward** (`docs_dir: '.'` needs heavy `exclude_docs`) | **Native** (explicit manifest) |
| **(b1) `$...$` / `$$...$$` math** | `remark-math` + `rehype-katex` (build-time) | Same, lost if bypassing `docsLoader` | Built-in opt-in (`markdown-it-mathjax3`) | Plugin (`@mdit/plugin-katex`) | `pymdownx.arithmatex` + MathJax/KaTeX JS | `remark-math` + `rehype-katex` |
| **(b2) `11` Mermaid diagrams** | `excludeLangs: ['mermaid']` + `rehype-mermaid` / client | Same / community `astro-mermaid` | Community `vitepress-plugin-mermaid` | Custom fence + `mermaid.js` | Built-in `superfences` Mermaid | `rehype-mermaid` / client |
| **(b3) `211` GFM task list items** | Native (`gfm: true`) | Native (`gfm: true`) | Native (`@mdit/plugin-tasklist`) | Plugin (`@mdit/plugin-tasklist`) | `pymdownx.tasklist` | `remark-gfm` |
| **(b4) `patches/README.md` GFM table in `<td>`** | **Works** (CommonMark `.md`) | **Works** in `.md` (breaks in `.mdx`) | **Works** (`markdown-it` pre-Vue) | **Works** (`markdown-it`) | **FAILS** without adding `markdown="1"` to source | **Works** (`remark-gfm` + `rehype-raw`) |
| **(b5) `86` raw HTML `<img>` relative paths** | Needs ~40-line `rehype` plugin (or `build.format: 'file'`) | Needs `rehype` plugin | Vite rewrites relative `<img>` (watch `rewrites`) | Needs HTML transform (or `.html` permalinks) | **Broken** under `use_directory_urls: true`; Zensical lacks Python `hooks` | Built into own `rehype` pass |
| **(c) GH Pages `/EnvelopeFollowerWithSkewLimiter/`** | `base` + `withastro/action` + `deploy-pages` | Same | `base` + `deploy-pages` | `pathPrefix` + `HtmlBasePlugin` | `site_url` subpath + `deploy-pages` | Vite `base` + `deploy-pages` |
| **(d) Pass-through `bom/ibom.html`, PDF, ZIP, CSV** | **Clean** (copy to `public/` or `dist/`) | Clean (`public/`) | **Friction** (`public/` + rewrite links + `target="_self"` + `ignoreDeadLinks`) | **Clean** (`addPassthroughCopy`) | Clean under `docs_dir` (mind `exclude_docs`) | **Clean** (`publicDir` / copy) |
| **(e) Interactive islands (`ENV/SKEW` overlay & PCB viewer)** | **Best** (`client:visible` islands, zero JS elsewhere) | Overrides needed for `.md` | **Good** (Vue 3 theme slots / `paths.js`, full SPA JS) | **Good** (`@11ty/is-land` / WebC; DIY shell) | **Weak** (`extra_javascript` + `document$`, no bundler) | **Full control**, high DIY maintenance |
| **Lifecycle / Maintenance Health** | Active, stable | Active, opinionated | Active, mature | Active, minimal | Material EOL **2027-05-05**; Zensical early (`v0.1+`, no Python hooks) | 100% self-maintained |

---

## 4. Recommended Astro Core Architecture (Implementation Blueprint)

To keep **zero duplication of source Markdown** while solving all repository edge cases cleanly:

1. **Content Layer (`src/content.config.ts`):**
   Use Astro's `glob()` loader with `base: '.'` and an explicit `pattern` allowlist covering `README.md`, `EnvelopeFollower.md`, `EnvelopeFollowerImprovements.md`, `DesignSpec.md`, `panel_svg_spec.md`, `checklists/*.md`, and `patches/*.md` (never matching `.agents/`, `docs/`, or `node_modules/`). Derive page titles from the first `<h1>` in `headings` (or filename fallback) so source files stay frontmatter-free.
2. **Markdown Pipeline (`astro.config.mjs`):**
   - Set `site: 'https://domesticmouse.github.io'` and `base: '/EnvelopeFollowerWithSkewLimiter'`.
   - Configure `markdown.syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] }`.
   - Enable `remarkMath` + `rehypeKatex` (plus KaTeX CSS imported in the Astro base layout), plus Mermaid rendering (`rehype-mermaid` at build time or lightweight client `mermaid` loaded only when `.mermaid` blocks exist).
   - Add one **project-local `rehype` plugin** (~40 lines) receiving the source entry's repo path:
     - Rewrites relative `.md` links (e.g., `README.md` -> `./`, `patches/README.md` -> `/EnvelopeFollowerWithSkewLimiter/patches/`, `02-pcba-part-alignment.md` -> `/EnvelopeFollowerWithSkewLimiter/checklists/02-pcba-part-alignment/`, preserving `#anchors`).
     - Rewrites relative raw HTML `<img src="../...">` and `<a href="../...">` pointing to pass-through web assets (`images/`, `panel_art/`, `bom/ibom.html`, `envelope_follower.pdf`, `manufacturing/*.zip`, `manufacturing/jlcpcb_cpl.csv`, `jlcpcb_bom.csv`, `EnvelopeFollower.webp`) against the source file's repo path prefixed with `base`.
     - Rewrites links targeting non-published repo source files (`.kicad_pcb`, `.kicad_sch`, `.py`, `LICENSE`, `.agents/skills/`) to `https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter/blob/main/...` so zero dead links appear on the deployed site.
3. **Verbatim Static Asset Passthrough:**
   Copy `bom/ibom.html`, `envelope_follower.pdf`, `EnvelopeFollower.webp`, `jlcpcb_bom.csv`, `images/`, `panel_art/`, and `manufacturing/` into `dist/` via a lightweight Astro integration (`astro:build:done`) or pre-build copy into a gitignored `public/` stage so `bom/ibom.html` is never touched by HTML/JS processors.
4. **Interactive Islands (`client:visible`):**
   - **`PanelOverlay` island (Preact or Vanilla TS/SVG):** Mounted by `src/pages/[...slug].astro` above/beside patch guide content for `patches/01`..`08` using structured per-patch preset data (`GAIN`, `ATK`, `REL`, `OFFSET`, `SMOOTH`/`RAW`, `SLOW`/`FAST`, patched jacks, `LED1` color state) overlaid on `panel_art/preview_clean.png` / SVG geometry from `panel_svg_spec.md` (`30.00 × 128.50 mm` coordinate space).
   - **`SchematicPcbViewer` island:** Pan/zoom viewer (pointer drag + wheel/pinch zoom + layer/board toggles for `images/schematic.png`, `images/pcb_front.png`, `images/pcb_back.png`, `images/panel_front.png`, `images/panel_back.png`) mounted on a dedicated hardware explorer page or embedded via route matching.
5. **GitHub Actions Deployment:**
   Use `actions/checkout` -> `withastro/action` -> `actions/deploy-pages` (official workflow per [Deploy Astro to GitHub Pages](https://docs.astro.build/en/guides/deploy/github/) and [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)) with `pages: write` and `id-token: write`.

---

## 5. Primary Source Citations

- **Astro:**
  - Content Collections & `glob()` loader: <https://docs.astro.build/en/guides/content-collections/>
  - Markdown & Remark/Rehype (`gfm`, `syntaxHighlight.excludeLangs`): <https://docs.astro.build/en/guides/markdown-content/> · <https://docs.astro.build/en/reference/modules/astro-markdown-remark/>
  - Configuration Reference (`base`, `publicDir`, `build.format`, `trailingSlash`): <https://docs.astro.build/en/reference/configuration-reference/>
  - Images (`src/` vs `publicDir` vs raw `<img>`): <https://docs.astro.build/en/guides/images/>
  - Islands Architecture & Framework Components: <https://docs.astro.build/en/concepts/islands/> · <https://docs.astro.build/en/guides/framework-components/>
  - GitHub Pages Deployment: <https://docs.astro.build/en/guides/deploy/github/> · <https://github.com/withastro/action/releases>
- **Starlight:**
  - Manual Setup (`docsLoader`, `src/content/docs/`): <https://starlight.astro.build/guides/manual-setup/>
  - Frontmatter Reference (required `title`): <https://starlight.astro.build/reference/frontmatter/>
  - Configuration & Component Overrides: <https://starlight.astro.build/reference/configuration/> · <https://starlight.astro.build/reference/overrides/>
- **VitePress:**
  - Routing (`index.md` vs `README.md`, `rewrites`, dynamic `[slug].paths.js`): <https://vitepress.dev/guide/routing>
  - Markdown (`math`, `@mdit/plugin-tasklist`, `markdown-it` config): <https://vitepress.dev/guide/markdown>
  - Asset Handling (`public/` requirement for non-media PDF/ZIP/HTML files): <https://vitepress.dev/guide/asset-handling>
  - Site Config (`srcDir`, `srcExclude`, `ignoreDeadLinks`, `vue.template.compilerOptions`): <https://vitepress.dev/reference/site-config>
  - Deployment (`base` & GitHub Pages): <https://vitepress.dev/guide/deploy>
- **Eleventy (11ty):**
  - Configuration (`dir.input`, `pathPrefix`) & Ignores: <https://www.11ty.dev/docs/config/> · <https://www.11ty.dev/docs/ignores/>
  - Passthrough File Copy: <https://www.11ty.dev/docs/copy/>
  - HTML Base Plugin & Markdown: <https://www.11ty.dev/docs/plugins/html-base/> · <https://www.11ty.dev/docs/languages/markdown/>
  - `<is-land>`, WebC, & GitHub Pages: <https://www.11ty.dev/docs/plugins/is-land/> · <https://www.11ty.dev/docs/languages/webc/> · <https://www.11ty.dev/docs/deployment/github/>
- **MkDocs Material, Zensical & Python-Markdown:**
  - MkDocs Configuration (`docs_dir`, `exclude_docs`, `site_url`, `use_directory_urls`) & `README.md`: <https://www.mkdocs.org/user-guide/configuration/> · <https://www.mkdocs.org/user-guide/writing-your-docs/>
  - Material for MkDocs (`math`, `diagrams`, `lists`, `publishing-your-site`, `customization` / `document$`): <https://squidfunk.github.io/mkdocs-material/reference/math/> · <https://squidfunk.github.io/mkdocs-material/reference/diagrams/> · <https://squidfunk.github.io/mkdocs-material/reference/lists/> · <https://squidfunk.github.io/mkdocs-material/publishing-your-site/> · <https://squidfunk.github.io/mkdocs-material/customization/>
  - Zensical Docs (`setup/basics`, `authoring/math`, `authoring/diagrams`, `get-started/publish-your-site`, `compatibility`, `compatibility/markdown/extensions`, `compatibility/mkdocs/plugins`): <https://zensical.org/docs/setup/basics/> · <https://zensical.org/docs/authoring/math/> · <https://zensical.org/docs/authoring/diagrams/> · <https://zensical.org/docs/get-started/publish-your-site/> · <https://zensical.org/docs/compatibility/> · <https://zensical.org/docs/compatibility/markdown/extensions/> · <https://zensical.org/docs/compatibility/mkdocs/plugins/>
  - Python-Markdown `md_in_html` & PyMdown Extensions: <https://python-markdown.github.io/extensions/md_in_html/> · <https://facelessuser.github.io/pymdown-extensions/extensions/arithmatex/> · <https://facelessuser.github.io/pymdown-extensions/extensions/tasklist/> · <https://facelessuser.github.io/pymdown-extensions/extensions/superfences/>
- **Unified / Remark / Rehype, Vite & GitHub Pages:**
  - Unified, Remark/Rehype plugins: <https://unifiedjs.com> · <https://github.com/remarkjs/remark-gfm> · <https://github.com/remarkjs/remark-math> · <https://github.com/rehypejs/rehype-raw> · <https://github.com/remcohaszing/rehype-mermaid>
  - Vite (`base`, `publicDir`, Multi-Page App, Static Deploy): <https://vite.dev/config/shared-options> · <https://vite.dev/guide/build> · <https://vite.dev/guide/static-deploy>
  - GitHub Pages Actions: <https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages> · <https://github.com/actions/deploy-pages/releases> · <https://github.com/actions/upload-pages-artifact/releases>
