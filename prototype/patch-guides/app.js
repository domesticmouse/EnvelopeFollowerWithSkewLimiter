// THROWAWAY UI PROTOTYPE (Issue #10): Interactive Patch Guides UX & panel-state visualizer app.
import "./panel-component.js";
import {
  CONTROL_METADATA,
  PATCH_GUIDES,
  SOURCE_FILTERS,
  TIMING_TABLE,
  buildProductionSidecarPreview,
  getPatchBySlug
} from "./patch-states.js";

const VARIANTS = [
  { key: "A", name: "Studio Rack Workbench" },
  { key: "B", name: "Annotated Blueprint Hero" },
  { key: "C", name: "Interactive Dial-In Walkthrough" }
];

const NAV_ITEMS = [
  { label: "Patches", route: "patches", current: true },
  { label: "Build", route: "build", disabledNote: "Site section preview (/build/)" },
  { label: "Hardware", route: "hardware", disabledNote: "Site section preview (/hardware/)" },
  { label: "Origin", route: "origin", disabledNote: "Site section preview (/origin/)" },
  { label: "Downloads", route: "downloads", disabledNote: "Site section preview (/downloads/)" }
];

const state = {
  variant: "A",
  patch: "hub",
  preset: 0,
  mode: "all",
  source: "all",
  signal: "idle",
  step: "all",
  previewSlug: "01-sidechain-ducking",
  activeControl: null,
  lockedControl: null,
  railCollapsed: false
};

let mermaidPromise = null;

function loadMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")
    .then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: {
          background: "#0D0E11",
          primaryColor: "#1B1D22",
          primaryTextColor: "#E8EAEF",
          primaryBorderColor: "#D8B154",
          lineColor: "#D8B154",
          secondaryColor: "#23262E",
          tertiaryColor: "#141518",
          edgeLabelBackground: "#141518",
          fontFamily: "IBM Plex Sans, system-ui, sans-serif"
        }
      });
      return mermaid;
    })
    .catch(() => null);
  return mermaidPromise;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const v = (params.get("variant") || "A").toUpperCase();
  state.variant = VARIANTS.some((item) => item.key === v) ? v : "A";

  const patchParam = params.get("patch") || "hub";
  if (patchParam === "hub") {
    state.patch = "hub";
  } else {
    const matched = getPatchBySlug(patchParam);
    state.patch = matched ? matched.slug : "hub";
  }

  const presetNum = Number.parseInt(params.get("preset") || "0", 10);
  state.preset = Number.isNaN(presetNum) || presetNum < 0 ? 0 : presetNum;

  const mode = params.get("mode") || "all";
  state.mode = ["all", "envelope-follower", "asymmetric-skew-limiter"].includes(mode) ? mode : "all";

  const src = params.get("source") || "all";
  state.source = SOURCE_FILTERS.some((f) => f.id === src) ? src : "all";

  const sig = params.get("signal") || "idle";
  state.signal = sig === "active" ? "active" : "idle";

  const st = params.get("step") || "all";
  state.step = st;
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set("variant", state.variant);
  params.set("patch", state.patch);
  if (state.patch !== "hub") {
    params.set("preset", String(state.preset));
  }
  if (state.mode !== "all") {
    params.set("mode", state.mode);
  }
  if (state.variant === "C" && state.source !== "all") {
    params.set("source", state.source);
  }
  params.set("signal", state.signal);
  if (state.variant === "C" && state.patch !== "hub" && state.step !== "all") {
    params.set("step", String(state.step));
  }
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", nextUrl);
  updateSwitcherBar();
}

function updateSwitcherBar() {
  const info = VARIANTS.find((v) => v.key === state.variant) || VARIANTS[0];
  const labelEl = document.getElementById("proto-label");
  const stateEl = document.getElementById("proto-state");
  if (labelEl) {
    labelEl.textContent = `${info.key} — ${info.name}`;
  }
  if (stateEl) {
    const parts = [
      `?variant=${state.variant}`,
      `patch=${state.patch === "hub" ? "hub" : state.patch.slice(0, 2)}`,
      `signal=${state.signal}`
    ];
    if (state.patch !== "hub") {
      parts.push(`preset=${state.preset}`);
    }
    if (state.variant === "C" && state.patch !== "hub") {
      parts.push(`step=${state.step}`);
    }
    stateEl.textContent = parts.join(" · ");
  }
}

function setState(patchObj, { preserveFocus = false } = {}) {
  const activeId = preserveFocus ? document.activeElement?.id : null;
  Object.assign(state, patchObj);

  const patch = state.patch === "hub" ? null : getPatchBySlug(state.patch);
  if (patch && state.preset >= patch.presets.length) {
    state.preset = 0;
  }
  if (!patch) {
    state.step = "all";
    state.activeControl = null;
    state.lockedControl = null;
  } else {
    const stepNum = Number.parseInt(state.step, 10);
    if (state.step !== "all" && (Number.isNaN(stepNum) || stepNum < 1 || stepNum > patch.dialInSteps.length)) {
      state.step = "all";
    }
  }

  syncUrl();
  renderApp();

  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) el.focus();
  }
}

function filteredPatches() {
  return PATCH_GUIDES.filter((p) => {
    if (state.mode !== "all" && p.mode !== state.mode) return false;
    if (state.variant === "C" && state.source !== "all" && !p.sources.includes(state.source)) return false;
    return true;
  });
}

function ledBadgeHtml(ledState, labelText) {
  const symbol = ledState === "dark" ? "○" : "●";
  return `<span class="led-pill is-${escapeHtml(ledState)}">${symbol} ${escapeHtml(labelText)}</span>`;
}

function renderHeader() {
  return `
    <header class="site-header">
      <div class="site-header-inner">
        <a href="?variant=${state.variant}&patch=hub" class="brand-slab" data-nav-hub="true">ENV / SKEW</a>
        <nav class="top-nav" aria-label="Primary site sections">
          ${NAV_ITEMS.map((item) => {
            if (item.current) {
              return `<a href="?variant=${state.variant}&patch=hub" class="top-nav-link" aria-current="page" data-nav-hub="true">${item.label}</a>`;
            }
            return `<button type="button" class="top-nav-link" title="${escapeHtml(item.disabledNote)}" data-stub-nav="${item.route}">${item.label}</button>`;
          }).join("")}
        </nav>
        <div class="header-actions">
          <button type="button" id="open-metadata-btn" class="header-btn header-btn-gold" title="Inspect structured patch-states.ts schema">
            <span>{ }</span>
            <span class="header-meta-label">Inspect Metadata</span>
          </button>
          <button type="button" id="open-search-btn" class="header-btn" aria-label="Search patch guides (Cmd+K)">
            <span>⌘K</span>
            <span class="header-meta-label">Search</span>
          </button>
          <a
            class="header-btn"
            href="https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter/tree/main/patches"
            target="_blank"
            rel="noreferrer"
          >GitHub</a>
          <button type="button" id="open-mobile-drawer-btn" class="header-btn mobile-menu-btn" aria-label="Open navigation menu">☰ Menu</button>
        </div>
      </div>
    </header>
  `;
}

function renderSidebar() {
  const ef = PATCH_GUIDES.filter((p) => p.mode === "envelope-follower");
  const slew = PATCH_GUIDES.filter((p) => p.mode === "asymmetric-skew-limiter");
  const renderLink = (p) => `
    <li>
      <button
        type="button"
        class="rail-link"
        data-open-patch="${p.slug}"
        ${state.patch === p.slug ? 'aria-current="page"' : ""}
      >
        <span class="rail-num">${p.id}</span>
        <span>${escapeHtml(p.shortTitle)}</span>
      </button>
    </li>
  `;

  return `
    <aside class="section-rail" aria-label="Patch Guides navigation">
      <div class="rail-head">
        <h2 class="rail-title">Patch Guides</h2>
        <button type="button" class="rail-toggle-btn" id="collapse-rail-btn">Hide</button>
      </div>
      <button
        type="button"
        class="rail-link"
        data-nav-hub="true"
        ${state.patch === "hub" ? 'aria-current="page"' : ""}
      >
        <span class="rail-num">ALL</span>
        <span>Patch Guides Hub</span>
      </button>
      <p class="rail-group-label">Envelope Follower Mode</p>
      <ul class="rail-list">${ef.map(renderLink).join("")}</ul>
      <p class="rail-group-label">Asymmetric Skew Limiter</p>
      <ul class="rail-list">${slew.map(renderLink).join("")}</ul>
    </aside>
  `;
}

