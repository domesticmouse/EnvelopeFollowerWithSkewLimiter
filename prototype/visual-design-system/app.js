// THROWAWAY UI PROTOTYPE (Issue #8): Three radically different visual design system variants
// Switchable via ?variant=A|B|C, floating bottom bar, and Left/Right arrow keys.

const VARIANTS = [
  { key: "A", name: "Faceplate Instrument" },
  { key: "B", name: "Hardware Datasheet" },
  { key: "C", name: "Studio Monograph" },
];

const PATCH_GUIDES = [
  {
    num: "01",
    slug: "01-sidechain-ducking",
    title: "Sidechain Ducking & Pumping",
    mode: "Envelope Follower Mode",
    controls: "INV OUT · OFFSET CCW · SMOOTH · FAST · +/− LED",
    led: { state: "red", label: "● RED (Idle −V) → ○ DARK (0V Hit)" },
    summary: "Techno kick-drum pumping by eye: dip the post-offset bi-color LED cleanly to Dark.",
  },
  {
    num: "02",
    slug: "02-auto-wah-envelope-filter",
    title: "Auto-Wah & Dynamic Envelope Filter",
    mode: "Envelope Follower Mode",
    controls: "OUT / INV OUT · ATK · REL · RAW / SMOOTH",
    led: { state: "green", label: "● GREEN (+V Sweep)" },
    summary: "Dynamic VCF frequency sweeps for funk bass, plucked synths, and acid lines.",
  },
  {
    num: "03",
    slug: "03-compression-expansion-gating",
    title: "Compression, Expansion & Noise Gating",
    mode: "Envelope Follower Mode",
    controls: "INV OUT (Comp) / OUT (Gate) · OFFSET · ATK · REL",
    led: { state: "red", label: "● RED / ○ DARK Threshold" },
    summary: "Opto-style VCA leveling and threshold gating with independent rise and fall timing.",
  },
  {
    num: "04",
    slug: "04-ducking-and-blooming-fx",
    title: "Ducking & Blooming Reverb / Delay",
    mode: "Envelope Follower Mode",
    controls: "INV OUT / OUT · SLOW (4.87 µF) · SMOOTH",
    led: { state: "green", label: "● GREEN (3.00 s Swell)" },
    summary: "Keep dry melodies forward while phrases play, blooming reverb tails up to 3.00 s.",
  },
  {
    num: "05",
    slug: "05-cross-modulation-push-pull",
    title: "Cross-Modulation & Push-Pull Stereo FX",
    mode: "Envelope Follower Mode",
    controls: "OUT + INV OUT Simultaneously · OFFSET",
    led: { state: "dark", label: "○ DARK (12 o'clock) ↔ ● GREEN/RED" },
    summary: "Complementary stereo panning, dual-voice crossfading, and dynamic FM/fold push-pull.",
  },
  {
    num: "06",
    slug: "06-audio-rate-slew-waveshaping",
    title: "Audio-Rate Slew Waveshaping & Nonlinear LPF",
    mode: "Asymmetric Skew Limiter Mode",
    controls: "SLEW IN · RAW (mandatory) · FAST · ATK vs REL",
    led: { state: "dark", label: "○ DARK / Audio-Rate Bipolar" },
    summary: "Patch VCO audio into SLEW IN to sculpt square waves into asymmetric ramps or fuzz.",
  },
  {
    num: "07",
    slug: "07-asymmetric-portamento-slides",
    title: "Asymmetric Portamento & 303-Style Slides",
    mode: "Asymmetric Skew Limiter Mode",
    controls: "SLEW IN · OFFSET (12 o'clock) · SLOW / FAST",
    led: { state: "green", label: "● GREEN (+Oct) / ● RED (−Oct)" },
    summary: "1V/Oct pitch glides with independent upward scoop and downward laser drop rates.",
  },
  {
    num: "08",
    slug: "08-gate-to-ar-envelope-and-slewed-mod",
    title: "Gate-to-AR Envelope & Slewed Modulation",
    mode: "Asymmetric Skew Limiter Mode",
    controls: "SLEW IN · ATK · REL · SMOOTH · OUT + INV OUT",
    led: { state: "green", label: "● GREEN (Gate High)" },
    summary: "Convert raw gates into linear AR/ASR envelopes or smooth stepped S&H modulation.",
  },
];

const BUILD_CHECKLISTS = [
  { num: "01", title: "Main Board Ordering", scope: "Gerbers, BOM/CPL, JLCPCB Economic PCBA" },
  { num: "01b", title: "Front Panel Ordering", scope: "6 HP Matte Black + ENIG-RoHS + White Silk" },
  { num: "02", title: "PCBA Part Alignment", scope: "50 B.Cu SMD placement & polarity audit" },
  { num: "03", title: "Tayda Ordering", scope: "18 TH parts, pots, jacks, toggles, knobs" },
  { num: "04", title: "Hand Assembly", scope: "THT parts, LED1 bench check, dry-fit solder" },
  { num: "05", title: "Board Bringup & Verification", scope: "Cold checks, power-up, TP1–TP12 probing" },
];

const TEST_POINTS = [
  { ref: "TP1", label: "GND", net: "GND", loc: "back (15.00, 105.60)", role: "Lower scope ground clip" },
  { ref: "TP2", label: "+12V", net: "+12V", loc: "back (13.30, 2.25)", role: "Filtered +11.54 V rail (post-D1/R1)" },
  { ref: "TP3", label: "-12V", net: "-12V", loc: "back (18.80, 2.25)", role: "Filtered -11.54 V rail (post-D2/R2)" },
  { ref: "TP4", label: "PRE", net: "NET_PREAMP_OUT", loc: "back (26.80, 20.00)", role: "U1A.1 ×2.00 preamp (±10.0 V headroom)" },
  { ref: "TP9", label: "HWR", net: "NET_RECT_HALF", loc: "back (26.80, 26.50)", role: "U1B / D3.1 half-wave rectifier check" },
  { ref: "TP5", label: "RECT", net: "NET_RECT_OUT", loc: "back (26.80, 33.00)", role: "U1C.8 FWR (1.000× |V_pre|)" },
  { ref: "TP10", label: "DRV", net: "NET_U1D_OUT", loc: "back (26.80, 39.50)", role: "U1D.14 skew driver swing & stability" },
  { ref: "TP6", label: "ENV", net: "NET_ENV_BUF", loc: "back (26.80, 46.00)", role: "U2A.1 buffered V_env (zero cap loading)" },
  { ref: "TP11", label: "OFF", net: "NET_OFF_WIPER", loc: "back (26.80, 52.50)", role: "RV4.2 ±4.98 V offset & center detent" },
  { ref: "TP7", label: "INV", net: "NET_INV_AMP", loc: "back (26.80, 59.00)", role: "U2B.7 -(V_env + V_off) (SMOOTH check)" },
  { ref: "TP8", label: "OUT", net: "NET_OUT_AMP", loc: "back (26.80, 65.00)", role: "U2C.8 +(V_env + V_off) & U2D input" },
  { ref: "TP12", label: "GND2", net: "GND", loc: "back (26.80, 2.50)", role: "Upper scope ground clip" },
];

const BRINGUP_CHECKS = [
  { id: "chk-psu", phase: "Prep", text: "Bench PSU ready: Dual tracking ±12 V bench supply with current limit set to 40–50 mA per rail." },
  { id: "chk-pol", phase: "Phase 1", text: "Final visual polarity check: J_PWR notch inward, C1 + inner, C2 + outer (GND), D1/D2 cathodes left." },
  { id: "chk-ohms", phase: "Phase 1", text: "Power-rail resistance check: TP2/TP3 to TP1 > 10 kΩ; TP2 to TP3 ~22 kΩ steady state." },
  { id: "chk-gnd", phase: "Phase 1", text: "Ground continuity < 0.5 Ω across J_PWR Pins 3–8, TP1, TP12, and J1–J4 sleeves." },
  { id: "chk-pwr", phase: "Phase 2", text: "Connect 10-pin power ribbon (RED STRIPE -12V at bottom) and verify ~8–11 mA idle draw per rail." },
  { id: "chk-rails", phase: "Phase 2", text: "Verify filtered rails: TP2 (+11.40 V to +11.80 V) and TP3 (-11.40 V to -11.80 V); ICs cool." },
];

