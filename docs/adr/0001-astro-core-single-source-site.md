---
status: accepted
---

# Astro Core in `site/` with Single-Source Markdown Ingestion and Vanilla Web Components

We will build the **ENV / SKEW** GitHub Pages site using **Astro (Core)** inside an isolated `site/` directory managed by `npm`, ingesting the `20` existing hardware Markdown files directly from the repository root (`glob({ base: '..' })`) via a small project-local `rehype` plugin, pairing zero-JS static pages with **Vanilla TypeScript + Native Web Components** for interactive islands and lazy client-side `mermaid` on the `11` diagram pages.

## Considered Options

- **Astro Starlight:** Rejected because `docsLoader()` locks content to `src/content/docs/` and requires YAML `title` frontmatter on every document, conflicting with our frontmatter-free single-source hardware Markdown.
- **VitePress:** Rejected because non-media fabrication artifacts (`bom/ibom.html`, PDFs, Gerber ZIPs, CSVs) are not handled as Vite assets and require `public/` copying, SPA-bypass `target="_self"` rewriting, and `ignoreDeadLinks` workarounds.
- **MkDocs Material / Zensical:** Rejected because MkDocs Material is in maintenance mode (EOL May 2027), Python-Markdown fails to parse `patches/README.md`'s GFM table nested inside raw `<td>` without editing source prose to add `markdown="1"`, and Zensical lacks the Python hooks required to rewrite the `86` raw HTML `<img src="../...">` tags under directory URLs.
- **Preact / React islands & `rehype-mermaid` build-time SVGs:** Rejected for v1 to avoid extra UI framework dependencies (our visual design system already uses native `<dialog>`, CSS custom properties, and `@container` queries) and to avoid maintaining Playwright + headless Chromium (~300 MB) in local dev and GitHub Actions CI just for `11` small `flowchart LR` diagrams.

## Consequences

- The repository root stays clean of `node_modules/` and JS tooling while keeping all hardware Markdown, images, KiCad, and Python files at their canonical paths with zero binary or prose duplication in git.
- A project-local `rehype` plugin (`site/src/plugins/`) owns single-source route mapping, raw HTML `<img>` resolution + PNG header dimensions, non-site source link fallback to GitHub `blob/main/`, GitHub-only nav stripping on `patches/01`–`08`, `<details>` wrapping of `panel_svg_spec.md`'s JSON appendix, and accessible table scroll wrappers.
- A post-build `npm run check` gate in `.github/workflows/deploy-pages.yml` enforces that all `25` canonical HTML routes and allowlisted Static Passthroughs exist in `site/dist/` with zero broken internal links or leaked internal files (`.vectorcraft`, `.py`, `.agents/`, `docs/research/`).
- Preact or another island framework can still be added selectively to an individual Astro island later without changing the content pipeline or build layout.