function renderRailShowBanner() {
  if (!state.railCollapsed) return "";
  return `
    <div style="margin-block-end: 0.75rem;">
      <button type="button" class="rail-toggle-btn" id="expand-rail-btn">☰ Show Patch Guides Sidebar</button>
    </div>
  `;
}

function renderSignalToggle(preset) {
  const activeColor = state.signal === "active" ? preset.led.activeState : preset.led.idleState;
  const activeText = state.signal === "active" ? `Active: ${preset.led.activeDesc}` : `Idle: ${preset.led.idleDesc}`;
  return `
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.5rem;">
      <div class="signal-toggle-group" role="group" aria-label="Signal state LED preview">
        <button type="button" class="signal-toggle-btn" data-set-signal="idle" aria-pressed="${state.signal === "idle"}">Idle</button>
        <button type="button" class="signal-toggle-btn" data-set-signal="active" aria-pressed="${state.signal === "active"}">Active Signal</button>
      </div>
      ${ledBadgeHtml(activeColor, activeText)}
    </div>
  `;
}

function renderPresetTabs(patch, activeIdx) {
  if (patch.presets.length <= 1) {
    const p = patch.presets[0];
    return `
      <div class="tabpanel-body" style="border-block-start:1px solid var(--border-subtle); margin-block:0.75rem 1rem;">
        <strong>${escapeHtml(p.name)}:</strong> ${escapeHtml(p.summary)}
      </div>
    `;
  }
  return `
    <div class="preset-tabs-wrap">
      <div class="preset-tablist" role="tablist" aria-label="Patch sub-techniques">
        ${patch.presets
          .map(
            (pr, i) => `
          <button
            type="button"
            role="tab"
            id="preset-tab-${pr.id}"
            class="preset-tab"
            aria-selected="${i === activeIdx ? "true" : "false"}"
            tabindex="${i === activeIdx ? "0" : "-1"}"
            data-preset-idx="${i}"
          >${escapeHtml(pr.name)}</button>
        `
          )
          .join("")}
      </div>
      <div class="preset-panels-container">
        ${patch.presets
          .map(
            (pr, i) => `
          <div
            role="tabpanel"
            id="preset-panel-${pr.id}"
            aria-labelledby="preset-tab-${pr.id}"
            data-preset-panel="${i}"
            ${i === activeIdx ? 'tabindex="0"' : 'hidden="until-found"'}
          >
            <div class="tabpanel-body">
              <strong>${escapeHtml(pr.name)}:</strong> ${escapeHtml(pr.summary)}
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderModeFilterPills() {
  const counts = {
    all: PATCH_GUIDES.length,
    "envelope-follower": PATCH_GUIDES.filter((p) => p.mode === "envelope-follower").length,
    "asymmetric-skew-limiter": PATCH_GUIDES.filter((p) => p.mode === "asymmetric-skew-limiter").length
  };
  return `
    <div class="filter-bar" role="group" aria-label="Filter Patch Guides by operating mode">
      <button type="button" class="filter-btn" data-set-mode="all" aria-pressed="${state.mode === "all"}">All Modes (${counts.all})</button>
      <button type="button" class="filter-btn" data-set-mode="envelope-follower" aria-pressed="${state.mode === "envelope-follower"}">Envelope Follower Mode (${counts["envelope-follower"]})</button>
      <button type="button" class="filter-btn" data-set-mode="asymmetric-skew-limiter" aria-pressed="${state.mode === "asymmetric-skew-limiter"}">Asymmetric Skew Limiter (${counts["asymmetric-skew-limiter"]})</button>
    </div>
  `;
}

function renderSharedHubReferences() {
  return `
    <section class="doc-section">
      <h2>Timing Quick Reference (<code>0–5 V</code> Linear Ramps &amp; <code>1 V/Oct</code> Glide)</h2>
      <div class="table-scroll-region" tabindex="0" role="region" aria-label="Timing quick reference table">
        <table class="data-table">
          <caption>All four knobs have 11 radial ticks spaced 30° apart from 7 o'clock (0%) to 5 o'clock (100%).</caption>
          <thead>
            <tr>
              <th>Knob Position (<code>A1M</code>)</th>
              <th>Approx. <code>R</code></th>
              <th><code>0→5 V</code> Rise (<code>FAST</code>)</th>
              <th><code>5→0 V</code> Fall (<code>FAST</code>)</th>
              <th><code>0→5 V</code> Rise (<code>SLOW</code>)</th>
              <th><code>5→0 V</code> Fall (<code>SLOW</code>)</th>
              <th><code>1 V/Oct</code> Glide (<code>SLOW</code>)</th>
            </tr>
          </thead>
          <tbody>
            ${TIMING_TABLE.map(
              (r) => `
              <tr>
                <th scope="row">${escapeHtml(r.pos)}</th>
                <td><code>${escapeHtml(r.res)}</code></td>
                <td>${escapeHtml(r.fastRise)}</td>
                <td>${escapeHtml(r.fastFall)}</td>
                <td><strong>${escapeHtml(r.slowRise)}</strong></td>
                <td><strong>${escapeHtml(r.slowFall)}</strong></td>
                <td>${escapeHtml(r.glide)}</td>
              </tr>
            `
            ).join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="doc-section">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
        <h2 style="margin-block-end:0; border:0; padding:0;">Front-Panel Control Reference</h2>
        <div style="display:inline-flex; align-items:center; gap:0.4rem;">
          <span style="font-size:0.8rem; color:var(--ink-muted);">Panel Scale Rule</span>
          <button
            type="button"
            class="toggletip-btn"
            interestfor="tip-dial-scale"
            popovertarget="tip-dial-scale"
            popovertargetaction="show"
            aria-label="About the 11-tick knob dial scale"
          >?</button>
          <div id="tip-dial-scale" popover="hint">
            All 4 knobs span 300° across 11 radial ticks spaced 30° apart: 7 o'clock = 0% (tick 0), 12 o'clock = 50% (tick 5), 5 o'clock = 100% (tick 10).
          </div>
        </div>
      </div>
      <div class="table-scroll-region" tabindex="0" role="region" aria-label="Front-panel control reference" style="margin-block-start:0.75rem;">
        <table class="data-table stack-narrow">
          <thead>
            <tr>
              <th>Control / Jack</th>
              <th>Label</th>
              <th>Range / Behavior</th>
              <th>Engineering Notes</th>
            </tr>
          </thead>
          <tbody>
            ${CONTROL_METADATA.map(
              (c) => `
              <tr>
                <th scope="row">${escapeHtml(c.ref)}</th>
                <td data-label="Label"><code>${escapeHtml(c.label)}</code></td>
                <td data-label="Range">${escapeHtml(c.range)}</td>
                <td data-label="Notes">${escapeHtml(c.notes)}</td>
              </tr>
            `
            ).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

/* ============================================================================
 * HUB RENDERERS (A, B, C)
 * ============================================================================ */
function renderHubVariantA(patches) {
  const previewPatch = getPatchBySlug(state.previewSlug) || patches[0] || PATCH_GUIDES[0];
  const previewPreset = previewPatch.presets[0];
  return `
    <div class="main-container">
      <div class="hero-toolbar">
        <div>
          <h1 class="page-hero-title">ENV / SKEW — Patch Guides Workbench</h1>
          <p class="page-lead">Hover, focus, or click <strong>Preview</strong> on any patch row to inspect its live 6 HP front-panel state on the right rack strip.</p>
        </div>
      </div>
      ${renderModeFilterPills()}
      <div class="va-hub-grid">
        <main id="main-content" class="min-width-zero">
          <div class="va-index-list" role="list" aria-label="Patch Guides list">
            ${patches
              .map((p) => {
                const pr = p.presets[0];
                const isPreviewed = previewPatch.slug === p.slug;
                return `
                  <article class="va-index-row ${isPreviewed ? "is-previewed" : ""}" data-hover-preview="${p.slug}">
                    <div class="va-num-badge">${p.id}</div>
                    <div style="min-inline-size:0;">
                      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.45rem; margin-block-end:0.2rem;">
                        <strong style="color:var(--ink-silk); font-size:0.98rem;">${escapeHtml(p.shortTitle)}</strong>
                        <span class="mode-badge ${p.mode === "asymmetric-skew-limiter" ? "is-slew" : ""}">${escapeHtml(p.modeSummary)}</span>
                      </div>
                      <div style="font-size:0.84rem; color:var(--ink-muted); margin-block-end:0.35rem;">${escapeHtml(p.bestFor)}</div>
                      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.4rem;">
                        ${ledBadgeHtml(pr.led.idleState, pr.led.label)}
                        <span style="font-family:var(--font-mono); font-size:0.74rem; color:var(--ink-muted);">Modules: ${escapeHtml(p.companionModules.join(" · "))}</span>
                      </div>
                    </div>
                    <div class="va-index-actions">
                      <button type="button" class="va-preview-btn" data-pin-preview="${p.slug}" aria-pressed="${isPreviewed}">Preview</button>
                      <button type="button" class="va-open-btn" data-open-patch="${p.slug}">Open Guide →</button>
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
          ${renderSharedHubReferences()}
        </main>

        <aside class="va-rack-card" aria-label="Live patch preview rack">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
            <span id="hub-preview-badge" class="mode-badge ${previewPatch.mode === "asymmetric-skew-limiter" ? "is-slew" : ""}">Patch ${previewPatch.id} Preview</span>
            <button type="button" id="hub-preview-open" class="va-open-btn" data-open-patch="${previewPatch.slug}">Open →</button>
          </div>
          <h2 id="hub-preview-title" style="font-family:var(--font-display); font-size:1.05rem; margin:0.55rem 0 0.2rem; color:var(--ink-silk);">${escapeHtml(previewPatch.shortTitle)}</h2>
          <p id="hub-preview-summary" style="font-size:0.8rem; color:var(--ink-muted); margin:0;">${escapeHtml(previewPreset.summary)}</p>
          <div class="va-panel-stage">
            <env-skew-panel id="hub-preview-panel" size="full" signal-state="${state.signal}"></env-skew-panel>
          </div>
          <div id="hub-preview-signal" style="display:flex; justify-content:center; margin-block-end:0.65rem;">
            ${renderSignalToggle(previewPreset)}
          </div>
          <div class="va-rack-readout" id="hub-preview-readout">
            <p class="va-rack-readout-title">Active Patch Summary</p>
            <div><strong>GAIN:</strong> ${escapeHtml(previewPreset.knobs.gain.positionLabel)}</div>
            <div><strong>ATK / REL:</strong> ${escapeHtml(previewPreset.knobs.atk.positionLabel)} / ${escapeHtml(previewPreset.knobs.rel.positionLabel)}</div>
            <div><strong>Toggles:</strong> ${escapeHtml(previewPreset.switches.sw1.label)} · ${escapeHtml(previewPreset.switches.sw2.label)}</div>
          </div>
        </aside>
      </div>
    </div>
  `;
}

function renderHubVariantB(patches) {
  const ef = patches.filter((p) => p.mode === "envelope-follower");
  const slew = patches.filter((p) => p.mode === "asymmetric-skew-limiter");
  const renderCard = (p) => {
    const pr = p.presets[0];
    return `
      <button type="button" class="vb-patch-card" data-open-patch="${p.slug}">
        <div class="vb-mini-panel-frame">
          <env-skew-panel size="mini" class="mini-panel-instance" data-patch-slug="${p.slug}" signal-state="${state.signal}"></env-skew-panel>
        </div>
        <div class="vb-card-body">
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.4rem;">
            <span class="mode-badge ${p.mode === "asymmetric-skew-limiter" ? "is-slew" : ""}">${p.id}</span>
            ${pr.switches.sw1.mandatory ? '<span class="alert-badge">! RAW ONLY</span>' : ""}
            ${pr.knobs.gain.bypassed ? '<span class="bypass-badge">GAIN BYPASSED</span>' : ""}
          </div>
          <h3 class="vb-card-title">${escapeHtml(p.shortTitle)}</h3>
          <p style="margin:0; font-size:0.84rem; color:var(--ink-muted);">${escapeHtml(p.bestFor)}</p>
          <div class="vb-card-meta">${escapeHtml(p.primaryControls)}</div>
          <div>${ledBadgeHtml(pr.led.idleState, pr.led.label)}</div>
        </div>
      </button>
    `;
  };

  return `
    <main id="main-content" class="main-container">
      <div class="hero-toolbar">
        <div>
          <h1 class="page-hero-title">ENV / SKEW — Patchbook Visual Blueprints</h1>
          <p class="page-lead">Every card renders a live 1:1 mini <code>ENV / SKEW</code> front panel so you can scan knob angles, toggle positions, active jacks, and LED states at a glance.</p>
        </div>
        <div class="signal-toggle-group" role="group" aria-label="Global mini panel signal preview">
          <button type="button" class="signal-toggle-btn" data-set-signal="idle" aria-pressed="${state.signal === "idle"}">Idle States</button>
          <button type="button" class="signal-toggle-btn" data-set-signal="active" aria-pressed="${state.signal === "active"}">Active Signal</button>
        </div>
      </div>
      ${renderModeFilterPills()}
      ${ef.length ? `<h2 style="font-family:var(--font-display); color:var(--accent-bright); margin:0 0 0.75rem;">Envelope Follower Mode (<code>IN</code> Patched, <code>SLEW IN</code> Unpatched)</h2><div class="vb-card-grid">${ef.map(renderCard).join("")}</div>` : ""}
      ${slew.length ? `<h2 style="font-family:var(--font-display); color:#bae6fd; margin:0 0 0.75rem;">Asymmetric Skew Limiter Mode (<code>SLEW IN</code> Patched)</h2><div class="vb-card-grid">${slew.map(renderCard).join("")}</div>` : ""}
      ${renderSharedHubReferences()}
    </main>
  `;
}

function renderHubVariantC(patches) {
  return `
    <main id="main-content" class="main-container">
      <div class="hero-toolbar">
        <div>
          <h1 class="page-hero-title">ENV / SKEW — Start From What You Have</h1>
          <p class="page-lead">Pick your sound or CV source below to jump straight to matching patches, or expand <strong>Quick Peek Panel</strong> on any band without leaving the hub.</p>
        </div>
      </div>

      <div class="filter-bar" role="group" aria-label="Start from what you have source filter">
        ${SOURCE_FILTERS.map(
          (src) => `
          <button type="button" class="filter-btn" data-set-source="${src.id}" aria-pressed="${state.source === src.id}">${escapeHtml(src.label)}</button>
        `
        ).join("")}
      </div>
      ${renderModeFilterPills()}

      <div class="vc-monograph-list">
        ${patches
          .map((p) => {
            const pr = p.presets[0];
            const ins = [pr.jacks.in.state === "active" ? "IN" : null, pr.jacks.slewIn.state === "active" ? "SLEW IN" : null].filter(Boolean).join(" + ");
            const outs = [pr.jacks.out.state === "active" ? "OUT" : null, pr.jacks.invOut.state === "active" ? "INV OUT" : null].filter(Boolean).join(" + ");
            return `
              <article class="vc-monograph-band">
                <div class="vc-band-top">
                  <div class="vc-big-num">${p.id}</div>
                  <div style="min-inline-size:0;">
                    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.45rem; margin-block-end:0.25rem;">
                      <span class="mode-badge ${p.mode === "asymmetric-skew-limiter" ? "is-slew" : ""}">${escapeHtml(p.modeLabel)}</span>
                      <span class="vc-route-pill">${escapeHtml(ins)} ──▶ ${escapeHtml(outs)}</span>
                      ${ledBadgeHtml(pr.led.idleState, pr.led.label)}
                    </div>
                    <h2 style="font-family:var(--font-display); font-size:1.18rem; margin:0 0 0.22rem; color:var(--ink-silk);">${escapeHtml(p.shortTitle)}</h2>
                    <p style="margin:0; font-size:0.87rem; color:var(--ink-muted);">${escapeHtml(p.tagline)}</p>
                  </div>
                  <div class="vc-band-cta">
                    <button type="button" class="va-open-btn" data-open-patch="${p.slug}">Walkthrough →</button>
                  </div>
                </div>
                <details class="vc-quick-peek">
                  <summary>Quick Peek Panel &amp; Companion Gear (${escapeHtml(p.companionModules.join(" · "))})</summary>
                  <div class="vc-quick-peek-body">
                    <div class="vc-quick-peek-panel">
                      <env-skew-panel size="mini" class="mini-panel-instance" data-patch-slug="${p.slug}" signal-state="${state.signal}"></env-skew-panel>
                    </div>
                    <div style="font-size:0.84rem; display:flex; flex-direction:column; gap:0.25rem;">
                      <div><strong>GAIN:</strong> ${escapeHtml(pr.knobs.gain.positionLabel)}</div>
                      <div><strong>ATK:</strong> ${escapeHtml(pr.knobs.atk.positionLabel)} · <strong>REL:</strong> ${escapeHtml(pr.knobs.rel.positionLabel)}</div>
                      <div><strong>OFFSET:</strong> ${escapeHtml(pr.knobs.offset.positionLabel)}</div>
                      <div><strong>Switches:</strong> ${escapeHtml(pr.switches.sw1.label)} · ${escapeHtml(pr.switches.sw2.label)}</div>
                    </div>
                  </div>
                </details>
              </article>
            `;
          })
          .join("")}
      </div>
      ${renderSharedHubReferences()}
    </main>
  `;
}

/* ============================================================================
 * GUIDE RENDERERS (A, B, C)
 * ============================================================================ */
function buildControlRows(preset) {
  return [
    {
      id: "rv1",
      label: "GAIN (RV1)",
      pos: preset.knobs.gain.positionLabel,
      effect: preset.knobs.gain.effect,
      bypassed: Boolean(preset.knobs.gain.bypassed),
      mandatory: false
    },
    {
      id: "rv2",
      label: "ATK (RV2)",
      pos: preset.knobs.atk.positionLabel,
      effect: preset.knobs.atk.effect,
      bypassed: false,
      mandatory: false
    },
    {
      id: "rv3",
      label: "REL (RV3)",
      pos: preset.knobs.rel.positionLabel,
      effect: preset.knobs.rel.effect,
      bypassed: false,
      mandatory: false
    },
    {
      id: "rv4",
      label: "OFFSET (RV4)",
      pos: preset.knobs.offset.positionLabel,
      effect: preset.knobs.offset.effect,
      bypassed: false,
      mandatory: false
    },
    {
      id: "sw1",
      label: "Left Toggle (SW1)",
      pos: preset.switches.sw1.label,
      effect: preset.switches.sw1.effect,
      bypassed: false,
      mandatory: Boolean(preset.switches.sw1.mandatory)
    },
    {
      id: "sw2",
      label: "Right Toggle (SW2)",
      pos: preset.switches.sw2.label,
      effect: preset.switches.sw2.effect,
      bypassed: false,
      mandatory: false
    },
    {
      id: "led1",
      label: "+ / − LED (LED1)",
      pos: preset.led.label,
      effect: `Idle: ${preset.led.idleDesc} · Active: ${preset.led.activeDesc}`,
      bypassed: false,
      mandatory: false
    },
    {
      id: "j1",
      label: "IN Jack (J1)",
      pos: preset.jacks.in.state.toUpperCase(),
      effect: preset.jacks.in.note,
      bypassed: preset.jacks.in.state === "bypassed",
      mandatory: false
    },
    {
      id: "j2",
      label: "SLEW IN Jack (J2)",
      pos: preset.jacks.slewIn.state.toUpperCase(),
      effect: preset.jacks.slewIn.note,
      bypassed: false,
      mandatory: false
    },
    {
      id: "j3",
      label: "OUT Jack (J3)",
      pos: preset.jacks.out.state.toUpperCase(),
      effect: preset.jacks.out.note,
      bypassed: false,
      mandatory: false
    },
    {
      id: "j4",
      label: "INV OUT Jack (J4)",
      pos: preset.jacks.invOut.state.toUpperCase(),
      effect: preset.jacks.invOut.note,
      bypassed: false,
      mandatory: false
    }
  ];
}

function renderSharedGuideBody(patch, { includeSettingsTable = true, includeSteps = true } = {}, preset) {
  const idx = PATCH_GUIDES.findIndex((p) => p.slug === patch.slug);
  const prev = idx > 0 ? PATCH_GUIDES[idx - 1] : null;
  const next = idx < PATCH_GUIDES.length - 1 ? PATCH_GUIDES[idx + 1] : null;
  const rows = buildControlRows(preset);

  return `
    ${
      includeSettingsTable
        ? `
    <section class="doc-section">
      <h2>Front-Panel Starting Settings <span style="font-size:0.78rem; color:var(--ink-muted); font-weight:400;">(hover or click any row to highlight on the panel)</span></h2>
      <div class="table-scroll-region" tabindex="0" role="region" aria-label="Front-panel starting settings">
        <table class="data-table stack-narrow">
          <thead>
            <tr>
              <th>Control</th>
              <th>Starting Position</th>
              <th>Electrical State &amp; Purpose</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr
                data-control="${r.id}"
                class="${state.activeControl === r.id ? "is-row-highlighted" : ""}"
              >
                <th scope="row">${escapeHtml(r.label)}</th>
                <td data-label="Position">
                  <strong>${escapeHtml(r.pos)}</strong>
                  ${r.bypassed ? ' <span class="bypass-badge">BYPASSED</span>' : ""}
                  ${r.mandatory ? ' <span class="alert-badge">! MANDATORY</span>' : ""}
                </td>
                <td data-label="Purpose">${escapeHtml(r.effect)}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>`
        : ""
    }

    <section class="doc-section">
      <h2>What You Need &amp; Signal Flow</h2>
      <ul class="clean-list" style="margin-block-end:0.9rem;">
        ${patch.whatYouNeed.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <div class="mermaid-card">
        <div class="mermaid-target" data-mermaid-source="${escapeHtml(patch.mermaid)}">
          <pre class="mermaid-fallback">${escapeHtml(patch.mermaid)}</pre>
        </div>
      </div>
    </section>

    ${
      includeSteps
        ? `
    <section class="doc-section">
      <h2>Step-by-Step Dial-In</h2>
      <ol class="clean-list">
        ${patch.dialInSteps
          .map(
            (s) => `
          <li><strong>${escapeHtml(s.title)}:</strong> ${escapeHtml(s.text)}</li>
        `
          )
          .join("")}
      </ol>
    </section>`
        : ""
    }

    <section class="doc-section">
      <h2>How the Controls Shape the Patch</h2>
      <ul class="clean-list">
        ${patch.howItWorks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>

    <section class="doc-section">
      <h2>Variations &amp; Creative Patches</h2>
      <ul class="clean-list">
        ${patch.variations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>

    <section class="doc-section">
      <h2>Troubleshooting &amp; Tips</h2>
      <div class="table-scroll-region" tabindex="0" role="region" aria-label="Troubleshooting table">
        <table class="data-table stack-narrow">
          <thead>
            <tr>
              <th>Symptom</th>
              <th>Likely Cause</th>
              <th>Fix</th>
            </tr>
          </thead>
          <tbody>
            ${patch.troubleshooting
              .map(
                (t) => `
              <tr>
                <th scope="row">${escapeHtml(t.symptom)}</th>
                <td data-label="Cause">${escapeHtml(t.cause)}</td>
                <td data-label="Fix">${escapeHtml(t.fix)}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>

    <nav class="prev-next-footer" aria-label="Sequential patch navigation">
      ${
        prev
          ? `<button type="button" class="prev-next-btn" data-open-patch="${prev.slug}"><span class="prev-next-kicker">← Previous Patch</span><strong>${escapeHtml(prev.title)}</strong></button>`
          : `<button type="button" class="prev-next-btn" data-nav-hub="true"><span class="prev-next-kicker">← Hub</span><strong>All Patch Guides</strong></button>`
      }
      ${
        next
          ? `<button type="button" class="prev-next-btn is-next" data-open-patch="${next.slug}"><span class="prev-next-kicker">Next Patch →</span><strong>${escapeHtml(next.title)}</strong></button>`
          : `<button type="button" class="prev-next-btn is-next" data-nav-hub="true"><span class="prev-next-kicker">Index →</span><strong>All Patch Guides</strong></button>`
      }
    </nav>
  `;
}

function renderBreadcrumbs(patch) {
  return `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <button type="button" class="crumb-btn" data-nav-hub="true">Patches</button>
      <span aria-hidden="true">/</span>
      <span>${escapeHtml(patch.title)}</span>
    </nav>
  `;
}

function renderControlInspectorCard(preset) {
  const rows = buildControlRows(preset);
  const selected = rows.find((r) => r.id === state.activeControl) || null;
  if (!selected) {
    return `
      <div class="va-rack-readout" id="control-inspector-box">
        <p class="va-rack-readout-title">Control Inspector</p>
        <div style="color:var(--ink-muted);">Hover, focus, or click any knob, toggle, LED, or jack on the panel (or a row in the table) to inspect its exact role.</div>
      </div>
    `;
  }
  return `
    <div class="va-rack-readout" id="control-inspector-box">
      <p class="va-rack-readout-title">${escapeHtml(selected.label)}</p>
      <div><strong>${escapeHtml(selected.pos)}</strong></div>
      <div style="color:var(--ink-muted); margin-block-start:0.2rem;">${escapeHtml(selected.effect)}</div>
    </div>
  `;
}

function renderGuideVariantA(patch, preset) {
  return `
    <div class="main-container">
      ${renderRailShowBanner()}
      <div class="doc-grid-3col ${state.railCollapsed ? "is-rail-collapsed" : ""}">
        ${state.railCollapsed ? "" : renderSidebar()}
        <main id="main-content" class="main-col">
          ${renderBreadcrumbs(patch)}
          <div class="hero-toolbar">
            <div>
              <div class="hero-chips" style="margin-block-end:0.45rem;">
                <span class="mode-badge ${patch.mode === "asymmetric-skew-limiter" ? "is-slew" : ""}">${escapeHtml(patch.modeLabel)}</span>
                <span style="font-family:var(--font-mono); font-size:0.76rem; color:var(--ink-muted);">${escapeHtml(patch.modeSummary)}</span>
              </div>
              <h1 class="page-hero-title">${escapeHtml(patch.title)}</h1>
            </div>
          </div>
          <p class="page-lead">${escapeHtml(patch.tagline)}</p>
          ${renderPresetTabs(patch, state.preset)}
          ${renderSharedGuideBody(patch, { includeSettingsTable: true, includeSteps: true }, preset)}
        </main>
        <aside class="workbench-dock va-rack-card" aria-label="Interactive ENV / SKEW Rack Strip">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
            <span style="font-family:var(--font-mono); font-size:0.74rem; color:var(--accent-bright); text-transform:uppercase;">Live 6 HP Panel</span>
            ${preset.switches.sw1.mandatory ? '<span class="alert-badge">! RAW</span>' : ""}
          </div>
          <div class="va-panel-stage">
            <env-skew-panel id="guide-panel-a" size="full" signal-state="${state.signal}"></env-skew-panel>
          </div>
          <div style="margin-block-end:0.65rem;">
            ${renderSignalToggle(preset)}
          </div>
          ${renderControlInspectorCard(preset)}
        </aside>
      </div>
    </div>
  `;
}

function renderGuideVariantB(patch, preset) {
  const rows = buildControlRows(preset);
  // Group into the exact 7 physical rows of the ENV / SKEW panel
  const hardwareRows = [
    rows[0],
    rows[1],
    rows[2],
    rows[3],
    {
      id: "sw-led",
      label: "SW1 · LED1 · SW2",
      pos: `${preset.switches.sw1.label} | ${preset.led.label} | ${preset.switches.sw2.label}`,
      effect: `${preset.switches.sw1.effect} · ${preset.switches.sw2.effect}`,
      bypassed: false,
      mandatory: Boolean(preset.switches.sw1.mandatory)
    },
    {
      id: "j-in",
      label: "IN · SLEW IN",
      pos: `IN: ${preset.jacks.in.state.toUpperCase()} · SLEW IN: ${preset.jacks.slewIn.state.toUpperCase()}`,
      effect: `${preset.jacks.in.note} · ${preset.jacks.slewIn.note}`,
      bypassed: false,
      mandatory: false
    },
    {
      id: "j-out",
      label: "OUT · INV OUT",
      pos: `OUT: ${preset.jacks.out.state.toUpperCase()} · INV OUT: ${preset.jacks.invOut.state.toUpperCase()}`,
      effect: `${preset.jacks.out.note} · ${preset.jacks.invOut.note}`,
      bypassed: false,
      mandatory: false
    }
  ];

  return `
    <div class="main-container">
      ${renderRailShowBanner()}
      <div class="doc-grid-2col ${state.railCollapsed ? "is-rail-collapsed" : ""}">
        ${state.railCollapsed ? "" : renderSidebar()}
        <main id="main-content" class="main-col">
          ${renderBreadcrumbs(patch)}
          <div class="hero-chips" style="margin-block-end:0.45rem;">
            <span class="mode-badge ${patch.mode === "asymmetric-skew-limiter" ? "is-slew" : ""}">${escapeHtml(patch.modeLabel)}</span>
            <span style="font-family:var(--font-mono); font-size:0.76rem; color:var(--ink-muted);">${escapeHtml(patch.modeSummary)}</span>
          </div>
          <h1 class="page-hero-title">${escapeHtml(patch.title)}</h1>
          <p class="page-lead">${escapeHtml(patch.tagline)}</p>
          ${renderPresetTabs(patch, state.preset)}

          <section class="vb-blueprint-stage" aria-label="Annotated Patch Blueprint Hero">
            <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:0.65rem; margin-block-end:0.9rem;">
              <strong style="font-family:var(--font-display); color:var(--accent-bright); text-transform:uppercase; letter-spacing:0.05em;">Hardware Callout Blueprint (Row-Aligned 1:1)</strong>
              ${renderSignalToggle(preset)}
            </div>
            <div class="vb-blueprint-grid">
              <div class="vb-blueprint-panel-col">
                <env-skew-panel id="guide-panel-b" size="full" signal-state="${state.signal}"></env-skew-panel>
              </div>
              <div class="vb-callout-matrix">
                ${hardwareRows
                  .map(
                    (row) => `
                  <div class="vb-callout-row ${row.bypassed ? "is-bypassed" : ""} ${row.mandatory ? "is-mandatory" : ""}">
                    <div class="vb-callout-label">${escapeHtml(row.label)}</div>
                    <div style="min-inline-size:0;">
                      <div class="vb-callout-val">
                        <strong>${escapeHtml(row.pos)}</strong>
                        ${row.bypassed ? ' <span class="bypass-badge">BYPASSED</span>' : ""}
                        ${row.mandatory ? ' <span class="alert-badge">! MANDATORY</span>' : ""}
                      </div>
                      <div class="vb-callout-effect">${escapeHtml(row.effect)}</div>
                    </div>
                  </div>
                `
                  )
                  .join("")}
              </div>
            </div>
          </section>

          ${renderSharedGuideBody(patch, { includeSettingsTable: false, includeSteps: true }, preset)}
        </main>
      </div>
    </div>
  `;
}

function renderGuideVariantC(patch, preset) {
  const activeStepNum = state.step === "all" ? null : Number.parseInt(state.step, 10);
  const activeStepObj = activeStepNum ? patch.dialInSteps[activeStepNum - 1] : null;
  const totalSteps = patch.dialInSteps.length;

  return `
    <div class="main-container">
      ${renderRailShowBanner()}
      <div class="doc-grid-2col ${state.railCollapsed ? "is-rail-collapsed" : ""}">
        ${state.railCollapsed ? "" : renderSidebar()}
        <main id="main-content" class="main-col">
          ${renderBreadcrumbs(patch)}
          <div class="hero-chips" style="margin-block-end:0.45rem;">
            <span class="mode-badge ${patch.mode === "asymmetric-skew-limiter" ? "is-slew" : ""}">${escapeHtml(patch.modeLabel)}</span>
            <span style="font-family:var(--font-mono); font-size:0.76rem; color:var(--ink-muted);">${escapeHtml(patch.modeSummary)}</span>
          </div>
          <h1 class="page-hero-title">${escapeHtml(patch.title)}</h1>
          <p class="page-lead">${escapeHtml(patch.tagline)}</p>
          ${renderPresetTabs(patch, state.preset)}

          <section class="vc-walkthrough-stage" aria-label="Interactive Step-by-Step Dial-In Stage">
            <div class="vc-walkthrough-panel">
              <env-skew-panel id="guide-panel-c" size="full" signal-state="${state.signal}"></env-skew-panel>
              <div style="margin-block-start:0.65rem;">
                ${renderSignalToggle(preset)}
              </div>
            </div>
            <div class="vc-steps-col">
              <div class="vc-step-controls">
                <strong style="font-family:var(--font-display); color:var(--accent-bright); font-size:1.05rem;">
                  ${activeStepObj ? `Step ${activeStepNum} of ${totalSteps} Spotlight` : "Interactive Step-by-Step Dial-In"}
                </strong>
                <div style="display:flex; flex-wrap:wrap; gap:0.4rem;">
                  <button type="button" class="filter-btn" id="step-prev-btn" ${activeStepNum === 1 ? "disabled" : ""}>← Prev Step</button>
                  <button type="button" class="filter-btn" id="step-next-btn">${activeStepNum ? (activeStepNum < totalSteps ? "Next Step →" : "All Controls") : "Start Step 1 →"}</button>
                  <button type="button" class="filter-btn" data-set-step="all" aria-pressed="${state.step === "all"}">Show All Controls</button>
                </div>
              </div>
              ${patch.dialInSteps
                .map((s, idx) => {
                  const num = idx + 1;
                  const isCurrent = activeStepNum === num;
                  return `
                    <button
                      type="button"
                      class="vc-step-card"
                      data-set-step="${num}"
                      ${isCurrent ? 'aria-current="step"' : ""}
                    >
                      <span class="vc-step-kicker">STEP ${num} · HIGHLIGHTS ${escapeHtml(s.spotlightControls.map((c) => c.toUpperCase()).join(", "))}</span>
                      <span class="vc-step-title">${escapeHtml(s.title)}</span>
                      <p class="vc-step-text">${escapeHtml(s.text)}</p>
                    </button>
                  `;
                })
                .join("")}
            </div>
          </section>

          ${renderSharedGuideBody(patch, { includeSettingsTable: true, includeSteps: false }, preset)}
        </main>
      </div>
    </div>
  `;
}

function renderFooter() {
  return `
    <footer class="site-footer">
      <div class="site-footer-inner">
        <div>
          <strong>ENV / SKEW</strong> — 6 HP Eurorack Envelope Follower &amp; Asymmetric Skew Limiter ·
          Origin: <a href="https://note.com/solder_state/n/n110e9ba066b3?hl=en" target="_blank" rel="noreferrer">HAGIWO No. 43</a> →
          <a href="https://github.com/domesticmouse/EnvelopeFollower" target="_blank" rel="noreferrer">domesticmouse/EnvelopeFollower</a>
        </div>
        <div>Apache-2.0 · Throwaway UI Prototype (Issue #10) · This is not an officially supported Google product.</div>
      </div>
    </footer>
  `;
}

function renderApp() {
  const root = document.getElementById("app-root");
  if (!root) return;

  const patch = state.patch === "hub" ? null : getPatchBySlug(state.patch);
  const patches = filteredPatches();

  let mainHtml = "";
  if (!patch) {
    if (state.variant === "A") mainHtml = renderHubVariantA(patches);
    else if (state.variant === "B") mainHtml = renderHubVariantB(patches);
    else mainHtml = renderHubVariantC(patches);
  } else {
    const preset = patch.presets[state.preset] || patch.presets[0];
    if (state.variant === "A") mainHtml = renderGuideVariantA(patch, preset);
    else if (state.variant === "B") mainHtml = renderGuideVariantB(patch, preset);
    else mainHtml = renderGuideVariantC(patch, preset);
  }

  root.className = `app-shell variant-${state.variant.toLowerCase()}`;
  root.innerHTML = `${renderHeader()}${mainHtml}${renderFooter()}`;

  hydratePanels(patch);
  hydrateMermaid();
  updateSwitcherBar();
}

function hydratePanels(patch) {
  const hubPanel = document.getElementById("hub-preview-panel");
  if (hubPanel) {
    const previewPatch = getPatchBySlug(state.previewSlug) || PATCH_GUIDES[0];
    hubPanel.preset = previewPatch.presets[0];
    hubPanel.signalState = state.signal;
  }

  document.querySelectorAll(".mini-panel-instance").forEach((el) => {
    const p = getPatchBySlug(el.getAttribute("data-patch-slug"));
    if (p) {
      el.preset = p.presets[0];
      el.signalState = state.signal;
    }
  });

  if (patch) {
    const preset = patch.presets[state.preset] || patch.presets[0];
    const panelA = document.getElementById("guide-panel-a");
    if (panelA) {
      panelA.preset = preset;
      panelA.signalState = state.signal;
      panelA.activeControl = state.activeControl;
    }
    const panelB = document.getElementById("guide-panel-b");
    if (panelB) {
      panelB.preset = preset;
      panelB.signalState = state.signal;
      panelB.activeControl = state.activeControl;
    }
    const panelC = document.getElementById("guide-panel-c");
    if (panelC) {
      panelC.preset = preset;
      panelC.signalState = state.signal;
      const stepNum = Number.parseInt(state.step, 10);
      const stepObj = !Number.isNaN(stepNum) ? patch.dialInSteps[stepNum - 1] : null;
      panelC.spotlightControls = stepObj ? stepObj.spotlightControls : null;
    }
  }
}

async function hydrateMermaid() {
  const targets = document.querySelectorAll(".mermaid-target");
  if (!targets.length) return;
  const mermaid = await loadMermaid();
  if (!mermaid) return;

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const code = target.getAttribute("data-mermaid-source");
    if (!code) continue;
    try {
      const { svg } = await mermaid.render(`mmd-patch-${Date.now()}-${i}`, code);
      target.innerHTML = svg;
    } catch {
      /* Retain pre fallback */
    }
  }
}

function updateActiveControlVisuals(controlId, preset) {
  const panel = document.getElementById("guide-panel-a") || document.getElementById("guide-panel-b");
  if (panel) {
    panel.activeControl = controlId;
  }
  document.querySelectorAll(".data-table tbody tr[data-control]").forEach((row) => {
    row.classList.toggle("is-row-highlighted", row.getAttribute("data-control") === controlId);
  });
  const box = document.getElementById("control-inspector-box");
  if (box && preset) {
    const rows = buildControlRows(preset);
    const selected = rows.find((r) => r.id === controlId);
    if (selected) {
      box.innerHTML = `<p class="va-rack-readout-title">${escapeHtml(selected.label)}</p><div><strong>${escapeHtml(selected.pos)}</strong></div><div style="color:var(--ink-muted); margin-block-start:0.2rem;">${escapeHtml(selected.effect)}</div>`;
    } else {
      box.innerHTML = `<p class="va-rack-readout-title">Control Inspector</p><div style="color:var(--ink-muted);">Hover, focus, or click any knob, toggle, LED, or jack on the panel (or a row in the table) to inspect its exact role.</div>`;
    }
  }
}

function setupModalLightDismiss(dialog) {
  let downOnBackdrop = false;
  dialog.addEventListener("pointerdown", (e) => {
    downOnBackdrop = e.target === dialog;
  });
  dialog.addEventListener("pointerup", (e) => {
    if (downOnBackdrop && e.target === dialog) {
      dialog.close();
    }
    downOnBackdrop = false;
  });
}

function openMetadataModal() {
  const dialog = document.getElementById("metadata-dialog");
  const subtitle = document.getElementById("metadata-subtitle");
  const codeEl = document.querySelector("#metadata-pre code");
  const patch = state.patch === "hub" ? null : getPatchBySlug(state.patch);
  const payload = buildProductionSidecarPreview(patch);
  if (subtitle) {
    subtitle.textContent = patch
      ? `Single-patch sidecar entry for "${patch.slug}" — zero prose duplication from patches/${patch.slug}.md.`
      : "Full 8-patch sidecar manifest — Markdown prose remains solely in patches/01..08.md.";
  }
  if (codeEl) {
    codeEl.textContent = JSON.stringify(payload, null, 2);
  }
  dialog.showModal();
}

function renderSearchMatches(query) {
  const list = document.getElementById("search-results");
  if (!list) return;
  const q = query.trim().toLowerCase();
  const hits = PATCH_GUIDES.filter((p) => {
    if (!q) return true;
    const blob = [
      p.title,
      p.modeLabel,
      p.bestFor,
      p.primaryControls,
      p.tagline,
      ...p.tags,
      ...p.companionModules,
      ...p.troubleshooting.map((t) => `${t.symptom} ${t.cause} ${t.fix}`)
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  });

  if (!hits.length) {
    list.innerHTML = `<li style="padding:0.5rem; color:var(--ink-muted);">No matching Patch Guides found for "${escapeHtml(query)}".</li>`;
    return;
  }

  list.innerHTML = hits
    .map(
      (p) => `
    <li>
      <button type="button" class="search-result-btn" data-search-open="${p.slug}">
        <strong style="color:var(--ink-silk);">${escapeHtml(p.title)}</strong>
        <span style="font-size:0.78rem; color:var(--ink-muted);">${escapeHtml(p.modeLabel)} · ${escapeHtml(p.primaryControls)}</span>
      </button>
    </li>
  `
    )
    .join("");
}

function openSearchModal() {
  const dialog = document.getElementById("search-dialog");
  const input = document.getElementById("search-input");
  renderSearchMatches(input ? input.value : "");
  dialog.showModal();
  if (input) input.focus();
}

function openMobileDrawer() {
  const dialog = document.getElementById("mobile-drawer");
  const list = document.getElementById("mobile-drawer-links");
  if (list) {
    list.innerHTML = `
      <li><button type="button" data-drawer-hub="true">Patches Hub (All 8 Guides)</button></li>
      ${PATCH_GUIDES.map((p) => `<li><button type="button" data-drawer-patch="${p.slug}">${escapeHtml(p.title)}</button></li>`).join("")}
    `;
  }
  dialog.showModal();
}

function cycleVariant(delta) {
  const idx = VARIANTS.findIndex((v) => v.key === state.variant);
  const next = VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length];
  setState({ variant: next.key });
}

function initGlobalListeners() {
  const root = document.getElementById("app-root");

  // Safari fallback for popover="hint" toggletips (MUST happen in beforetoggle!)
  const probe = document.createElement("div");
  probe.popover = "hint";
  if (probe.popover !== "hint") {
    document.addEventListener(
      "beforetoggle",
      (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const toggletip = target.getAttribute("popover") === "hint" && target.id && document.querySelector(`[popovertarget="${CSS.escape(target.id)}"]`);
        if (e.newState === "open" && toggletip) {
          target.popover = "auto";
        }
      },
      true
    );
  }

  // Reveal hidden="until-found" preset panels cleanly on Find-in-page beforematch
  document.addEventListener("beforematch", (e) => {
    const panel = e.target instanceof HTMLElement ? e.target.closest('[role="tabpanel"][data-preset-panel]') : null;
    if (!panel) return;
    const idx = Number.parseInt(panel.getAttribute("data-preset-panel") || "0", 10);
    if (!Number.isNaN(idx) && idx !== state.preset) {
      setState({ preset: idx });
    }
  });

  // Delegated clicks inside app-root
  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const openPatchBtn = target.closest("[data-open-patch]");
    if (openPatchBtn) {
      e.preventDefault();
      setState({ patch: openPatchBtn.getAttribute("data-open-patch"), preset: 0, step: "all", activeControl: null, lockedControl: null });
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    if (target.closest("[data-nav-hub]")) {
      e.preventDefault();
      setState({ patch: "hub", activeControl: null, lockedControl: null });
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    const pinBtn = target.closest("[data-pin-preview]");
    if (pinBtn) {
      const slug = pinBtn.getAttribute("data-pin-preview");
      setState({ previewSlug: slug });
      return;
    }

    const modeBtn = target.closest("[data-set-mode]");
    if (modeBtn) {
      setState({ mode: modeBtn.getAttribute("data-set-mode") }, { preserveFocus: true });
      return;
    }

    const srcBtn = target.closest("[data-set-source]");
    if (srcBtn) {
      setState({ source: srcBtn.getAttribute("data-set-source") }, { preserveFocus: true });
      return;
    }

    const sigBtn = target.closest("[data-set-signal]");
    if (sigBtn) {
      setState({ signal: sigBtn.getAttribute("data-set-signal") }, { preserveFocus: true });
      return;
    }

    const tabBtn = target.closest("[data-preset-idx]");
    if (tabBtn) {
      const idx = Number.parseInt(tabBtn.getAttribute("data-preset-idx") || "0", 10);
      setState({ preset: idx, activeControl: null, lockedControl: null }, { preserveFocus: true });
      return;
    }

    const stepBtn = target.closest("[data-set-step]");
    if (stepBtn) {
      setState({ step: stepBtn.getAttribute("data-set-step") }, { preserveFocus: true });
      return;
    }

    if (target.closest("#step-prev-btn")) {
      const curr = Number.parseInt(state.step, 10);
      if (!Number.isNaN(curr) && curr > 1) {
        setState({ step: String(curr - 1) }, { preserveFocus: true });
      }
      return;
    }

    if (target.closest("#step-next-btn")) {
      const patch = getPatchBySlug(state.patch);
      if (!patch) return;
      const curr = state.step === "all" ? 0 : Number.parseInt(state.step, 10);
      const next = curr < patch.dialInSteps.length ? String(curr + 1) : "all";
      setState({ step: next }, { preserveFocus: true });
      return;
    }

    if (target.closest("#collapse-rail-btn")) {
      setState({ railCollapsed: true });
      return;
    }

    if (target.closest("#expand-rail-btn")) {
      setState({ railCollapsed: false });
      return;
    }

    const stubBtn = target.closest("[data-stub-nav]");
    if (stubBtn) {
      const section = stubBtn.getAttribute("data-stub-nav");
      const stateEl = document.getElementById("proto-state");
      if (stateEl) {
        stateEl.textContent = `/${section}/ is outside Issue #10 prototype scope (Patches UX focus)`;
      }
      return;
    }

    if (target.closest("#open-metadata-btn")) {
      openMetadataModal();
      return;
    }

    if (target.closest("#open-search-btn")) {
      openSearchModal();
      return;
    }

    if (target.closest("#open-mobile-drawer-btn")) {
      openMobileDrawer();
      return;
    }

    const row = target.closest(".data-table tbody tr[data-control]");
    if (row && (state.variant === "A" || state.variant === "B")) {
      const ctrlId = row.getAttribute("data-control");
      state.lockedControl = state.lockedControl === ctrlId ? null : ctrlId;
      state.activeControl = state.lockedControl;
      const patch = getPatchBySlug(state.patch);
      updateActiveControlVisuals(state.activeControl, patch?.presets[state.preset] || patch?.presets[0]);
      return;
    }
  });

  // Hub hover preview in Variant A + bidirectional table/panel hover
  root.addEventListener("pointerover", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    if (state.variant === "A" && state.patch === "hub") {
      const hubRow = target.closest("[data-hover-preview]");
      if (hubRow) {
        const slug = hubRow.getAttribute("data-hover-preview");
        if (slug && slug !== state.previewSlug) {
          state.previewSlug = slug;
          const p = getPatchBySlug(slug);
          const hubPanel = document.getElementById("hub-preview-panel");
          if (p && hubPanel) {
            const pr = p.presets[0];
            hubPanel.preset = pr;
            const badgeEl = document.getElementById("hub-preview-badge");
            const openEl = document.getElementById("hub-preview-open");
            const titleEl = document.getElementById("hub-preview-title");
            const sumEl = document.getElementById("hub-preview-summary");
            const sigEl = document.getElementById("hub-preview-signal");
            const readEl = document.getElementById("hub-preview-readout");
            if (badgeEl) {
              badgeEl.className = `mode-badge ${p.mode === "asymmetric-skew-limiter" ? "is-slew" : ""}`;
              badgeEl.textContent = `Patch ${p.id} Preview`;
            }
            if (openEl) openEl.setAttribute("data-open-patch", p.slug);
            if (titleEl) titleEl.textContent = p.shortTitle;
            if (sumEl) sumEl.textContent = pr.summary;
            if (sigEl) sigEl.innerHTML = renderSignalToggle(pr);
            if (readEl) {
              readEl.innerHTML = `<p class="va-rack-readout-title">Active Patch Summary</p><div><strong>GAIN:</strong> ${escapeHtml(pr.knobs.gain.positionLabel)}</div><div><strong>ATK / REL:</strong> ${escapeHtml(pr.knobs.atk.positionLabel)} / ${escapeHtml(pr.knobs.rel.positionLabel)}</div><div><strong>Toggles:</strong> ${escapeHtml(pr.switches.sw1.label)} · ${escapeHtml(pr.switches.sw2.label)}</div>`;
            }
          }
          document.querySelectorAll(".va-index-row").forEach((r) => {
            r.classList.toggle("is-previewed", r.getAttribute("data-hover-preview") === slug);
          });
        }
      }
    }

    const tr = target.closest(".data-table tbody tr[data-control]");
    if (tr && !state.lockedControl) {
      const ctrlId = tr.getAttribute("data-control");
      state.activeControl = ctrlId;
      const patch = getPatchBySlug(state.patch);
      updateActiveControlVisuals(ctrlId, patch?.presets[state.preset] || patch?.presets[0]);
    }
  });

  root.addEventListener("pointerout", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (target.closest(".data-table tbody tr[data-control]") && !state.lockedControl) {
      state.activeControl = null;
      const patch = getPatchBySlug(state.patch);
      updateActiveControlVisuals(null, patch?.presets[state.preset] || patch?.presets[0]);
    }
  });

  // Panel Shadow DOM custom events
  root.addEventListener("panel-control-hover", (e) => {
    if (state.lockedControl) return;
    const ctrlId = e.detail?.controlId || null;
    state.activeControl = ctrlId;
    const patch = getPatchBySlug(state.patch);
    updateActiveControlVisuals(ctrlId, patch?.presets[state.preset] || patch?.presets[0]);
  });

  root.addEventListener("panel-control-select", (e) => {
    const ctrlId = e.detail?.controlId || null;
    state.lockedControl = state.lockedControl === ctrlId ? null : ctrlId;
    state.activeControl = state.lockedControl;
    const patch = getPatchBySlug(state.patch);
    updateActiveControlVisuals(state.activeControl, patch?.presets[state.preset] || patch?.presets[0]);
  });

  // Keyboard navigation on WAI-ARIA preset tablist
  root.addEventListener("keydown", (e) => {
    const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
    if (!tab) return;
    const tablist = tab.closest('[role="tablist"]');
    if (!tablist) return;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const idx = tabs.indexOf(tab);
    let nextIdx = idx;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = tabs.length - 1;
    else return;

    e.preventDefault();
    setState({ preset: nextIdx, activeControl: null, lockedControl: null });
    const updatedTab = document.getElementById(tabs[nextIdx].id);
    if (updatedTab) updatedTab.focus();
  });

  // Floating Prototype Switcher buttons
  document.getElementById("proto-prev")?.addEventListener("click", () => cycleVariant(-1));
  document.getElementById("proto-next")?.addEventListener("click", () => cycleVariant(1));

  // Global keyboard shortcuts (Cmd/Ctrl+K search, Left/Right variant switch)
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearchModal();
      return;
    }

    const active = document.activeElement;
    const inEditable =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      Boolean(active?.closest('[contenteditable="true"]')) ||
      Boolean(active?.closest('[role="tablist"]')) ||
      Boolean(document.querySelector("dialog[open]"));

    if (inEditable) return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      cycleVariant(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      cycleVariant(1);
    }
  });

  // Dialog wiring
  const searchDialog = document.getElementById("search-dialog");
  const drawerDialog = document.getElementById("mobile-drawer");
  const metaDialog = document.getElementById("metadata-dialog");
  [searchDialog, drawerDialog, metaDialog].forEach((d) => d && setupModalLightDismiss(d));

  document.getElementById("search-input")?.addEventListener("input", (e) => {
    renderSearchMatches(e.target.value);
  });

  searchDialog?.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest("[data-search-open]") : null;
    if (!btn) return;
    const slug = btn.getAttribute("data-search-open");
    searchDialog.close();
    setState({ patch: slug, preset: 0, step: "all" });
  });

  drawerDialog?.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (target.closest("[data-drawer-hub]")) {
      drawerDialog.close();
      setState({ patch: "hub" });
      return;
    }
    const pBtn = target.closest("[data-drawer-patch]");
    if (pBtn) {
      drawerDialog.close();
      setState({ patch: pBtn.getAttribute("data-drawer-patch"), preset: 0, step: "all" });
    }
  });

  document.getElementById("copy-metadata-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const code = document.querySelector("#metadata-pre code")?.textContent || "";
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = "Copy JSON";
      }, 1500);
    } catch {
      /* Ignore clipboard errors in headless environments */
    }
  });
}

readStateFromUrl();
initGlobalListeners();
renderApp();