const TIMING_ROWS = [
  { pos: "0% (CCW Min)", r: "1 kΩ", fRise: "0.29 ms", fFall: "0.18 ms", sRise: "2.99 ms", sFall: "1.84 ms" },
  { pos: "25% (9 o'clock)", r: "~41 kΩ", fRise: "11.8 ms", fFall: "7.28 ms", sRise: "123 ms", sFall: "75.4 ms" },
  { pos: "50% (Noon)", r: "~151 kΩ", fRise: "43.6 ms", fFall: "26.8 ms", sRise: "452 ms", sFall: "278 ms" },
  { pos: "100% (CW Max)", r: "1.001 MΩ", fRise: "289 ms", fFall: "178 ms", sRise: "3.00 s", sFall: "1.84 s" },
];

const SEARCH_ENTRIES = [
  { title: "01 — Sidechain Ducking & Pumping", section: "Patch Guide", view: "patch", anchor: "main-content" },
  { title: "05 — Board Bringup & Verification Checklist", section: "Build Checklist", view: "bench", anchor: "main-content" },
  { title: "BAT54S (D3) Precision HWR Pair", section: "DesignSpec / PCBA", view: "bench", anchor: "electrical-equations" },
  { title: "TP7 (INV) Virtual-Ground Inverted Output", section: "Test Point TP1–TP12", view: "bench", anchor: "test-points" },
  { title: "A-1076 Post-Offset Bi-Color LED Driver", section: "LED1 / DesignSpec", view: "patch", anchor: "dial-in" },
  { title: "SMOOTH (SW1) Zero-Gain-Drop 29.0 Hz T-Filter", section: "Panel Control", view: "patch", anchor: "starting-settings" },
  { title: "SLEW IN (J2) Normaled Asymmetric Skew Mode", section: "Asymmetric Skew Limiter Mode", view: "home", anchor: "patch-guides-grid" },
  { title: "HAGIWO No. 43 & domesticmouse/EnvelopeFollower", section: "Origin Story", view: "home", anchor: "pathway-origin" },
  { title: "Color Tokens & WCAG AA/AAA Contrast Matrix", section: "Design System", view: "bench", anchor: "design-tokens" },
];

const STORAGE_A = "envskew-proto-scheme-a";
const STORAGE_B = "envskew-proto-scheme-b";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

const state = {
  variant: "A",
  view: "home",
  checkedIds: new Set(["chk-psu"]),
  railCollapsedB: false,
  printPreviewC: false,
  schemeA: readStorage(STORAGE_A) || "dark",
  schemeB: readStorage(STORAGE_B) || "system",
};

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, val) {
  try {
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch {
    /* ignore storage block */
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getSystemScheme() {
  return darkQuery.matches ? "dark" : "light";
}

function getResolvedScheme() {
  if (state.variant === "C") {
    return state.printPreviewC ? "print-preview (light)" : "dark";
  }
  if (state.variant === "B") {
    return state.schemeB === "system" ? `system (${getSystemScheme()})` : state.schemeB;
  }
  return state.schemeA;
}

function syncColorSchemeMeta() {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) return;
  if (state.variant === "C") {
    meta.content = state.printPreviewC ? "light" : "dark";
  } else if (state.variant === "B") {
    meta.content = state.schemeB === "system" ? "light dark" : state.schemeB;
  } else {
    meta.content = state.schemeA;
  }
}

function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const v = (params.get("variant") || "A").toUpperCase();
  const view = (params.get("view") || "home").toLowerCase();
  const schemeParam = (params.get("scheme") || "").toLowerCase();
  const printParam = params.get("print") === "1";
  state.variant = VARIANTS.some((item) => item.key === v) ? v : "A";
  state.view = ["home", "patch", "bench"].includes(view) ? view : "home";
  if (schemeParam === "light" || schemeParam === "dark") {
    state.schemeA = schemeParam;
    state.schemeB = schemeParam;
  } else if (schemeParam === "system") {
    state.schemeB = "system";
  }
  if (printParam) {
    state.printPreviewC = true;
  }
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", state.variant);
  url.searchParams.set("view", state.view);
  url.searchParams.delete("scheme");
  url.searchParams.delete("print");
  window.history.replaceState({}, "", url);
}

function setVariant(nextVariant) {
  state.variant = nextVariant;
  syncColorSchemeMeta();
  updateUrl();
  render();
}

function setView(nextView, anchorId = null) {
  state.view = nextView;
  updateUrl();
  render();
  if (anchorId) {
    requestAnimationFrame(() => {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } else {
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

function cycleVariant(delta) {
  const idx = VARIANTS.findIndex((v) => v.key === state.variant);
  const next = VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length];
  setVariant(next.key);
}

/* ============================================================================
 * SHARED DOMAIN CONTENT FRAGMENTS (Themed via CSS custom properties)
 * ============================================================================ */

function renderThemedPatchDiagramSvg() {
  return `
    <div class="mermaid-card" role="img" aria-label="Patch diagram: Kick Drum feeds Mult to Main Mixer and ENV/SKEW IN; Bass/Pad Bus feeds VCA modulated by ENV/SKEW INV OUT into Main Mixer.">
      <svg viewBox="0 0 820 215" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent-text)" />
          </marker>
        </defs>
        <!-- Kick -> Mult -> Mixer & IN -->
        <rect x="12" y="22" width="110" height="44" fill="var(--bg-surface)" stroke="var(--border-ui)" stroke-width="1.5"/>
        <text x="67" y="49" text-anchor="middle" fill="var(--ink-primary)" font-family="var(--font-mono)" font-size="12" font-weight="600">Kick Drum</text>

        <line x1="122" y1="44" x2="165" y2="44" stroke="var(--accent-text)" stroke-width="2" marker-end="url(#arrow-head)"/>
        <rect x="168" y="22" width="84" height="44" fill="var(--bg-surface)" stroke="var(--border-ui)" stroke-width="1.5"/>
        <text x="210" y="49" text-anchor="middle" fill="var(--ink-primary)" font-family="var(--font-mono)" font-size="12" font-weight="600">Mult</text>

        <line x1="252" y1="36" x2="656" y2="36" stroke="var(--accent-text)" stroke-width="2" marker-end="url(#arrow-head)"/>
        <text x="454" y="25" text-anchor="middle" fill="var(--ink-muted)" font-family="var(--font-mono)" font-size="11">Direct Kick Audio</text>

        <path d="M 210 66 L 210 108 L 258 108" fill="none" stroke="var(--accent-text)" stroke-width="2" marker-end="url(#arrow-head)"/>
        <rect x="261" y="86" width="212" height="44" fill="var(--accent-tint)" stroke="var(--accent-text)" stroke-width="2"/>
        <text x="367" y="113" text-anchor="middle" fill="var(--ink-primary)" font-family="var(--font-mono)" font-size="12" font-weight="700">ENV / SKEW: IN → INV OUT</text>

        <!-- Bass -> VCA -> Mixer -->
        <rect x="12" y="148" width="132" height="44" fill="var(--bg-surface)" stroke="var(--border-ui)" stroke-width="1.5"/>
        <text x="78" y="175" text-anchor="middle" fill="var(--ink-primary)" font-family="var(--font-mono)" font-size="12" font-weight="600">Bass / Pad Bus</text>

        <line x1="144" y1="170" x2="480" y2="170" stroke="var(--accent-text)" stroke-width="2" marker-end="url(#arrow-head)"/>

        <path d="M 473 108 L 540 108 L 540 144" fill="none" stroke="var(--accent-text)" stroke-width="2" marker-end="url(#arrow-head)"/>
        <text x="550" y="96" fill="var(--accent-text)" font-family="var(--font-mono)" font-size="11" font-weight="600">+4.98 V idle → 0 V hit</text>

        <rect x="484" y="148" width="112" height="44" fill="var(--bg-surface)" stroke="var(--border-ui)" stroke-width="1.5"/>
        <text x="540" y="175" text-anchor="middle" fill="var(--ink-primary)" font-family="var(--font-mono)" font-size="12" font-weight="600">VCA</text>

        <path d="M 596 170 L 728 170 L 728 70" fill="none" stroke="var(--accent-text)" stroke-width="2" marker-end="url(#arrow-head)"/>

        <rect x="660" y="22" width="144" height="44" fill="var(--bg-surface)" stroke="var(--border-ui)" stroke-width="1.5"/>
        <text x="732" y="49" text-anchor="middle" fill="var(--ink-primary)" font-family="var(--font-mono)" font-size="12" font-weight="600">Main Mixer</text>
      </svg>
    </div>
  `;
}

function renderPatchBodyContent() {
  return `
    <div class="breadcrumb">
      <button type="button" data-nav-view="home">Home</button>
      <span aria-hidden="true">/</span>
      <span>Patches</span>
      <span aria-hidden="true">/</span>
      <span>01 — Sidechain Ducking &amp; Pumping</span>
    </div>

    <span class="mode-badge">Mode: Envelope Follower Mode (IN patched · SLEW IN unpatched)</span>
    <h1 class="doc-h1">01 — Sidechain Ducking &amp; Pumping</h1>
    <p class="doc-lead">
      Tuned specifically for techno kick-drum ducking. Combine <code>INV OUT</code>, <code>OFFSET</code>, the zero-gain-drop <code>SMOOTH</code> T-filter, and the post-offset <code>+ / −</code> LED to dial in ripple-free pumping by eye in seconds.
    </p>

    <h2 class="doc-h2" id="patch-diagram">Patch Diagram (Themed Mermaid View)</h2>
    ${renderThemedPatchDiagramSvg()}

    <h2 class="doc-h2" id="starting-settings">Front-Panel Starting Settings</h2>
    <p>Resize the viewport or inspect inside a narrow column to verify the container-queried stacked card layout (<code>@container (width &lt; 560px)</code>).</p>
    <div tabindex="0" role="region" aria-labelledby="settings-table-cap" class="table-wrapper settings-table-wrap">
      <table class="settings-table">
        <caption id="settings-table-cap">Starting front-panel positions for 01 — Sidechain Ducking &amp; Pumping</caption>
        <thead>
          <tr>
            <th>Control</th>
            <th>Starting Position</th>
            <th>Electrical State &amp; Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th><code>GAIN</code> (RV1)</th>
            <td><code>7 o'clock</code> (Full CCW)</td>
            <td>Start muted; raise until kicks dip the <code>+ / −</code> LED to Dark (<code>0.00 V</code>)</td>
          </tr>
          <tr>
            <th><code>ATK</code> (RV2)</th>
            <td><code>7 o'clock</code> (Full CCW)</td>
            <td><code>0.29 ms</code> instant transient clamp (<code>FAST</code> mode)</td>
          </tr>
          <tr>
            <th><code>REL</code> (RV3)</th>
            <td><code>11–2 o'clock</code> (40–65%)</td>
            <td><code>~20–80 ms</code> recovery (<code>FAST</code>) — match to tempo groove</td>
          </tr>
          <tr>
            <th><code>OFFSET</code> (RV4)</th>
            <td><code>7 o'clock</code> (Full CCW, <code>−</code>)</td>
            <td>Shifts <code>OUT</code> to <code>−4.98 V</code> so <code>INV OUT</code> rests at <code>+4.98 V</code></td>
          </tr>
          <tr>
            <th>Left Toggle (SW1)</th>
            <td><strong>UP (<code>SMOOTH</code>)</strong></td>
            <td>Engages <code>29.0 Hz</code> T-filter (<code>−11.1 dB @ 100 Hz</code> ripple, <code>0.00%</code> DC drop)</td>
          </tr>
          <tr>
            <th>Right Toggle (SW2)</th>
            <td><strong>DOWN (<code>FAST</code>)</strong></td>
            <td>Selects <code>470 nF</code> hold cap (<code>0.29–289 ms</code> range)</td>
          </tr>
          <tr>
            <th><code>+ / −</code> LED (LED1)</th>
            <td><span class="led-pill" data-led="red">● RED (−V Idle)</span></td>
            <td>Confirms <code>OUT = −4.98 V</code> (<code>INV OUT = +4.98 V</code>, VCA open)</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 class="doc-h2" id="dial-in">Step-by-Step Dial-In &amp; LED Calibration</h2>
    <ol>
      <li><strong>Confirm <code>SLEW IN</code> is empty</strong> and route ducked audio through a unipolar VCA with bias at zero.</li>
      <li><strong>Set <code>OFFSET</code> full CCW (<code>−</code>)</strong> and confirm <span class="led-pill" data-led="red">● RED (−4.98 V)</span> idle glow.</li>
      <li><strong>Start the kick pattern</strong> and sweep <code>GAIN</code> CW until each transient dips the LED cleanly to <span class="led-pill" data-led="dark">○ DARK (0.00 V)</span> without flashing <span class="led-pill" data-led="green">● GREEN (+V Overshoot)</span>.</li>
      <li><strong>Shape the pocket with <code>REL</code></strong> between 9 and 5 o'clock (<code>7–178 ms</code>).</li>
    </ol>

    <div class="callout">
      <p class="callout-title">▲ Signal Integrity Note — Avoid Green Overshoot on Bipolar VCAs</p>
      <p>If <code>GAIN</code> drives <code>+ / −</code> LED into <span class="led-pill" data-led="green">● GREEN (&gt; 0 V)</span>, <code>INV OUT</code> swings negative and can re-open a 4-quadrant VCA out of phase during the kick peak.</p>
    </div>

    <h2 class="doc-h2" id="troubleshooting">Troubleshooting Matrix</h2>
    <div tabindex="0" role="region" aria-labelledby="trouble-cap" class="table-wrapper">
      <table>
        <caption id="trouble-cap">Common sidechain ducking symptoms and fixes</caption>
        <thead>
          <tr>
            <th>Symptom</th>
            <th>Likely Cause</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Bass buzzes or double-triggers</th>
            <td><code>GAIN</code> too high; LED flashing Green</td>
            <td>Back <code>GAIN</code> CCW until LED hits Dark at kick peak</td>
          </tr>
          <tr>
            <th>Audible flutter on sustained bass</th>
            <td>Left toggle is DOWN (<code>RAW</code>)</td>
            <td>Flip left toggle UP (<code>SMOOTH</code>) to cut 100 Hz ripple</td>
          </tr>
          <tr>
            <th>Ducked audio never recovers full level</th>
            <td><code>REL</code> too long or <code>OFFSET</code> not CCW</td>
            <td>Shorten <code>REL</code> and return <code>OFFSET</code> to 7 o'clock</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="prev-next-bar">
      <button type="button" class="vb-btn-secondary" data-nav-view="home">← All Patch Guides</button>
      <button type="button" class="vb-btn-secondary" data-nav-view="bench">Next: 05 — Board Bringup Checklist →</button>
    </div>
  `;
}

function renderBenchBodyContent(extraHeaderControl = "") {
  const checkedCount = BRINGUP_CHECKS.filter((c) => state.checkedIds.has(c.id)).length;
  return `
    <div class="breadcrumb">
      <button type="button" data-nav-view="home">Home</button>
      <span aria-hidden="true">/</span>
      <span>Build</span>
      <span aria-hidden="true">/</span>
      <span>05 — Board Bringup &amp; Technical Tokens</span>
    </div>

    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.75rem;">
      <span class="mode-badge">Build Checklist 05 · Bench Bringup + DesignSpec Math</span>
      ${extraHeaderControl}
    </div>

    <h1 class="doc-h1">05 — Board Bringup &amp; Verification Checklist</h1>
    <p class="doc-lead">
      Safely power up, verify, and probe your assembled <strong>ENV / SKEW</strong> PCB across all 12 <code>B.Cu</code> test points before mounting in a Eurorack case.
    </p>

    <figure class="figure-frame">
      <img src="../../images/board_bringup/00_test_point_map.png" alt="B.Cu Test Point Map TP1 to TP12 on the 30.0 by 108.0 mm main PCB" width="660" />
      <figcaption>Figure 1: Real repository bringup artifact (<code>images/board_bringup/00_test_point_map.png</code>) showing direct <code>B.Cu</code> bench probing view.</figcaption>
    </figure>

    <h2 class="doc-h2" id="test-points">1. Test Point Reference (12 B.Cu Test Points)</h2>
    <div tabindex="0" role="region" aria-labelledby="tp-table-cap" class="table-wrapper has-sticky-col">
      <table class="tabular">
        <caption id="tp-table-cap">Scrollable sticky-header &amp; sticky-column matrix for TP1–TP12</caption>
        <thead>
          <tr>
            <th>RefDes</th>
            <th>Silk Label</th>
            <th>Net</th>
            <th>Back Location (mm)</th>
            <th>Expected Idle / Function</th>
          </tr>
        </thead>
        <tbody>
          ${TEST_POINTS.map(
            (tp) => `
              <tr>
                <th scope="row">${escapeHtml(tp.ref)}</th>
                <td><code>${escapeHtml(tp.label)}</code></td>
                <td><code>${escapeHtml(tp.net)}</code></td>
                <td>${escapeHtml(tp.loc)}</td>
                <td>${escapeHtml(tp.role)}</td>
              </tr>
            `
          ).join("")}
        </tbody>
      </table>
    </div>

    <h2 class="doc-h2" id="bringup-steps">2. Interactive Phase 1 &amp; 2 Bringup Checklist</h2>
    <div class="checklist-progress">
      <span>In-memory prototype progress: <strong id="bringup-progress-text">${checkedCount} / ${BRINGUP_CHECKS.length} checks complete</strong></span>
      <button type="button" class="vb-btn-secondary" id="reset-checklist-btn">Reset Checks</button>
    </div>

    <ul class="checklist-list">
      ${BRINGUP_CHECKS.map((item) => {
        const isChecked = state.checkedIds.has(item.id) ? "checked" : "";
        return `
          <li class="checklist-item">
            <label>
              <input type="checkbox" data-check-id="${item.id}" ${isChecked} />
              <span><strong>[${escapeHtml(item.phase)}]</strong> ${escapeHtml(item.text)}</span>
            </label>
          </li>
        `;
      }).join("")}
    </ul>

    <div class="callout callout-danger">
      <p class="callout-title">▲ ABORT IMMEDIATELY — Current Limit Guardrail</p>
      <p>Shut off bench PSU at once if either <code>+12V</code> or <code>-12V</code> rail exceeds <code>20 mA</code> idle draw, hits the <code>40–50 mA</code> current limit, or sags below <code>11.0 V</code>. Re-check <code>C2</code> (<code>-12V</code> electrolytic) polarity and <code>D1</code>/<code>D2</code> cathode bands.</p>
    </div>

    <h2 class="doc-h2" id="electrical-equations">3. Key Circuit Equations &amp; Timing Table (KaTeX)</h2>
    <div class="math-grid" id="katex-scope">
      <div class="math-card">
        <p class="math-card-label">Input Stage Impedance &amp; HPF</p>
        <div>$$Z_{\\text{in}} = 1\\,\\text{M}\\Omega \\parallel 100\\,\\text{k}\\Omega = 90.9\\,\\text{k}\\Omega, \\quad f_c = 3.72\\,\\text{Hz}$$</div>
      </div>
      <div class="math-card">
        <p class="math-card-label">Skew Limiter Rise &amp; Fall (±10.89 V Drive)</p>
        <div>$$t_{\\text{rise}} = 0.6146\\,R_{\\text{atk}} C_2, \\quad t_{\\text{fall}} = 0.3778\\,R_{\\text{rel}} C_2$$</div>
      </div>
      <div class="math-card">
        <p class="math-card-label">Loop Zero &amp; SMOOTH T-Filter</p>
        <div>$$f_z = \\frac{1}{2\\pi \\cdot 10\\,\\text{k}\\Omega \\cdot 2.2\\,\\text{nF}} = 7.23\\,\\text{kHz}, \\quad f_c = 29.0\\,\\text{Hz}$$</div>
      </div>
      <div class="math-card">
        <p class="math-card-label">Active Bi-Color LED Driver</p>
        <div>$$I_{\\text{LED}} = \\frac{V_{\\text{OUT}}}{2.2\\,\\text{k}\\Omega} = \\pm 2.27\\,\\text{mA} \\text{ at } \\pm 5\\,\\text{V}$$</div>
      </div>
    </div>

    <div tabindex="0" role="region" aria-labelledby="timing-table-cap" class="table-wrapper">
      <table class="tabular">
        <caption id="timing-table-cap">Active Skew Limiter timing range across RV2 (ATK) and RV3 (REL)</caption>
        <thead>
          <tr>
            <th>Pot Position (A1M)</th>
            <th>Branch R</th>
            <th>FAST Rise (0→5 V)</th>
            <th>FAST Fall (5→0 V)</th>
            <th>SLOW Rise (0→5 V)</th>
            <th>SLOW Fall (5→0 V)</th>
          </tr>
        </thead>
        <tbody>
          ${TIMING_ROWS.map(
            (row) => `
              <tr>
                <th>${escapeHtml(row.pos)}</th>
                <td><code>${escapeHtml(row.r)}</code></td>
                <td>${escapeHtml(row.fRise)}</td>
                <td>${escapeHtml(row.fFall)}</td>
                <td>${escapeHtml(row.sRise)}</td>
                <td>${escapeHtml(row.sFall)}</td>
              </tr>
            `
          ).join("")}
        </tbody>
      </table>
    </div>

    <h2 class="doc-h2" id="design-tokens">4. Visual Design Tokens &amp; Verified WCAG Contrast Matrix</h2>
    <p>Raw ENIG Gold (<code>#D8B154</code>) yields only <code>1.86:1</code> on white paper, so light surfaces substitute Burnished Brass (<code>#785607</code>, <code>5.87:1+</code>) for text/borders and restrict <code>#D8B154</code> strictly to solid slabs carrying Matte Black (<code>#141518</code>) knocked-out text (<code>9.06:1</code>).</p>
    <div class="swatch-grid">
      <div class="swatch-card">
        <div class="swatch-chip" style="background:#141518;color:#F4F5F7;"><span>Matte Black FR4</span><span>#141518</span></div>
        <div class="mono" style="font-size:0.75rem;">Ink #F4F5F7 = <strong>17.1:1 AAA</strong></div>
      </div>
      <div class="swatch-card">
        <div class="swatch-chip" style="background:#D8B154;color:#141518;"><span>ENIG Gold Slab</span><span>#D8B154</span></div>
        <div class="mono" style="font-size:0.75rem;">On #141518 / #141518 on Gold = <strong>9.06:1 AAA</strong></div>
      </div>
      <div class="swatch-card">
        <div class="swatch-chip" style="background:#FAF9F5;color:#785607;"><span>Burnished Brass (Light)</span><span>#785607</span></div>
        <div class="mono" style="font-size:0.75rem;">On #FAF9F5 / #FFFFFF = <strong>6.4:1 AA+</strong></div>
      </div>
      <div class="swatch-card">
        <div class="swatch-chip" style="background:#141518;color:#4ADE80;"><span>LED +V / -V Pair</span><span>#4ADE80 / #F87171</span></div>
        <div class="mono" style="font-size:0.75rem;">Dark 10.5:1 / 6.6:1 · Light 6.2:1 / 6.1:1</div>
      </div>
    </div>

    <div class="prev-next-bar">
      <button type="button" class="vb-btn-secondary" data-nav-view="patch">← 01 — Sidechain Ducking</button>
      <button type="button" class="vb-btn-secondary" data-nav-view="home">Return to Module Home →</button>
    </div>
  `;
}

function renderGlobalFooter() {
  return `
    <footer class="site-footer">
      <div class="site-footer-inner">
        <div>
          <strong>ENV / SKEW</strong> — 6 HP Eurorack Envelope Follower &amp; Asymmetric Skew Limiter ·
          <strong>Apache License 2.0</strong> ·
          <em>This is not an officially supported Google product.</em>
        </div>
        <div>
          Origin: <a href="https://note.com/solder_state/n/n110e9ba066b3?hl=en" target="_blank" rel="noreferrer">HAGIWO No. 43</a> →
          <a href="https://github.com/domesticmouse/EnvelopeFollower" target="_blank" rel="noreferrer">domesticmouse/EnvelopeFollower</a> →
          <a href="https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter" target="_blank" rel="noreferrer">GitHub Repo</a>
        </div>
      </div>
    </footer>
  `;
}

/* ============================================================================
 * VARIANT A: FACEPLATE INSTRUMENT
 * Split-rack hero, chamfered gold rails, 3-col doc console, 2-state Dark/Light toggle
 * ============================================================================ */
function renderVariantA() {
  const isPatches = state.view === "patch";
  const isBuild = state.view === "bench";
  const isLight = state.schemeA === "light";

  const sidebarItems = isBuild
    ? BUILD_CHECKLISTS.map(
        (b) => `<li><button type="button" class="va-sidebar-item" ${b.num === "05" ? 'aria-current="page"' : ""} data-nav-view="bench">${b.num} · ${escapeHtml(b.title)}</button></li>`
      ).join("")
    : PATCH_GUIDES.map(
        (p) => `<li><button type="button" class="va-sidebar-item" ${p.num === "01" ? 'aria-current="page"' : ""} data-nav-view="patch">${p.num} · ${escapeHtml(p.title)}</button></li>`
      ).join("");

  const tocItems = isBuild
    ? `
      <li><a class="va-sidebar-item" href="#test-points">1. Test Point Reference</a></li>
      <li><a class="va-sidebar-item" href="#bringup-steps">2. Bringup Checklist</a></li>
      <li><a class="va-sidebar-item" href="#electrical-equations">3. Circuit Equations</a></li>
      <li><a class="va-sidebar-item" href="#design-tokens">4. Color &amp; Contrast Tokens</a></li>
    `
    : `
      <li><a class="va-sidebar-item" href="#patch-diagram">Patch Diagram</a></li>
      <li><a class="va-sidebar-item" href="#starting-settings">Starting Settings</a></li>
      <li><a class="va-sidebar-item" href="#dial-in">Dial-In &amp; LED</a></li>
      <li><a class="va-sidebar-item" href="#troubleshooting">Troubleshooting</a></li>
    `;

  const mainHtml =
    state.view === "home"
      ? `
        <section class="va-rack-hero" aria-label="ENV / SKEW Module Overview">
          <div class="va-rack-bay">
            <span class="va-rack-slot" aria-hidden="true"></span>
            <img src="../../images/panel_front.png" alt="ENV / SKEW 6 HP matte black and ENIG gold Eurorack front panel" width="160" />
            <span class="va-rack-slot" aria-hidden="true"></span>
          </div>
          <div class="va-hero-content">
            <p class="va-kicker">6 HP Eurorack Envelope Follower &amp; Asymmetric Skew Limiter</p>
            <h1 class="va-hero-title">Two Modules in 6 HP</h1>
            <p class="va-hero-sub">
              Patch into <strong>IN</strong> for audio-driven kick ducking and dynamic sweeps, or break the normal at <strong>SLEW IN</strong> for DC-coupled asymmetric skew limiting. Zero calibration trimmers, open-source hardware.
            </p>
            <div class="va-spec-strip">
              <span class="va-spec-chip">6 HP (30.0 mm)</span>
              <span class="va-spec-chip">2× TL074H</span>
              <span class="va-spec-chip">±12 V (~13 mA)</span>
              <span class="va-spec-chip">0 Trimmers</span>
              <span class="va-spec-chip">Apache-2.0</span>
            </div>
            <div class="va-cta-row">
              <button type="button" class="va-cta-primary chamfer-sm" data-nav-view="patch">Explore Patch Guides →</button>
              <button type="button" class="va-cta-secondary chamfer-sm" data-nav-view="bench">Build It Yourself</button>
            </div>
          </div>
        </section>

        <hr class="va-busbar" />

        <section id="patch-guides-grid" aria-labelledby="va-patches-heading">
          <div class="va-section-head">
            <h2 id="va-patches-heading" class="va-section-title">Patchbay Quick-Launch (01–08)</h2>
            <span class="mono" style="font-size:0.82rem;color:var(--ink-muted);">01–05 Envelope Follower Mode · 06–08 Asymmetric Skew Limiter Mode</span>
          </div>
          <div class="va-patchbay-matrix">
            ${PATCH_GUIDES.map(
              (p) => `
                <button type="button" class="va-slot-row" data-nav-view="patch">
                  <span class="va-slot-num">${p.num}</span>
                  <span>
                    <span class="va-slot-title">${escapeHtml(p.title)}</span>
                    <span class="va-slot-meta">${escapeHtml(p.mode)} · ${escapeHtml(p.controls)}</span>
                  </span>
                  <span class="led-pill" data-led="${p.led.state}">${escapeHtml(p.led.label.split(" ")[0] + " " + p.led.label.split(" ")[1])}</span>
                </button>
              `
            ).join("")}
          </div>
        </section>

        <hr class="va-busbar" />

        <section class="va-pathway-strip" aria-label="Build, Hardware, and Origin Pathways">
          <article id="pathway-hardware" class="va-pathway-box">
            <h3>Hardware &amp; Panel Art</h3>
            <p style="margin:0;color:var(--ink-muted);">A3 PDF schematic, 2-layer KiCad 10 PCB, and Matte Black FR4 + ENIG gold panel artwork.</p>
            <button type="button" class="va-btn-icon" data-nav-view="bench">Inspect TP1–TP12 &amp; Specs →</button>
          </article>
          <article id="pathway-origin" class="va-pathway-box">
            <h3>Origin Story</h3>
            <p style="margin:0;color:var(--ink-muted);">From HAGIWO Project No. 43 ($4 Envelope Follower) through <code>domesticmouse/EnvelopeFollower</code> to ENV / SKEW.</p>
            <button type="button" class="va-btn-icon" data-nav-view="patch">See Patch 01 Philosophy →</button>
          </article>
          <article id="pathway-downloads" class="va-pathway-box">
            <h3>Build &amp; Fab Downloads</h3>
            <p style="margin:0;color:var(--ink-muted);">6 step-by-step checklists, hosted Interactive BOM (<code>ibom.html</code>), JLCPCB Gerbers, and Tayda shopping list.</p>
            <button type="button" class="va-btn-icon" data-nav-view="bench">Open Bringup Checklist →</button>
          </article>
        </section>
      `
      : `
        <div class="va-console">
          <aside class="va-sidebar" aria-label="Section Navigation">
            <h2 class="va-sidebar-heading">${isBuild ? "Build Checklists" : "Patch Guides"}</h2>
            <ul class="va-sidebar-list">${sidebarItems}</ul>
          </aside>
          <article class="va-doc-article">
            ${isBuild ? renderBenchBodyContent() : renderPatchBodyContent()}
          </article>
          <nav class="va-toc" aria-label="On This Page">
            <h2 class="va-toc-heading">On This Page</h2>
            <ul class="va-toc-list">${tocItems}</ul>
          </nav>
        </div>
      `;

  return `
    <div class="variant-a">
      <header class="va-header">
        <div class="va-header-inner">
          <div class="va-brand-group">
            <button type="button" class="va-menu-btn" id="open-mobile-drawer" aria-label="Open menu">☰ Menu</button>
            <a href="?variant=A&view=home" class="slab-logo chamfer-sm" data-nav-view="home">ENV / SKEW</a>
            <span class="va-rev">DM // R1.0</span>
          </div>
          <nav class="va-nav" aria-label="Primary">
            <button type="button" class="va-nav-link" ${isPatches ? 'aria-current="page"' : ""} data-nav-view="patch">Patches</button>
            <button type="button" class="va-nav-link" ${isBuild ? 'aria-current="page"' : ""} data-nav-view="bench">Build</button>
            <button type="button" class="va-nav-link" data-nav-home-anchor="pathway-hardware">Hardware</button>
            <button type="button" class="va-nav-link" data-nav-home-anchor="pathway-origin">Origin</button>
            <button type="button" class="va-nav-link" data-nav-home-anchor="pathway-downloads">Downloads</button>
          </nav>
          <div class="va-actions">
            <button type="button" class="va-btn-icon" id="open-search-btn" aria-label="Search site">⌘K Search</button>
            <button type="button" class="va-btn-icon" id="toggle-scheme-a" aria-pressed="${isLight}" title="Toggle Dark Default / Bench Light">
              ${isLight ? "☾ Dark Panel" : "☀ Bench Light"}
            </button>
            <a class="va-btn-icon" href="https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter" target="_blank" rel="noreferrer">GitHub ↗</a>
          </div>
        </div>
      </header>
      <main id="main-content" class="va-main">${mainHtml}</main>
      ${renderGlobalFooter()}
    </div>
  `;
}

/* ============================================================================
 * VARIANT B: HARDWARE DATASHEET
 * 2-tier Swiss masthead, tabular ledger, structured Patch Index Table, 2-col wide manual
 * ============================================================================ */
function renderVariantB() {
  const isPatches = state.view === "patch";
  const isBuild = state.view === "bench";
  const sysNow = getSystemScheme() === "dark" ? "Dark" : "Light";

  const sidebarItems = isBuild
    ? BUILD_CHECKLISTS.map(
        (b) => `<li><button type="button" class="va-sidebar-item" ${b.num === "05" ? 'aria-current="page"' : ""} data-nav-view="bench">${b.num}. ${escapeHtml(b.title)}</button></li>`
      ).join("")
    : PATCH_GUIDES.map(
        (p) => `<li><button type="button" class="va-sidebar-item" ${p.num === "01" ? 'aria-current="page"' : ""} data-nav-view="patch">${p.num}. ${escapeHtml(p.title)}</button></li>`
      ).join("");

  const mainHtml =
    state.view === "home"
      ? `
        <section class="vb-frontsheet-head" aria-label="Hardware Datasheet Front Sheet">
          <div>
            <p class="vb-doc-id">DATASHEET // ENV-SKEW-R1.0 · HARDWARE + PATCH REFERENCE</p>
            <h1 class="vb-title">6 HP Eurorack Envelope Follower &amp; Asymmetric Skew Limiter</h1>
            <p class="doc-lead">
              Precision full-wave rectifier normaled into a 2-op-amp active asymmetric skew limiter. Single-source documentation, step-by-step build checklists, and 8 patch sheets.
            </p>
            <div class="va-cta-row">
              <button type="button" class="vb-btn-primary" data-nav-view="patch">Open Patch Guides (01–08)</button>
              <button type="button" class="vb-btn-secondary" data-nav-view="bench">Open Build &amp; Bringup</button>
            </div>
          </div>
          <div class="vb-panel-duo">
            <img src="../../panel_art/preview_clean.png" alt="ENV / SKEW clean vector panel preview" width="110" />
            <img src="../../images/panel_front.png" alt="ENV / SKEW rendered 3D front panel" width="110" />
          </div>
        </section>

        <div class="vb-ledger tabular" role="region" aria-label="Key Hardware Specifications">
          <div class="vb-ledger-cell"><span class="vb-ledger-label">Format</span><span class="vb-ledger-val">3U · 6 HP (30.0 mm)</span></div>
          <div class="vb-ledger-cell"><span class="vb-ledger-label">Active ICs</span><span class="vb-ledger-val">2× TL074HIDR (8/8 used)</span></div>
          <div class="vb-ledger-cell"><span class="vb-ledger-label">Supply Rails</span><span class="vb-ledger-val">±12 V (~13 mA peak)</span></div>
          <div class="vb-ledger-cell"><span class="vb-ledger-label">Calibration</span><span class="vb-ledger-val">0 Trimmers (0.1% thin-film)</span></div>
          <div class="vb-ledger-cell"><span class="vb-ledger-label">License</span><span class="vb-ledger-val">Apache-2.0 OSHW</span></div>
        </div>

        <section id="patch-guides-grid" aria-labelledby="vb-patch-table-cap">
          <div tabindex="0" role="region" aria-labelledby="vb-patch-table-cap" class="table-wrapper">
            <table class="tabular">
              <caption id="vb-patch-table-cap">Structured Patch Index (01–08) — Select any row to open walkthrough</caption>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Patch Guide</th>
                  <th>Operating Mode</th>
                  <th>Primary Controls</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${PATCH_GUIDES.map(
                  (p) => `
                    <tr>
                      <th>${p.num}</th>
                      <td><strong>${escapeHtml(p.title)}</strong><br><span style="color:var(--ink-muted);font-size:0.82rem;">${escapeHtml(p.summary)}</span></td>
                      <td><code>${escapeHtml(p.mode)}</code></td>
                      <td><code>${escapeHtml(p.controls)}</code></td>
                      <td><button type="button" class="vb-btn-secondary" data-nav-view="patch">Open</button></td>
                    </tr>
                  `
                ).join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section class="va-pathway-strip" aria-label="Technical Sections">
          <article id="pathway-hardware" class="va-pathway-box">
            <h3 style="font-family:var(--font-mono);font-size:1rem;">01. Hardware &amp; Schematic</h3>
            <p style="margin:0;color:var(--ink-muted);">A3 schematic PDF, 48-net specification, and Matte Black + ENIG panel tolerances.</p>
            <button type="button" class="vb-btn-secondary" data-nav-view="bench">View TP1–TP12 &amp; Equations</button>
          </article>
          <article id="pathway-origin" class="va-pathway-box">
            <h3 style="font-family:var(--font-mono);font-size:1rem;">02. Origin &amp; Attribution</h3>
            <p style="margin:0;color:var(--ink-muted);">Evolution from HAGIWO No. 43 (2022) and <code>domesticmouse/EnvelopeFollower</code>.</p>
            <button type="button" class="vb-btn-secondary" data-nav-view="patch">View Patch Context</button>
          </article>
          <article id="pathway-downloads" class="va-pathway-box">
            <h3 style="font-family:var(--font-mono);font-size:1rem;">03. Fabrication Artifacts</h3>
            <p style="margin:0;color:var(--ink-muted);">JLCPCB Gerber ZIPs, Economic PCBA BOM/CPL, and Interactive BOM (<code>ibom.html</code>).</p>
            <button type="button" class="vb-btn-secondary" data-nav-view="bench">Open Bringup Manual</button>
          </article>
        </section>
      `
      : `
        <div class="vb-manual ${state.railCollapsedB ? "is-rail-collapsed" : ""}">
          ${
            state.railCollapsedB
              ? ""
              : `
                <aside class="vb-rail" aria-label="Section Index">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                    <strong class="mono" style="font-size:0.8rem;">${isBuild ? "CHECKLISTS" : "PATCHES"}</strong>
                    <button type="button" class="va-btn-icon" id="toggle-rail-b">Hide</button>
                  </div>
                  <ul class="va-sidebar-list">${sidebarItems}</ul>
                </aside>
              `
          }
          <article class="vb-doc-body">
            <details class="vb-outline-details">
              <summary>On-Page Outline &amp; Layout Controls ${state.railCollapsedB ? "(Index hidden — click inside to restore)" : ""}</summary>
              <div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:0.6rem;">
                ${state.railCollapsedB ? '<button type="button" class="va-btn-icon" id="toggle-rail-b">Show Section Index</button>' : ""}
                ${
                  isBuild
                    ? '<a href="#test-points">Test Points</a><a href="#bringup-steps">Checklist</a><a href="#electrical-equations">Equations</a><a href="#design-tokens">Tokens</a>'
                    : '<a href="#patch-diagram">Patch Diagram</a><a href="#starting-settings">Starting Settings</a><a href="#dial-in">Dial-In &amp; LED</a><a href="#troubleshooting">Troubleshooting</a>'
                }
              </div>
            </details>
            ${isBuild ? renderBenchBodyContent() : renderPatchBodyContent()}
          </article>
        </div>
      `;

  return `
    <div class="variant-b">
      <header class="vb-header">
        <div class="vb-meta-bar">
          <span>DOC // ENV-SKEW-R1.0 · 6 HP EURORACK · 2× TL074HIDR</span>
          <span>SINGLE-SOURCE HARDWARE &amp; PATCH MANUAL</span>
        </div>
        <div class="vb-nav-row">
          <div class="va-brand-group">
            <button type="button" class="va-menu-btn" id="open-mobile-drawer" aria-label="Open menu">☰ Menu</button>
            <a href="?variant=B&view=home" class="vb-brand" data-nav-view="home">
              <span class="vb-brand-square" aria-hidden="true"></span>
              ENV / SKEW
            </a>
          </div>
          <nav class="vb-nav" aria-label="Primary">
            <button type="button" class="vb-nav-link" ${isPatches ? 'aria-current="page"' : ""} data-nav-view="patch">Patches</button>
            <button type="button" class="vb-nav-link" ${isBuild ? 'aria-current="page"' : ""} data-nav-view="bench">Build</button>
            <button type="button" class="vb-nav-link" data-nav-home-anchor="pathway-hardware">Hardware</button>
            <button type="button" class="vb-nav-link" data-nav-home-anchor="pathway-origin">Origin</button>
            <button type="button" class="vb-nav-link" data-nav-home-anchor="pathway-downloads">Downloads</button>
          </nav>
          <div class="va-actions">
            <button type="button" class="va-btn-icon" id="open-search-btn" aria-label="Search site">⌘K Search</button>
            <a class="va-btn-icon" href="https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter" target="_blank" rel="noreferrer">GitHub ↗</a>
          </div>
        </div>
      </header>

      <main id="main-content" class="vb-main">
        ${mainHtml}
        <div class="vb-settings-bar" role="region" aria-label="Display Preferences">
          <span class="mono" style="font-size:0.78rem;"><strong>Display Theme</strong> (Separate settings surface — follows OS by default):</span>
          <div class="vb-theme-group" role="group" aria-label="Color Scheme Override">
            <button type="button" class="vb-theme-opt" data-scheme-b="system" aria-pressed="${state.schemeB === "system"}">System (${sysNow})</button>
            <button type="button" class="vb-theme-opt" data-scheme-b="light" aria-pressed="${state.schemeB === "light"}">Light</button>
            <button type="button" class="vb-theme-opt" data-scheme-b="dark" aria-pressed="${state.schemeB === "dark"}">Dark</button>
          </div>
        </div>
      </main>
      ${renderGlobalFooter()}
    </div>
  `;
}

/* ============================================================================
 * VARIANT C: STUDIO MONOGRAPH
 * Persistent 228px left vertical navigation spine (no top navbar), Dark-Only + Print Sheet
 * ============================================================================ */
function renderVariantC() {
  const isPatches = state.view === "patch";
  const isBuild = state.view === "bench";

  const printToggleBtn = `
    <button type="button" class="va-btn-icon" id="toggle-print-preview-c" aria-pressed="${state.printPreviewC}">
      ${state.printPreviewC ? "☾ Return to Studio Dark" : "⎙ Preview Print Sheet"}
    </button>
  `;

  const mainHtml =
    state.view === "home"
      ? `
        <section class="vc-poster-hero" aria-label="Studio Monograph Poster">
          <div>
            <p class="va-kicker">6 HP Eurorack · Dark-Room Studio Edition</p>
            <h1 class="vc-poster-title">TWO MODULES IN 6 HP</h1>
            <p class="doc-lead" style="max-inline-size:52ch;">
              Precision envelope follower into an active asymmetric skew limiter. Tuned for low-glare studio patch sessions with dedicated high-contrast bench print sheets.
            </p>
            <div class="va-cta-row">
              <button type="button" class="va-cta-primary" data-nav-view="patch">Explore 8 Patch Guides →</button>
              <button type="button" class="va-cta-secondary" data-nav-view="bench">Print / Bench Bringup</button>
            </div>
          </div>
          <div class="vc-poster-frame">
            <img src="../../images/panel_front.png" alt="ENV / SKEW 6 HP panel hardware photograph" width="165" />
          </div>
        </section>

        <section id="patch-guides-grid" class="vc-mode-band" aria-labelledby="vc-ef-heading">
          <div class="vc-mode-band-head">
            <h2 id="vc-ef-heading" style="margin:0;font-family:var(--font-display);">Envelope Follower Mode (01–05)</h2>
            <span class="mono" style="font-size:0.78rem;color:var(--ink-muted);">IN patched · SLEW IN unpatched</span>
          </div>
          ${PATCH_GUIDES.slice(0, 5)
            .map(
              (p) => `
                <button type="button" class="vc-patch-strip" data-nav-view="patch">
                  <span class="vc-giant-num">${p.num}</span>
                  <span>
                    <strong style="display:block;font-size:1.05rem;">${escapeHtml(p.title)}</strong>
                    <span style="color:var(--ink-muted);font-size:0.86rem;">${escapeHtml(p.summary)}</span>
                  </span>
                  <span class="led-pill" data-led="${p.led.state}">${escapeHtml(p.led.label)}</span>
                </button>
              `
            )
            .join("")}
        </section>

        <section class="vc-mode-band" aria-labelledby="vc-slew-heading">
          <div class="vc-mode-band-head">
            <h2 id="vc-slew-heading" style="margin:0;font-family:var(--font-display);">Asymmetric Skew Limiter Mode (06–08)</h2>
            <span class="mono" style="font-size:0.78rem;color:var(--ink-muted);">SLEW IN patched · DC-coupled</span>
          </div>
          ${PATCH_GUIDES.slice(5)
            .map(
              (p) => `
                <button type="button" class="vc-patch-strip" data-nav-view="patch">
                  <span class="vc-giant-num">${p.num}</span>
                  <span>
                    <strong style="display:block;font-size:1.05rem;">${escapeHtml(p.title)}</strong>
                    <span style="color:var(--ink-muted);font-size:0.86rem;">${escapeHtml(p.summary)}</span>
                  </span>
                  <span class="led-pill" data-led="${p.led.state}">${escapeHtml(p.led.label)}</span>
                </button>
              `
            )
            .join("")}
        </section>

        <section class="va-pathway-strip" aria-label="Studio Dossier">
          <article id="pathway-hardware" class="va-pathway-box">
            <h3>Hardware Showcase</h3>
            <p style="margin:0;color:var(--ink-muted);">A3 schematic, 2-layer SMD/TH sandwich PCB, and Matte Black + ENIG panel art.</p>
          </article>
          <article id="pathway-origin" class="va-pathway-box">
            <h3>Origin Story</h3>
            <p style="margin:0;color:var(--ink-muted);">HAGIWO Project No. 43 → <code>domesticmouse/EnvelopeFollower</code> → ENV / SKEW.</p>
          </article>
          <article id="pathway-downloads" class="va-pathway-box">
            <h3>Downloads &amp; IBOM</h3>
            <p style="margin:0;color:var(--ink-muted);">Hosted <code>bom/ibom.html</code>, Gerber archives, and print-ready bench sheets.</p>
          </article>
        </section>
      `
      : `
        <details class="vb-outline-details no-print">
          <summary>On-Page Contents &amp; Print Sheet Controls</summary>
          <div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:0.55rem;align-items:center;">
            ${isBuild ? printToggleBtn : ""}
            <button type="button" class="va-btn-icon" id="trigger-print-btn">Print Current Sheet</button>
            ${
              isBuild
                ? '<a href="#test-points">Test Points</a><a href="#bringup-steps">Checklist</a><a href="#electrical-equations">Equations</a><a href="#design-tokens">Tokens</a>'
                : '<a href="#patch-diagram">Patch Diagram</a><a href="#starting-settings">Starting Settings</a><a href="#dial-in">Dial-In &amp; LED</a><a href="#troubleshooting">Troubleshooting</a>'
            }
          </div>
        </details>
        ${isBuild ? renderBenchBodyContent(printToggleBtn) : renderPatchBodyContent()}
      `;

  return `
    <div class="variant-c ${state.printPreviewC ? "is-print-preview" : ""}">
      <aside class="vc-spine" aria-label="Studio Navigation Spine">
        <div>
          <a href="?variant=C&view=home" class="slab-logo" data-nav-view="home" style="inline-size:100%;justify-content:center;">ENV / SKEW</a>
          <p class="mono" style="font-size:0.72rem;color:var(--ink-muted);margin:0.5rem 0 0;text-align:center;">
            6 HP EURORACK · DARK-ONLY
          </p>
          <ul class="vc-spine-nav">
            <li><button type="button" class="vc-spine-link" ${state.view === "home" ? 'aria-current="page"' : ""} data-nav-view="home">Home Overview <span>00</span></button></li>
            <li><button type="button" class="vc-spine-link" ${isPatches ? 'aria-current="page"' : ""} data-nav-view="patch">Patches <span>01–08</span></button></li>
            <li><button type="button" class="vc-spine-link" ${isBuild ? 'aria-current="page"' : ""} data-nav-view="bench">Build &amp; Print <span>01–05</span></button></li>
            <li><button type="button" class="vc-spine-link" data-nav-home-anchor="pathway-hardware">Hardware <span>A3</span></button></li>
            <li><button type="button" class="vc-spine-link" data-nav-home-anchor="pathway-origin">Origin <span>#43</span></button></li>
            <li><button type="button" class="vc-spine-link" data-nav-home-anchor="pathway-downloads">Downloads <span>ZIP</span></button></li>
          </ul>
          <div style="margin-top:1.1rem;display:flex;flex-direction:column;gap:0.45rem;">
            <button type="button" class="va-btn-icon" id="open-search-btn" style="justify-content:center;">⌘K Search</button>
            <a class="va-btn-icon" href="https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter" target="_blank" rel="noreferrer" style="justify-content:center;">GitHub Repo ↗</a>
          </div>
        </div>
        <div class="mono" style="font-size:0.7rem;color:var(--ink-muted);border-top:1px solid var(--border-subtle);padding-top:0.75rem;">
          Screen: Low-glare Dark<br>Bench: <code>@media print</code> sheet
        </div>
      </aside>

      <div class="vc-stage">
        <div class="vc-mobile-bar">
          <button type="button" class="va-btn-icon" id="open-mobile-drawer" aria-label="Open menu">☰ Menu</button>
          <a href="?variant=C&view=home" class="slab-logo" data-nav-view="home" style="font-size:1rem;padding:0.25rem 0.65rem;">ENV / SKEW</a>
          <button type="button" class="va-btn-icon" id="open-search-btn-mobile" aria-label="Search">⌘K</button>
        </div>
        <main id="main-content" class="vc-container">${mainHtml}</main>
        ${renderGlobalFooter()}
      </div>
    </div>
  `;
}

/* ============================================================================
 * RENDERING, MATH, DIALOGS, AND EVENT WIRING
 * ============================================================================ */
function renderKatexIfReady() {
  const scope = document.getElementById("katex-scope");
  if (!scope || typeof window.renderMathInElement !== "function") return;
  try {
    window.renderMathInElement(scope, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  } catch {
    /* keep raw fallback */
  }
}

function updateFloatingSwitcher() {
  const meta = VARIANTS.find((v) => v.key === state.variant) || VARIANTS[0];
  document.getElementById("proto-label").textContent = `${meta.key} — ${meta.name}`;
  document.getElementById("proto-state").textContent = `?variant=${state.variant} · view=${state.view} · scheme=${getResolvedScheme()}`;
}

function renderSearchResults(query) {
  const list = document.getElementById("search-results");
  if (!list) return;
  const q = query.trim().toLowerCase();
  const hits = SEARCH_ENTRIES.filter(
    (entry) => !q || entry.title.toLowerCase().includes(q) || entry.section.toLowerCase().includes(q)
  );
  if (hits.length === 0) {
    list.innerHTML = `<li style="padding:0.65rem;color:var(--ink-muted);">No matches for "${escapeHtml(query)}".</li>`;
    return;
  }
  list.innerHTML = hits
    .map(
      (entry, idx) => `
        <li>
          <button type="button" class="search-result-btn" data-search-idx="${idx}">
            <span><strong>${escapeHtml(entry.title)}</strong></span>
            <span class="mono" style="font-size:0.74rem;color:var(--accent-text);">${escapeHtml(entry.section)}</span>
          </button>
        </li>
      `
    )
    .join("");
}

function openSearchDialog() {
  const dlg = document.getElementById("search-dialog");
  const input = document.getElementById("search-input");
  if (!dlg) return;
  renderSearchResults(input?.value || "");
  if (!dlg.open) dlg.showModal();
  input?.focus();
}

function openMobileDrawer() {
  const dlg = document.getElementById("mobile-drawer");
  const list = document.getElementById("mobile-drawer-links");
  if (!dlg || !list) return;
  list.innerHTML = `
    <li><button type="button" data-drawer-view="home">Home Overview</button></li>
    <li><button type="button" data-drawer-view="patch">Patches (01–08)</button></li>
    <li><button type="button" data-drawer-view="bench">Build &amp; Bringup (01–05)</button></li>
    <li><button type="button" data-drawer-anchor="pathway-hardware">Hardware &amp; Panel Art</button></li>
    <li><button type="button" data-drawer-anchor="pathway-origin">Origin Story</button></li>
    <li><a href="https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter" target="_blank" rel="noreferrer">GitHub Repo ↗</a></li>
  `;
  if (!dlg.open) dlg.showModal();
}

function render() {
  const root = document.getElementById("app-root");
  if (!root) return;
  if (state.variant === "B") root.innerHTML = renderVariantB();
  else if (state.variant === "C") root.innerHTML = renderVariantC();
  else root.innerHTML = renderVariantA();

  updateFloatingSwitcher();
  renderKatexIfReady();
}

function installDialogPolyfillsAndReset() {
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("close", () => {
      dialog.returnValue = "";
    });
  }

  // MANDATORY per dialog & light-dismiss-a-dialog guidance for browsers lacking closedby
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e, dialog)) dialog.close();
      });
    }
  }
}

function wireEvents() {
  document.getElementById("proto-prev")?.addEventListener("click", () => cycleVariant(-1));
  document.getElementById("proto-next")?.addEventListener("click", () => cycleVariant(1));

  document.getElementById("search-input")?.addEventListener("input", (e) => {
    renderSearchResults(e.target.value);
  });

  document.getElementById("search-results")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-search-idx]");
    if (!btn) return;
    const query = document.getElementById("search-input")?.value.trim().toLowerCase() || "";
    const hits = SEARCH_ENTRIES.filter(
      (entry) => !query || entry.title.toLowerCase().includes(query) || entry.section.toLowerCase().includes(query)
    );
    const chosen = hits[Number(btn.dataset.searchIdx)];
    document.getElementById("search-dialog")?.close();
    if (chosen) setView(chosen.view, chosen.anchor);
  });

  document.getElementById("mobile-drawer-links")?.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-drawer-view]");
    const anchorBtn = e.target.closest("[data-drawer-anchor]");
    if (viewBtn) {
      document.getElementById("mobile-drawer")?.close();
      setView(viewBtn.dataset.drawerView);
    } else if (anchorBtn) {
      document.getElementById("mobile-drawer")?.close();
      setView("home", anchorBtn.dataset.drawerAnchor);
    }
  });

  document.getElementById("app-root")?.addEventListener("click", (e) => {
    const viewEl = e.target.closest("[data-nav-view]");
    if (viewEl) {
      e.preventDefault();
      setView(viewEl.dataset.navView);
      return;
    }

    const anchorEl = e.target.closest("[data-nav-home-anchor]");
    if (anchorEl) {
      e.preventDefault();
      setView("home", anchorEl.dataset.navHomeAnchor);
      return;
    }

    if (e.target.closest("#open-search-btn") || e.target.closest("#open-search-btn-mobile")) {
      openSearchDialog();
      return;
    }

    if (e.target.closest("#open-mobile-drawer")) {
      openMobileDrawer();
      return;
    }

    if (e.target.closest("#toggle-scheme-a")) {
      state.schemeA = state.schemeA === "dark" ? "light" : "dark";
      writeStorage(STORAGE_A, state.schemeA === "dark" ? null : "light");
      syncColorSchemeMeta();
      render();
      return;
    }

    const themeB = e.target.closest("[data-scheme-b]");
    if (themeB) {
      const next = themeB.dataset.schemeB;
      state.schemeB = next;
      writeStorage(STORAGE_B, next === "system" ? null : next);
      syncColorSchemeMeta();
      render();
      return;
    }

    if (e.target.closest("#toggle-rail-b")) {
      state.railCollapsedB = !state.railCollapsedB;
      render();
      return;
    }

    if (e.target.closest("#toggle-print-preview-c")) {
      state.printPreviewC = !state.printPreviewC;
      syncColorSchemeMeta();
      render();
      return;
    }

    if (e.target.closest("#trigger-print-btn")) {
      window.print();
      return;
    }

    if (e.target.closest("#reset-checklist-btn")) {
      state.checkedIds.clear();
      render();
    }
  });

  document.getElementById("app-root")?.addEventListener("change", (e) => {
    const box = e.target.closest('input[type="checkbox"][data-check-id]');
    if (!box) return;
    if (box.checked) state.checkedIds.add(box.dataset.checkId);
    else state.checkedIds.delete(box.dataset.checkId);
    const prog = document.getElementById("bringup-progress-text");
    if (prog) {
      const count = BRINGUP_CHECKS.filter((c) => state.checkedIds.has(c.id)).length;
      prog.textContent = `${count} / ${BRINGUP_CHECKS.length} checks complete`;
    }
  });

  // Listen to OS color scheme changes per dark-mode guidance
  darkQuery.addEventListener("change", () => {
    if (state.variant === "B") render();
  });

  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_A) {
      state.schemeA = e.newValue || "dark";
      syncColorSchemeMeta();
      render();
    } else if (e.key === STORAGE_B) {
      state.schemeB = e.newValue || "system";
      syncColorSchemeMeta();
      render();
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearchDialog();
      return;
    }

    const activeTag = document.activeElement?.tagName;
    const isEditable =
      activeTag === "INPUT" ||
      activeTag === "TEXTAREA" ||
      activeTag === "SELECT" ||
      document.activeElement?.isContentEditable;
    const hasOpenModal = Boolean(document.querySelector("dialog[open]"));

    if (isEditable || hasOpenModal) return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      cycleVariant(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      cycleVariant(1);
    }
  });

  window.addEventListener("load", renderKatexIfReady);
}

parseUrlParams();
syncColorSchemeMeta();
installDialogPolyfillsAndReset();
wireEvents();
render();
